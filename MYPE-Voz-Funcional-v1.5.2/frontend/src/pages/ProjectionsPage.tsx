import { useLiveQuery } from "dexie-react-hooks";
import { getProjectionSnapshot } from "../services/insights.service";
import { MiniLineChart } from "../components/MiniLineChart";

interface ProjectionsPageProps {
  onHome: () => void;
  onAssistant: () => void;
}

function money(value: number): string {
  return `S/ ${value.toFixed(2)}`;
}

export function ProjectionsPage({
  onHome,
  onAssistant,
}: ProjectionsPageProps) {
  const projection = useLiveQuery(
    () => getProjectionSnapshot(),
    [],
    undefined,
  );

  return (
    <>
      <header className="topbar glass">
        <div>
          <p className="eyebrow">ESTIMACIONES CON DATOS REALES</p>
          <h1>Proyecciones</h1>
        </div>
        <button className="secondary-button" onClick={onHome}>
          Volver al inicio
        </button>
      </header>

      <section className="page active intelligence-page">
        {!projection ? (
          <div className="panel glass loading-panel">
            Calculando proyección…
          </div>
        ) : (
          <>
            <article
              className={`projection-hero glass ${projection.confidence}`}
            >
              <div>
                <span className="pill">
                  Confianza:{" "}
                  {projection.confidence === "insufficient"
                    ? "Datos insuficientes"
                    : projection.confidence === "low"
                      ? "Baja"
                      : projection.confidence === "medium"
                        ? "Media"
                        : "Alta"}
                </span>
                <h2>
                  {projection.sufficientData
                    ? money(projection.currentMonthProjection)
                    : "Necesitamos más información"}
                </h2>
                <p>
                  {projection.sufficientData
                    ? "Proyección aproximada de ventas para el mes actual."
                    : projection.message}
                </p>
              </div>
              <button className="primary-button" onClick={onAssistant}>
                Preguntar a la IA
              </button>
            </article>

            <div className="projection-metrics">
              <article className="metric-card glass">
                <span className="metric-icon">Ø</span>
                <div>
                  <p>Promedio diario</p>
                  <strong>
                    {projection.sufficientData
                      ? money(projection.dailyAverage)
                      : "Sin calcular"}
                  </strong>
                  <small>{projection.observedDays} días observados</small>
                </div>
              </article>
              <article className="metric-card glass">
                <span className="metric-icon">7</span>
                <div>
                  <p>Próximos 7 días</p>
                  <strong>
                    {projection.sufficientData
                      ? money(projection.nextSevenDays)
                      : "Sin calcular"}
                  </strong>
                  <small>Estimación, no garantía</small>
                </div>
              </article>
              <article className="metric-card glass">
                <span className="metric-icon">M</span>
                <div>
                  <p>Ventas del mes</p>
                  <strong>{money(projection.currentMonthSales)}</strong>
                  <small>
                    {projection.remainingDaysInMonth} días restantes
                  </small>
                </div>
              </article>
            </div>

            <article className="panel glass intelligence-chart-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">BASE DE LA ESTIMACIÓN</p>
                  <h3>Ventas de los últimos 7 días</h3>
                </div>
              </div>
              <MiniLineChart
                series={projection.series}
                emptyText="Registra ventas durante varios días para observar una tendencia."
              />
              <div className="projection-explanation">
                <strong>Cómo se calcula</strong>
                <p>
                  Usa las ventas confirmadas y los días calendario desde la
                  primera operación. Los días sin ventas también cuentan como
                  cero para evitar una proyección exagerada.
                </p>
              </div>
            </article>
          </>
        )}
      </section>
    </>
  );
}
