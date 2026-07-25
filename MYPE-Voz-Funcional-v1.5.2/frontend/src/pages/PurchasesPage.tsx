import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../database/db";
import {
  calculatePurchaseTotal,
  confirmPurchase,
  PurchaseValidationError,
} from "../services/purchase.service";
import type {
  PaymentMethod,
  Product,
  PurchaseCartItem,
  PurchaseDraft,
  PurchasePurpose,
} from "../types/domain";

const purposeLabels: Record<PurchasePurpose, string> = {
  merchandise: "Mercadería para vender",
  internal_supply: "Insumo interno",
  business_expense: "Gasto del negocio",
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

function productToPurchaseItem(product: Product): PurchaseCartItem {
  return {
    productId: product.id,
    productName: product.name,
    quantity: 1,
    unitCost: product.purchaseCost ?? 0,
    tracksStock: product.tracksStock,
    currentStock: product.currentStock,
  };
}

export function PurchasesPage() {
  const products = useLiveQuery(
    () =>
      db.products
        .filter((product) => product.active && product.type === "product")
        .sortBy("name"),
    [],
    [],
  );
  const recentPurchases = useLiveQuery(
    () => db.purchases.orderBy("purchasedAt").reverse().limit(15).toArray(),
    [],
    [],
  );

  const [selectedProductId, setSelectedProductId] = useState("");
  const [items, setItems] = useState<PurchaseCartItem[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [purpose, setPurpose] = useState<PurchasePurpose>("merchandise");
  const [additionalCosts, setAdditionalCosts] = useState(0);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("cash");
  const [purchasedAt, setPurchasedAt] = useState(localDateTimeValue());
  const [preview, setPreview] = useState<PurchaseDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const draft = useMemo<PurchaseDraft>(
    () => ({
      supplierName: supplierName.trim() || null,
      purpose,
      items,
      additionalCosts,
      paymentMethod,
      purchasedAt,
    }),
    [supplierName, purpose, items, additionalCosts, paymentMethod, purchasedAt],
  );

  const total = calculatePurchaseTotal(draft);

  function addSelectedProduct() {
    setError("");
    const product = (products ?? []).find(
      (candidate) => candidate.id === selectedProductId,
    );
    if (!product) {
      setError("Selecciona un producto.");
      return;
    }

    setItems((current) => {
      if (current.some((item) => item.productId === product.id)) return current;
      return [...current, productToPurchaseItem(product)];
    });
    setSelectedProductId("");
  }

  function updateItem(
    productId: string,
    changes: Partial<Pick<PurchaseCartItem, "quantity" | "unitCost">>,
  ) {
    setItems((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, ...changes } : item,
      ),
    );
  }

  function removeItem(productId: string) {
    setItems((current) =>
      current.filter((item) => item.productId !== productId),
    );
  }

  function preparePurchase() {
    setError("");
    setNotice("");

    if (!items.length) {
      setError("Agrega por lo menos un producto.");
      return;
    }
    if (items.some((item) => item.quantity <= 0 || item.unitCost <= 0)) {
      setError("Cada producto debe tener cantidad y costo mayores que cero.");
      return;
    }

    setPreview(draft);
  }

  async function executePurchase() {
    if (!preview) return;
    setBusy(true);
    setError("");

    try {
      const result = await confirmPurchase(preview);
      setPreview(null);
      setItems([]);
      setSupplierName("");
      setAdditionalCosts(0);
      setPurchasedAt(localDateTimeValue());
      setNotice(
        `Compra confirmada por S/ ${result.total.toFixed(2)}. Se actualizaron ${result.productsUpdated} productos y ${result.inventoryMovements} movimientos de inventario.`,
      );
    } catch (caught) {
      setError(
        caught instanceof PurchaseValidationError || caught instanceof Error
          ? caught.message
          : "No se pudo confirmar la compra.",
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
          <p className="eyebrow">ENTRADAS Y ABASTECIMIENTO</p>
          <h1>Compras</h1>
        </div>
      </header>

      <section className="page active purchase-page">
        <article className="panel glass purchase-builder">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">NUEVA COMPRA</p>
              <h3>¿Qué compró el negocio?</h3>
            </div>
          </div>

          <div className="form-grid">
            <label>
              Uso de la compra
              <select
                className="input"
                value={purpose}
                onChange={(event) =>
                  setPurpose(event.target.value as PurchasePurpose)
                }
              >
                {Object.entries(purposeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Proveedor
              <input
                className="input"
                value={supplierName}
                onChange={(event) => setSupplierName(event.target.value)}
                placeholder="Opcional"
              />
            </label>

            <label>
              Método de pago
              <select
                className="input"
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(event.target.value as PaymentMethod)
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
                value={purchasedAt}
                onChange={(event) => setPurchasedAt(event.target.value)}
              />
            </label>
          </div>

          <div className={`purpose-note ${purpose}`}>
            <strong>{purposeLabels[purpose]}</strong>
            <p>
              {purpose === "merchandise"
                ? "Actualizará el costo del producto y aumentará el stock únicamente cuando su control esté activado. Los gastos adicionales se repartirán proporcionalmente entre los productos."
                : "Se registrará como salida de dinero, pero no modificará el costo ni el inventario del catálogo."}
            </p>
          </div>

          <div className="add-purchase-item">
            <select
              className="input"
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
            >
              <option value="">Selecciona un producto…</option>
              {(products ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            <button className="secondary-button" onClick={addSelectedProduct}>
              + Agregar
            </button>
          </div>

          {items.length ? (
            <div className="purchase-item-list">
              {items.map((item) => (
                <div className="purchase-item-row" key={item.productId}>
                  <div>
                    <strong>{item.productName}</strong>
                    <small>
                      {item.tracksStock
                        ? `Stock actual: ${item.currentStock ?? 0}`
                        : "Stock no registrado"}
                    </small>
                  </div>

                  <label>
                    Cantidad
                    <input
                      className="input"
                      type="number"
                      min="1"
                      step="1"
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem(item.productId, {
                          quantity: Number(event.target.value),
                        })
                      }
                    />
                  </label>

                  <label>
                    Costo unitario
                    <input
                      className="input"
                      type="number"
                      min="0.01"
                      step="0.10"
                      value={item.unitCost || ""}
                      onChange={(event) =>
                        updateItem(item.productId, {
                          unitCost: Number(event.target.value),
                        })
                      }
                    />
                  </label>

                  <div className="purchase-line-total">
                    <span>Subtotal</span>
                    <strong>
                      S/ {(item.quantity * item.unitCost).toFixed(2)}
                    </strong>
                  </div>

                  <button
                    className="mini-button danger-button"
                    onClick={() => removeItem(item.productId)}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>Aún no agregaste productos</strong>
              <p>Selecciona productos existentes del catálogo.</p>
            </div>
          )}

          <div className="purchase-footer">
            <label>
              Gastos adicionales
              <input
                className="input"
                type="number"
                min="0"
                step="0.10"
                value={additionalCosts || ""}
                onChange={(event) =>
                  setAdditionalCosts(Number(event.target.value))
                }
                placeholder="Transporte u otros"
              />
            </label>

            <div className="purchase-total">
              <span>Total de compra</span>
              <strong>S/ {total.toFixed(2)}</strong>
            </div>

            <button className="primary-button" onClick={preparePurchase}>
              Revisar compra
            </button>
          </div>

          {error ? <p className="form-message error">{error}</p> : null}
          {notice ? <p className="form-message success">{notice}</p> : null}
        </article>

        <article className="panel glass">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">HISTORIAL</p>
              <h3>Compras recientes</h3>
            </div>
          </div>

          {recentPurchases?.length ? (
            <div className="operation-list">
              {recentPurchases.map((purchase) => (
                <div className="operation-item" key={purchase.id}>
                  <span className="operation-icon purchase-icon">↓</span>
                  <div>
                    <strong>
                      {purchase.supplierName || purposeLabels[purchase.purpose]}
                    </strong>
                    <small>
                      {purposeLabels[purchase.purpose]} ·{" "}
                      {paymentLabels[purchase.paymentMethod]} ·{" "}
                      {new Date(purchase.purchasedAt).toLocaleString("es-PE")}
                    </small>
                  </div>
                  <strong className="negative-amount">
                    − S/ {purchase.total.toFixed(2)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No hay compras registradas</strong>
              <p>Las compras confirmadas aparecerán aquí.</p>
            </div>
          )}
        </article>
      </section>

      {preview ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal glass purchase-modal" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">REVISIÓN OBLIGATORIA</p>
                <h2>Compra por confirmar</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setPreview(null)}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="preview-items">
              {preview.items.map((item) => (
                <div className="preview-row" key={item.productId}>
                  <span>
                    {item.quantity} × {item.productName}
                  </span>
                  <strong>
                    S/ {(item.quantity * item.unitCost).toFixed(2)}
                  </strong>
                </div>
              ))}
            </div>

            <div className="preview-row">
              <span>Uso</span>
              <strong>{purposeLabels[preview.purpose]}</strong>
            </div>
            <div className="preview-row">
              <span>Proveedor</span>
              <strong>{preview.supplierName || "No especificado"}</strong>
            </div>
            <div className="preview-row">
              <span>Gastos adicionales</span>
              <strong>S/ {preview.additionalCosts.toFixed(2)}</strong>
            </div>
            <div className="preview-row">
              <span>Método de pago</span>
              <strong>{paymentLabels[preview.paymentMethod]}</strong>
            </div>
            <div className="preview-row total-row">
              <span>Total</span>
              <strong>S/ {calculatePurchaseTotal(preview).toFixed(2)}</strong>
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
                onClick={executePurchase}
                disabled={busy}
              >
                {busy ? "Guardando…" : "Confirmar compra"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
