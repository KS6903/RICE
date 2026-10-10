import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "./stores/authStore";
import { useIdleLogout } from "./hooks/useIdleLogout";
import { authService } from "./services/AuthService";
import AppShell from "./components/layout/AppShell";
import AdminShell from "./components/layout/AdminShell";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import Dashboard from "./pages/Dashboard";
import PaddyPage from "./pages/PaddyPage";
import MillingPage from "./pages/MillingPage";
import InventoryPage from "./pages/InventoryPage";
import SalesPage from "./pages/SalesPage";
import DispatchPage from "./pages/DispatchPage";
import FieldOperatorsPage from "./pages/FieldOperatorsPage";
import CostsPage from "./pages/CostsPage";
import ReportsPage from "./pages/ReportsPage";
import AutomationsPage from "./pages/AutomationsPage";
import TasksPage from "./pages/TasksPage";
import CollectionsPage from "./pages/CollectionsPage";
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
import MfaEnrollmentGate from "./components/MfaEnrollmentGate";
import PasswordChangeGate from "./components/PasswordChangeGate";
import EmailVerificationGate from "./components/EmailVerificationGate";
import LegalAcceptanceGate from "./components/LegalAcceptanceGate";
import LegalPage from "./pages/LegalPage";

function AuthSessionSync() {
  const hasAccessToken = useAuthStore((s) => !!s.accessToken);
  const user = useAuthStore((s) => s.user);
  const reauthenticationRequired = useAuthStore((s) => s.reauthenticationRequired);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const meQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => authService.me(),
    // The session lives in httpOnly cookies, so after a reload there is no
    // in-memory token — the persisted user signals a (probable) live cookie
    // session, which this query verifies (401 → logout below).
    enabled: !reauthenticationRequired && (hasAccessToken || !!user),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Once a minute: every poll is a request (and Redis commands, which Upstash
    // bills). Focus and reconnect still refetch at once.
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
    retry: 0,
  });

  useEffect(() => {
    if (meQuery.data) setUser(meQuery.data);
  }, [meQuery.data, setUser]);

  useEffect(() => {
    if (!meQuery.isError) return;
    const status = (meQuery.error as any)?.response?.status;
    if (status === 401 || status === 403) void logout();
  }, [meQuery.isError, meQuery.error, logout]);

  return null;
}

/** Signs the user out and returns them to /login after a window of inactivity
 *  (see useIdleLogout). Rendered inside the Router so it can navigate. */
function IdleLogout() {
  useIdleLogout();
  return null;
}

/** Root of the tenant app. Logged-out visitors get the public homepage
 *  instead of being bounced to /login: at "/" the landing page renders
 *  directly; deep links to protected pages redirect to "/" (the homepage). */
function TenantRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();
  if (!isAuthenticated) {
    if (pathname !== "/") return <Navigate to="/" replace />;
    return <HomePage />;
  }
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

/** When the server blocks data endpoints for a not-yet-ready account (MFA
 *  enrollment or email verification required), we replace the whole app with the
 *  relevant mandatory screen. The /verify-email link route stays reachable so a
 *  user can complete verification from the gate. */
function AppRoutes() {
  const { pathname } = useLocation();
  const mustChangePassword = useAuthStore((s) => !!s.user?.password_change_required);
  const mustEnroll = useAuthStore((s) => !!s.user?.mfa_enrollment_required);
  const mustVerify = useAuthStore((s) => !!s.user?.email_verification_required);
  const mustAccept = useAuthStore((s) => !!s.user?.legal_acceptance_required);
  // /legal/* stays reachable from every gate: nobody should be asked to accept
  // terms they cannot open, and the pages are public anyway.
  const onLegalPage = pathname.startsWith("/legal");
  // First, the temporary password: nothing else matters until it is replaced.
  if (mustChangePassword && !onLegalPage) return <PasswordChangeGate />;
  if (mustEnroll && !onLegalPage) return <MfaEnrollmentGate />;
  if (mustVerify && pathname !== "/verify-email" && !onLegalPage) return <EmailVerificationGate />;
  if (mustAccept && !onLegalPage) return <LegalAcceptanceGate />;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/legal" element={<LegalPage />} />
      <Route path="/legal/:key" element={<LegalPage />} />

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
        <Route
          path="paddy"
          element={
            <RoleGate section="paddy">
              <FeatureGate code="paddy" label="Paddy procurement">
                <PaddyPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="milling"
          element={
            <RoleGate section="milling">
              <FeatureGate code="milling" label="Milling">
                <MillingPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="inventory"
          element={
            <RoleGate section="inventory">
              <FeatureGate code="inventory" label="Inventory">
                <InventoryPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="sales"
          element={
            <RoleGate section="sales">
              <FeatureGate code="sales" label="Sales">
                <SalesPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="dispatch"
          element={
            <RoleGate section="dispatch">
              <FeatureGate code="sales" label="Dispatch">
                <DispatchPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="operators"
          element={
            <RoleGate section="operators">
              <FeatureGate code="sales" label="Field Operators">
                <FieldOperatorsPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="costs"
          element={
            <RoleGate section="expenses">
              <FeatureGate code="expenses" label="Expenses">
                <CostsPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="reports"
          element={
            <RoleGate section="reports">
              <FeatureGate code="dashboard" label="Reports">
                <ReportsPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="users"
          element={
            <RoleGate section="users">
              <FeatureGate code="users" label="Users">
                <UsersPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="employees"
          element={
            <RoleGate section="employees">
              <FeatureGate code="employees" label="Employees" requires="Pro or Enterprise">
                <EmployeesPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="automations"
          element={
            <RoleGate section="automations">
              <FeatureGate code="automations" label="Automations" requires="Enterprise">
                <AutomationsPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="collections"
          element={
            <RoleGate section="sales">
              <FeatureGate code="automations" label="Collections" requires="Enterprise">
                <CollectionsPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="tasks"
          element={
            <RoleGate section="tasks">
              <FeatureGate code="automations" label="To do" requires="Enterprise">
                <TasksPage />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthSessionSync />
      <IdleLogout />
      <AppRoutes />
    </BrowserRouter>
  );
}
