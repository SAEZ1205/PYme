import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { UiProvider } from "./mobile/context/UiContext";
import { MobileLayout } from "./mobile/components/MobileLayout";
import { LegacyPage } from "./mobile/components/LegacyPage";
import { HomePage } from "./mobile/pages/HomePage";
import { InventoryPage } from "./mobile/pages/InventoryPage";
import { DebtsPage as MobileDebtsPage } from "./mobile/pages/DebtsPage";
import { MorePage } from "./mobile/pages/MorePage";
import { AssistantPage } from "./pages/AssistantPage";
import { CashierPage } from "./pages/CashierPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { MovementsPage } from "./pages/MovementsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ProjectionsPage } from "./pages/ProjectionsPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";

function ReportsRoute() {
  const navigate = useNavigate();
  return (
    <LegacyPage>
      <ReportsPage
        onHome={() => navigate("/")}
        onAssistant={() => navigate("/asistente")}
      />
    </LegacyPage>
  );
}

function ProjectionsRoute() {
  const navigate = useNavigate();
  return (
    <LegacyPage>
      <ProjectionsPage
        onHome={() => navigate("/")}
        onAssistant={() => navigate("/asistente")}
      />
    </LegacyPage>
  );
}

function RecommendationsRoute() {
  const navigate = useNavigate();
  return (
    <LegacyPage>
      <RecommendationsPage
        onHome={() => navigate("/")}
        onAssistant={() => navigate("/asistente")}
      />
    </LegacyPage>
  );
}

export default function App() {
  return (
    <UiProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<MobileLayout />}>
            <Route index element={<HomePage />} />
            <Route
              path="registrar"
              element={<Navigate to="/asistente" replace />}
            />
            <Route path="inventario" element={<InventoryPage />} />
            <Route path="deudas" element={<MobileDebtsPage />} />
            <Route
              path="asistente"
              element={
                <LegacyPage className="mobile-assistant-page">
                  <AssistantPage />
                </LegacyPage>
              }
            />
            <Route path="mas" element={<MorePage />} />
            <Route
              path="caja"
              element={
                <LegacyPage>
                  <CashierPage />
                </LegacyPage>
              }
            />
            <Route
              path="compras"
              element={
                <LegacyPage>
                  <PurchasesPage />
                </LegacyPage>
              }
            />
            <Route
              path="gastos"
              element={
                <LegacyPage>
                  <ExpensesPage />
                </LegacyPage>
              }
            />
            <Route
              path="movimientos"
              element={
                <LegacyPage>
                  <MovementsPage />
                </LegacyPage>
              }
            />
            <Route path="reportes" element={<ReportsRoute />} />
            <Route path="proyecciones" element={<ProjectionsRoute />} />
            <Route
              path="recomendaciones"
              element={<RecommendationsRoute />}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </UiProvider>
  );
}
