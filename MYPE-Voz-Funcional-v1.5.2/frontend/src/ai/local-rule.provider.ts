import type {
  AIActionEnvelope,
  AIActionName,
  ExpenseCategory,
  Product,
} from "../types/domain";
import type { AIProvider, AIProviderContext } from "./provider";
import {
  extractCustomerName,
  extractOperationProductName,
  extractQuantity,
  extractTotalAmount,
  extractUnitPrice,
  findCustomerMention,
  findProductMention,
  normalizeText,
  NUMBER_PATTERN,
  parseFirstNumber,
  parsePaymentMethod,
  parsePurchasePurpose,
} from "./parsing";

function buildEnvelope(input: {
  action: AIActionName;
  text: string;
  data?: Record<string, unknown>;
  missingFields?: string[];
  warnings?: string[];
  requiresConfirmation?: boolean;
  userMessage: string;
}): AIActionEnvelope {
  const missingFields = input.missingFields ?? [];
  return {
    id: crypto.randomUUID(),
    action: input.action,
    confidence: Math.max(0.52, 0.97 - missingFields.length * 0.11),
    data: input.data ?? {},
    missingFields,
    warnings: input.warnings ?? [],
    requiresConfirmation: input.requiresConfirmation ?? true,
    userMessage: input.userMessage,
    originalText: input.text,
    createdAt: new Date().toISOString(),
    source: "local-rules",
  };
}

function categoryFromText(value: string): ExpenseCategory {
  const text = normalizeText(value);
  if (text.includes("alquiler")) return "rent";
  if (
    text.includes("luz") ||
    text.includes("agua") ||
    text.includes("internet") ||
    text.includes("telefono")
  ) {
    return "utilities";
  }
  if (
    text.includes("transporte") ||
    text.includes("movilidad") ||
    text.includes("taxi")
  ) {
    return "transport";
  }
  if (text.includes("mantenimiento") || text.includes("reparacion")) {
    return "maintenance";
  }
  if (text.includes("proveedor")) return "supplier_payment";
  return "other";
}

function extractCreateName(value: string): string | null {
  const text = normalizeText(value);
  const match = text.match(
    /(?:crea|agrega|registra)(?:me)?\s+(?:un|una)?\s*(?:producto|servicio)\s+(.+?)(?=\s+(?:con|precio|costo|stock|sin|que)\b|$)/,
  );
  return match?.[1]?.trim() || null;
}

function extractNamedValue(
  value: string,
  labels: string[],
): number | null {
  const text = normalizeText(value);
  for (const label of labels) {
    const match = text.match(
      new RegExp(
        String.raw`${label}\s*(?:de|a|es)?\s*(${NUMBER_PATTERN})\s*(?:soles?|s\/)?`,
      ),
    );
    const parsed = parseFirstNumber(match?.[1] ?? "");
    if (parsed !== null) return parsed;
  }
  return null;
}

function isMarketIdeaRequest(value: string): boolean {
  const text = normalizeText(value);

  const dataBased =
    text.includes("segun mis datos") ||
    text.includes("basado en mis ventas") ||
    text.includes("analiza mis datos") ||
    text.includes("que puedo mejorar") ||
    text.includes("que me recomiendas mejorar") ||
    text.includes("que deberia priorizar");

  if (dataBased) return false;

  return (
    (
      (
        text.includes("que otras cosas") ||
        text.includes("que mas") ||
        text.includes("que otros productos") ||
        text.includes("que productos")
      ) &&
      (
        text.includes("vender") ||
        text.includes("ofrecer") ||
        text.includes("comprar") ||
        text.includes("agregar")
      )
    ) ||
    text.includes("recomiendas comprar") ||
    text.includes("recomiendas vender") ||
    text.includes("ideas de productos") ||
    text.includes("productos para vender")
  );
}

