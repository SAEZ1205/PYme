import { NavLink } from "react-router-dom";
import {
  Grid2X2,
  HandCoins,
  Home,
  Package,
  Sparkles,
} from "lucide-react";

const items = [
  { to: "/", label: "Inicio", icon: Home, end: true },
  { to: "/inventario", label: "Inventario", icon: Package },
  { to: "/asistente", label: "IA", icon: Sparkles, featured: true },
  { to: "/deudas", label: "Fiados", icon: HandCoins },
  { to: "/mas", label: "Más", icon: Grid2X2 },
];

export function BottomNavigation() {
  return (
    <nav
      className="bottom-navigation-bigsur"
      aria-label="Navegación principal"
    >
      <div className="bottom-navigation-grid">
        {items.map(
          ({ to, label, icon: Icon, end, featured }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  "bottom-navigation-item",
                  featured ? "bottom-navigation-ai" : "",
                  isActive ? "active" : "",
                ].join(" ")
              }
            >
              <span className="bottom-navigation-icon">
                <Icon size={featured ? 25 : 21} strokeWidth={2.2} />
              </span>
              <span>{label}</span>
            </NavLink>
          ),
        )}
      </div>
    </nav>
  );
}
