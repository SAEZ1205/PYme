import { z } from "zod";
import { db } from "../database/db";
import {
  ensureCustomer,
  findCustomerByName,
  getCustomerDebtSummaries,
  payCustomerDebt,
  saveCustomer,
} from "../services/debt.service";
import { confirmExpense } from "../services/expense.service";
import { adjustProductStock } from "../services/inventory.service";
import {
  getBusinessRecommendations,
  getProjectionSnapshot,
  getReportSnapshot,
} from "../services/insights.service";
import { cancelBusinessOperation } from "../services/operation.service";
import { deactivateProduct, saveProduct } from "../services/product.service";
import {
  calculatePurchaseTotal,
  confirmPurchase,
} from "../services/purchase.service";
import { calculateSaleTotal, confirmSale } from "../services/sale.service";
import type {
  AIActionEnvelope,
  AIExecutionResult,
  PaymentMethod,
  Product,
  BusinessOperationType,
  PurchasePurpose,
} from "../types/domain";
import {
  recordAIConfirmation,
  setAIActionStatus,
} from "./action-audit.service";

const saleSchema = z
  .object({
    productId: z.string().min(1).optional(),
    productName: z.string().trim().min(2),
    createProductIfMissing: z.boolean().optional().default(false),
    quantity: z.number().int().positive(),
    unitPrice: z.number().positive(),
    paymentMethod: z.enum(["cash", "yape", "plin"]),
  })
  .superRefine((data, context) => {
    if (!data.productId && !data.createProductIfMissing) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: "Falta identificar el producto.",
      });
    }
  });


const createCustomerSchema = z.object({
  customerName: z.string().trim().min(2),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const creditSaleSchema = z
  .object({
    productId: z.string().min(1).optional(),
    productName: z.string().trim().min(2),
    createProductIfMissing: z.boolean().optional().default(false),
    quantity: z.number().int().positive(),
    unitPrice: z.number().positive(),
    customerId: z.string().optional(),
    customerName: z.string().trim().min(2),
    dueDate: z.string().nullable().optional(),
  })
  .superRefine((data, context) => {
    if (!data.productId && !data.createProductIfMissing) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: "Falta identificar el producto.",
      });
    }
  });

const debtPaymentSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().trim().min(2),
  amount: z.number().positive(),
  paymentMethod: z.enum(["cash", "yape", "plin"]),
});

const expenseSchema = z.object({
  category: z.enum([
    "rent",
    "utilities",
    "transport",
    "maintenance",
    "supplier_payment",
    "other",
  ]),
  description: z.string().min(2),
  amount: z.number().positive(),
  paymentMethod: z.enum(["cash", "yape", "plin"]),
  occurredAt: z.string().min(1),
});

const purchaseSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: z.number().positive(),
  purpose: z.enum(["merchandise", "internal_supply", "business_expense"]),
  paymentMethod: z.enum(["cash", "yape", "plin"]),
  additionalCosts: z.number().min(0),
  supplierName: z.string().nullable(),
  purchasedAt: z.string().min(1),
});

const createProductSchema = z.object({
  name: z.string().trim().min(2),
  type: z.enum(["product", "service"]),
  purchaseCost: z.number().min(0).nullable(),
  salePrice: z.number().positive(),
  tracksStock: z.boolean(),
  currentStock: z.number().int().min(0).nullable(),
  minimumStock: z.number().int().min(0).nullable(),
});

const editProductSchema = z.object({
  productId: z.string().min(1),
  salePrice: z.number().positive().nullable().optional(),
  purchaseCost: z.number().min(0).nullable().optional(),
  tracksStock: z.boolean().nullable().optional(),
  currentStock: z.number().int().min(0).nullable().optional(),
});

const adjustStockSchema = z.object({
  productId: z.string().min(1),
  newStock: z.number().int().min(0),
  reason: z.string().min(2),
});

const cancelOperationSchema = z.object({
  operationId: z.string().min(1),
  operationType: z.enum(["sale", "expense", "purchase"]),
});

const conversationSchema = z.object({
  responseText: z.string().trim().min(1),
  suggestedPrompts: z
    .array(z.string().trim().min(1).max(100))
    .max(4)
    .default([]),
});