function localBusinessIdeaResponse(value: string): {
  message: string;
  prompts: string[];
} {
  const text = normalizeText(value);

  if (
    text.includes("barberia") ||
    text.includes("barbero") ||
    text.includes("cabello") ||
    text.includes("barba")
  ) {
    return {
      message:
        "Para complementar una barbería, empezaría con pomadas o ceras, polvo texturizante, shampoo y acondicionador, aceite o bálsamo para barba, aftershave y sérum o protector térmico. Prueba primero cuatro categorías con pocas unidades y ofrece el producto que utilizaste al finalizar el corte.",
      prompts: [
        "Dame una lista inicial con pocas unidades",
        "Ayúdame a elegir cuatro categorías",
        "¿Cómo puedo ofrecerlos después del corte?",
      ],
    };
  }

  return {
    message:
      "Para ampliar la oferta, elige productos que complementen tu servicio principal. Empieza con tres o cuatro categorías, pocas unidades y una prueba corta antes de ampliar el catálogo.",
    prompts: [
      "Dame categorías concretas",
      "Ayúdame a definir una prueba pequeña",
      "¿Cómo calculo cuánto comprar?",
    ],
  };
}

function actionMessage(action: AIActionName, product?: Product | null): string {
  const name = product?.name ?? "el artículo";
  const messages: Record<AIActionName, string> = {
    register_sale: `Preparé una venta de ${name}.`,
    register_expense: "Preparé el registro del gasto.",
    register_purchase: `Preparé una compra de ${name}.`,
    create_product: "Preparé la creación del artículo.",
    edit_product: `Preparé cambios para ${name}.`,
    adjust_stock: `Preparé el ajuste de stock de ${name}.`,
    deactivate_product: `Preparé la desactivación de ${name}.`,
    query_today_summary: "Voy a revisar el resumen de hoy.",
    query_inventory: "Voy a revisar el inventario.",
    query_cash: "Voy a revisar los saldos de Caja.",
    query_report: "Voy a preparar el reporte solicitado.",
    query_projection: "Voy a calcular una proyección con los datos registrados.",
    query_recommendations: "Voy a revisar qué acciones podrían ayudar al negocio.",
    create_customer: "Preparé el registro del cliente.",
    register_credit_sale: `Preparé una venta fiada de ${name}.`,
    register_debt_payment: "Preparé el abono de la deuda.",
    query_debts: "Voy a revisar los fiados pendientes.",
    cancel_operation: "Preparé la anulación segura de la operación.",
    conversation: "¿En qué te ayudo?",
    unsupported: "No pude convertir esa frase en una acción segura.",
  };
  return messages[action] ?? messages.unsupported;
}

export class LocalRuleAIProvider implements AIProvider {
  readonly name = "Controlador local estructurado";
  readonly mode = "local-rules" as const;

  async interpret(
    originalText: string,
    context: AIProviderContext,
  ): Promise<AIActionEnvelope> {
    const text = normalizeText(originalText);
    const product = findProductMention(text, context.products);
    const inferredProductName = product
      ? null
      : extractOperationProductName(text);
    const customer = findCustomerMention(text, context.customers);
    const extractedCustomerName = extractCustomerName(text);



    if (
      /^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|ola)(\s+.*)?$/.test(
        text,
      )
    ) {
      return buildEnvelope({
        action: "conversation",
        text: originalText,
        data: {
          responseText:
            "¡Hola! Puedes contarme una venta, compra, gasto o fiado; también puedes preguntarme por Caja, reportes o recomendaciones.",
          suggestedPrompts: [
            "¿Cómo nos fue hoy?",
            "¿Qué me recomiendas mejorar?",
            "Quiero registrar una venta",
          ],
        },
        requiresConfirmation: false,
        userMessage:
          "¡Hola! Puedes contarme una venta, compra, gasto o fiado; también puedes preguntarme por Caja, reportes o recomendaciones.",
      });
    }

