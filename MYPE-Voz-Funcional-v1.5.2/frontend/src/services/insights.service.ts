import { db } from "../database/db";
import type {
  BusinessRecommendation,
  InsightPeriod,
  PaymentMethod,
  ProjectionSnapshot,
  ReportSeriesPoint,
  ReportSnapshot,
} from "../types/domain";

function startOfDay(value: string | Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayKey(value: string | Date): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function daysBetween(start: Date, end: Date): number {
  return Math.floor(
    (startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000,
  );
}

function shortDate(value: Date): string {
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "2-digit",
  }).format(value);
}

function filterDateForPeriod(
  createdAt: string,
  period: InsightPeriod,
  now = new Date(),
): boolean {
  const date = new Date(createdAt);
  if (period === "all") return true;
  if (period === "today") return dayKey(date) === dayKey(now);

  const days = period === "7days" ? 6 : 29;
  const start = addDays(startOfDay(now), -days);
  return date >= start && date <= now;
}

function periodDays(period: InsightPeriod): number {
  if (period === "today") return 1;
  if (period === "7days") return 7;
  if (period === "30days") return 30;
  return 0;
}

export async function getReportSnapshot(
  period: InsightPeriod,
): Promise<ReportSnapshot> {
  const [
    sales,
    saleItems,
    expenses,
    purchases,
    cashMovements,
    debts,
  ] = await Promise.all([
    db.sales.toArray(),
    db.saleItems.toArray(),
    db.expenses.toArray(),
    db.purchases.toArray(),
    db.cashMovements.toArray(),
    db.debts.toArray(),
  ]);

  const confirmedSales = sales.filter(
    (sale) =>
      sale.status === "confirmed" &&
      filterDateForPeriod(sale.createdAt, period),
  );
  const saleIds = new Set(confirmedSales.map((sale) => sale.id));
  const selectedItems = saleItems.filter((item) => saleIds.has(item.saleId));
  const selectedExpenses = expenses.filter(
    (expense) =>
      expense.status === "confirmed" &&
      filterDateForPeriod(expense.occurredAt, period),
  );
  const selectedPurchases = purchases.filter(
    (purchase) =>
      purchase.status === "confirmed" &&
      filterDateForPeriod(purchase.purchasedAt, period),
  );
  const selectedMovements = cashMovements.filter((movement) =>
    filterDateForPeriod(movement.createdAt, period),
  );

  const salesTotal = confirmedSales.reduce(
    (sum, sale) => sum + sale.total,
    0,
  );
  const expenseTotal = selectedExpenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );
  const purchaseTotal = selectedPurchases.reduce(
    (sum, purchase) => sum + purchase.total,
    0,
  );
  const nonMerchandisePurchases = selectedPurchases
    .filter((purchase) => purchase.purpose !== "merchandise")
    .reduce((sum, purchase) => sum + purchase.total, 0);
  const costOfGoodsSold = selectedItems.reduce(
    (sum, item) => sum + (item.unitCost ?? 0) * item.quantity,
    0,
  );
  const missingCostItems = selectedItems.filter(
    (item) => item.unitCost === null,
  ).length;

  const paymentTotals: Record<PaymentMethod, number> = {
    cash: 0,
    yape: 0,
    plin: 0,
  };
  let moneyIn = 0;
  let moneyOut = 0;

  for (const movement of selectedMovements) {
    if (movement.type === "income") {
      moneyIn += movement.amount;
      paymentTotals[movement.paymentMethod] += movement.amount;
    } else {
      moneyOut += movement.amount;
      paymentTotals[movement.paymentMethod] -= movement.amount;
    }
  }

  const productMap = new Map<
    string,
    { productName: string; quantity: number; revenue: number }
  >();
  for (const item of selectedItems) {
    const current = productMap.get(item.productId) ?? {
      productName: item.productName,
      quantity: 0,
      revenue: 0,
    };
    current.quantity += item.quantity;
    current.revenue += item.subtotal;
    productMap.set(item.productId, current);
  }

  const topProducts = [...productMap.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 6);

  const now = new Date();
  let seriesStart: Date;
  let seriesLength: number;

  if (period === "today") {
    seriesStart = startOfDay(now);
    seriesLength = 1;
  } else if (period === "all" && confirmedSales.length) {
    const first =
      confirmedSales
        .map((sale) => startOfDay(sale.createdAt))
        .sort((a, b) => a.getTime() - b.getTime())[0] ??
      startOfDay(now);
    seriesStart = first;
    seriesLength = Math.max(1, daysBetween(first, now) + 1);
  } else {
    seriesLength = periodDays(period) || 30;
    seriesStart = addDays(startOfDay(now), -(seriesLength - 1));
  }

  const maximumPoints = 14;
  const bucketSize = Math.max(1, Math.ceil(seriesLength / maximumPoints));
  const bucketCount = Math.ceil(seriesLength / bucketSize);

  const dailySeries: ReportSeriesPoint[] = Array.from(
    { length: bucketCount },
    (_, index) => {
      const bucketStart = addDays(seriesStart, index * bucketSize);
      const bucketEnd = addDays(bucketStart, bucketSize);
      const value = confirmedSales
        .filter((sale) => {
          const date = new Date(sale.createdAt);
          return date >= bucketStart && date < bucketEnd;
        })
        .reduce((sum, sale) => sum + sale.total, 0);

      return {
        label:
          bucketSize === 1
            ? shortDate(bucketStart)
            : `${shortDate(bucketStart)}–${shortDate(addDays(bucketEnd, -1))}`,
        value,
      };
    },
  );

  return {
    period,
    salesTotal,
    salesCount: confirmedSales.length,
    expenseTotal,
    purchaseTotal,
    moneyIn,
    moneyOut,
    approximateResult:
      salesTotal - costOfGoodsSold - expenseTotal - nonMerchandisePurchases,
    missingCostItems,
    paymentTotals,
    topProducts,
    dailySeries,
    pendingDebtTotal: debts
      .filter((debt) => debt.status === "pending")
      .reduce((sum, debt) => sum + debt.balance, 0),
  };
}

