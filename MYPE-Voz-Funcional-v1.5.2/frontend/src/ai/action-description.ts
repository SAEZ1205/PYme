import type {
  AIActionEnvelope,
  PaymentMethod,
  PurchasePurpose,
} from "../types/domain";

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
};

const purposeLabels: Record<PurchasePurpose, string> = {
  merchandise: "Mercadería para vender",
  internal_supply: "Insumo interno",
  business_expense: "Gasto del negocio",
};

function money(value: unknown): string {
  return `S/ ${Number(value ?? 0).toFixed(2)}`;
}

export function actionTitle(action: AIActionEnvelope): string {
  const titles = {
    register_sale: "Venta por confirmar",
    register_expense: "Gasto por confirmar",
    register_purchase: "Compra por confirmar",
    create_product: "Producto por crear",
    edit_product: "Cambios por confirmar",
    adjust_stock: "Ajuste de stock por confirmar",
    deactivate_product: "Desactivación por confirmar",
    query_today_summary: "Consulta del día",
    query_inventory: "Consulta de inventario",
    query_cash: "Consulta de Caja",
    query_report: "Reporte del negocio",
    query_projection: "Proyección del negocio",
    query_recommendations: "Recomendaciones",
    create_customer: "Cliente por registrar",
    register_credit_sale: "Venta fiada por confirmar",
    register_debt_payment: "Abono por confirmar",
    query_debts: "Consulta de fiados",
    cancel_operation: "Anulación por confirmar",
    conversation: "Conversación",
    unsupported: "Acción no reconocida",
  };
  return titles[action.action];
}

export function actionPreviewRows(
  action: AIActionEnvelope,
): Array<{ label: string; value: string }> {
  const data = action.data;

  switch (action.action) {

    case "create_customer":
      return [
        { label: "Cliente", value: String(data.customerName ?? "Falta") },
        {
          label: "Acción",
          value: "Registrar o reutilizar cliente existente",
        },
      ];

    case "register_credit_sale":
      return [
        { label: "Cliente", value: String(data.customerName ?? "Falta") },
        {
          label: "Producto",
          value: data.createProductIfMissing
            ? `${String(data.productName ?? "Falta")} · nuevo`
            : String(data.productName ?? "Falta"),
        },
        { label: "Cantidad", value: String(data.quantity ?? "Falta") },
        { label: "Precio unitario", value: money(data.unitPrice) },
        {
          label: "Total fiado",
          value: money(
            Number(data.quantity ?? 0) * Number(data.unitPrice ?? 0),
          ),
        },
        { label: "Ingreso inmediato a Caja", value: "S/ 0.00" },
      ];

    case "register_debt_payment":
      return [
        { label: "Cliente", value: String(data.customerName ?? "Falta") },
        { label: "Abono", value: money(data.amount) },
        {
          label: "Método de pago",
          value:
            paymentLabels[data.paymentMethod as PaymentMethod] ?? "Falta",
        },
      ];

    case "register_sale":
      return [
        {
          label: "Producto",
          value: data.createProductIfMissing
            ? `${String(data.productName ?? "Falta")} · nuevo`
            : String(data.productName ?? "Falta"),
        },
        { label: "Cantidad", value: String(data.quantity ?? "Falta") },
        { label: "Precio unitario", value: money(data.unitPrice) },
        {
          label: "Total",
          value: money(Number(data.quantity ?? 0) * Number(data.unitPrice ?? 0)),
        },
        {
          label: "Método de pago",
          value:
            paymentLabels[data.paymentMethod as PaymentMethod] ?? "Falta",
        },
      ];

    case "register_expense":
      return [
        { label: "Descripción", value: String(data.description ?? "") },
        { label: "Monto", value: money(data.amount) },
        {
          label: "Método de pago",
          value:
            paymentLabels[data.paymentMethod as PaymentMethod] ?? "Falta",
        },
      ];

    case "register_purchase":
      return [
        { label: "Producto", value: String(data.productName ?? "Falta") },
        { label: "Cantidad", value: String(data.quantity ?? "Falta") },
        { label: "Costo unitario", value: money(data.unitCost) },
        {
          label: "Gastos adicionales",
          value: money(data.additionalCosts),
        },
        {
          label: "Uso",
          value:
            purposeLabels[data.purpose as PurchasePurpose] ?? "Falta",
        },
        {
          label: "Método de pago",
          value:
            paymentLabels[data.paymentMethod as PaymentMethod] ?? "Falta",
        },
      ];

    case "create_product":
      return [
        { label: "Nombre", value: String(data.name ?? "Falta") },
        {
          label: "Tipo",
          value: data.type === "service" ? "Servicio" : "Producto",
        },
        { label: "Costo", value: data.purchaseCost == null ? "No registrado" : money(data.purchaseCost) },
        { label: "Precio de venta", value: money(data.salePrice) },
        {
          label: "Control de stock",
          value:
            data.type === "service"
              ? "No aplica"
              : data.tracksStock === true
                ? "Activado"
                : data.tracksStock === false
                  ? "Desactivado"
                  : "Falta",
        },
        ...(data.tracksStock === true
          ? [
              {
                label: "Stock actual",
                value: String(data.currentStock ?? "Falta"),
              },
            ]
          : []),
      ];

    case "edit_product": {
      const rows = [
        { label: "Producto", value: String(data.productName ?? "Falta") },
      ];
      if (data.salePrice != null) {
        rows.push({ label: "Nuevo precio", value: money(data.salePrice) });
      }
      if (data.purchaseCost != null) {
        rows.push({ label: "Nuevo costo", value: money(data.purchaseCost) });
      }
      if (typeof data.tracksStock === "boolean") {
        rows.push({
          label: "Control de stock",
          value: data.tracksStock ? "Activar" : "Desactivar",
        });
      }
      if (data.currentStock != null) {
        rows.push({
          label: "Stock inicial",
          value: String(data.currentStock),
        });
      }
      return rows;
    }

    case "adjust_stock":
      return [
        { label: "Producto", value: String(data.productName ?? "Falta") },
        { label: "Nuevo stock", value: String(data.newStock ?? "Falta") },
      ];

    case "deactivate_product":
      return [
        { label: "Producto", value: String(data.productName ?? "Falta") },
        { label: "Acción", value: "Desactivar sin borrar el historial" },
      ];

    case "cancel_operation":
      return [
        {
          label: "Tipo",
          value:
            data.operationType === "sale"
              ? "Venta"
              : data.operationType === "purchase"
                ? "Compra"
                : "Gasto",
        },
        {
          label: "Operación",
          value: String(data.operationSummary ?? "Operación seleccionada"),
        },
        {
          label: "Monto",
          value: money(data.operationAmount),
        },
        {
          label: "Acción",
          value: "Anular y crear movimientos de reversión",
        },
        {
          label: "Historial",
          value: "Se conserva como cancelado",
        },
      ];

    default:
      return [];
  }
}