    const cancellationIntent =
      /\b(elimina|eliminar|borra|borrar|anula|anular|deshaz|deshacer|cancela|cancelar|revierte|revertir)\b/.test(
        text,
      ) &&
      /\b(operacion|movimiento|venta|compra|gasto|registro|anterior|ultima|ultimo|previa|previo)\b/.test(
        text,
      ) &&
      !(
        /\b(producto|catalogo|articulo)\b/.test(text) &&
        !/\b(venta|compra|gasto|operacion|movimiento)\b/.test(text)
      );

    if (cancellationIntent) {
      const requestedType = text.includes("compra")
        ? "purchase"
        : text.includes("gasto")
          ? "expense"
          : text.includes("venta")
            ? "sale"
            : null;

      const reversible = context.recentOperations.filter(
        (operation) =>
          operation.reversible && operation.status === "confirmed",
      );
      const target = requestedType
        ? reversible.find((operation) => operation.type === requestedType)
        : reversible[0];

      if (!target) {
        const latest = context.recentOperations[0];
        const latestText = latest
          ? ` La última operación fue una ${latest.title.toLowerCase()} por S/ ${latest.amount.toFixed(2)}.`
          : "";
        const responseText = requestedType
          ? `No encontré una ${requestedType === "purchase" ? "compra" : requestedType === "expense" ? "gasto" : "venta"} reciente que pueda anular.${latestText}`
          : `No encontré una operación reciente que pueda anular.${latestText}`;

        return buildEnvelope({
          action: "conversation",
          text: originalText,
          data: { responseText },
          requiresConfirmation: false,
          userMessage: responseText,
        });
      }

      return buildEnvelope({
        action: "cancel_operation",
        text: originalText,
        data: {
          operationId: target.id,
          operationType: target.type,
          operationTitle: target.title,
          operationSummary: target.summary,
          operationAmount: target.amount,
          operationCreatedAt: target.createdAt,
        },
        warnings: [
          "La operación quedará marcada como cancelada y se crearán movimientos de reversión. El historial no se borrará.",
        ],
        userMessage: "Preparé la anulación segura de la operación.",
      });
    }

    if (
      text.includes("quienes nos deben") ||
      text.includes("quien nos debe") ||
      text.includes("deudas pendientes") ||
      text.includes("fiados pendientes") ||
      text.includes("cuanto debe") ||
      text.includes("cuanto nos debe")
    ) {
      return buildEnvelope({
        action: "query_debts",
        text: originalText,
        data: customer
          ? {
              customerId: customer.id,
              customerName: customer.name,
            }
          : extractedCustomerName
            ? { customerName: extractedCustomerName }
            : {},
        requiresConfirmation: false,
        userMessage: actionMessage("query_debts"),
      });
    }

    if (
      /(?:crea|crear|agrega|registra)(?:me)?\s+(?:un|una)?\s*cliente\b/.test(
        text,
      )
    ) {
      const customerName =
        text
          .match(
            /(?:crea|crear|agrega|registra)(?:me)?\s+(?:un|una)?\s*cliente\s+(.+?)(?=\s+(?:con|telefono|nota)\b|$)/,
          )?.[1]
          ?.trim() ?? null;
      return buildEnvelope({
        action: "create_customer",
        text: originalText,
        data: {
          customerName,
          phone: null,
          notes: null,
        },
        missingFields: customerName ? [] : ["customerName"],
        userMessage: actionMessage("create_customer"),
      });
    }

    if (
      text.includes("pago su deuda") ||
      text.includes("pago de su deuda") ||
      text.includes("de su deuda") ||
      /\bpago\b.*\bdeuda\b/.test(text) ||
      text.includes("abono") ||
      text.includes("abona") ||
      text.includes("pago parte") ||
      text.includes("pago la deuda")
    ) {
      const amount = extractTotalAmount(text);
      const paymentMethod = parsePaymentMethod(text);
      const customerName = customer?.name ?? extractedCustomerName;
      const missingFields: string[] = [];
      if (!customerName) missingFields.push("customerName");
      if (amount === null) missingFields.push("amount");
      if (paymentMethod === null) missingFields.push("paymentMethod");

      return buildEnvelope({
        action: "register_debt_payment",
        text: originalText,
        data: {
          customerId: customer?.id,
          customerName,
          amount,
          paymentMethod,
        },
        missingFields,
        userMessage: actionMessage("register_debt_payment"),
      });
    }