async function getProduct(productId: string): Promise<Product> {
  const product = await db.products.get(productId);
  if (!product || !product.active) {
    throw new Error("El producto ya no está disponible.");
  }
  return product;
}

async function queryTodaySummary(): Promise<AIExecutionResult> {
  const today = new Date();
  const dayKey = (value: string | Date) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  const [sales, expenses, cashMovements, saleItems, debts] =
    await Promise.all([
      db.sales.toArray(),
      db.expenses.toArray(),
      db.cashMovements.toArray(),
      db.saleItems.toArray(),
      db.debts.toArray(),
    ]);

  const todaySales = sales.filter(
    (sale) =>
      sale.status === "confirmed" && dayKey(sale.createdAt) === dayKey(today),
  );
  const todaySaleIds = new Set(todaySales.map((sale) => sale.id));
  const todayExpenses = expenses.filter(
    (expense) =>
      expense.status === "confirmed" &&
      dayKey(expense.occurredAt) === dayKey(today),
  );
  const salesTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  const expensesTotal = todayExpenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );
  const costs = saleItems
    .filter((item) => todaySaleIds.has(item.saleId))
    .reduce((sum, item) => sum + (item.unitCost ?? 0) * item.quantity, 0);
  const cash = cashMovements
    .filter(
      (movement) =>
        movement.paymentMethod === "cash" &&
        dayKey(movement.createdAt) === dayKey(today),
    )
    .reduce(
      (sum, movement) =>
        sum + (movement.type === "income" ? movement.amount : -movement.amount),
      0,
    );

  const pendingDebt = debts
    .filter((debt) => debt.status === "pending")
    .reduce((sum, debt) => sum + debt.balance, 0);

  return {
    title: "Resumen de hoy",
    kind: "analysis",
    message: `Hoy se registraron ${todaySales.length} ventas por S/ ${salesTotal.toFixed(2)}. El efectivo esperado es S/ ${cash.toFixed(2)} y los fiados pendientes totales suman S/ ${pendingDebt.toFixed(2)}.`,
    details: [
      { label: "Ventas", value: `S/ ${salesTotal.toFixed(2)}` },
      {
        label: "Resultado aproximado",
        value: `S/ ${(salesTotal - costs - expensesTotal).toFixed(2)}`,
      },
      { label: "Efectivo esperado", value: `S/ ${cash.toFixed(2)}` },
      { label: "Fiados pendientes", value: `S/ ${pendingDebt.toFixed(2)}` },
    ],
  };
}

async function queryInventory(
  action: AIActionEnvelope,
): Promise<AIExecutionResult> {
  const productId =
    typeof action.data.productId === "string"
      ? action.data.productId
      : undefined;

  if (productId) {
    const product = await getProduct(productId);
    return {
      title: `Inventario de ${product.name}`,
      message:
        product.type === "service"
          ? `${product.name} es un servicio y no utiliza stock.`
          : product.tracksStock
            ? `${product.name} tiene ${product.currentStock ?? 0} unidades. El mínimo configurado es ${product.minimumStock ?? 0}.`
            : `${product.name} está configurado con stock no registrado.`,
    };
  }

  const products = await db.products
    .filter((product) => product.active && product.type === "product")
    .toArray();
  const low = products.filter(
    (product) =>
      product.tracksStock &&
      (product.currentStock ?? 0) <= (product.minimumStock ?? 0),
  );
  const untracked = products.filter((product) => !product.tracksStock);

  return {
    title: "Estado del inventario",
    message: low.length
      ? `Hay ${low.length} productos en nivel bajo o agotado: ${low
          .slice(0, 5)
          .map((product) => product.name)
          .join(", ")}. Además, ${untracked.length} productos tienen stock no registrado.`
      : `No hay alertas de stock entre los productos controlados. ${untracked.length} productos tienen stock no registrado.`,
  };
}

async function queryCash(): Promise<AIExecutionResult> {
  const today = new Date();
  const sameDay = (value: string) => {
    const date = new Date(value);
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };
  const movements = (await db.cashMovements.toArray()).filter((movement) =>
    sameDay(movement.createdAt),
  );

  const totals: Record<PaymentMethod, number> = {
    cash: 0,
    yape: 0,
    plin: 0,
  };
  for (const movement of movements) {
    totals[movement.paymentMethod] +=
      movement.type === "income" ? movement.amount : -movement.amount;
  }

  return {
    title: "Saldos de hoy",
    message: `Efectivo esperado: S/ ${totals.cash.toFixed(2)}. Yape: S/ ${totals.yape.toFixed(2)}. Plin: S/ ${totals.plin.toFixed(2)}.`,
  };
}


