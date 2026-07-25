import { db } from "../database/db";
import type { BusinessConversationSnapshot } from "../types/domain";
import {
  getBusinessRecommendations,
  getProjectionSnapshot,
  getReportSnapshot,
} from "./insights.service";
import { getCustomerDebtSummaries } from "./debt.service";

export const EMPTY_BUSINESS_SNAPSHOT: BusinessConversationSnapshot = {
  generatedAt: new Date(0).toISOString(),
  today: {
    salesTotal: 0,
    salesCount: 0,
    expenseTotal: 0,
    purchaseTotal: 0,
    moneyIn: 0,
    moneyOut: 0,
    approximateResult: 0,
  },
  last7Days: {
    salesTotal: 0,
    salesCount: 0,
    expenseTotal: 0,
    purchaseTotal: 0,
    approximateResult: 0,
    topProducts: [],
  },
  last30Days: {
    salesTotal: 0,
    salesCount: 0,
    expenseTotal: 0,
    purchaseTotal: 0,
    approximateResult: 0,
    topProducts: [],
  },
  cash: {
    expectedCash: 0,
    yape: 0,
    plin: 0,
  },
  inventory: {
    activeProducts: 0,
    activeServices: 0,
    trackedProducts: 0,
    untrackedProducts: 0,
    lowStockProducts: [],
    outOfStockProducts: [],
  },
  debts: {
    pendingTotal: 0,
    customersWithDebt: 0,
    topDebtors: [],
  },
  projection: {
    sufficientData: false,
    confidence: "insufficient",
    observedDays: 0,
    dailyAverage: 0,
    nextSevenDays: 0,
    currentMonthProjection: 0,
    message: "Todavía no existen datos suficientes.",
  },
  recommendations: [],
  dataWarnings: ["El contexto del negocio todavía se está cargando."],
};

export async function getBusinessConversationSnapshot(): Promise<
  BusinessConversationSnapshot
> {
  const [
    today,
    last7Days,
    last30Days,
    projection,
    recommendations,
    products,
    debtSummaries,
  ] = await Promise.all([
    getReportSnapshot("today"),
    getReportSnapshot("7days"),
    getReportSnapshot("30days"),
    getProjectionSnapshot(),
    getBusinessRecommendations(),
    db.products.filter((product) => product.active).toArray(),
    getCustomerDebtSummaries(),
  ]);

  const activeProducts = products.filter(
    (product) => product.type === "product",
  );
  const activeServices = products.filter(
    (product) => product.type === "service",
  );
  const trackedProducts = activeProducts.filter(
    (product) => product.tracksStock,
  );
  const untrackedProducts = activeProducts.filter(
    (product) => !product.tracksStock,
  );

  const lowStockProducts = trackedProducts
    .filter(
      (product) =>
        (product.currentStock ?? 0) > 0 &&
        (product.currentStock ?? 0) <= (product.minimumStock ?? 0),
    )
    .map((product) => product.name)
    .slice(0, 12);

  const outOfStockProducts = trackedProducts
    .filter((product) => (product.currentStock ?? 0) <= 0)
    .map((product) => product.name)
    .slice(0, 12);

  const debtors = debtSummaries.filter(
    (summary) => summary.pendingBalance > 0,
  );

  const dataWarnings: string[] = [];
  if (!last30Days.salesCount) {
    dataWarnings.push(
      "Todavía no hay ventas confirmadas suficientes para analizar tendencias.",
    );
  }
  if (last30Days.missingCostItems) {
    dataWarnings.push(
      `${last30Days.missingCostItems} artículos vendidos no tienen costo histórico; la utilidad aproximada puede estar sobreestimada.`,
    );
  }
  if (!projection.sufficientData) {
    dataWarnings.push(projection.message);
  }
  if (untrackedProducts.length) {
    dataWarnings.push(
      `${untrackedProducts.length} productos no controlan stock; no deben generarse recomendaciones de reposición para ellos.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    today: {
      salesTotal: today.salesTotal,
      salesCount: today.salesCount,
      expenseTotal: today.expenseTotal,
      purchaseTotal: today.purchaseTotal,
      moneyIn: today.moneyIn,
      moneyOut: today.moneyOut,
      approximateResult: today.approximateResult,
    },
    last7Days: {
      salesTotal: last7Days.salesTotal,
      salesCount: last7Days.salesCount,
      expenseTotal: last7Days.expenseTotal,
      purchaseTotal: last7Days.purchaseTotal,
      approximateResult: last7Days.approximateResult,
      topProducts: last7Days.topProducts,
    },
    last30Days: {
      salesTotal: last30Days.salesTotal,
      salesCount: last30Days.salesCount,
      expenseTotal: last30Days.expenseTotal,
      purchaseTotal: last30Days.purchaseTotal,
      approximateResult: last30Days.approximateResult,
      topProducts: last30Days.topProducts,
    },
    cash: {
      expectedCash: today.paymentTotals.cash,
      yape: today.paymentTotals.yape,
      plin: today.paymentTotals.plin,
    },
    inventory: {
      activeProducts: activeProducts.length,
      activeServices: activeServices.length,
      trackedProducts: trackedProducts.length,
      untrackedProducts: untrackedProducts.length,
      lowStockProducts,
      outOfStockProducts,
    },
    debts: {
      pendingTotal: debtors.reduce(
        (sum, summary) => sum + summary.pendingBalance,
        0,
      ),
      customersWithDebt: debtors.length,
      topDebtors: debtors.slice(0, 8).map((summary) => ({
        customerName: summary.customer.name,
        balance: summary.pendingBalance,
      })),
    },
    projection: {
      sufficientData: projection.sufficientData,
      confidence: projection.confidence,
      observedDays: projection.observedDays,
      dailyAverage: projection.dailyAverage,
      nextSevenDays: projection.nextSevenDays,
      currentMonthProjection: projection.currentMonthProjection,
      message: projection.message,
    },
    recommendations: recommendations.map((recommendation) => ({
      priority: recommendation.priority,
      title: recommendation.title,
      explanation: recommendation.explanation,
      actionPrompt: recommendation.actionPrompt,
    })),
    dataWarnings,
  };
}
