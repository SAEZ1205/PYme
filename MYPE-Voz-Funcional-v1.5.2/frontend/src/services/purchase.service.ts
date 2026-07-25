import { z } from "zod";
import { BUSINESS_ID, db } from "../database/db";
import { getActiveOperatorName } from "./operator.service";
import type {
  CashMovement,
  ConfirmedPurchaseResult,
  InventoryMovement,
  Purchase,
  PurchaseDraft,
  PurchaseItem,
} from "../types/domain";

const purchaseDraftSchema = z.object({
  supplierName: z.string().trim().nullable(),
  operatorName: z.string().trim().nullable().optional(),
  purpose: z.enum(["merchandise", "internal_supply", "business_expense"]),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        productName: z.string().min(1),
        quantity: z.number().int().positive(),
        unitCost: z.number().positive(),
        tracksStock: z.boolean(),
        currentStock: z.number().int().min(0).nullable(),
      }),
    )
    .min(1, "Agrega por lo menos un producto a la compra."),
  additionalCosts: z.number().min(0),
  paymentMethod: z.enum(["cash", "yape", "plin"]),
  purchasedAt: z.string().min(1, "Selecciona la fecha de compra."),
});

export class PurchaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseValidationError";
  }
}

export function calculatePurchaseTotal(draft: PurchaseDraft): number {
  const itemTotal = draft.items.reduce(
    (sum, item) => sum + item.quantity * item.unitCost,
    0,
  );
  return itemTotal + draft.additionalCosts;
}

function calculateWeightedCost(
  currentStock: number,
  currentCost: number | null,
  purchasedQuantity: number,
  purchasedUnitCost: number,
): number {
  if (currentStock <= 0 || currentCost === null) return purchasedUnitCost;

  const previousValue = currentStock * currentCost;
  const newValue = purchasedQuantity * purchasedUnitCost;
  return (previousValue + newValue) / (currentStock + purchasedQuantity);
}

export async function confirmPurchase(
  input: PurchaseDraft,
): Promise<ConfirmedPurchaseResult> {
  const draft = purchaseDraftSchema.parse(input);
  const purchaseId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const purchasedAt = new Date(draft.purchasedAt).toISOString();
  const total = calculatePurchaseTotal(draft);

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
      const products = await db.products.bulkGet(
        draft.items.map((item) => item.productId),
      );

      for (const [index, product] of products.entries()) {
        const item = draft.items[index];
        if (!product || !item || !product.active || product.type !== "product") {
          throw new PurchaseValidationError(
            `El producto ${item?.productName ?? "seleccionado"} ya no está disponible.`,
          );
        }
      }

      const purchase: Purchase = {
        id: purchaseId,
        businessId: BUSINESS_ID,
        supplierName: draft.supplierName?.trim() || null,
        purpose: draft.purpose,
        additionalCosts: draft.additionalCosts,
        total,
        paymentMethod: draft.paymentMethod,
        status: "confirmed",
        operatorName: draft.operatorName?.trim() || getActiveOperatorName(),
        purchasedAt,
        createdAt,
      };

      const baseItemsTotal = draft.items.reduce(
        (sum, item) => sum + item.quantity * item.unitCost,
        0,
      );

      const purchaseItems: PurchaseItem[] = draft.items.map((item) => {
        const subtotal = item.quantity * item.unitCost;
        const allocatedAdditionalCost =
          baseItemsTotal > 0
            ? draft.additionalCosts * (subtotal / baseItemsTotal)
            : 0;
        const effectiveUnitCost =
          item.unitCost + allocatedAdditionalCost / item.quantity;

        return {
          id: crypto.randomUUID(),
          purchaseId,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitCost: item.unitCost,
          allocatedAdditionalCost,
          effectiveUnitCost,
          subtotal,
        };
      });

      const cashMovement: CashMovement = {
        id: crypto.randomUUID(),
        businessId: BUSINESS_ID,
        type: "expense",
        paymentMethod: draft.paymentMethod,
        amount: total,
        referenceType: "purchase",
        referenceId: purchaseId,
        createdAt: purchasedAt,
      };

      const inventoryMovements: InventoryMovement[] = [];
      let productsUpdated = 0;

      if (draft.purpose === "merchandise") {
        for (const item of draft.items) {
          const product = await db.products.get(item.productId);
          const storedItem = purchaseItems.find(
            (candidate) => candidate.productId === item.productId,
          );
          if (!product || !storedItem) {
            throw new PurchaseValidationError(
              `No se encontró ${item.productName}.`,
            );
          }

          const update: Partial<typeof product> = {
            updatedAt: createdAt,
          };

          if (product.tracksStock) {
            const previousStock = product.currentStock ?? 0;
            update.purchaseCost = calculateWeightedCost(
              previousStock,
              product.purchaseCost,
              item.quantity,
              storedItem.effectiveUnitCost,
            );
            update.currentStock = previousStock + item.quantity;

            inventoryMovements.push({
              id: crypto.randomUUID(),
              businessId: BUSINESS_ID,
              productId: product.id,
              type: "purchase",
              quantity: item.quantity,
              referenceId: purchaseId,
              createdAt: purchasedAt,
            });
          } else {
            update.purchaseCost = storedItem.effectiveUnitCost;
          }

          await db.products.update(product.id, update);
          productsUpdated += 1;
        }
      }

      await db.purchases.add(purchase);
      await db.purchaseItems.bulkAdd(purchaseItems);
      await db.cashMovements.add(cashMovement);
      if (inventoryMovements.length) {
        await db.inventoryMovements.bulkAdd(inventoryMovements);
      }

      return {
        purchaseId,
        total,
        inventoryMovements: inventoryMovements.length,
        productsUpdated,
      };
    },
  );
}
