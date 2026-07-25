import { z } from "zod";
import { BUSINESS_ID, db } from "../database/db";
import type {
  CashMovement,
  Customer,
  CustomerDebtSummary,
  DebtPayment,
  DebtPaymentResult,
  PaymentMethod,
} from "../types/domain";

const customerSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Escribe el nombre del cliente."),
  phone: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

const paymentSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.enum(["cash", "yape", "plin"]),
});

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findCustomerByName(
  name: string,
): Promise<Customer | undefined> {
  const normalized = normalizeName(name);
  const customers = await db.customers
    .filter((customer) => customer.active)
    .toArray();

  return customers.find(
    (customer) => normalizeName(customer.name) === normalized,
  );
}

export async function saveCustomer(input: {
  id?: string;
  name: string;
  phone?: string | null;
  notes?: string | null;
}): Promise<Customer> {
  const data = customerSchema.parse(input);
  const now = new Date().toISOString();

  if (!data.id) {
    const existing = await findCustomerByName(data.name);
    if (existing) return existing;
  }

  const current = data.id ? await db.customers.get(data.id) : undefined;
  const customer: Customer = {
    id: data.id ?? crypto.randomUUID(),
    businessId: BUSINESS_ID,
    name: data.name,
    phone: data.phone?.trim() || null,
    notes: data.notes?.trim() || null,
    active: current?.active ?? true,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  await db.customers.put(customer);
  return customer;
}

export async function ensureCustomer(input: {
  customerId?: string | null;
  customerName?: string | null;
}): Promise<Customer> {
  if (input.customerId) {
    const customer = await db.customers.get(input.customerId);
    if (customer?.active) return customer;
  }

  if (!input.customerName?.trim()) {
    throw new Error("Falta identificar al cliente.");
  }

  return saveCustomer({ name: input.customerName.trim() });
}

export async function getCustomerDebtSummaries(): Promise<
  CustomerDebtSummary[]
> {
  const [customers, debts] = await Promise.all([
    db.customers.filter((customer) => customer.active).toArray(),
    db.debts.toArray(),
  ]);

  return customers
    .map((customer) => {
      const customerDebts = debts.filter(
        (debt) =>
          debt.customerId === customer.id &&
          debt.status === "pending" &&
          debt.balance > 0,
      );

      return {
        customer,
        pendingBalance: customerDebts.reduce(
          (sum, debt) => sum + debt.balance,
          0,
        ),
        pendingDebts: customerDebts.length,
        lastDebtAt: customerDebts.length
          ? customerDebts
              .map((debt) => debt.createdAt)
              .sort()
              .reverse()[0]
          : null,
      };
    })
    .sort(
      (a, b) =>
        b.pendingBalance - a.pendingBalance ||
        a.customer.name.localeCompare(b.customer.name),
    );
}

export async function payCustomerDebt(input: {
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
}): Promise<DebtPaymentResult> {
  const data = paymentSchema.parse(input);
  const createdAt = new Date().toISOString();

  return db.transaction(
    "rw",
    [db.customers, db.debts, db.debtPayments, db.cashMovements],
    async () => {
      const customer = await db.customers.get(data.customerId);
      if (!customer?.active) {
        throw new Error("El cliente ya no está disponible.");
      }

      const pendingDebts = (await db.debts
        .where("customerId")
        .equals(customer.id)
        .toArray())
        .filter((debt) => debt.status === "pending" && debt.balance > 0)
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() -
            new Date(b.createdAt).getTime(),
        );

      const totalPending = pendingDebts.reduce(
        (sum, debt) => sum + debt.balance,
        0,
      );

      if (totalPending <= 0) {
        throw new Error(`${customer.name} no tiene deuda pendiente.`);
      }

      if (data.amount > totalPending + 0.001) {
        throw new Error(
          `El abono supera la deuda pendiente de S/ ${totalPending.toFixed(2)}.`,
        );
      }

      let remainingPayment = data.amount;
      const paymentIds: string[] = [];
      let affectedDebts = 0;

      for (const debt of pendingDebts) {
        if (remainingPayment <= 0.001) break;

        const applied = Math.min(remainingPayment, debt.balance);
        const nextBalance = Math.max(0, debt.balance - applied);

        const payment: DebtPayment = {
          id: crypto.randomUUID(),
          businessId: BUSINESS_ID,
          debtId: debt.id,
          customerId: customer.id,
          amount: applied,
          paymentMethod: data.paymentMethod,
          createdAt,
        };

        await db.debtPayments.add(payment);
        await db.debts.update(debt.id, {
          balance: nextBalance,
          status: nextBalance <= 0.001 ? "paid" : "pending",
          updatedAt: createdAt,
        });

        paymentIds.push(payment.id);
        affectedDebts += 1;
        remainingPayment -= applied;
      }

      const cashMovement: CashMovement = {
        id: crypto.randomUUID(),
        businessId: BUSINESS_ID,
        type: "income",
        paymentMethod: data.paymentMethod,
        amount: data.amount,
        referenceType: "debt_payment",
        referenceId: paymentIds[0]!,
        createdAt,
      };
      await db.cashMovements.add(cashMovement);

      return {
        customerId: customer.id,
        customerName: customer.name,
        amountPaid: data.amount,
        remainingBalance: Math.max(0, totalPending - data.amount),
        affectedDebts,
        paymentIds,
      };
    },
  );
}
