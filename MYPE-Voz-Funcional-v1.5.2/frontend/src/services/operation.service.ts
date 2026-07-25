import { BUSINESS_ID, db } from "../database/db";
import type {
  BusinessOperationType,
  CancelBusinessOperationResult,
  CashMovement,
  InventoryMovement,
  PaymentMethod,
  RecentBusinessOperation,
} from "../types/domain";

function paymentLabel(method: PaymentMethod | "credit"): string {
  if (method === "cash") return "Efectivo";
  if (method === "yape") return "Yape";
  if (method === "plin") return "Plin";
  return "Fiado";
}

function operationDate(value: string): number {
  return new Date(value).getTime();
}

export async function getRecentBusinessOperations(
  limit = 15,
): Promise<RecentBusinessOperation[]> {
  const [sales, saleItems, expenses, purchases, purchaseItems] =
    await Promise.all([
      db.sales.toArray(),
      db.saleItems.toArray(),
      db.expenses.toArray(),
      db.purchases.toArray(),
      db.purchaseItems.toArray(),
    ]);

  const saleRows: RecentBusinessOperation[] = sales.map((sale) => {
    const items = saleItems.filter((item) => item.saleId === sale.id);
    const summary = items.length
      ? items
          .slice(0, 3)
          .map((item) => `${item.quantity} ${item.productName}`)
          .join(", ")
      : "Venta registrada";

    return {
      id: sale.id,
      type: "sale",
      title: "Venta",
      summary: `${summary} · ${paymentLabel(sale.paymentMethod)}`,
      amount: sale.total,
      paymentMethod: sale.paymentMethod,
      createdAt: sale.createdAt,
      status: sale.status,
      reversible: sale.status === "confirmed",
      reversalReason:
        sale.status === "confirmed" ? null : "La venta ya fue cancelada.",
    };
  });

  const expenseRows: RecentBusinessOperation[] = expenses.map((expense) => ({
    id: expense.id,
    type: "expense",
    title: "Gasto",
    summary: `${expense.description} · ${paymentLabel(expense.paymentMethod)}`,
    amount: expense.amount,
    paymentMethod: expense.paymentMethod,
    createdAt: expense.occurredAt,
    status: expense.status,
    reversible: expense.status === "confirmed",
    reversalReason:
      expense.status === "confirmed" ? null : "El gasto ya fue cancelado.",
  }));

  const purchaseRows: RecentBusinessOperation[] = purchases.map((purchase) => {
    const items = purchaseItems.filter(
      (item) => item.purchaseId === purchase.id,
    );
    const itemSummary = items.length
      ? items
          .slice(0, 3)
          .map((item) => `${item.quantity} ${item.productName}`)
          .join(", ")
      : purchase.supplierName || "Compra registrada";

    return {
      id: purchase.id,
      type: "purchase",
      title: "Compra",
      summary: `${itemSummary} · ${paymentLabel(purchase.paymentMethod)}`,
      amount: purchase.total,
      paymentMethod: purchase.paymentMethod,
      createdAt: purchase.purchasedAt,
      status: purchase.status,
      reversible: purchase.status === "confirmed",
      reversalReason:
        purchase.status === "confirmed"
          ? null
          : "La compra ya fue cancelada.",
    };
  });

  return [...saleRows, ...expenseRows, ...purchaseRows]
    .sort(
      (left, right) =>
        operationDate(right.createdAt) - operationDate(left.createdAt),
    )
    .slice(0, limit);
}

function reverseCashMovement(
  original: CashMovement,
  referenceId: string,
  createdAt: string,
): CashMovement {
  return {
    id: crypto.randomUUID(),
    businessId: BUSINESS_ID,
    type: original.type === "income" ? "expense" : "income",
    paymentMethod: original.paymentMethod,
    amount: original.amount,
    referenceType: "reversal",
    referenceId,
    createdAt,
  };
}

async function cancelSale(
  saleId: string,
): Promise<CancelBusinessOperationResult> {
  const createdAt = new Date().toISOString();

  return db.transaction(
    "rw",
    [
      db.products,
      db.sales,
      db.saleItems,
      db.debts,
      db.debtPayments,
      db.cashMovements,
      db.inventoryMovements,
    ],
    async () => {
      const sale = await db.sales.get(saleId);
      if (!sale) throw new Error("La venta ya no existe.");
      if (sale.status !== "confirmed") {
        throw new Error("La venta ya fue cancelada.");
      }

      const items = await db.saleItems
        .where("saleId")
        .equals(sale.id)
        .toArray();

      if (sale.paymentMethod === "credit") {
        const debt = await db.debts
          .where("saleId")
          .equals(sale.id)
          .first();

        if (debt) {
          const payments = await db.debtPayments
            .where("debtId")
            .equals(debt.id)
            .toArray();

          if (payments.length) {
            throw new Error(
              "No puedo anular automáticamente esta venta fiada porque ya recibió uno o más abonos.",
            );
          }

          await db.debts.update(debt.id, {
            status: "cancelled",
            balance: 0,
            updatedAt: createdAt,
          });
        }
      }

      let inventoryReversals = 0;

      for (const item of items) {
        const product = await db.products.get(item.productId);
        if (
          product &&
          product.type === "product" &&
          product.tracksStock
        ) {
          await db.products.update(product.id, {
            currentStock: (product.currentStock ?? 0) + item.quantity,
            updatedAt: createdAt,
          });

          const movement: InventoryMovement = {
            id: crypto.randomUUID(),
            businessId: BUSINESS_ID,
            productId: product.id,
            type: "cancellation",
            quantity: item.quantity,
            referenceId: sale.id,
            createdAt,
          };
          await db.inventoryMovements.add(movement);
          inventoryReversals += 1;
        }
      }

      let cashReversal = 0;
      if (sale.paymentMethod !== "credit") {
        const originalMovements = (
          await db.cashMovements
            .where("referenceId")
            .equals(sale.id)
            .toArray()
        ).filter((movement) => movement.referenceType === "sale");

        for (const original of originalMovements) {
          await db.cashMovements.add(
            reverseCashMovement(original, sale.id, createdAt),
          );
          cashReversal += original.amount;
        }
      }

      await db.sales.update(sale.id, { status: "cancelled" });

      return {
        operationId: sale.id,
        operationType: "sale",
        title: "Venta anulada",
        amount: sale.total,
        cashReversal,
        inventoryReversals,
      };
    },
  );
}