    if (
      text.includes("fie") ||
      text.includes("fiamos") ||
      text.includes("fiado") ||
      text.includes("al credito") ||
      text.includes("a credito")
    ) {
      const quantity = extractQuantity(text, product);
      let unitPrice = extractUnitPrice(text);
      const total = extractTotalAmount(text);
      if (unitPrice === null && total !== null && quantity && quantity > 0) {
        unitPrice = total / quantity;
      }

      const customerName = customer?.name ?? extractedCustomerName;
      const createProductIfMissing =
        !product && Boolean(inferredProductName);
      const resolvedProductName =
        product?.name ?? inferredProductName;

      const missingFields: string[] = [];
      if (!product && !inferredProductName) {
        missingFields.push("productId");
      }
      if (quantity === null) missingFields.push("quantity");
      if (unitPrice === null) missingFields.push("unitPrice");
      if (!customerName) missingFields.push("customerName");

      const warnings = [
        "La venta descontará inventario, pero no ingresará dinero a Caja hasta que el cliente pague.",
      ];
      if (createProductIfMissing) {
        warnings.push(
          `${resolvedProductName} no existe en el catálogo. Al confirmar, se creará con stock no registrado y costo de compra pendiente.`,
        );
      }

      return buildEnvelope({
        action: "register_credit_sale",
        text: originalText,
        data: {
          productId: product?.id,
          productName: resolvedProductName,
          createProductIfMissing,
          quantity,
          unitPrice,
          customerId: customer?.id,
          customerName,
          dueDate: null,
        },
        missingFields,
        warnings,
        userMessage: product
          ? actionMessage("register_credit_sale", product)
          : `Preparé una venta fiada de ${resolvedProductName ?? "el artículo"}.`,
      });
    }

    if (
      text.includes("proyeccion") ||
      text.includes("proyecta") ||
      text.includes("podriamos vender") ||
      text.includes("venderemos este mes") ||
      text.includes("cuanto venderemos")
    ) {
      return buildEnvelope({
        action: "query_projection",
        text: originalText,
        requiresConfirmation: false,
        userMessage: actionMessage("query_projection"),
      });
    }

    if (isMarketIdeaRequest(originalText)) {
      const idea = localBusinessIdeaResponse(originalText);

      return buildEnvelope({
        action: "conversation",
        text: originalText,
        data: {
          responseText: idea.message,
          suggestedPrompts: idea.prompts,
        },
        requiresConfirmation: false,
        userMessage: idea.message,
      });
    }

    if (
      text.includes("recomendacion del negocio") ||
      text.includes("recomendaciones del negocio") ||
      text.includes("segun mis datos") ||
      text.includes("basado en mis ventas") ||
      text.includes("analiza mis datos") ||
      text.includes("que puedo mejorar") ||
      text.includes("que me recomiendas mejorar") ||
      text.includes("que deberia priorizar") ||
      text.includes("consejo para mejorar")
    ) {
      return buildEnvelope({
        action: "query_recommendations",
        text: originalText,
        requiresConfirmation: false,
        userMessage: actionMessage("query_recommendations"),
      });
    }

    if (
      text.includes("reporte") ||
      text.includes("informe") ||
      text.includes("ultimos 7 dias") ||
      text.includes("ultimos 30 dias") ||
      text.includes("reporte semanal") ||
      text.includes("reporte mensual")
    ) {
      const period =
        text.includes("30") || text.includes("mensual")
          ? "30days"
          : text.includes("7") || text.includes("semanal")
            ? "7days"
            : "today";
      return buildEnvelope({
        action: "query_report",
        text: originalText,
        data: { period },
        requiresConfirmation: false,
        userMessage: actionMessage("query_report"),
      });
    }

