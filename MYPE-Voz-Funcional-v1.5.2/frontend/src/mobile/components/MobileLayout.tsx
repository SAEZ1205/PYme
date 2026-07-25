import { Outlet } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { BottomNavigation } from "./BottomNavigation";

export function MobileLayout() {
  return (
    <div className="mobile-app-background">
      <div className="mobile-app-frame">
        <AppHeader />
        <main className="mobile-app-main">
          <Outlet />
        </main>
        <BottomNavigation />
      </div>
    </div>
  );
}
