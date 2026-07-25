import { calculateSaleTotal } from "../services/sale.service";
import type { SaleDraft } from "../types/domain";

interface ConfirmSaleModalProps {
  draft: SaleDraft;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const paymentLabels = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  credit: "Fiado",
} as const;

export function ConfirmSaleModal({
  draft,
  busy,
  onCancel,
  onConfirm,
}: ConfirmSaleModalProps) {
  const total = calculateSaleTotal(draft);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal glass" role="dialog" aria-modal="true">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">REVISIÓN OBLIGATORIA</p>
            <h2>Venta por confirmar</h2>
          </div>
          <button className="icon-button" onClick={onCancel} disabled={busy}>
            ×
          </button>
        </div>

        <div className="preview-items">
          {draft.items.map((item) => (
            <div className="preview-row" key={item.productId}>
              <span>
                {item.quantity} × {item.productName}
              </span>
              <strong>S/ {(item.quantity * item.unitPrice).toFixed(2)}</strong>
            </div>
          ))}
        </div>

        <div className="preview-row">
          <span>Método de pago</span>
          <strong>{paymentLabels[draft.paymentMethod]}</strong>
        </div>
        <div className="preview-row total-row">
          <span>Total</span>
          <strong>S/ {total.toFixed(2)}</strong>
        </div>
        <div className="preview-row">
          <span>Estado</span>
          <strong>Aún no guardado</strong>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>
            Corregir
          </button>
          <button className="primary-button" onClick={onConfirm} disabled={busy}>
            {busy ? "Guardando…" : "Confirmar venta"}
          </button>
        </div>
      </section>
    </div>
  );
}
