import { useLiveQuery } from "dexie-react-hooks";
import { getBusinessRecommendations } from "../services/insights.service";

interface RecommendationsPageProps {
  onHome: () => void;
  onAssistant: () => void;
}

const priorityLabels = {
  high: "Atención alta",
  medium: "Revisar",
  low: "Sugerencia",
} as const;

export function RecommendationsPage({
  onHome,
  onAssistant,
}: RecommendationsPageProps) {
  const recommendations = useLiveQuery(
    () => getBusinessRecommendations(),
    [],
    undefined,
  );

  return (
    <>
      <header className="topbar glass">
        <div>
          <p className="eyebrow">CONSEJOS SEGÚN TUS DATOS</p>
          <h1>Recomendaciones</h1>
        </div>
        <button className="secondary-button" onClick={onHome}>
          Volver al inicio
        </button>
      </header>

      <section className="page active intelligence-page">
        <article className="recommendations-intro glass">
          <div>
            <span className="pill">Sin datos inventados</span>
            <h2>Qué conviene revisar ahora</h2>
            <p>
              Cada recomendación se calcula usando ventas, gastos, compras,
              costos e inventario realmente registrados.
            </p>
          </div>
          <button className="primary-button" onClick={onAssistant}>
            Conversar con la IA
          </button>
        </article>

        {!recommendations ? (
          <div className="panel glass loading-panel">
            Analizando el negocio…
          </div>
        ) : recommendations.length ? (
          <div className="recommendations-grid">
            {recommendations.map((recommendation) => (
              <article
                className={`recommendation-card glass ${recommendation.priority}`}
                key={recommendation.id}
              >
                <span className="recommendation-priority">
                  {priorityLabels[recommendation.priority]}
                </span>
                <h3>{recommendation.title}</h3>
                <p>{recommendation.explanation}</p>
                {recommendation.actionPrompt ? (
                  <button
                    className="text-button"
                    onClick={onAssistant}
                    title={recommendation.actionPrompt}
                  >
                    Preguntar a la IA →
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="panel glass empty-state compact">
            <strong>No hay recomendaciones pendientes</strong>
            <p>Continúa registrando operaciones para mantener el análisis.</p>
          </div>
        )}
      </section>
    </>
  );
}