    if (
      text.includes("como nos fue") ||
      text.includes("cuanto vendimos") ||
      text.includes("resumen de hoy") ||
      text.includes("resultado de hoy")
    ) {
      return buildEnvelope({
        action: "query_today_summary",
        text: originalText,
        requiresConfirmation: false,
        userMessage: actionMessage("query_today_summary"),
      });
    }

    if (
      text.includes("cuanto hay en caja") ||
      text.includes("cuanto tenemos en efectivo") ||
      text.includes("cuanto recibimos por yape") ||
      text.includes("cuanto hay en yape") ||
      text.includes("cuanto hay en plin") ||
      text.includes("saldo de yape") ||
      text.includes("saldo de plin")
    ) {
      return buildEnvelope({
        action: "query_cash",
        text: originalText,
        requiresConfirmation: false,
        userMessage: actionMessage("query_cash"),
      });
    }

    if (
      text.includes("stock bajo") ||
      text.includes("queda poco") ||
      text.includes("cuanto queda") ||
      text.includes("inventario")
    ) {
      return buildEnvelope({
        action: "query_inventory",
        text: originalText,
        data: product
          ? { productId: product.id, productName: product.name }
          : {},
        requiresConfirmation: false,
        userMessage: actionMessage("query_inventory", product),
      });
    }

    if (
      /(?:crea|crear|agrega|registra)(?:me)?\s+(?:un|una)?\s*(?:producto|servicio)/.test(
        text,
      )
    ) {
      const type = text.includes("servicio") ? "service" : "product";
      const name = extractCreateName(text);
      const salePrice =
        extractNamedValue(text, ["precio de venta", "precio", "venta"]) ??
        extractUnitPrice(text);
      const purchaseCost = extractNamedValue(text, ["costo", "coste"]);
      const explicitNoStock =
        text.includes("sin stock") || text.includes("sin control de stock");
      const stockMatch = text.match(
        new RegExp(String.raw`stock\s*(?:actual)?\s*(${NUMBER_PATTERN})`),
      );
      const currentStock = parseFirstNumber(stockMatch?.[1] ?? "");
      const tracksStock =
        type === "service"
          ? false
          : explicitNoStock
            ? false
            : currentStock !== null
              ? true
              : null;
      const minimumStock = extractNamedValue(text, [
        "stock minimo",
        "minimo",
      ]);

      const missingFields: string[] = [];
      if (!name) missingFields.push("name");
      if (salePrice === null) missingFields.push("salePrice");
      if (type === "product" && tracksStock === null) {
        missingFields.push("tracksStock");
      }
      if (tracksStock === true && currentStock === null) {
        missingFields.push("currentStock");
      }

      return buildEnvelope({
        action: "create_product",
        text: originalText,
        data: {
          name,
          type,
          purchaseCost,
          salePrice,
          tracksStock,
          currentStock,
          minimumStock: tracksStock ? (minimumStock ?? 0) : null,
        },
        missingFields,
        warnings:
          type === "product" && purchaseCost === null
            ? ["El costo de compra quedará como no registrado."]
            : [],
        userMessage: actionMessage("create_product"),
      });
    }

    if (
      text.includes("desactiva") ||
      text.includes("elimina producto") ||
      text.includes("oculta producto")
    ) {
      const missingFields = product ? [] : ["productId"];
      return buildEnvelope({
        action: "deactivate_product",
        text: originalText,
        data: product
          ? { productId: product.id, productName: product.name }
          : {},
        missingFields,
        warnings: ["El producto no se borrará: quedará desactivado."],
        userMessage: actionMessage("deactivate_product", product),
      });
    }

