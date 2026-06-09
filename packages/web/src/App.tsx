import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "./stores/authStore";
import { authService } from "./services/AuthService";
import AppShell from "./components/layout/AppShell";
import AdminShell from "./components/layout/AdminShell";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import Dashboard from "./pages/Dashboard";
import PaddyPage from "./pages/PaddyPage";
import MillingPage from "./pages/MillingPage";
import InventoryPage from "./pages/InventoryPage";
import SalesPage from "./pages/SalesPage";
import DispatchPage from "./pages/DispatchPage";
import FieldOperatorsPage from "./pages/FieldOperatorsPage";
import CostsPage from "./pages/CostsPage";
import ReportsPage from "./pages/ReportsPage";
import UsersPage from "./pages/UsersPage";
import EmployeesPage from "./pages/EmployeesPage";
import SettingsPage from "./pages/SettingsPage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminTenants from "./pages/admin/AdminTenants";
import AdminTenantDetail from "./pages/admin/AdminTenantDetail";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminUpgradeRequests from "./pages/admin/AdminUpgradeRequests";
import AdminSettingsPage from "./pages/admin/AdminSettingsPage";
import FeatureGate from "./components/FeatureGate";
import RoleGate from "./components/RoleGate";

function AuthSessionSync() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const meQuery = useQuery({
    queryKey: ["auth-me", accessToken],
    queryFn: () => authService.me(),
    enabled: !!accessToken,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 10 * 1000,
    staleTime: 10 * 1000,
    retry: 0,
  });

  useEffect(() => {
    if (meQuery.data) setUser(meQuery.data);
  }, [meQuery.data, setUser]);

  useEffect(() => {
    if (!meQuery.isError) return;
    const status = (meQuery.error as any)?.response?.status;
    if (status === 401 || status === 403) logout();
  }, [meQuery.isError, meQuery.error, logout]);

  return null;
}

function TenantRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const user = useAuthStore((s) => s.user);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.is_platform_admin) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const user = useAuthStore((s) => s.user);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user?.is_platform_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthSessionSync />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminShell />
            </AdminRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="tenants" element={<AdminTenants />} />
          <Route path="tenants/:id" element={<AdminTenantDetail />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="upgrade-requests" element={<AdminUpgradeRequests />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>

        <Route
          path="/"
          element={
            <TenantRoute>
              <AppShell />
            </TenantRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="paddy" element={<RoleGate section="paddy"><FeatureGate code="paddy" label="Paddy procurement"><PaddyPage /></FeatureGate></RoleGate>} />
          <Route path="milling" element={<RoleGate section="milling"><FeatureGate code="milling" label="Milling"><MillingPage /></FeatureGate></RoleGate>} />
          <Route path="inventory" element={<RoleGate section="inventory"><FeatureGate code="inventory" label="Inventory"><InventoryPage /></FeatureGate></RoleGate>} />
          <Route path="sales" element={<RoleGate section="sales"><FeatureGate code="sales" label="Sales"><SalesPage /></FeatureGate></RoleGate>} />
          <Route path="dispatch" element={<RoleGate section="dispatch"><FeatureGate code="sales" label="Dispatch"><DispatchPage /></FeatureGate></RoleGate>} />
          <Route path="operators" element={<RoleGate section="operators"><FeatureGate code="sales" label="Field Operators"><FieldOperatorsPage /></FeatureGate></RoleGate>} />
          <Route path="costs" element={<RoleGate section="expenses"><FeatureGate code="expenses" label="Expenses"><CostsPage /></FeatureGate></RoleGate>} />
          <Route path="reports" element={<RoleGate section="reports"><FeatureGate code="dashboard" label="Reports"><ReportsPage /></FeatureGate></RoleGate>} />
          <Route path="users" element={<RoleGate section="users"><FeatureGate code="users" label="Users"><UsersPage /></FeatureGate></RoleGate>} />
          <Route path="employees" element={<RoleGate section="employees"><FeatureGate code="employees" label="Employees" requires="Pro or Enterprise"><EmployeesPage /></FeatureGate></RoleGate>} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
