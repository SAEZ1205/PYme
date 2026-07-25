import type {
  AIActionEnvelope,
  Customer,
  Product,
} from "../types/domain";
import {
  findCustomerMention,
  findProductMention,
  parseFirstNumber,
  parsePaymentMethod,
  parsePurchasePurpose,
  parseYesNo,
} from "./parsing";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clarificationQuestion(
  action: AIActionEnvelope,
): string | null {
  const field = action.missingFields[0];
  if (!field) return null;

  const questions: Record<string, string> = {
    productId: "¿Qué producto o servicio es?",
    quantity: "¿Qué cantidad fue?",
    unitPrice: "¿Cuál fue el precio por unidad?",
    unitCost: "¿Cuál fue el costo por unidad?",
    paymentMethod: "¿El pago fue en efectivo, Yape o Plin?",
    amount: "¿Cuál fue el monto exacto?",
    purpose:
      "¿Qué uso tendrá la compra: mercadería para vender, insumo interno o gasto del negocio?",
    name: "¿Cómo se llamará el producto o servicio?",
    salePrice: "¿Cuál será su precio de venta?",
    tracksStock: "¿Deseas controlar el stock de este producto?",
    currentStock: "¿Cuántas unidades hay actualmente?",
    newStock: "¿Cuál debe ser el nuevo stock?",
    editValue:
      "¿Qué deseas cambiar: precio de venta, costo o control de stock?",
    customerName: "¿Cómo se llama el cliente?",
  };

  return questions[field] ?? `Falta completar: ${field}.`;
}

function removeFirstMissing(
  action: AIActionEnvelope,
  field: string,
): AIActionEnvelope {
  return {
    ...action,
    missingFields: action.missingFields.filter(
      (candidate, index) => !(candidate === field && index === 0),
    ),
    confidence: Math.min(0.98, action.confidence + 0.1),
  };
}

export function applyClarification(
  action: AIActionEnvelope,
  answer: string,
  products: Product[],
  customers: Customer[],
): AIActionEnvelope {
  const field = action.missingFields[0];
  if (!field) return action;

  const next: AIActionEnvelope = {
    ...action,
    data: { ...action.data },
    warnings: [...action.warnings],
  };

  const normalizedAnswer = normalizeText(answer);

  if (
    next.action === "register_sale" &&
    (
      normalizedAnswer.includes("era fiado") ||
      normalizedAnswer.includes("te dije fiado") ||
      normalizedAnswer.includes("dije fiado") ||
      normalizedAnswer.includes("dije que era fiado") ||
      normalizedAnswer.includes("fue fiado") ||
      normalizedAnswer.includes("a credito") ||
      normalizedAnswer.includes("al credito")
    )
  ) {
    next.action = "register_credit_sale";
    next.data.paymentMethod = "credit";
    next.data.customerName =
      typeof next.data.customerName === "string"
        ? next.data.customerName
        : null;
    next.missingFields = next.data.customerName
      ? next.missingFields.filter(
          (missing) => missing !== "paymentMethod",
        )
      : [
          ...next.missingFields.filter(
            (missing) =>
              missing !== "paymentMethod" &&
              missing !== "customerName",
          ),
          "customerName",
        ];
    next.userMessage = "Preparé la operación como venta fiada.";
    next.warnings = [
      "La operación fue corregida de venta pagada a venta fiada.",
      ...next.warnings,
    ];
    return next;
  }

  if (field === "productId") {
    const product = findProductMention(answer, products);
    if (!product) return next;
    next.data.productId = product.id;
    next.data.productName = product.name;
    return removeFirstMissing(next, field);
  }



  if (field === "customerName") {
    const name = answer.trim();
    if (name.length < 2) return next;
    const customer = findCustomerMention(name, customers);
    next.data.customerName = customer?.name ?? name;
    if (customer) next.data.customerId = customer.id;
    return removeFirstMissing(next, field);
  }

  if (field === "paymentMethod") {
    const paymentMethod = parsePaymentMethod(answer);
    if (!paymentMethod) return next;
    next.data.paymentMethod = paymentMethod;
    return removeFirstMissing(next, field);
  }

  if (field === "purpose") {
    const purpose = parsePurchasePurpose(answer);
    if (!purpose) return next;
    next.data.purpose = purpose;
    return removeFirstMissing(next, field);
  }

  if (field === "tracksStock") {
    const tracksStock = parseYesNo(answer);
    if (tracksStock === null) return next;
    next.data.tracksStock = tracksStock;
    let updated = removeFirstMissing(next, field);
    if (
      tracksStock &&
      updated.data.currentStock === null &&
      !updated.missingFields.includes("currentStock")
    ) {
      updated = {
        ...updated,
        missingFields: ["currentStock", ...updated.missingFields],
      };
    }
    if (!tracksStock) {
      updated.data.currentStock = null;
      updated.data.minimumStock = null;
      updated.missingFields = updated.missingFields.filter(
        (candidate) => candidate !== "currentStock",
      );
    }
    return updated;
  }

  if (field === "name") {
    const name = answer.trim();
    if (name.length < 2) return next;
    next.data.name = name;
    return removeFirstMissing(next, field);
  }

  if (field === "editValue") {
    const lower = answer.toLowerCase();
    const value = parseFirstNumber(answer);
    if (lower.includes("precio") && value !== null) {
      next.data.salePrice = value;
      return removeFirstMissing(next, field);
    }
    if (lower.includes("costo") && value !== null) {
      next.data.purchaseCost = value;
      return removeFirstMissing(next, field);
    }
    const stockChoice = parseYesNo(answer);
    if (lower.includes("stock") && stockChoice !== null) {
      next.data.tracksStock = stockChoice;
      let updated = removeFirstMissing(next, field);
      if (stockChoice) {
        updated.missingFields = ["currentStock", ...updated.missingFields];
      }
      return updated;
    }
    return next;
  }

  const numericFields = new Set([
    "quantity",
    "unitPrice",
    "unitCost",
    "amount",
    "salePrice",
    "currentStock",
    "newStock",
  ]);
  if (numericFields.has(field)) {
    const value = parseFirstNumber(answer);
    if (value === null || value < 0) return next;
    next.data[field] = value;
    return removeFirstMissing(next, field);
  }

  return next;
}
