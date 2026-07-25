import { z } from "zod";
import { BUSINESS_ID, db } from "../database/db";
import type { InventoryMovement } from "../types/domain";

const adjustmentSchema = z.object({
  productId: z.string().min(1),
  newStock: z.number().int().min(0),
  reason: z.string().trim().min(2),
  referenceId: z.string().min(1),
});

export async function adjustProductStock(input: {
  productId: string;
  newStock: number;
  reason: string;
  referenceId: string;
}): Promise<{ productName: string; previousStock: number; newStock: number }> {
  const parsed = adjustmentSchema.parse(input);
  const createdAt = new Date().toISOString();

  return db.transaction(
    "rw",
    [db.products, db.inventoryMovements],
    async () => {
      const product = await db.products.get(parsed.productId);
      if (!product || !product.active || product.type !== "product") {
        throw new Error("El producto ya no está disponible.");
      }
      if (!product.tracksStock) {
        throw new Error(
          "Este producto no controla stock. Activa el control antes de ajustarlo.",
        );
      }

      const previousStock = product.currentStock ?? 0;
      const difference = parsed.newStock - previousStock;

      await db.products.update(product.id, {
        currentStock: parsed.newStock,
        updatedAt: createdAt,
      });

      if (difference !== 0) {
        const movement: InventoryMovement = {
          id: crypto.randomUUID(),
          businessId: BUSINESS_ID,
          productId: product.id,
          type: "adjustment",
          quantity: difference,
          referenceId: parsed.referenceId,
          createdAt,
        };
        await db.inventoryMovements.add(movement);
      }

      return {
        productName: product.name,
        previousStock,
        newStock: parsed.newStock,
      };
    },
  );
}