async function queryDebts(
  action: AIActionEnvelope,
): Promise<AIExecutionResult> {
  const summaries = await getCustomerDebtSummaries();
  const requestedId =
    typeof action.data.customerId === "string"
      ? action.data.customerId
      : null;
  const requestedName =
    typeof action.data.customerName === "string"
      ? action.data.customerName
      : null;

  let selected = requestedId
    ? summaries.find((summary) => summary.customer.id === requestedId)
    : undefined;

  if (!selected && requestedName) {
    const normalized = requestedName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    selected = summaries.find(
      (summary) =>
        summary.customer.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") === normalized,
    );
  }

  if (requestedName || requestedId) {
    if (!selected) {
      return {
        title: "Consulta de deuda",
        message: requestedName
          ? `No encontré una deuda pendiente para ${requestedName}.`
          : "No encontré una deuda pendiente para ese cliente.",
      };
    }

    return {
      title: `Deuda de ${selected.customer.name}`,
      message: selected.pendingBalance > 0
        ? `${selected.customer.name} tiene ${selected.pendingDebts} ${selected.pendingDebts === 1 ? "venta fiada pendiente" : "ventas fiadas pendientes"}.`
        : `${selected.customer.name} no tiene deuda pendiente.`,
      details: [
        {
          label: "Saldo pendiente",
          value: `S/ ${selected.pendingBalance.toFixed(2)}`,
        },
        {
          label: "Fiados abiertos",
          value: String(selected.pendingDebts),
        },
      ],
    };
  }

  const pending = summaries.filter((summary) => summary.pendingBalance > 0);
  const total = pending.reduce(
    (sum, summary) => sum + summary.pendingBalance,
    0,
  );

  return {
    title: "Fiados pendientes",
    message: pending.length
      ? `${pending.length} ${pending.length === 1 ? "cliente tiene" : "clientes tienen"} deuda pendiente.`
      : "Ningún cliente tiene deuda pendiente.",
    details: [
      { label: "Total por cobrar", value: `S/ ${total.toFixed(2)}` },
      { label: "Clientes con deuda", value: String(pending.length) },
    ],
    suggestions: pending.slice(0, 5).map(
      (summary) =>
        `${summary.customer.name}: S/ ${summary.pendingBalance.toFixed(2)}`,
    ),
  };
}

