import Dexie, { type EntityTable } from "dexie";
import type {
  AIActionRecord,
  AIChatMessageRecord,
  AIChatSession,
  AIConfirmation,
  CashMovement,
  Customer,
  Debt,
  DebtPayment,
  Expense,
  InventoryMovement,
  Product,
  Purchase,
  PurchaseItem,
  Sale,
  SaleItem,
} from "../types/domain";

export const BUSINESS_ID = "local-business";

class NegocioDatabase extends Dexie {
  products!: EntityTable<Product, "id">;
  sales!: EntityTable<Sale, "id">;
  saleItems!: EntityTable<SaleItem, "id">;
  expenses!: EntityTable<Expense, "id">;
  purchases!: EntityTable<Purchase, "id">;
  purchaseItems!: EntityTable<PurchaseItem, "id">;
  cashMovements!: EntityTable<CashMovement, "id">;
  inventoryMovements!: EntityTable<InventoryMovement, "id">;
  aiActions!: EntityTable<AIActionRecord, "id">;
  aiConfirmations!: EntityTable<AIConfirmation, "id">;
  customers!: EntityTable<Customer, "id">;
  debts!: EntityTable<Debt, "id">;
  debtPayments!: EntityTable<DebtPayment, "id">;
  aiChatSessions!: EntityTable<AIChatSession, "id">;
  aiChatMessages!: EntityTable<AIChatMessageRecord, "id">;