async function cancelExpense(
  expenseId: string,
): Promise<CancelBusinessOperationResult> {
  const createdAt = new Date().toISOString();

  return db.transaction(
    "rw",
    [db.expenses, db.cashMovements],
    async () => {
      const expense = await db.expenses.get(expenseId);
      if (!expense) throw new Error("El gasto ya no existe.");
      if (expense.status !== "confirmed") {
        throw new Error("El gasto ya fue cancelado.");
      }

      const originalMovements = (
        await db.cashMovements
          .where("referenceId")
          .equals(expense.id)
          .toArray()
      ).filter((movement) => movement.referenceType === "expense");

      let cashReversal = 0;
      for (const original of originalMovements) {
        await db.cashMovements.add(
          reverseCashMovement(original, expense.id, createdAt),
        );
        cashReversal += original.amount;
      }

      await db.expenses.update(expense.id, { status: "cancelled" });

      return {
        operationId: expense.id,
        operationType: "expense",
        title: "Gasto anulado",
        amount: expense.amount,
        cashReversal,
        inventoryReversals: 0,
      };
    },
  );
}

function previousWeightedCost(
  currentCost: number | null,
  currentStock: number,
  purchasedQuantity: number,
  effectiveUnitCost: number,
): number | null {
  const previousStock = currentStock - purchasedQuantity;
  if (previousStock <= 0) return null;
  if (currentCost === null) return null;

  const previousValue =
    currentCost * currentStock -
    effectiveUnitCost * purchasedQuantity;
  return Math.max(0, previousValue / previousStock);
}

async function cancelPurchase(
  purchaseId: string,
): Promise<CancelBusinessOperationResult> {
  const createdAt = new Date().toISOString();

  return db.transaction(
    "rw",
    [
      db.products,
      db.purchases,
      db.purchaseItems,
      db.cashMovements,
      db.inventoryMovements,
    ],
    async () => {
      const purchase = await db.purchases.get(purchaseId);
      if (!purchase) throw new Error("La compra ya no existe.");
      if (purchase.status !== "confirmed") {
        throw new Error("La compra ya fue cancelada.");
      }

      const items = await db.purchaseItems
        .where("purchaseId")
        .equals(purchase.id)
        .toArray();

      let inventoryReversals = 0;

      if (purchase.purpose === "merchandise") {
        for (const item of items) {
          const product = await db.products.get(item.productId);
          if (!product) {
            throw new Error(
              `No se encontró ${item.productName}; la compra requiere revisión manual.`,
            );
          }

          if (!product.tracksStock) {
            throw new Error(
              `No puedo anular automáticamente esta compra porque ${product.name} no controla stock y no es posible reconstruir su costo anterior con seguridad.`,
            );
          }

          const laterMovements = (
            await db.inventoryMovements
              .where("productId")
              .equals(product.id)
              .toArray()
          ).filter(
            (movement) =>
              movement.referenceId !== purchase.id &&
              new Date(movement.createdAt).getTime() >
                new Date(purchase.purchasedAt).getTime(),
          );

          if (laterMovements.length) {
            throw new Error(
              `No puedo anular automáticamente la compra porque ${product.name} tuvo movimientos posteriores.`,
            );
          }

          const currentStock = product.currentStock ?? 0;
          if (currentStock < item.quantity) {
            throw new Error(
              `El stock actual de ${product.name} es menor que la cantidad comprada.`,
            );
          }

          const priorCost = previousWeightedCost(
            product.purchaseCost,
            currentStock,
            item.quantity,
            item.effectiveUnitCost,
          );

          await db.products.update(product.id, {
            currentStock: currentStock - item.quantity,
            purchaseCost: priorCost,
            updatedAt: createdAt,
          });

          const movement: InventoryMovement = {
            id: crypto.randomUUID(),
            businessId: BUSINESS_ID,
            productId: product.id,
            type: "cancellation",
            quantity: -item.quantity,
            referenceId: purchase.id,
            createdAt,
          };
          await db.inventoryMovements.add(movement);
          inventoryReversals += 1;
        }
      }

      const originalMovements = (
        await db.cashMovements
          .where("referenceId")
          .equals(purchase.id)
          .toArray()
      ).filter((movement) => movement.referenceType === "purchase");

      let cashReversal = 0;
      for (const original of originalMovements) {
        await db.cashMovements.add(
          reverseCashMovement(original, purchase.id, createdAt),
        );
        cashReversal += original.amount;
      }

      await db.purchases.update(purchase.id, { status: "cancelled" });

      return {
        operationId: purchase.id,
        operationType: "purchase",
        title: "Compra anulada",
        amount: purchase.total,
        cashReversal,
        inventoryReversals,
      };
    },
  );
}

export async function cancelBusinessOperation(input: {
  operationType: BusinessOperationType;
  operationId: string;
}): Promise<CancelBusinessOperationResult> {
  if (input.operationType === "sale") {
    return cancelSale(input.operationId);
  }
  if (input.operationType === "expense") {
    return cancelExpense(input.operationId);
  }
  return cancelPurchase(input.operationId);
}