export async function executeAIAction(
  action: AIActionEnvelope,
): Promise<AIExecutionResult> {
  if (action.missingFields.length) {
    throw new Error("La acción todavía tiene datos pendientes.");
  }

  if (action.requiresConfirmation) {
    await recordAIConfirmation(action.id, "confirmed");
  }
  await setAIActionStatus(action.id, "executing");

  try {
    let result: AIExecutionResult;

    switch (action.action) {

      case "conversation": {
        const data = conversationSchema.parse(action.data);
        result = {
          title: "MYPE Voz",
          message: data.responseText,
          quickReplies: data.suggestedPrompts,
          kind: "conversation",
        };
        break;
      }

      case "cancel_operation": {
        const data = cancelOperationSchema.parse(action.data);
        const cancelled = await cancelBusinessOperation({
          operationId: data.operationId,
          operationType: data.operationType as BusinessOperationType,
        });

        result = {
          title: cancelled.title,
          message:
            "La operación fue marcada como cancelada. El historial se conserva y los efectos contables fueron revertidos.",
          details: [
            {
              label: "Monto anulado",
              value: `S/ ${cancelled.amount.toFixed(2)}`,
            },
            {
              label: "Reversión de Caja",
              value: `S/ ${cancelled.cashReversal.toFixed(2)}`,
            },
            {
              label: "Reversiones de inventario",
              value: String(cancelled.inventoryReversals),
            },
          ],
          referenceId: cancelled.operationId,
        };
        break;
      }

      case "create_customer": {
        const data = createCustomerSchema.parse(action.data);
        const customer = await saveCustomer({
          name: data.customerName,
          phone: data.phone ?? null,
          notes: data.notes ?? null,
        });
        result = {
          title: "Cliente registrado",
          message: `${customer.name} ya está disponible para ventas fiadas y pagos.`,
          referenceId: customer.id,
        };
        break;
      }

      case "register_credit_sale": {
        const data = creditSaleSchema.parse(action.data);
        const customer = await ensureCustomer({
          customerId: data.customerId,
          customerName: data.customerName,
        });

        const product = data.productId
          ? await getProduct(data.productId)
          : await saveProduct({
              name: data.productName,
              type: "product",
              purchaseCost: null,
              salePrice: data.unitPrice,
              tracksStock: false,
              currentStock: null,
              minimumStock: null,
            });

        const draft = {
          items: [
            {
              productId: product.id,
              productName: product.name,
              productType: product.type,
              quantity: data.quantity,
              unitPrice: data.unitPrice,
              unitCost: product.purchaseCost,
              tracksStock: product.tracksStock,
              availableStock: product.currentStock,
            },
          ],
          paymentMethod: "credit" as const,
          customerId: customer.id,
          dueDate: data.dueDate ?? null,
        };
        const confirmed = await confirmSale(draft);
        result = {
          title: "Venta fiada registrada",
          message: `${
            data.createProductIfMissing
              ? `${product.name} fue agregado al catálogo con stock no registrado. `
              : ""
          }Se creó una deuda de S/ ${confirmed.total.toFixed(2)} para ${customer.name}. Caja no recibió dinero todavía.`,
          details: [
            { label: "Cliente", value: customer.name },
            { label: "Deuda nueva", value: `S/ ${confirmed.total.toFixed(2)}` },
            { label: "Ingreso a Caja", value: "S/ 0.00" },
          ],
          referenceId: confirmed.debtId,
        };
        break;
      }

      case "register_debt_payment": {
        const data = debtPaymentSchema.parse(action.data);
        const customer =
          (data.customerId
            ? await db.customers.get(data.customerId)
            : await findCustomerByName(data.customerName)) ?? null;

        if (!customer?.active) {
          throw new Error(`No encontré al cliente ${data.customerName}.`);
        }

        const payment = await payCustomerDebt({
          customerId: customer.id,
          amount: data.amount,
          paymentMethod: data.paymentMethod,
        });
        result = {
          title: "Abono registrado",
          message: `${payment.customerName} pagó S/ ${payment.amountPaid.toFixed(2)}. El pago ingresó a Caja y redujo su deuda.`,
          details: [
            {
              label: "Abono",
              value: `S/ ${payment.amountPaid.toFixed(2)}`,
            },
            {
              label: "Saldo pendiente",
              value: `S/ ${payment.remainingBalance.toFixed(2)}`,
            },
          ],
          referenceId: payment.paymentIds[0],
        };
        break;
      }

      case "register_sale": {
        const data = saleSchema.parse(action.data);
        const product = data.productId
          ? await getProduct(data.productId)
          : await saveProduct({
              name: data.productName,
              type: "product",
              purchaseCost: null,
              salePrice: data.unitPrice,
              tracksStock: false,
              currentStock: null,
              minimumStock: null,
            });
        const draft = {
          items: [
            {
              productId: product.id,
              productName: product.name,
              productType: product.type,
              quantity: data.quantity,
              unitPrice: data.unitPrice,
              unitCost: product.purchaseCost,
              tracksStock: product.tracksStock,
              availableStock: product.currentStock,
            },
          ],
          paymentMethod: data.paymentMethod,
        };
        const confirmed = await confirmSale(draft);
        result = {
          title: "Venta registrada",
          message: `${
            data.createProductIfMissing
              ? `${product.name} fue agregado al catálogo con stock no registrado. `
              : ""
          }Se guardó la venta por S/ ${calculateSaleTotal(draft).toFixed(2)}. Caja e inventario fueron actualizados.`,
          details: [
            { label: "Producto", value: product.name },
            {
              label: "Total",
              value: `S/ ${calculateSaleTotal(draft).toFixed(2)}`,
            },
            {
              label: "Método",
              value:
                data.paymentMethod === "cash"
                  ? "Efectivo"
                  : data.paymentMethod === "yape"
                    ? "Yape"
                    : "Plin",
            },
          ],
          referenceId: confirmed.saleId,
        };
        break;
      }

      case "register_expense": {
        const data = expenseSchema.parse(action.data);
        const confirmed = await confirmExpense(data);
        result = {
          title: "Gasto registrado",
          message: `Se registró una salida de S/ ${confirmed.amount.toFixed(2)} en Caja.`,
          referenceId: confirmed.expenseId,
        };
        break;
      }

      case "register_purchase": {
        const data = purchaseSchema.parse(action.data);
        const product = await getProduct(data.productId);
        if (product.type !== "product") {
          throw new Error("Las compras de mercadería requieren un producto.");
        }
        const draft = {
          supplierName: data.supplierName,
          purpose: data.purpose as PurchasePurpose,
          items: [
            {
              productId: product.id,
              productName: product.name,
              quantity: data.quantity,
              unitCost: data.unitCost,
              tracksStock: product.tracksStock,
              currentStock: product.currentStock,
            },
          ],
          additionalCosts: data.additionalCosts,
          paymentMethod: data.paymentMethod,
          purchasedAt: data.purchasedAt,
        };
        const confirmed = await confirmPurchase(draft);
        result = {
          title: "Compra registrada",
          message: `Se guardó la compra por S/ ${calculatePurchaseTotal(draft).toFixed(2)}. Se actualizaron ${confirmed.productsUpdated} productos y ${confirmed.inventoryMovements} movimientos de inventario.`,
          referenceId: confirmed.purchaseId,
        };
        break;
      }

      case "create_product": {
        const data = createProductSchema.parse(action.data);
        const product = await saveProduct({
          name: data.name,
          type: data.type,
          purchaseCost: data.type === "service" ? null : data.purchaseCost,
          salePrice: data.salePrice,
          tracksStock: data.type === "product" ? data.tracksStock : false,
          currentStock:
            data.type === "product" && data.tracksStock
              ? data.currentStock
              : null,
          minimumStock:
            data.type === "product" && data.tracksStock
              ? (data.minimumStock ?? 0)
              : null,
        });
        result = {
          title: "Artículo creado",
          message: `${product.name} fue agregado al catálogo con precio de venta S/ ${product.salePrice.toFixed(2)}.`,
          referenceId: product.id,
        };
        break;
      }

      case "edit_product": {
        const data = editProductSchema.parse(action.data);
        const previous = await getProduct(data.productId);
        const nextTracksStock =
          typeof data.tracksStock === "boolean"
            ? data.tracksStock
            : previous.tracksStock;

        const product = await saveProduct({
          id: previous.id,
          name: previous.name,
          type: previous.type,
          purchaseCost:
            data.purchaseCost === undefined || data.purchaseCost === null
              ? previous.purchaseCost
              : data.purchaseCost,
          salePrice:
            data.salePrice === undefined || data.salePrice === null
              ? previous.salePrice
              : data.salePrice,
          tracksStock:
            previous.type === "product" ? nextTracksStock : false,
          currentStock:
            previous.type === "product" && nextTracksStock
              ? (data.currentStock ?? previous.currentStock ?? 0)
              : null,
          minimumStock:
            previous.type === "product" && nextTracksStock
              ? (previous.minimumStock ?? 0)
              : null,
        });
        result = {
          title: "Producto actualizado",
          message: `Los cambios de ${product.name} fueron guardados.`,
          referenceId: product.id,
        };
        break;
      }

      case "adjust_stock": {
        const data = adjustStockSchema.parse(action.data);
        const adjusted = await adjustProductStock({
          ...data,
          referenceId: action.id,
        });
        result = {
          title: "Stock ajustado",
          message: `${adjusted.productName} cambió de ${adjusted.previousStock} a ${adjusted.newStock} unidades.`,
          referenceId: action.id,
        };
        break;
      }

      case "deactivate_product": {
        const productId = z.string().min(1).parse(action.data.productId);
        const product = await getProduct(productId);
        await deactivateProduct(product.id);
        result = {
          title: "Producto desactivado",
          message: `${product.name} dejó de mostrarse para ventas nuevas. Su historial se conserva.`,
          referenceId: product.id,
        };
        break;
      }

      case "query_today_summary":
        result = await queryTodaySummary();
        break;

      case "query_inventory":
        result = await queryInventory(action);
        break;

      case "query_cash":
        result = await queryCash();
        break;

      case "query_report": {
        const period =
          action.data.period === "7days" ||
          action.data.period === "30days" ||
          action.data.period === "all"
            ? action.data.period
            : "today";
        const report = await getReportSnapshot(period);
        const periodLabel =
          period === "today"
            ? "hoy"
            : period === "7days"
              ? "los últimos 7 días"
              : period === "30days"
                ? "los últimos 30 días"
                : "todo el historial";

        result = {
          title: `Reporte de ${periodLabel}`,
          message: report.salesCount
            ? `Se registraron ${report.salesCount} ventas. El resultado aproximado fue S/ ${report.approximateResult.toFixed(2)}.`
            : "No hay ventas confirmadas en el periodo seleccionado.",
          details: [
            { label: "Ventas", value: `S/ ${report.salesTotal.toFixed(2)}` },
            { label: "Entradas de dinero", value: `S/ ${report.moneyIn.toFixed(2)}` },
            { label: "Salidas de dinero", value: `S/ ${report.moneyOut.toFixed(2)}` },
            { label: "Gastos", value: `S/ ${report.expenseTotal.toFixed(2)}` },
            { label: "Compras", value: `S/ ${report.purchaseTotal.toFixed(2)}` },
            {
              label: "Resultado aproximado",
              value: `S/ ${report.approximateResult.toFixed(2)}`,
            },
            {
              label: "Fiados pendientes",
              value: `S/ ${report.pendingDebtTotal.toFixed(2)}`,
            },
          ],
          suggestions: report.topProducts.length
            ? [
                `Producto más vendido: ${report.topProducts[0]!.productName} (${report.topProducts[0]!.quantity}).`,
                ...(report.missingCostItems
                  ? [
                      `${report.missingCostItems} artículos vendidos no tienen costo registrado.`,
                    ]
                  : []),
              ]
            : [],
        };
        break;
      }

      case "query_projection": {
        const projection = await getProjectionSnapshot();
        result = {
          title: "Proyección de ventas",
          message: projection.message,
          tone: projection.sufficientData ? "normal" : "warning",
          details: projection.sufficientData
            ? [
                {
                  label: "Promedio diario",
                  value: `S/ ${projection.dailyAverage.toFixed(2)}`,
                },
                {
                  label: "Próximos 7 días",
                  value: `S/ ${projection.nextSevenDays.toFixed(2)}`,
                },
                {
                  label: "Ventas del mes",
                  value: `S/ ${projection.currentMonthSales.toFixed(2)}`,
                },
                {
                  label: "Proyección del mes",
                  value: `S/ ${projection.currentMonthProjection.toFixed(2)}`,
                },
                {
                  label: "Confianza",
                  value:
                    projection.confidence === "high"
                      ? "Alta"
                      : projection.confidence === "medium"
                        ? "Media"
                        : "Baja",
                },
              ]
            : [
                {
                  label: "Días observados",
                  value: String(projection.observedDays),
                },
                {
                  label: "Ventas registradas",
                  value: String(projection.salesCount),
                },
              ],
        };
        break;
      }

      case "query_debts":
        result = await queryDebts(action);
        break;

      case "query_recommendations": {
        const recommendations = await getBusinessRecommendations();
        result = {
          title: "Recomendaciones según tus datos",
          kind: "analysis",
          message: recommendations.length
            ? "Este análisis utiliza únicamente las operaciones registradas. No es una lista de productos nuevos para vender."
            : "Todavía no hay información suficiente para analizar mejoras internas.",
          suggestions: recommendations.map(
            (recommendation) =>
              `${recommendation.title}: ${recommendation.explanation}`,
          ),
        };
        break;
      }

      default:
        throw new Error("La acción no pertenece al catálogo ejecutable.");
    }

    await setAIActionStatus(action.id, "executed", {
      executedAt: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    await setAIActionStatus(action.id, "failed", {
      errorMessage:
        error instanceof Error ? error.message : "Error desconocido",
    });
    throw error;
  }
}

export async function cancelAIAction(
  action: AIActionEnvelope,
): Promise<void> {
  await recordAIConfirmation(action.id, "cancelled");
  await setAIActionStatus(action.id, "cancelled");
}
