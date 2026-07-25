import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  HandCoins,
  Package,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { db } from "../../database/db";
import { getReportSnapshot } from "../../services/insights.service";
import { getRecentBusinessOperations } from "../../services/operation.service";
import { getCustomerDebtSummaries } from "../../services/debt.service";
import { useUi } from "../context/UiContext";
import { PageContainer } from "../components/PageContainer";
import { Button } from "../components/Button";

const money = (value: number) => `S/ ${value.toFixed(2)}`;
const dateLabel = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  day: "numeric",
  month: "long",
}).format(new Date());

export function HomePage() {
  const navigate = useNavigate();
  const { activePerson } = useUi();

  const report = useLiveQuery(
    () => getReportSnapshot("today"),
    [],
    undefined,
  );
  const products = useLiveQuery(
    () => db.products.filter((product) => product.active).toArray(),
    [],
    [],
  );
  const debts = useLiveQuery(
    () => getCustomerDebtSummaries(),
    [],
    [],
  );
  const recent = useLiveQuery(
    () => getRecentBusinessOperations(4),
    [],
    [],
  );

  const lowStock = (products ?? []).filter(
    (product) =>
      product.type === "product" &&
      product.tracksStock &&
      (product.currentStock ?? 0) <=
        (product.minimumStock ?? 0),
  ).length;

  const debtTotal = (debts ?? []).reduce(
    (sum, debt) => sum + debt.pendingBalance,
    0,
  );

  const metrics = [
    {
      label: "Ventas de hoy",
      value: money(report?.salesTotal ?? 0),
      icon: TrendingUp,
      tone: "green",
    },
    {
      label: "Gastos",
      value: money(report?.expenseTotal ?? 0),
      icon: Wallet,
      tone: "red",
    },
    {
      label: "Dinero recibido",
      value: money(report?.moneyIn ?? 0),
      icon: Banknote,
      tone: "mint",
    },
    {
      label: "Fiados pendientes",
      value: money(debtTotal),
      icon: HandCoins,
      tone: "amber",
    },
    {
      label: "Efectivo esperado",
      value: money(report?.paymentTotals.cash ?? 0),
      icon: ShoppingBag,
      tone: "green",
    },
    {
      label: "Stock bajo",
      value: String(lowStock),
      icon: AlertTriangle,
      tone: lowStock ? "amber" : "mint",
    },
  ];

  return (
    <PageContainer className="home-page-bigsur">
      <div className="home-welcome">
        <p className="home-date">{dateLabel}</p>
        <h1>Hola, {activePerson}</h1>
        <p>Todo el negocio queda guardado en este equipo.</p>
      </div>

      <section className="home-ai-hero">
        <div className="home-ai-glow" />
        <div className="home-ai-orb">
          <Sparkles size={32} />
        </div>
        <div className="home-ai-copy">
          <span>ASISTENTE PRINCIPAL</span>
          <h2>Cuéntale a la IA lo que pasó en tu negocio.</h2>
          <p>
            Registra ventas, compras, gastos o fiados y recibe
            recomendaciones desde una sola conversación.
          </p>
        </div>
        <button
          onClick={() => navigate("/asistente")}
          className="home-ai-primary-button"
        >
          <Sparkles size={21} />
          Hablar con la IA
        </button>
      </section>

      <section className="home-result-card">
        <div>
          <span>Resultado aproximado de hoy</span>
          <strong>{money(report?.approximateResult ?? 0)}</strong>
        </div>
        <div className="home-result-indicator">
          <TrendingUp size={22} />
        </div>
      </section>

      <div className="home-metrics-grid">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <article className="home-metric-card" key={label}>
            <span className={`home-metric-icon ${tone}`}>
              <Icon size={18} />
            </span>
            <p>{label}</p>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="home-quick-grid">
        <button onClick={() => navigate("/caja")}>
          <ShoppingBag size={20} />
          <span>Caja</span>
        </button>
        <button onClick={() => navigate("/inventario")}>
          <Package size={20} />
          <span>Catálogo</span>
        </button>
        <button onClick={() => navigate("/deudas")}>
          <HandCoins size={20} />
          <span>Fiados</span>
        </button>
        <button onClick={() => navigate("/reportes")}>
          <ReceiptText size={20} />
          <span>Reportes</span>
        </button>
      </div>

      <section className="home-activity-card">
        <div className="home-section-heading">
          <div>
            <span>ACTIVIDAD</span>
            <h2>Últimas operaciones</h2>
          </div>
          <button onClick={() => navigate("/movimientos")}>
            Ver todas
          </button>
        </div>

        {recent?.length ? (
          <div className="home-operation-list">
            {recent.map((operation) => (
              <div
                key={`${operation.type}-${operation.id}`}
                className="home-operation-row"
              >
                <div>
                  <strong>{operation.title}</strong>
                  <small>{operation.summary}</small>
                </div>
                <b>{money(operation.amount)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="home-empty-copy">
            Todavía no hay operaciones registradas.
          </p>
        )}
      </section>

      <Button
        fullWidth
        size="lg"
        variant="outline"
        onClick={() => navigate("/mas")}
      >
        Ver todas las herramientas
      </Button>
    </PageContainer>
  );
}
