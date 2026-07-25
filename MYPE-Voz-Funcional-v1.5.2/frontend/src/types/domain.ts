export type ProductType = "product" | "service";
export type PaymentMethod = "cash" | "yape" | "plin";
export type SalePaymentMethod = PaymentMethod | "credit";
export type SaleStatus = "confirmed" | "cancelled";
export type ExpenseStatus = "confirmed" | "cancelled";
export type PurchaseStatus = "confirmed" | "cancelled";

export type ExpenseCategory =
  | "rent"
  | "utilities"
  | "transport"
  | "maintenance"
  | "supplier_payment"
  | "other";

export type PurchasePurpose =
  | "merchandise"
  | "internal_supply"
  | "business_expense";

export interface Product {
  id: string;
  businessId: string;
  name: string;
  type: ProductType;
  purchaseCost: number | null;
  salePrice: number;
  tracksStock: boolean;
  currentStock: number | null;
  minimumStock: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Sale {
  id: string;
  businessId: string;
  total: number;
  paymentMethod: SalePaymentMethod;
  customerId: string | null;
  status: SaleStatus;
  operatorName: string | null;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  subtotal: number;
}

export interface Expense {
  id: string;
  businessId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: ExpenseStatus;
  operatorName: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface Purchase {
  id: string;
  businessId: string;
  supplierName: string | null;
  purpose: PurchasePurpose;
  additionalCosts: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: PurchaseStatus;
  operatorName: string | null;
  purchasedAt: string;
  createdAt: string;
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  allocatedAdditionalCost: number;
  effectiveUnitCost: number;
  subtotal: number;
}

export interface CashMovement {
  id: string;
  businessId: string;
  type: "income" | "expense";
  paymentMethod: PaymentMethod;
  amount: number;
  referenceType:
    | "sale"
    | "expense"
    | "purchase"
    | "debt_payment"
    | "reversal";
  referenceId: string;
  createdAt: string;
}

export interface InventoryMovement {
  id: string;
  businessId: string;
  productId: string;
  type: "sale" | "purchase" | "adjustment" | "cancellation";
  quantity: number;
  referenceId: string;
  createdAt: string;
}

export interface CartItem {
  productId: string;
  productName: string;
  productType: ProductType;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  tracksStock: boolean;
  availableStock: number | null;
}

export interface SaleDraft {
  items: CartItem[];
  operatorName?: string | null;
  paymentMethod: SalePaymentMethod;
  customerId?: string | null;
  dueDate?: string | null;
}

export interface ExpenseDraft {
  category: ExpenseCategory;
  operatorName?: string | null;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  occurredAt: string;
}

export interface PurchaseCartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  tracksStock: boolean;
  currentStock: number | null;
}

export interface PurchaseDraft {
  supplierName: string | null;
  operatorName?: string | null;
  purpose: PurchasePurpose;
  items: PurchaseCartItem[];
  additionalCosts: number;
  paymentMethod: PaymentMethod;
  purchasedAt: string;
}

export interface ConfirmedSaleResult {
  saleId: string;
  total: number;
  inventoryMovements: number;
  debtId?: string;
}

export interface ConfirmedExpenseResult {
  expenseId: string;
  amount: number;
}

export interface ConfirmedPurchaseResult {
  purchaseId: string;
  total: number;
  inventoryMovements: number;
  productsUpdated: number;
}


export type AIActionName =
  | "register_sale"
  | "register_expense"
  | "register_purchase"
  | "create_product"
  | "edit_product"
  | "adjust_stock"
  | "deactivate_product"
  | "query_today_summary"
  | "query_inventory"
  | "query_cash"
  | "query_report"
  | "query_projection"
  | "query_recommendations"
  | "create_customer"
  | "register_credit_sale"
  | "register_debt_payment"
  | "query_debts"
  | "cancel_operation"
  | "conversation"
  | "unsupported";

export type AIActionStatus =
  | "interpreted"
  | "needs_clarification"
  | "awaiting_confirmation"
  | "executing"
  | "executed"
  | "cancelled"
  | "failed";

export interface AIActionEnvelope {
  id: string;
  action: AIActionName;
  confidence: number;
  data: Record<string, unknown>;
  missingFields: string[];
  warnings: string[];
  requiresConfirmation: boolean;
  userMessage: string;
  originalText: string;
  createdAt: string;
  source?: "gemma" | "local-rules";
  model?: string;
}

export interface AIActionRecord {
  id: string;
  businessId: string;
  action: AIActionName;
  originalText: string;
  dataJson: string;
  confidence: number;
  missingFieldsJson: string;
  warningsJson: string;
  requiresConfirmation: boolean;
  status: AIActionStatus;
  userMessage: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
}

export interface AIConfirmation {
  id: string;
  businessId: string;
  actionId: string;
  decision: "confirmed" | "cancelled";
  createdAt: string;
}

export interface AIExecutionResult {
  title: string;
  message: string;
  referenceId?: string;
  details?: Array<{ label: string; value: string }>;
  suggestions?: string[];
  quickReplies?: string[];
  kind?: "conversation" | "operation" | "analysis";
  tone?: "normal" | "success" | "warning";
}

export type InsightPeriod = "today" | "7days" | "30days" | "all";

export interface ReportSeriesPoint {
  label: string;
  value: number;
}

export interface ReportSnapshot {
  period: InsightPeriod;
  salesTotal: number;
  salesCount: number;
  expenseTotal: number;
  purchaseTotal: number;
  moneyIn: number;
  moneyOut: number;
  approximateResult: number;
  missingCostItems: number;
  paymentTotals: Record<PaymentMethod, number>;
  topProducts: Array<{
    productName: string;
    quantity: number;
    revenue: number;
  }>;
  dailySeries: ReportSeriesPoint[];
  pendingDebtTotal: number;
}

export interface ProjectionSnapshot {
  sufficientData: boolean;
  message: string;
  confidence: "insufficient" | "low" | "medium" | "high";
  observedDays: number;
  salesCount: number;
  observedSales: number;
  dailyAverage: number;
  nextSevenDays: number;
  currentMonthProjection: number;
  currentMonthSales: number;
  remainingDaysInMonth: number;
  series: ReportSeriesPoint[];
}

export interface BusinessRecommendation {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  explanation: string;
  actionPrompt?: string;
}


export interface Customer {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DebtStatus = "pending" | "paid" | "cancelled";

export interface Debt {
  id: string;
  businessId: string;
  customerId: string;
  saleId: string;
  originalAmount: number;
  balance: number;
  status: DebtStatus;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DebtPayment {
  id: string;
  businessId: string;
  debtId: string;
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
}

export interface CustomerDebtSummary {
  customer: Customer;
  pendingBalance: number;
  pendingDebts: number;
  lastDebtAt: string | null;
}

export interface DebtPaymentResult {
  customerId: string;
  customerName: string;
  amountPaid: number;
  remainingBalance: number;
  affectedDebts: number;
  paymentIds: string[];
}


export type BusinessOperationType = "sale" | "expense" | "purchase";

export interface RecentBusinessOperation {
  id: string;
  type: BusinessOperationType;
  title: string;
  summary: string;
  amount: number;
  paymentMethod: PaymentMethod | "credit";
  createdAt: string;
  status: "confirmed" | "cancelled";
  reversible: boolean;
  reversalReason: string | null;
}

export interface CancelBusinessOperationResult {
  operationId: string;
  operationType: BusinessOperationType;
  title: string;
  amount: number;
  cashReversal: number;
  inventoryReversals: number;
}


export interface AIConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BusinessConversationSnapshot {
  generatedAt: string;
  today: {
    salesTotal: number;
    salesCount: number;
    expenseTotal: number;
    purchaseTotal: number;
    moneyIn: number;
    moneyOut: number;
    approximateResult: number;
  };
  last7Days: {
    salesTotal: number;
    salesCount: number;
    expenseTotal: number;
    purchaseTotal: number;
    approximateResult: number;
    topProducts: Array<{
      productName: string;
      quantity: number;
      revenue: number;
    }>;
  };
  last30Days: {
    salesTotal: number;
    salesCount: number;
    expenseTotal: number;
    purchaseTotal: number;
    approximateResult: number;
    topProducts: Array<{
      productName: string;
      quantity: number;
      revenue: number;
    }>;
  };
  cash: {
    expectedCash: number;
    yape: number;
    plin: number;
  };
  inventory: {
    activeProducts: number;
    activeServices: number;
    trackedProducts: number;
    untrackedProducts: number;
    lowStockProducts: string[];
    outOfStockProducts: string[];
  };
  debts: {
    pendingTotal: number;
    customersWithDebt: number;
    topDebtors: Array<{
      customerName: string;
      balance: number;
    }>;
  };
  projection: {
    sufficientData: boolean;
    confidence: "insufficient" | "low" | "medium" | "high";
    observedDays: number;
    dailyAverage: number;
    nextSevenDays: number;
    currentMonthProjection: number;
    message: string;
  };
  recommendations: Array<{
    priority: "high" | "medium" | "low";
    title: string;
    explanation: string;
    actionPrompt?: string;
  }>;
  dataWarnings: string[];
}


export type AIChatMessageTone =
  | "normal"
  | "success"
  | "error"
  | "warning";

export interface AIChatSession {
  id: string;
  businessId: string;
  title: string;
  preview: string;
  pendingActionJson: string | null;
  pendingActionVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AIChatMessageRecord {
  id: string;
  businessId: string;
  sessionId: string;
  role: "assistant" | "user";
  text: string | null;
  tone: AIChatMessageTone;
  actionJson: string | null;
  actionDecision: "confirmed" | "cancelled" | null;
  resultJson: string | null;
  quickRepliesJson: string | null;
  source: "gemma" | "local-rules" | null;
  model: string | null;
  createdAt: string;
}