    if (
      text.includes("ajusta stock") ||
      text.includes("cambia stock") ||
      text.includes("stock de")
    ) {
      const newStockMatch = text.match(
        new RegExp(
          String.raw`(?:stock(?:\s+de)?(?:\s+\w+){0,5}?\s+(?:a|en)|ajusta\s+stock(?:\s+de)?(?:\s+\w+){0,5}?\s+(?:a|en))\s*(${NUMBER_PATTERN})`,
        ),
      );
      const newStock =
        parseFirstNumber(newStockMatch?.[1] ?? "") ??
        parseFirstNumber(text.split("stock").slice(1).join(" "));
      const missingFields: string[] = [];
      if (!product) missingFields.push("productId");
      if (newStock === null) missingFields.push("newStock");

      return buildEnvelope({
        action: "adjust_stock",
        text: originalText,
        data: {
          productId: product?.id,
          productName: product?.name,
          newStock,
          reason: "Ajuste solicitado mediante el asistente",
        },
        missingFields,
        userMessage: actionMessage("adjust_stock", product),
      });
    }

    if (
      text.includes("cambia") ||
      text.includes("modifica") ||
      text.includes("actualiza")
    ) {
      const flexiblePriceMatch = text.match(
        new RegExp(
          String.raw`precio(?:\s+de\s+venta)?(?:\s+de)?(?:\s+\w+){0,6}?\s+(?:a|en)\s*(${NUMBER_PATTERN})`,
        ),
      );
      const flexibleCostMatch = text.match(
        new RegExp(
          String.raw`(?:costo|coste)(?:\s+de)?(?:\s+\w+){0,6}?\s+(?:a|en)\s*(${NUMBER_PATTERN})`,
        ),
      );
      const salePrice =
        parseFirstNumber(flexiblePriceMatch?.[1] ?? "") ??
        extractNamedValue(text, ["precio de venta", "precio"]);
      const purchaseCost =
        parseFirstNumber(flexibleCostMatch?.[1] ?? "") ??
        extractNamedValue(text, ["costo", "coste"]);
      const activateStock =
        text.includes("activa control de stock") ||
        text.includes("controlar stock")
          ? true
          : text.includes("desactiva control de stock") ||
              text.includes("sin control de stock")
            ? false
            : null;
      const currentStock =
        activateStock === true
          ? extractNamedValue(text, ["stock actual", "stock"])
          : null;

      const missingFields: string[] = [];
      if (!product) missingFields.push("productId");
      if (
        salePrice === null &&
        purchaseCost === null &&
        activateStock === null
      ) {
        missingFields.push("editValue");
      }
      if (activateStock === true && currentStock === null) {
        missingFields.push("currentStock");
      }

      return buildEnvelope({
        action: "edit_product",
        text: originalText,
        data: {
          productId: product?.id,
          productName: product?.name,
          salePrice,
          purchaseCost,
          tracksStock: activateStock,
          currentStock,
        },
        missingFields,
        userMessage: actionMessage("edit_product", product),
      });
    }

    if (
      text.includes("compre") ||
      text.includes("compramos") ||
      text.includes("compra de")
    ) {
      const quantity = extractQuantity(text, product);
      let unitCost = extractUnitPrice(text);
      const total = extractTotalAmount(text);
      if (unitCost === null && total !== null && quantity && quantity > 0) {
        unitCost = total / quantity;
      }
      const purpose = parsePurchasePurpose(text);
      const paymentMethod = parsePaymentMethod(text);
      const additionalCosts =
        extractNamedValue(text, ["transporte", "gasto adicional"]) ?? 0;

      const missingFields: string[] = [];
      if (!product) missingFields.push("productId");
      if (quantity === null) missingFields.push("quantity");
      if (unitCost === null) missingFields.push("unitCost");
      if (purpose === null) missingFields.push("purpose");
      if (paymentMethod === null) missingFields.push("paymentMethod");

      return buildEnvelope({
        action: "register_purchase",
        text: originalText,
        data: {
          productId: product?.id,
          productName: product?.name,
          quantity,
          unitCost,
          purpose,
          paymentMethod,
          additionalCosts,
          supplierName: null,
          purchasedAt: new Date().toISOString(),
        },
        missingFields,
        warnings:
          purpose === null
            ? ["La aplicación nunca asumirá el uso de una compra."]
            : [],
        userMessage: actionMessage("register_purchase", product),
      });
    }

