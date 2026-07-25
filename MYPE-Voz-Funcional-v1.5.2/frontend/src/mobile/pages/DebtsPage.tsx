import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CheckCircle2,
  ChevronRight,
  HandCoins,
  PackageOpen,
  Plus,
  Search,
} from "lucide-react";
import { db } from "../../database/db";
import {
  payCustomerDebt,
  saveCustomer,
} from "../../services/debt.service";
import type {
  Customer,
  Debt,
  DebtPayment,
  PaymentMethod,
  Sale,
  SaleItem,
} from "../../types/domain";
import { PageContainer } from "../components/PageContainer";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";

interface DebtReceipt {
  debt: Debt;
  sale: Sale | null;
  items: SaleItem[];
}

interface GeneralPayment {
  id: string;
  amount: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
}

interface CustomerAccount {
  customer: Customer;
  receipts: DebtReceipt[];
  payments: GeneralPayment[];
  originalTotal: number;
  paidTotal: number;
  pendingBalance: number;
}

type PaymentMode = "partial" | "full";

const money = (value: number) => `S/ ${value.toFixed(2)}`;

const dateFormatter = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDate(value: string | null): string {
  if (!value) return "Sin fecha";
  return dateFormatter.format(new Date(value));
}

function paymentLabel(method: PaymentMethod): string {
  if (method === "cash") return "Efectivo";
  if (method === "yape") return "Yape";
  return "Plin";
}

