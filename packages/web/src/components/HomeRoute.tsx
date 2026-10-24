import { Navigate } from "react-router-dom";
import { useAccess } from "../hooks/useAccess";
import { planHas } from "../hooks/useFeature";
import { useAuthStore } from "../stores/authStore";
import { NAV_GROUPS } from "./layout/navigation";
import Dashboard from "../pages/Dashboard";

/**
 * The page "/" opens: the Dashboard, or, for a role the Boss closed it to, the
 * first page in the menu the role can open (on the mill's plan), and Settings
 * (their own account) when there is none.
 */
export default function HomeRoute() {
  const { canView } = useAccess();
  const user = useAuthStore((s) => s.user);
  if (canView("dashboard")) return <Dashboard />;
  const first = NAV_GROUPS.flatMap((g) => g.items).find(
    (item) =>
      item.to !== "/" && canView(item.section) && planHas(user, item.feature || "dashboard"),
  );
  return <Navigate to={first?.to ?? "/settings"} replace />;
}
