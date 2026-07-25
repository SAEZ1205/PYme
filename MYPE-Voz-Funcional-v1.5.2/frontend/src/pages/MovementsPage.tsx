import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../database/db";

const paymentLabels = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  credit: "Fiado",
} as const;

const referenceLabels = {
  sale: "Venta",
  expense: "Gasto",
  purchase: "Compra",
  debt_payment: "Pago de deuda",
  reversal: "Reversión de operación",
} as const;

const inventoryLabels = {
  sale: "Salida por venta",
  purchase: "Entrada por compra",
  adjustment: "Ajuste manual",
  cancellation: "Reversión",
} as const;

export function MovementsPage() {
  const sales = useLiveQuery(
    () => db.sales.orderBy("createdAt").reverse().limit(30).toArray(),
    [],
    [],
  );
  const expenses = useLiveQuery(
    () => db.expenses.orderBy("occurredAt").reverse().limit(30).toArray(),
    [],
    [],
  );
  const purchases = useLiveQuery(
    () => db.purchases.orderBy("purchasedAt").reverse().limit(30).toArray(),
    [],
    [],
  );
  const cashMovements = useLiveQuery(
    () => db.cashMovements.orderBy("createdAt").reverse().limit(50).toArray(),
    [],
    [],
  );
  const inventoryMovements = useLiveQuery(
    () =>
      db.inventoryMovements.orderBy("createdAt").reverse().limit(50).toArray(),
    [],
    [],
  );
  const products = useLiveQuery(() => db.products.toArray(), [], []);

  const productNames = new Map(
    (products ?? []).map((product) => [product.id, product.name]),
  );

  return (
    <>
      <header className="topbar glass">
        <div>
          <p className="eyebrow">TRAZABILIDAD</p>
          <h1>Movimientos</h1>
        </div>
      </header>

      <section className="page active audit-grid">
        <article className="panel glass">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">VENTAS</p>
              <h3>Operaciones confirmadas</h3>
            </div>
          </div>
          <div className="operation-list">
            {sales?.length ? (
              sales.map((sale) => (
                <div className="operation-item" key={sale.id}>
                  <span className="operation-icon">V</span>
                  <div>
                    <strong>Venta {sale.status}</strong>
                    <small>
                      {paymentLabels[sale.paymentMethod]} ·{" "}
                      {new Date(sale.createdAt).toLocaleString("es-PE")}
                    </small>
                  </div>
                  <strong>S/ {sale.total.toFixed(2)}</strong>
                </div>
              ))
            ) : (
              <p className="muted-text">Sin ventas.</p>
            )}
          </div>
        </article>

        <article className="panel glass">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EGRESOS</p>
              <h3>Gastos y compras</h3>
            </div>
          </div>
          <div className="operation-list">
            {expenses?.map((expense) => (
              <div className="operation-item" key={expense.id}>
                <span className="operation-icon expense-icon">G</span>
                <div>
                  <strong>{expense.description}</strong>
                  <small>{new Date(expense.occurredAt).toLocaleString("es-PE")}</small>
                </div>
                <strong className="negative-amount">
                  − S/ {expense.amount.toFixed(2)}
                </strong>
              </div>
            ))}
            {purchases?.map((purchase) => (
              <div className="operation-item" key={purchase.id}>
                <span className="operation-icon purchase-icon">C</span>
                <div>
                  <strong>{purchase.supplierName || "Compra registrada"}</strong>
                  <small>{new Date(purchase.purchasedAt).toLocaleString("es-PE")}</small>
                </div>
                <strong className="negative-amount">
                  − S/ {purchase.total.toFixed(2)}
                </strong>
              </div>
            ))}
            {!expenses?.length && !purchases?.length ? (
              <p className="muted-text">Sin egresos.</p>
            ) : null}
          </div>
        </article>

        <article className="panel glass">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CAJA</p>
              <h3>Ingresos y salidas</h3>
            </div>
          </div>
          <div className="operation-list">
            {cashMovements?.length ? (
              cashMovements.map((movement) => (
                <div className="operation-item" key={movement.id}>
                  <span
                    className={`operation-icon ${
                      movement.type === "expense" ? "expense-icon" : ""
                    }`}
                  >
                    {movement.type === "income" ? "+" : "−"}
                  </span>
                  <div>
                    <strong>{referenceLabels[movement.referenceType]}</strong>
                    <small>
                      {paymentLabels[movement.paymentMethod]} · Ref.{" "}
                      {movement.referenceId.slice(0, 8)}
                    </small>
                  </div>
                  <strong
                    className={
                      movement.type === "expense" ? "negative-amount" : ""
                    }
                  >
                    {movement.type === "expense" ? "− " : ""}
                    S/ {movement.amount.toFixed(2)}
                  </strong>
                </div>
              ))
            ) : (
              <p className="muted-text">Sin movimientos de Caja.</p>
            )}
          </div>
        </article>

        <article className="panel glass">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">INVENTARIO</p>
              <h3>Entradas y salidas de stock</h3>
            </div>
          </div>
          <div className="operation-list">
            {inventoryMovements?.length ? (
              inventoryMovements.map((movement) => (
                <div className="operation-item" key={movement.id}>
                  <span
                    className={`operation-icon ${
                      movement.quantity < 0 ? "expense-icon" : "purchase-icon"
                    }`}
                  >
                    {movement.quantity > 0 ? "+" : "−"}
                  </span>
                  <div>
                    <strong>{inventoryLabels[movement.type]}</strong>
                    <small>
                      {productNames.get(movement.productId) ??
                        movement.productId.slice(0, 8)}
                    </small>
                  </div>
                  <strong>{movement.quantity}</strong>
                </div>
              ))
            ) : (
              <p className="muted-text">
                No hay movimientos. Los productos sin control de stock no
                generan entradas ni salidas.
              </p>
            )}
          </div>
        </article>
      </section>
    </>
  );
}
