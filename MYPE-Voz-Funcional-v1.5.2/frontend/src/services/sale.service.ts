import { z } from "zod";
import { BUSINESS_ID, db } from "../database/db";
import { getActiveOperatorName } from "./operator.service";
import type {
  CashMovement,
  ConfirmedSaleResult,
  Debt,
  InventoryMovement,
  Sale,
  SaleDraft,
  SaleItem,
} from "../types/domain";

const saleDraftSchema = z
  .object({
    paymentMethod: z.enum(["cash", "yape", "plin", "credit"]),
    operatorName: z.string().trim().nullable().optional(),
    customerId: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          productName: z.string().min(1),
          productType: z.enum(["product", "service"]),
          quantity: z.number().int().positive(),
          unitPrice: z.number().positive(),
          unitCost: z.number().min(0).nullable(),
          tracksStock: z.boolean(),
          availableStock: z.number().int().min(0).nullable(),
        }),
      )
      .min(1, "La venta debe contener al menos un producto o servicio."),
  })
  .superRefine((data, context) => {
    if (data.paymentMethod === "credit" && !data.customerId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "Una venta fiada necesita un cliente.",
      });
    }
  });

export class SaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleValidationError";
  }
}

export function calculateSaleTotal(draft: SaleDraft): number {
  return draft.items.reduce(
    (total, item) => total + item.quantity * item.unitPrice,
    0,
  );
}

export async function confirmSale(
  draftInput: SaleDraft,
): Promise<ConfirmedSaleResult> {
  const draft = saleDraftSchema.parse(draftInput);
  const createdAt = new Date().toISOString();
  const saleId = crypto.randomUUID();
  const total = calculateSaleTotal(draft);
  const debtId =
    draft.paymentMethod === "credit" ? crypto.randomUUID() : undefined;

  return db.transaction(
    "rw",
    [
      db.products,
      db.customers,
      db.sales,
      db.saleItems,
      db.debts,
      db.cashMovements,
      db.inventoryMovements,
    ],
    async () => {
      const products = await db.products.bulkGet(
        draft.items.map((item) => item.productId),
      );

      for (const [index, product] of products.entries()) {
        const draftItem = draft.items[index];
        if (!product || !draftItem || !product.active) {
          throw new SaleValidationError(
            `El artículo ${draftItem?.productName ?? "seleccionado"} ya no está disponible.`,
          );
        }

        if (
          product.type === "product" &&
          product.tracksStock &&
          (product.currentStock ?? 0) < draftItem.quantity
        ) {
          throw new SaleValidationError(
            `Stock insuficiente para ${product.name}. Disponible: ${product.currentStock ?? 0}.`,
          );
        }
      }

      if (draft.paymentMethod === "credit") {
        const customer = await db.customers.get(draft.customerId!);
        if (!customer?.active) {
          throw new SaleValidationError(
            "El cliente de la venta fiada no está disponible.",
          );
        }
      }

      const sale: Sale = {
        id: saleId,
        businessId: BUSINESS_ID,
        total,
        paymentMethod: draft.paymentMethod,
        customerId:
          draft.paymentMethod === "credit"
            ? (draft.customerId ?? null)
            : null,
        status: "confirmed",
        operatorName: draft.operatorName?.trim() || getActiveOperatorName(),
        createdAt,
      };

      const saleItems: SaleItem[] = draft.items.map((item) => ({
        id: crypto.randomUUID(),
        saleId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCost: item.unitCost,
        subtotal: item.quantity * item.unitPrice,
      }));

      const inventoryMovements: InventoryMovement[] = [];

      for (const item of draft.items) {
        const product = await db.products.get(item.productId);
        if (!product) {
          throw new SaleValidationError(`No se encontró ${item.productName}.`);
        }

        if (product.type === "product" && product.tracksStock) {
          const nextStock = (product.currentStock ?? 0) - item.quantity;
          await db.products.update(product.id, {
            currentStock: nextStock,
            updatedAt: createdAt,
          });

          inventoryMovements.push({
            id: crypto.randomUUID(),
            businessId: BUSINESS_ID,
            productId: product.id,
            type: "sale",
            quantity: -item.quantity,
            referenceId: saleId,
            createdAt,
          });
        }
      }

      await db.sales.add(sale);
      await db.saleItems.bulkAdd(saleItems);

      if (draft.paymentMethod === "credit") {
        const debt: Debt = {
          id: debtId!,
          businessId: BUSINESS_ID,
          customerId: draft.customerId!,
          saleId,
          originalAmount: total,
          balance: total,
          status: "pending",
          dueDate: draft.dueDate
            ? new Date(draft.dueDate).toISOString()
            : null,
          createdAt,
          updatedAt: createdAt,
        };
        await db.debts.add(debt);
      } else {
        const cashMovement: CashMovement = {
          id: crypto.randomUUID(),
          businessId: BUSINESS_ID,
          type: "income",
          paymentMethod: draft.paymentMethod,
          amount: total,
          referenceType: "sale",
          referenceId: saleId,
          createdAt,
        };
        await db.cashMovements.add(cashMovement);
      }

      if (inventoryMovements.length) {
        await db.inventoryMovements.bulkAdd(inventoryMovements);
      }

      return {
        saleId,
        total,
        inventoryMovements: inventoryMovements.length,
        debtId,
      };
    },
  );
}