    if (
      text.includes("gaste") ||
      text.includes("pague alquiler") ||
      text.includes("pague internet") ||
      text.includes("pague luz") ||
      text.includes("pague agua") ||
      text.includes("gasto de")
    ) {
      const amount = extractTotalAmount(text);
      const paymentMethod = parsePaymentMethod(text);
      const category = categoryFromText(text);
      const missingFields: string[] = [];
      if (amount === null) missingFields.push("amount");
      if (paymentMethod === null) missingFields.push("paymentMethod");

      return buildEnvelope({
        action: "register_expense",
        text: originalText,
        data: {
          category,
          description: originalText.trim(),
          amount,
          paymentMethod,
          occurredAt: new Date().toISOString(),
        },
        missingFields,
        userMessage: actionMessage("register_expense"),
      });
    }

    if (
      text.includes("vendi") ||
      text.includes("vendimos") ||
      text.includes("venta de") ||
      text.includes("cobre")
    ) {
      const quantity = extractQuantity(text, product);
      let unitPrice = extractUnitPrice(text);
      const total = extractTotalAmount(text);
      const paymentMethod = parsePaymentMethod(text);

      if (unitPrice === null && total !== null && quantity && quantity > 0) {
        unitPrice = total / quantity;
      }

      const createProductIfMissing =
        !product && Boolean(inferredProductName);
      const resolvedProductName =
        product?.name ?? inferredProductName;

      const missingFields: string[] = [];
      if (!product && !inferredProductName) {
        missingFields.push("productId");
      }
      if (quantity === null) missingFields.push("quantity");
      if (unitPrice === null) missingFields.push("unitPrice");
      if (paymentMethod === null) missingFields.push("paymentMethod");

      const warnings: string[] = [];
      if (
        product &&
        unitPrice !== null &&
        Math.abs(unitPrice - product.salePrice) > 0.001
      ) {
        warnings.push(
          `El precio indicado es distinto al precio guardado de S/ ${product.salePrice.toFixed(2)}.`,
        );
      }
      if (createProductIfMissing) {
        warnings.push(
          `${resolvedProductName} no existe en el catálogo. Al confirmar, se creará con stock no registrado y costo pendiente.`,
        );
      }

      return buildEnvelope({
        action: "register_sale",
        text: originalText,
        data: {
          productId: product?.id,
          productName: resolvedProductName,
          createProductIfMissing,
          quantity,
          unitPrice,
          paymentMethod,
        },
        missingFields,
        warnings,
        userMessage: product
          ? actionMessage("register_sale", product)
          : `Preparé una venta de ${resolvedProductName ?? "el artículo"}.`,
      });
    }


    if (
      text.includes("como estas") ||
      text === "gracias" ||
      text.includes("muchas gracias") ||
      text.includes("ayudame con mi negocio") ||
      text.includes("quiero mejorar mi negocio")
    ) {
      const responseText = text.includes("gracias")
        ? "Con gusto. Podemos revisar qué ocurrió hoy, analizar tus gastos o elegir una mejora concreta para el negocio."
        : "Estoy listo para ayudarte con el negocio. Cuéntame qué te preocupa o revisemos ventas, gastos, inventario, fiados y próximos pasos.";

      return buildEnvelope({
        action: "conversation",
        text: originalText,
        data: {
          responseText,
          suggestedPrompts: [
            "¿Cómo nos fue hoy?",
            "Analiza mis gastos",
            "¿Qué debería priorizar ahora?",
          ],
        },
        requiresConfirmation: false,
        userMessage: responseText,
      });
    }

    return buildEnvelope({
      action: "unsupported",
      text: originalText,
      requiresConfirmation: false,
      userMessage:
        "Todavía no puedo convertir esa frase en una acción segura. Prueba con una venta, gasto, compra, producto, stock o consulta.",
    });
  }
}