function aggregatePayments(
  customerId: string,
  payments: DebtPayment[],
): GeneralPayment[] {
  const grouped = new Map<string, GeneralPayment>();

  for (const payment of payments) {
    if (payment.customerId !== customerId) continue;

    const key = `${payment.createdAt}|${payment.paymentMethod}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.amount += payment.amount;
      existing.id = `${existing.id}-${payment.id}`;
      continue;
    }

    grouped.set(key, {
      id: payment.id,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      createdAt: payment.createdAt,
    });
  }

  return [...grouped.values()].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() -
      new Date(left.createdAt).getTime(),
  );
}

export function DebtsPage() {
  const accounts = useLiveQuery(async () => {
    const [customers, debts, sales, saleItems, payments] =
      await Promise.all([
        db.customers
          .filter((customer) => customer.active)
          .toArray(),
        db.debts.toArray(),
        db.sales.toArray(),
        db.saleItems.toArray(),
        db.debtPayments.toArray(),
      ]);

    const saleMap = new Map(
      sales.map((sale) => [sale.id, sale]),
    );

    return customers
      .map<CustomerAccount>((customer) => {
        const customerDebts = debts
          .filter((debt) => debt.customerId === customer.id)
          .sort(
            (left, right) =>
              new Date(right.createdAt).getTime() -
              new Date(left.createdAt).getTime(),
          );

        const receipts = customerDebts.map<DebtReceipt>((debt) => ({
          debt,
          sale: saleMap.get(debt.saleId) ?? null,
          items: saleItems.filter(
            (item) => item.saleId === debt.saleId,
          ),
        }));

        const originalTotal = receipts.reduce(
          (sum, receipt) =>
            sum + receipt.debt.originalAmount,
          0,
        );
        const pendingBalance = receipts.reduce(
          (sum, receipt) => sum + receipt.debt.balance,
          0,
        );

        return {
          customer,
          receipts,
          payments: aggregatePayments(customer.id, payments),
          originalTotal,
          paidTotal: Math.max(
            0,
            originalTotal - pendingBalance,
          ),
          pendingBalance,
        };
      })
      .filter((account) => account.receipts.length > 0)
      .sort(
        (left, right) =>
          right.pendingBalance - left.pendingBalance ||
          left.customer.name.localeCompare(
            right.customer.name,
          ),
      );
  }, [], []);

  const [query, setQuery] = useState("");
  const [detailAccountId, setDetailAccountId] =
    useState<string | null>(null);
  const [paymentAccountId, setPaymentAccountId] =
    useState<string | null>(null);
  const [paymentMode, setPaymentMode] =
    useState<PaymentMode>("partial");
  const [amount, setAmount] = useState("");
  const [method, setMethod] =
    useState<PaymentMethod>("cash");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const detailAccount =
    (accounts ?? []).find(
      (account) => account.customer.id === detailAccountId,
    ) ?? null;

  const paymentAccount =
    (accounts ?? []).find(
      (account) => account.customer.id === paymentAccountId,
    ) ?? null;

  const filtered = useMemo(() => {
    const search = query.toLowerCase().trim();
    if (!search) return accounts ?? [];

    return (accounts ?? []).filter((account) =>
      account.customer.name.toLowerCase().includes(search),
    );
  }, [accounts, query]);

  function openPayment(
    account: CustomerAccount,
    mode: PaymentMode,
  ) {
    setPaymentAccountId(account.customer.id);
    setPaymentMode(mode);
    setAmount(
      mode === "full"
        ? account.pendingBalance.toFixed(2)
        : "",
    );
    setMethod("cash");
    setError("");
  }

  function closePayment() {
    setPaymentAccountId(null);
    setAmount("");
    setError("");
  }

  async function pay() {
    if (!paymentAccount) return;

    setError("");

    try {
      const value =
        paymentMode === "full"
          ? paymentAccount.pendingBalance
          : Number(amount);

      const result = await payCustomerDebt({
        customerId: paymentAccount.customer.id,
        amount: value,
        paymentMethod: method,
      });

      setMessage(
        paymentMode === "full"
          ? `La deuda total de ${
              result.customerName
            } quedó pagada. Se registró ${money(
              result.amountPaid,
            )} por ${paymentLabel(method)}.`
          : `Abono registrado: ${money(
              result.amountPaid,
            )}. Saldo restante: ${money(
              result.remainingBalance,
            )}.`,
      );

      closePayment();

      if (paymentMode === "full") {
        setDetailAccountId(
          paymentAccount.customer.id,
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo registrar el pago.",
      );
    }
  }

  async function addCustomer() {
    const name = window.prompt("Nombre del cliente:");
    if (!name?.trim()) return;

    await saveCustomer({ name });
    setMessage(`${name.trim()} fue agregado como cliente.`);
  }

  return (
    <PageContainer className="debts-mobile-page">
      <div className="mobile-page-heading">
        <div>
          <span>CUENTAS POR COBRAR</span>
          <h1>Fiados</h1>
          <p>
            Revisa lo entregado, registra abonos y marca una
            cuenta como pagada cuando cancelen todo el saldo.
          </p>
        </div>
        <button
          className="mobile-circle-action"
          onClick={() => void addCustomer()}
          title="Agregar cliente"
        >
          <Plus size={20} />
        </button>
      </div>

      {message ? (
        <div className="mobile-success-banner">{message}</div>
      ) : null}

      <div className="mobile-search-field">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar cliente"
        />
      </div>

      {filtered.length ? (
        <div className="debt-account-list">
          {filtered.map((account) => (
            <article
              className="debt-account-card"
              key={account.customer.id}
            >
              <div className="debt-account-head">
                <div>
                  <h2>{account.customer.name}</h2>
                  <span>Monto que debe</span>
                </div>
                <strong>{money(account.pendingBalance)}</strong>
              </div>

              <div className="debt-account-progress">
                <div>
                  <span>Total fiado</span>
                  <strong>{money(account.originalTotal)}</strong>
                </div>
                <div>
                  <span>Abonado</span>
                  <strong>{money(account.paidTotal)}</strong>
                </div>
              </div>

              <div className="debt-account-actions">
                <button
                  onClick={() =>
                    setDetailAccountId(account.customer.id)
                  }
                >
                  Ver detalles
                  <ChevronRight size={17} />
                </button>
                <button
                  className="primary"
                  disabled={account.pendingBalance <= 0}
                  onClick={() =>
                    openPayment(account, "partial")
                  }
                >
                  <HandCoins size={17} />
                  Registrar abono
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="debt-empty-card">
          <PackageOpen size={32} />
          <strong>No hay fiados registrados</strong>
          <p>
            Los fiados confirmados desde la IA aparecerán aquí
            con su detalle completo.
          </p>
        </div>
      )}

      <Modal
        open={Boolean(detailAccount)}
        title={
          detailAccount
            ? `Cuenta de ${detailAccount.customer.name}`
            : "Detalle de deuda"
        }
        onClose={() => setDetailAccountId(null)}
        footer={
          <Button
            variant="outline"
            fullWidth
            onClick={() => setDetailAccountId(null)}
          >
            Cerrar
          </Button>
        }
      >
        {detailAccount ? (
          <div className="debt-detail-simple">
            <section className="debt-account-summary">
              <div>
                <span>Total fiado</span>
                <strong>
                  {money(detailAccount.originalTotal)}
                </strong>
              </div>
              <div>
                <span>Abonado total</span>
                <strong>{money(detailAccount.paidTotal)}</strong>
              </div>
              <div className="pending">
                <span>Saldo pendiente</span>
                <strong>
                  {money(detailAccount.pendingBalance)}
                </strong>
              </div>
            </section>

            {detailAccount.pendingBalance > 0 ? (
              <div className="debt-general-actions">
                <button
                  onClick={() => {
                    openPayment(detailAccount, "partial");
                    setDetailAccountId(null);
                  }}
                >
                  <HandCoins size={18} />
                  Registrar abono
                </button>
                <button
                  className="paid"
                  onClick={() => {
                    openPayment(detailAccount, "full");
                    setDetailAccountId(null);
                  }}
                >
                  <CheckCircle2 size={18} />
                  Deuda total pagada
                </button>
              </div>
            ) : (
              <div className="debt-paid-banner">
                <CheckCircle2 size={20} />
                <div>
                  <strong>Cuenta pagada</strong>
                  <p>No queda saldo pendiente.</p>
                </div>
              </div>
            )}

            <section className="debt-detail-section">
              <header>
                <span>DETALLE DE LO FIADO</span>
                <strong>
                  {detailAccount.receipts.length}{" "}
                  {detailAccount.receipts.length === 1
                    ? "registro"
                    : "registros"}
                </strong>
              </header>

              <div className="debt-simple-receipts">
                {detailAccount.receipts.map((receipt) => (
                  <article
                    className="debt-simple-receipt"
                    key={receipt.debt.id}
                  >
                    <div className="debt-simple-receipt-head">
                      <strong>
                        {formatDate(receipt.debt.createdAt)}
                      </strong>
                      <b
                        className={
                          receipt.debt.status === "paid"
                            ? "paid"
                            : "pending"
                        }
                      >
                        {money(receipt.debt.originalAmount)}
                      </b>
                    </div>

                    <div className="debt-simple-items compact">
                      {receipt.items.length ? (
                        receipt.items.map((item) => (
                          <div key={item.id}>
                            <strong>{item.productName}</strong>
                            <span>
                              {item.quantity}{" "}
                              {item.quantity === 1
                                ? "unidad"
                                : "unidades"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p>
                          Este registro antiguo no conserva el
                          detalle de productos.
                        </p>
                      )}
                    </div>

                    {receipt.debt.dueDate ? (
                      <small className="debt-simple-due-date">
                        Fecha acordada:{" "}
                        {formatDate(receipt.debt.dueDate)}
                      </small>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="debt-detail-section">
              <header>
                <span>HISTORIAL GENERAL DE ABONOS</span>
                <strong>
                  {detailAccount.payments.length}
                </strong>
              </header>

              {detailAccount.payments.length ? (
                <div className="debt-general-payment-list">
                  {detailAccount.payments.map((payment) => (
                    <div key={payment.id}>
                      <div>
                        <strong>
                          {shortDateFormatter.format(
                            new Date(payment.createdAt),
                          )}
                        </strong>
                        <span>
                          {paymentLabel(payment.paymentMethod)}
                        </span>
                      </div>
                      <b>{money(payment.amount)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="debt-no-payments">
                  Todavía no se registraron abonos.
                </p>
              )}
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(paymentAccount)}
        title={
          paymentMode === "full"
            ? "Pagar deuda total"
            : "Registrar abono"
        }
        onClose={closePayment}
        footer={
          <>
            <Button
              variant="outline"
              fullWidth
              onClick={closePayment}
            >
              Volver
            </Button>
            <Button
              fullWidth
              onClick={() => void pay()}
              disabled={
                !paymentAccount ||
                paymentAccount.pendingBalance <= 0 ||
                (
                  paymentMode === "partial" &&
                  (!amount || Number(amount) <= 0)
                )
              }
            >
              {paymentMode === "full"
                ? "Confirmar pago total"
                : "Confirmar abono"}
            </Button>
          </>
        }
      >
        <div className="debt-payment-form">
          <section>
            <span>Cliente</span>
            <strong>{paymentAccount?.customer.name}</strong>
            <p>
              Saldo pendiente:{" "}
              {money(paymentAccount?.pendingBalance ?? 0)}
            </p>
          </section>

          {paymentMode === "full" ? (
            <div className="debt-full-payment-notice">
              <CheckCircle2 size={22} />
              <div>
                <strong>
                  Se pagará todo el saldo
                </strong>
                <p>
                  Se registrará un abono general de{" "}
                  {money(
                    paymentAccount?.pendingBalance ?? 0,
                  )}{" "}
                  y la cuenta quedará en S/ 0.00.
                </p>
              </div>
            </div>
          ) : (
            <label className="field-mobile">
              Monto del abono
              <input
                type="number"
                min="0.1"
                step="0.1"
                max={paymentAccount?.pendingBalance}
                value={amount}
                onChange={(event) =>
                  setAmount(event.target.value)
                }
                placeholder="0.00"
              />
            </label>
          )}

          <div>
            <p className="debt-method-label">
              Método de pago
            </p>
            <div className="debt-method-grid">
              {(
                ["cash", "yape", "plin"] as PaymentMethod[]
              ).map((item) => (
                <button
                  key={item}
                  onClick={() => setMethod(item)}
                  className={method === item ? "active" : ""}
                >
                  {paymentLabel(item)}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="mobile-error-banner">{error}</p>
          ) : null}
        </div>
      </Modal>
    </PageContainer>
  );
}
