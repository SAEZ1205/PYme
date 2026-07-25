import { z } from "zod";
import { BUSINESS_ID, db } from "../database/db";
import type { Product, ProductType } from "../types/domain";

const productInputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(2, "Escribe un nombre válido."),
    type: z.enum(["product", "service"]),
    purchaseCost: z.number().min(0).nullable(),
    salePrice: z.number().positive("El precio de venta debe ser mayor que cero."),
    tracksStock: z.boolean(),
    currentStock: z.number().int().min(0).nullable(),
    minimumStock: z.number().int().min(0).nullable(),
  })
  .superRefine((value, context) => {
    if (value.type === "service" && value.tracksStock) {
      context.addIssue({
        code: "custom",
        path: ["tracksStock"],
        message: "Un servicio no puede controlar stock.",
      });
    }

    if (value.type === "product" && value.tracksStock) {
      if (value.currentStock === null) {
        context.addIssue({
          code: "custom",
          path: ["currentStock"],
          message: "Ingresa el stock actual.",
        });
      }
      if (value.minimumStock === null) {
        context.addIssue({
          code: "custom",
          path: ["minimumStock"],
          message: "Ingresa el stock mínimo.",
        });
      }
    }
  });

export type ProductInput = {
  id?: string;
  name: string;
  type: ProductType;
  purchaseCost: number | null;
  salePrice: number;
  tracksStock: boolean;
  currentStock: number | null;
  minimumStock: number | null;
};

export async function saveProduct(input: ProductInput): Promise<Product> {
  const parsed = productInputSchema.parse(input);
  const now = new Date().toISOString();
  const previous = parsed.id ? await db.products.get(parsed.id) : undefined;

  const product: Product = {
    id: previous?.id ?? crypto.randomUUID(),
    businessId: BUSINESS_ID,
    name: parsed.name,
    type: parsed.type,
    purchaseCost: parsed.type === "service" ? null : parsed.purchaseCost,
    salePrice: parsed.salePrice,
    tracksStock: parsed.type === "product" ? parsed.tracksStock : false,
    currentStock:
      parsed.type === "product" && parsed.tracksStock ? parsed.currentStock : null,
    minimumStock:
      parsed.type === "product" && parsed.tracksStock ? parsed.minimumStock : null,
    active: previous?.active ?? true,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };

  await db.products.put(product);
  return product;
}

export async function deactivateProduct(productId: string): Promise<void> {
  await db.products.update(productId, {
    active: false,
    updatedAt: new Date().toISOString(),
  });
}