  constructor() {
    super("negocio-ia-mvp");

    this.version(1).stores({
      products: "&id,businessId,name,type,updatedAt",
      sales: "&id,businessId,createdAt,status,paymentMethod",
      saleItems: "&id,saleId,productId",
      cashMovements: "&id,businessId,createdAt,referenceId,paymentMethod",
      inventoryMovements: "&id,businessId,productId,createdAt,referenceId",
    });

    this.version(2).stores({
      products: "&id,businessId,name,type,updatedAt",
      sales: "&id,businessId,createdAt,status,paymentMethod",
      saleItems: "&id,saleId,productId",
      expenses: "&id,businessId,occurredAt,status,category,paymentMethod",
      purchases: "&id,businessId,purchasedAt,status,purpose,paymentMethod",
      purchaseItems: "&id,purchaseId,productId",
      cashMovements:
        "&id,businessId,createdAt,referenceId,referenceType,paymentMethod,type",
      inventoryMovements:
        "&id,businessId,productId,createdAt,referenceId,type",
    });

    this.version(3).stores({
      products: "&id,businessId,name,type,updatedAt",
      sales: "&id,businessId,createdAt,status,paymentMethod",
      saleItems: "&id,saleId,productId",
      expenses: "&id,businessId,occurredAt,status,category,paymentMethod",
      purchases: "&id,businessId,purchasedAt,status,purpose,paymentMethod",
      purchaseItems: "&id,purchaseId,productId",
      cashMovements:
        "&id,businessId,createdAt,referenceId,referenceType,paymentMethod,type",
      inventoryMovements:
        "&id,businessId,productId,createdAt,referenceId,type",
      aiActions:
        "&id,businessId,createdAt,updatedAt,action,status,requiresConfirmation",
      aiConfirmations: "&id,businessId,actionId,createdAt,decision",
    });

    this.version(4)
      .stores({
        products: "&id,businessId,name,type,updatedAt",
        sales:
          "&id,businessId,createdAt,status,paymentMethod,customerId",
        saleItems: "&id,saleId,productId",
        expenses:
          "&id,businessId,occurredAt,status,category,paymentMethod",
        purchases:
          "&id,businessId,purchasedAt,status,purpose,paymentMethod",
        purchaseItems: "&id,purchaseId,productId",
        cashMovements:
          "&id,businessId,createdAt,referenceId,referenceType,paymentMethod,type",
        inventoryMovements:
          "&id,businessId,productId,createdAt,referenceId,type",
        aiActions:
          "&id,businessId,createdAt,updatedAt,action,status,requiresConfirmation",
        aiConfirmations: "&id,businessId,actionId,createdAt,decision",
        customers:
          "&id,businessId,name,active,createdAt,updatedAt",
        debts:
          "&id,businessId,customerId,saleId,status,createdAt,dueDate",
        debtPayments:
          "&id,businessId,debtId,customerId,createdAt,paymentMethod",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("sales")
          .toCollection()
          .modify((sale: { customerId?: string | null }) => {
            if (sale.customerId === undefined) sale.customerId = null;
          });
      });

    this.version(5).stores({
      products: "&id,businessId,name,type,updatedAt",
      sales:
        "&id,businessId,createdAt,status,paymentMethod,customerId",
      saleItems: "&id,saleId,productId",
      expenses:
        "&id,businessId,occurredAt,status,category,paymentMethod",
      purchases:
        "&id,businessId,purchasedAt,status,purpose,paymentMethod",
      purchaseItems: "&id,purchaseId,productId",
      cashMovements:
        "&id,businessId,createdAt,referenceId,referenceType,paymentMethod,type",
      inventoryMovements:
        "&id,businessId,productId,createdAt,referenceId,type",
      aiActions:
        "&id,businessId,createdAt,updatedAt,action,status,requiresConfirmation",
      aiConfirmations:
        "&id,businessId,actionId,createdAt,decision",
      customers:
        "&id,businessId,name,active,createdAt,updatedAt",
      debts:
        "&id,businessId,customerId,saleId,status,createdAt,dueDate",
      debtPayments:
        "&id,businessId,debtId,customerId,createdAt,paymentMethod",
      aiChatSessions:
        "&id,businessId,updatedAt,createdAt,title",
      aiChatMessages:
        "&id,businessId,sessionId,createdAt,[sessionId+createdAt]",
    });

    this.version(6)
      .stores({
        products: "&id,businessId,name,type,updatedAt",
        sales:
          "&id,businessId,createdAt,status,paymentMethod,customerId",
        saleItems: "&id,saleId,productId",
        expenses:
          "&id,businessId,occurredAt,status,category,paymentMethod",
        purchases:
          "&id,businessId,purchasedAt,status,purpose,paymentMethod",
        purchaseItems: "&id,purchaseId,productId",
        cashMovements:
          "&id,businessId,createdAt,referenceId,referenceType,paymentMethod,type",
        inventoryMovements:
          "&id,businessId,productId,createdAt,referenceId,type",
        aiActions:
          "&id,businessId,createdAt,updatedAt,action,status,requiresConfirmation",
        aiConfirmations:
          "&id,businessId,actionId,createdAt,decision",
        customers:
          "&id,businessId,name,active,createdAt,updatedAt",
        debts:
          "&id,businessId,customerId,saleId,status,createdAt,dueDate",
        debtPayments:
          "&id,businessId,debtId,customerId,createdAt,paymentMethod",
        aiChatSessions:
          "&id,businessId,updatedAt,createdAt,title",
        aiChatMessages:
          "&id,businessId,sessionId,createdAt,[sessionId+createdAt]",
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("aiChatSessions")
          .toCollection()
          .modify(
            (session: {
              pendingActionVersion?: string | null;
            }) => {
              if (session.pendingActionVersion === undefined) {
                session.pendingActionVersion = null;
              }
            },
          );
      });

    this.version(7)
      .stores({
        products: "&id,businessId,name,type,updatedAt",
        sales: "&id,businessId,createdAt,status,paymentMethod,customerId,operatorName",
        saleItems: "&id,saleId,productId",
        expenses: "&id,businessId,occurredAt,status,category,paymentMethod,operatorName",
        purchases: "&id,businessId,purchasedAt,status,purpose,paymentMethod,operatorName",
        purchaseItems: "&id,purchaseId,productId",
        cashMovements: "&id,businessId,createdAt,referenceId,referenceType,paymentMethod,type",
        inventoryMovements: "&id,businessId,productId,createdAt,referenceId,type",
        aiActions: "&id,businessId,createdAt,updatedAt,action,status,requiresConfirmation",
        aiConfirmations: "&id,businessId,actionId,createdAt,decision",
        customers: "&id,businessId,name,active,createdAt,updatedAt",
        debts: "&id,businessId,customerId,saleId,status,createdAt,dueDate",
        debtPayments: "&id,businessId,debtId,customerId,createdAt,paymentMethod",
        aiChatSessions: "&id,businessId,updatedAt,createdAt,title",
        aiChatMessages: "&id,businessId,sessionId,createdAt,[sessionId+createdAt]",
      })
      .upgrade(async (transaction) => {
        for (const tableName of ["sales", "expenses", "purchases"]) {
          await transaction.table(tableName).toCollection().modify(
            (record: { operatorName?: string | null }) => {
              if (record.operatorName === undefined) record.operatorName = null;
            },
          );
        }
      });

  }
}

export const db = new NegocioDatabase();