export async function getProjectionSnapshot(): Promise<ProjectionSnapshot> {
  const confirmedSales = (await db.sales.toArray())
    .filter((sale) => sale.status === "confirmed")
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  if (!confirmedSales.length) {
    return {
      sufficientData: false,
      message:
        "Todavía no hay ventas confirmadas para construir una proyección.",
      confidence: "insufficient",
      observedDays: 0,
      salesCount: 0,
      observedSales: 0,
      dailyAverage: 0,
      nextSevenDays: 0,
      currentMonthProjection: 0,
      currentMonthSales: 0,
      remainingDaysInMonth: 0,
      series: [],
    };
  }

  const firstDate = startOfDay(confirmedSales[0]!.createdAt);
  const today = startOfDay(new Date());
  const observedDays = Math.max(1, daysBetween(firstDate, today) + 1);
  const observedSales = confirmedSales.reduce(
    (sum, sale) => sum + sale.total,
    0,
  );
  const dailyAverage = observedSales / observedDays;

  const currentMonthStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    1,
  );
  const nextMonthStart = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    1,
  );
  const daysInMonth = daysBetween(currentMonthStart, nextMonthStart);
  const elapsedMonthDays = today.getDate();
  const remainingDaysInMonth = Math.max(0, daysInMonth - elapsedMonthDays);

  const currentMonthSales = confirmedSales
    .filter((sale) => new Date(sale.createdAt) >= currentMonthStart)
    .reduce((sum, sale) => sum + sale.total, 0);

  const sufficientData =
    observedDays >= 3 && confirmedSales.length >= 5;
  const confidence: ProjectionSnapshot["confidence"] =
    !sufficientData
      ? "insufficient"
      : observedDays < 7
        ? "low"
        : observedDays < 21
          ? "medium"
          : "high";

  const seriesStart = addDays(today, -6);
  const series = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(seriesStart, index);
    return {
      label: shortDate(date),
      value: confirmedSales
        .filter((sale) => dayKey(sale.createdAt) === dayKey(date))
        .reduce((sum, sale) => sum + sale.total, 0),
    };
  });

  return {
    sufficientData,
    message: sufficientData
      ? `La proyección utiliza ${observedDays} días calendario y ${confirmedSales.length} ventas confirmadas.`
      : `Solo hay ${observedDays} días calendario y ${confirmedSales.length} ventas. Registra al menos 3 días y 5 ventas para mostrar una proyección utilizable.`,
    confidence,
    observedDays,
    salesCount: confirmedSales.length,
    observedSales,
    dailyAverage,
    nextSevenDays: sufficientData ? dailyAverage * 7 : 0,
    currentMonthProjection: sufficientData
      ? currentMonthSales + dailyAverage * remainingDaysInMonth
      : 0,
    currentMonthSales,
    remainingDaysInMonth,
    series,
  };
}

export async function getBusinessRecommendations(): Promise<
  BusinessRecommendation[]
