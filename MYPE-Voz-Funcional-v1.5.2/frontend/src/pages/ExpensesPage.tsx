import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../database/db";
import { confirmExpense } from "../services/expense.service";
import type {
  ExpenseCategory,
  ExpenseDraft,
  PaymentMethod,
} from "../types/domain";

const categoryLabels: Record<ExpenseCategory, string> = {
  rent: "Alquiler",
  utilities: "Luz, agua o internet",
  transport: "Transporte",
  maintenance: "Mantenimiento",
  supplier_payment: "Pago a proveedor",
  other: "Otro gasto",
};

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
};

function localDateTimeValue(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

const emptyDraft: ExpenseDraft = {
  category: "other",
  description: "",
  amount: 0,
  paymentMethod: "cash",
  occurredAt: localDateTimeValue(),
};

export function ExpensesPage() {
  const expenses = useLiveQuery(
    () => db.expenses.orderBy("occurredAt").reverse().limit(20).toArray(),
    [],
    [],
  );
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);
  const [preview, setPreview] = useState<ExpenseDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function update<K extends keyof ExpenseDraft>(
    key: K,
    value: ExpenseDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (draft.description.trim().length < 2) {
      setError("Describe brevemente el gasto.");
      return;
    }
    if (draft.amount <= 0) {
      setError("El monto debe ser mayor que cero.");
      return;
    }

    setPreview(draft);
  }

  async function execute() {
    if (!preview) return;
    setBusy(true);
    setError("");

    try {
      const result = await confirmExpense(preview);
      setPreview(null);
      setDraft({ ...emptyDraft, occurredAt: localDateTimeValue() });
      setNotice(
        `Gasto registrado por S/ ${result.amount.toFixed(2)} y descontado de Caja.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No se pudo guardar el gasto.",
      );
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar glass">
        <div>
          <p className="eyebrow">EGRESOS DEL NEGOCIO</p>
          <h1>Gastos</h1>
        </div>
      </header>

      <section className="page active split-page">
        <article className="panel glass form-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">NUEVO GASTO</p>
              <h3>Registrar salida de dinero</h3>
            </div>
          </div>

          <form className="form-grid" onSubmit={prepare}>
            <label>
              Categoría
              <select
                className="input"
                value={draft.category}
                onChange={(event) =>
                  update("category", event.target.value as ExpenseCategory)
                }
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Monto
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.10"
                value={draft.amount || ""}
                onChange={(event) => update("amount", Number(event.target.value))}
                placeholder="0.00"
              />
            </label>

            <label className="full">
              Descripción
              <input
                className="input"
                value={draft.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Ej. Pago de internet del local"
              />
            </label>

            <label>
              Método de pago
              <select
                className="input"
                value={draft.paymentMethod}
                onChange={(event) =>
                  update("paymentMethod", event.target.value as PaymentMethod)
                }
              >
                <option value="cash">Efectivo</option>
                <option value="yape">Yape</option>
                <option value="plin">Plin</option>
              </select>
            </label>

            <label>
              Fecha y hora
              <input
                className="input"
                type="datetime-local"
                value={draft.occurredAt}
                onChange={(event) => update("occurredAt", event.target.value)}
              />
            </label>

            {error ? <p className="form-message error full">{error}</p> : null}
            {notice ? <p className="form-message success full">{notice}</p> : null}

            <button className="primary-button full" type="submit">
              Revisar gasto
            </button>
          </form>
        </article>

        <article className="panel glass">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">HISTORIAL</p>
              <h3>Gastos recientes</h3>
            </div>
          </div>

          {expenses?.length ? (
            <div className="operation-list">
              {expenses.map((expense) => (
                <div className="operation-item" key={expense.id}>
                  <span className="operation-icon expense-icon">−</span>
                  <div>
                    <strong>{expense.description}</strong>
                    <small>
                      {categoryLabels[expense.category]} ·{" "}
                      {paymentLabels[expense.paymentMethod]} ·{" "}
                      {new Date(expense.occurredAt).toLocaleString("es-PE")}
                    </small>
                  </div>
                  <strong className="negative-amount">
                    − S/ {expense.amount.toFixed(2)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No hay gastos registrados</strong>
              <p>Los egresos confirmados aparecerán aquí.</p>
            </div>
          )}
        </article>
      </section>

      {preview ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal glass" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">REVISIÓN OBLIGATORIA</p>
                <h2>Gasto por confirmar</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setPreview(null)}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="preview-row">
              <span>Categoría</span>
              <strong>{categoryLabels[preview.category]}</strong>
            </div>
            <div className="preview-row">
              <span>Descripción</span>
              <strong>{preview.description}</strong>
            </div>
            <div className="preview-row">
              <span>Método de pago</span>
              <strong>{paymentLabels[preview.paymentMethod]}</strong>
            </div>
            <div className="preview-row total-row">
              <span>Monto</span>
              <strong>S/ {preview.amount.toFixed(2)}</strong>
            </div>
            <div className="preview-row">
              <span>Estado</span>
              <strong>Aún no guardado</strong>
            </div>

            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setPreview(null)}
                disabled={busy}
              >
                Corregir
              </button>
              <button
                className="primary-button"
                onClick={execute}
                disabled={busy}
              >
                {busy ? "Guardando…" : "Confirmar gasto"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
