import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MiniLineChart } from "../components/MiniLineChart";
import { getReportSnapshot } from "../services/insights.service";
import type { InsightPeriod } from "../types/domain";

interface ReportsPageProps {
  onHome: () => void;
  onAssistant: () => void;
}

function money(value: number): string {
  return `S/ ${value.toFixed(2)}`;
}

const periodLabels: Record<InsightPeriod, string> = {
  today: "Hoy",
  "7days": "Últimos 7 días",
  "30days": "Últimos 30 días",
  all: "Todo el historial",
};

export function ReportsPage({
  onHome,
  onAssistant,
}: ReportsPageProps) {
  const [period, setPeriod] = useState<InsightPeriod>("7days");
  const report = useLiveQuery(
    () => getReportSnapshot(period),
    [period],
    undefined,
  );

  return (
    <>
      <header className="topbar glass">
        <div>
          <p className="eyebrow">RESULTADOS DEL NEGOCIO</p>
          <h1>Reportes</h1>
        </div>
        <div className="topbar-actions">
          <select
            className="input report-period-select"
            value={period}
            onChange={(event) =>
              setPeriod(event.target.value as InsightPeriod)
            }
          >
            {Object.entries(periodLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="secondary-button" onClick={onHome}>
            Volver
          </button>
        </div>
      </header>

      <section className="page active intelligence-page">
        {!report ? (
          <div className="panel glass loading-panel">
            Calculando reporte…
          </div>
        ) : (
          <>
            <div className="report-summary-grid">
              <article className="metric-card glass">
                <span className="metric-icon">↗</span>
                <div>
                  <p>Ventas</p>
                  <strong>{money(report.salesTotal)}</strong>
                  <small>{report.salesCount} operaciones</small>
                </div>
              </article>
              <article className="metric-card glass">
                <span className="metric-icon green">+</span>
                <div>
                  <p>Dinero recibido</p>
                  <strong>{money(report.moneyIn)}</strong>
                  <small>Todos los medios de pago</small>
                </div>
              </article>
              <article className="metric-card glass">
                <span className="metric-icon expense-icon">−</span>
                <div>
                  <p>Dinero que salió</p>
                  <strong>{money(report.moneyOut)}</strong>
                  <small>Compras y gastos</small>
                </div>
              </article>
              <article className="metric-card glass">
                <span className="metric-icon result-icon">≈</span>
                <div>
                  <p>Resultado aproximado</p>
                  <strong>{money(report.approximateResult)}</strong>
                  <small>
                    {report.missingCostItems
                      ? `${report.missingCostItems} artículos sin costo`
                      : "Con costos registrados"}
                  </small>
                </div>
              </article>
              <article className="metric-card glass">
                <span className="metric-icon debt-icon">F</span>
                <div>
                  <p>Fiados pendientes</p>
                  <strong>{money(report.pendingDebtTotal)}</strong>
                  <small>Saldo actual por cobrar</small>
                </div>
              </article>
            </div>

            <article className="panel glass intelligence-chart-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">EVOLUCIÓN</p>
                  <h3>{periodLabels[period]}</h3>
                </div>
                <button className="text-button" onClick={onAssistant}>
                  Analizar con la IA
                </button>
              </div>
              <MiniLineChart series={report.dailySeries} />
            </article>

            <div className="report-lower-grid">
              <article className="panel glass">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">MEDIOS DE PAGO</p>
                    <h3>Saldo del periodo</h3>
                  </div>
                </div>
                <div className="payment-balance-list">
                  {(
                    [
                      ["Efectivo", report.paymentTotals.cash],
                      ["Yape", report.paymentTotals.yape],
                      ["Plin", report.paymentTotals.plin],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{money(value)}</strong>
                      <div className="payment-balance-bar">
                        <span
                          style={{
                            width: `${
                              Math.max(
                                0,
                                Math.min(
                                  100,
                                  Math.abs(value) /
                                    Math.max(
                                      1,
                                      ...Object.values(
                                        report.paymentTotals,
                                      ).map(Math.abs),
                                    ) *
                                    100,
                                ),
                              )
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel glass">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">MÁS VENDIDOS</p>
                    <h3>Productos y servicios</h3>
                  </div>
                </div>
                {report.topProducts.length ? (
                  <div className="ranking-list">
                    {report.topProducts.map((product, index) => (
                      <div
                        className="ranking-row"
                        key={product.productName}
                      >
                        <span>{index + 1}</span>
                        <div>
                          <strong>{product.productName}</strong>
                          <small>
                            {product.quantity} vendidos ·{" "}
                            {money(product.revenue)}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">
                    <strong>Sin ventas en este periodo</strong>
                  </div>
                )}
              </article>
            </div>
          </>
        )}
      </section>
    </>
  );
}