> {
  const [
    products,
    report,
    purchases,
    inventoryMovements,
  ] = await Promise.all([
    db.products.filter((product) => product.active).toArray(),
    getReportSnapshot("30days"),
    db.purchases.toArray(),
    db.inventoryMovements.toArray(),
  ]);

  const recommendations: BusinessRecommendation[] = [];

  if (report.pendingDebtTotal > 0) {
    recommendations.push({
      id: "pending-debts",
      priority: "high",
      title: "Hay dinero pendiente de cobro",
      explanation: `Los fiados pendientes suman S/ ${report.pendingDebtTotal.toFixed(2)}. Revisa los clientes y registra los abonos conforme los recibas.`,
      actionPrompt: "¿Quiénes nos deben?",
    });
  }

  if (!report.salesCount) {
    recommendations.push({
      id: "need-sales",
      priority: "high",
      title: "Registra operaciones reales",
      explanation:
        "Todavía no existen ventas suficientes para detectar productos fuertes, márgenes o tendencias.",
      actionPrompt:
        "Ayúdame a registrar mi primera venta",
    });
  }

  const lowStock = products.filter(
    (product) =>
      product.type === "product" &&
      product.tracksStock &&
      (product.currentStock ?? 0) <= (product.minimumStock ?? 0),
  );

  if (lowStock.length) {
    recommendations.push({
      id: "low-stock",
      priority: "high",
      title: "Revisa productos con stock bajo",
      explanation: `${lowStock
        .slice(0, 4)
        .map((product) => product.name)
        .join(", ")} ${lowStock.length === 1 ? "llegó" : "llegaron"} al nivel mínimo configurado.`,
      actionPrompt: "¿Qué productos tienen stock bajo?",
    });
  }

  const minimumSalesForTrend = 5;
  const minimumUnitsForTrend = 3;

  if (
    report.topProducts.length &&
    report.salesCount >= minimumSalesForTrend &&
    report.topProducts[0]!.quantity >= minimumUnitsForTrend
  ) {
    const top = report.topProducts[0]!;
    recommendations.push({
      id: "top-product",
      priority: "medium",
      title: `${top.productName} destaca en la muestra registrada`,
      explanation: `En los últimos 30 días se registraron ${top.quantity} unidades o servicios y S/ ${top.revenue.toFixed(2)} en ventas. Revisa más periodos antes de considerarlo una tendencia estable.`,
      actionPrompt: `Muéstrame el inventario de ${top.productName}`,
    });
  } else if (report.salesCount > 0) {
    recommendations.push({
      id: "insufficient-product-sample",
      priority: "medium",
      title: "Aún no hay muestra suficiente para identificar productos fuertes",
      explanation: `Solo hay ${report.salesCount} ${
        report.salesCount === 1 ? "venta confirmada" : "ventas confirmadas"
      } en los últimos 30 días. Registra más operaciones antes de comparar productos o afirmar que alguno lidera.`,
      actionPrompt: "Dame el reporte de los últimos 30 días",
    });
  }

  if (report.missingCostItems) {
    recommendations.push({
      id: "missing-costs",
      priority: "high",
      title: "Completa costos de compra",
      explanation: `${report.missingCostItems} artículos vendidos no tienen costo histórico. El resultado aproximado puede verse mayor de lo real.`,
      actionPrompt: "¿Qué productos no tienen costo registrado?",
    });
  }

  if (
    report.salesTotal > 0 &&
    report.expenseTotal / report.salesTotal >= 0.4
  ) {
    recommendations.push({
      id: "high-expenses",
      priority: "medium",
      title: "Los gastos pesan sobre las ventas",
      explanation: `Los gastos directos representan ${Math.round(
        (report.expenseTotal / report.salesTotal) * 100,
      )}% de las ventas de los últimos 30 días.`,
      actionPrompt: "Dame un reporte de gastos de los últimos 30 días",
    });
  }

  const untracked = products.filter(
    (product) => product.type === "product" && !product.tracksStock,
  );
  if (untracked.length) {
    recommendations.push({
      id: "untracked",
      priority: "low",
      title: "Hay productos sin control de stock",
      explanation: `${untracked.length} ${untracked.length === 1 ? "producto funciona" : "productos funcionan"} con “stock no registrado”. Es válido; actívalo solo donde aporte control real.`,
    });
  }

  if (purchases.length && !inventoryMovements.some((m) => m.type === "purchase")) {
    recommendations.push({
      id: "purchase-purpose",
      priority: "low",
      title: "Revisa el uso de las compras",
      explanation:
        "Hay compras registradas, pero todavía no aparecen entradas de inventario. Comprueba que las compras de reventa estén marcadas como mercadería.",
      actionPrompt: "Muéstrame las compras recientes",
    });
  }

  return recommendations.slice(0, 6);
}
