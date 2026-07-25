import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ConfirmSaleModal } from "../components/ConfirmSaleModal";
import { db } from "../database/db";
import {
  calculateSaleTotal,
  confirmSale,
  SaleValidationError,
} from "../services/sale.service";
import type { CartItem, PaymentMethod, Product, SaleDraft } from "../types/domain";

function toCartItem(product: Product): CartItem {
  return {
    productId: product.id,
    productName: product.name,
    productType: product.type,
    quantity: 1,
    unitPrice: product.salePrice,
    unitCost: product.purchaseCost,
    tracksStock: product.tracksStock,
    availableStock: product.currentStock,
  };
}

export function CashierPage() {
  const products = useLiveQuery(
    () => db.products.filter((product) => product.active).sortBy("name"),
    [],
    [],
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<SaleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const filteredProducts = useMemo(
    () =>
      (products ?? []).filter((product) =>
        product.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [products, query],
  );

  const draft: SaleDraft = { items: cart, paymentMethod };
  const total = calculateSaleTotal(draft);

  function addProduct(product: Product) {
    setError("");
    setMessage("");

    if (product.type === "product" && product.tracksStock && (product.currentStock ?? 0) <= 0) {
      setError(`${product.name} está agotado.`);
      return;
    }

    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (!existing) return [...current, toCartItem(product)];

      if (
        product.type === "product" &&
        product.tracksStock &&
        existing.quantity >= (product.currentStock ?? 0)
      ) {
        setError(`Solo quedan ${product.currentStock ?? 0} unidades de ${product.name}.`);
        return current;
      }

      return current.map((item) =>
        item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item,
      );
    });
  }

  function changeQuantity(productId: string, quantity: number) {
    setCart((current) =>
      current
        .map((item) => {
          if (item.productId !== productId) return item;
          const safeQuantity = Math.max(0, Math.floor(quantity));
          if (
            item.tracksStock &&
            item.availableStock !== null &&
            safeQuantity > item.availableStock
          ) {
            setError(`Solo hay ${item.availableStock} unidades disponibles.`);
            return item;
          }
          return { ...item, quantity: safeQuantity };
        })
        .filter((item) => item.quantity > 0),
    );
  }

  function changePrice(productId: string, unitPrice: number) {
    setCart((current) =>
      current.map((item) =>
        item.productId === productId
          ? { ...item, unitPrice: Math.max(0, unitPrice) }
          : item,
      ),
    );
  }

  function prepareSale() {
    setError("");
    setMessage("");
    if (!cart.length) {
      setError("Selecciona al menos un producto o servicio.");
      return;
    }
    if (cart.some((item) => item.unitPrice <= 0)) {
      setError("Todos los precios deben ser mayores que cero.");
      return;
    }
    setPreview(draft);
  }

  async function executeSale() {
    if (!preview) return;
    setBusy(true);
    setError("");

    try {
      const result = await confirmSale(preview);
      setCart([]);
      setPreview(null);
      setMessage(
        `Venta confirmada por S/ ${result.total.toFixed(2)}. Se crearon ${result.inventoryMovements} movimientos de inventario.`,
      );
    } catch (caught) {
      setError(
        caught instanceof SaleValidationError || caught instanceof Error
          ? caught.message
          : "No se pudo confirmar la venta.",
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
          <p className="eyebrow">OPERACIÓN TRANSACCIONAL</p>
          <h1>Caja</h1>
        </div>
      </header>

      <section className="page active cashier-layout">
        <article className="panel glass">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar producto o servicio…"
          />

          {filteredProducts.length ? (
            <div className="product-picker">
              {filteredProducts.map((product) => {
                const unavailable =
                  product.type === "product" &&
                  product.tracksStock &&
                  (product.currentStock ?? 0) <= 0;
                return (
                  <button
                    className="product-tile"
                    key={product.id}
                    disabled={unavailable}
                    onClick={() => addProduct(product)}
                  >
                    <strong>{product.name}</strong>
                    <span>S/ {product.salePrice.toFixed(2)}</span>
                    <small>
                      {product.type === "service"
                        ? "Servicio"
                        : product.tracksStock
                          ? `${product.currentStock} disponibles`
                          : "Stock no registrado"}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No hay productos disponibles</strong>
              <p>Créelos primero en Productos.</p>
            </div>
          )}
        </article>

        <aside className="checkout-card glass">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">VENTA ACTUAL</p>
              <h3>Detalle</h3>
            </div>
            <button className="text-button danger-text" onClick={() => setCart([])}>
              Limpiar
            </button>
          </div>

          {cart.length ? (
            <div className="cart-list">
              {cart.map((item) => (
                <div className="cart-item" key={item.productId}>
                  <div className="cart-name">
                    <strong>{item.productName}</strong>
                    <small>
                      {item.tracksStock
                        ? `${item.availableStock} disponibles`
                        : "Stock no registrado"}
                    </small>
                  </div>

                  <label>
                    Cantidad
                    <input
                      className="input small-input"
                      type="number"
                      min="1"
                      step="1"
                      value={item.quantity}
                      onChange={(event) =>
                        changeQuantity(item.productId, Number(event.target.value))
                      }
                    />
                  </label>

                  <label>
                    Precio de esta venta
                    <input
                      className="input price-input"
                      type="number"
                      min="0.01"
                      step="0.10"
                      value={item.unitPrice}
                      onChange={(event) =>
                        changePrice(item.productId, Number(event.target.value))
                      }
                    />
                  </label>

                  <strong className="subtotal">
                    S/ {(item.quantity * item.unitPrice).toFixed(2)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>Venta vacía</strong>
              <p>Selecciona un artículo para comenzar.</p>
            </div>
          )}

          <label className="payment-field">
            Método de pago
            <select
              className="input"
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
            >
              <option value="cash">Efectivo</option>
              <option value="yape">Yape</option>
              <option value="plin">Plin</option>
            </select>
          </label>

          {error ? <p className="form-message error">{error}</p> : null}
          {message ? <p className="form-message success">{message}</p> : null}

          <div className="checkout-total">
            <span>Total</span>
            <strong>S/ {total.toFixed(2)}</strong>
          </div>

          <button className="primary-button full-width" onClick={prepareSale}>
            Revisar venta
          </button>
        </aside>
      </section>

      {preview ? (
        <ConfirmSaleModal
          draft={preview}
          busy={busy}
          onCancel={() => setPreview(null)}
          onConfirm={executeSale}
        />
      ) : null}
    </>
  );
}
