import { z } from "zod";
import { BUSINESS_ID, db } from "../database/db";
import { getActiveOperatorName } from "./operator.service";
import type {
  CashMovement,
  ConfirmedExpenseResult,
  Expense,
  ExpenseDraft,
} from "../types/domain";

const expenseDraftSchema = z.object({
  category: z.enum([
    "rent",
    "utilities",
    "transport",
    "maintenance",
    "supplier_payment",
    "other",
  ]),
  description: z.string().trim().min(2, "Describe brevemente el gasto."),
  amount: z.number().positive("El monto debe ser mayor que cero."),
  paymentMethod: z.enum(["cash", "yape", "plin"]),
  operatorName: z.string().trim().nullable().optional(),
  occurredAt: z.string().min(1, "Selecciona la fecha del gasto."),
});

export async function confirmExpense(
  input: ExpenseDraft,
): Promise<ConfirmedExpenseResult> {
  const draft = expenseDraftSchema.parse(input);
  const expenseId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const occurredAt = new Date(draft.occurredAt).toISOString();

  return db.transaction("rw", [db.expenses, db.cashMovements], async () => {
    const expense: Expense = {
      id: expenseId,
      businessId: BUSINESS_ID,
      category: draft.category,
      description: draft.description,
      amount: draft.amount,
      paymentMethod: draft.paymentMethod,
      status: "confirmed",
      operatorName: draft.operatorName?.trim() || getActiveOperatorName(),
      occurredAt,
      createdAt,
    };

    const cashMovement: CashMovement = {
      id: crypto.randomUUID(),
      businessId: BUSINESS_ID,
      type: "expense",
      paymentMethod: draft.paymentMethod,
      amount: draft.amount,
      referenceType: "expense",
      referenceId: expenseId,
      createdAt: occurredAt,
    };

    await db.expenses.add(expense);
    await db.cashMovements.add(cashMovement);

    return { expenseId, amount: draft.amount };
  });
}
