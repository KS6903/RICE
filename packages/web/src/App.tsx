import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "./stores/authStore";
import { useIdleLogout } from "./hooks/useIdleLogout";
import { useVisualViewport } from "./hooks/useVisualViewport";
import { authService } from "./services/AuthService";
import AppShell from "./components/layout/AppShell";
import AdminShell from "./components/layout/AdminShell";
import FeatureGate from "./components/FeatureGate";
import RoleGate from "./components/RoleGate";
import MfaEnrollmentGate from "./components/MfaEnrollmentGate";
import AccountClosedGate from "./components/AccountClosedGate";
import PasswordChangeGate from "./components/PasswordChangeGate";
import EmailVerificationGate from "./components/EmailVerificationGate";
import LegalAcceptanceGate from "./components/LegalAcceptanceGate";

const HomePage = lazy(() => import("./pages/HomePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const HomeRoute = lazy(() => import("./components/HomeRoute"));
const PaddyPage = lazy(() => import("./pages/PaddyPage"));
const RicePurchasesPage = lazy(() => import("./pages/RicePurchasesPage"));
const ByproductPurchasesPage = lazy(() => import("./pages/ByproductPurchasesPage"));
const MillingPage = lazy(() => import("./pages/MillingPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const SalesPage = lazy(() => import("./pages/SalesPage"));
const DispatchPage = lazy(() => import("./pages/DispatchPage"));
const FieldOperatorsPage = lazy(() => import("./pages/FieldOperatorsPage"));
const CostsPage = lazy(() => import("./pages/CostsPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const AutomationsPage = lazy(() => import("./pages/AutomationsPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const CollectionsPage = lazy(() => import("./pages/CollectionsPage"));
const CashCountPage = lazy(() => import("./pages/CashCountPage"));
const StockCountPage = lazy(() => import("./pages/StockCountPage"));
const CatalogPage = lazy(() => import("./pages/CatalogPage"));
const MaintenancePage = lazy(() => import("./pages/MaintenancePage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const CheckoutReturnPage = lazy(() => import("./pages/CheckoutReturnPage"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminTenants = lazy(() => import("./pages/admin/AdminTenants"));
const AdminTenantDetail = lazy(() => import("./pages/admin/AdminTenantDetail"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminUpgradeRequests = lazy(() => import("./pages/admin/AdminUpgradeRequests"));
const AdminSettingsPage = lazy(() => import("./pages/admin/AdminSettingsPage"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const RetrieveDataPage = lazy(() => import("./pages/RetrieveDataPage"));

function LazyPage({ component: Page }: { component: ComponentType<any> }) {
  return (
    <Suspense
      fallback={
        <div
          className="mx-auto flex min-h-[40vh] w-full max-w-7xl items-center justify-center p-6"
          role="status"
          aria-label="Loading page"
        >
          <span className="h-9 w-9 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        </div>
      }
    >
      <Page />
    </Suspense>
  );
}

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
    return <LazyPage component={HomePage} />;
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
  // The Boss closed the mill's account: they may only reopen it or take its data.
  const accountClosed = useAuthStore((s) => {
    const state = s.user?.account?.state;
    return state === "paused" || state === "deletion_requested";
  });
  // /legal/* stays reachable from every gate: nobody should be asked to accept
  // terms they cannot open, and the pages are public anyway.
  const onLegalPage = pathname.startsWith("/legal");
  // First, the temporary password: nothing else matters until it is replaced.
  if (mustChangePassword && !onLegalPage) return <PasswordChangeGate />;
  if (mustEnroll && !onLegalPage) return <MfaEnrollmentGate />;
  if (accountClosed && !onLegalPage) return <AccountClosedGate />;
  if (mustVerify && pathname !== "/verify-email" && !onLegalPage) return <EmailVerificationGate />;
  if (mustAccept && !onLegalPage) return <LegalAcceptanceGate />;
  return (
    <Routes>
      <Route path="/login" element={<LazyPage component={LoginPage} />} />
      <Route path="/signup" element={<LazyPage component={SignupPage} />} />
      <Route path="/forgot-password" element={<LazyPage component={ForgotPasswordPage} />} />
      <Route path="/reset-password" element={<LazyPage component={ResetPasswordPage} />} />
      <Route path="/verify-email" element={<LazyPage component={VerifyEmailPage} />} />
      <Route path="/legal" element={<LazyPage component={LegalPage} />} />
      <Route path="/legal/:key" element={<LazyPage component={LegalPage} />} />
      {/* Open to anyone: it explains the steps, or takes the backup once the
          owner of a new, empty account is signed in. */}
      <Route path="/retrieve-data" element={<LazyPage component={RetrieveDataPage} />} />
      {/* The address people guess for loading a backup file. */}
      <Route path="/upload" element={<Navigate to="/retrieve-data" replace />} />

      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminShell />
          </AdminRoute>
        }
      >
        <Route index element={<LazyPage component={AdminDashboard} />} />
        <Route path="tenants" element={<LazyPage component={AdminTenants} />} />
        <Route path="tenants/:id" element={<LazyPage component={AdminTenantDetail} />} />
        <Route path="users" element={<LazyPage component={AdminUsers} />} />
        <Route path="upgrade-requests" element={<LazyPage component={AdminUpgradeRequests} />} />
        <Route path="settings" element={<LazyPage component={AdminSettingsPage} />} />
      </Route>

      <Route
        path="/"
        element={
          <TenantRoute>
            <AppShell />
          </TenantRoute>
        }
      >
        <Route index element={<LazyPage component={HomeRoute} />} />
        <Route
          path="paddy"
          element={
            <RoleGate section="paddy">
              <FeatureGate code="paddy" label="Paddy procurement">
                <LazyPage component={PaddyPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="rice"
          element={
            <RoleGate section="paddy">
              <FeatureGate code="paddy" label="Rice purchases">
                <LazyPage component={RicePurchasesPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="byproducts"
          element={
            <RoleGate section="paddy">
              <FeatureGate code="paddy" label="By-product purchases">
                <LazyPage component={ByproductPurchasesPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="milling"
          element={
            <RoleGate section="milling">
              <FeatureGate code="milling" label="Milling" requires="Basic or higher">
                <LazyPage component={MillingPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="inventory"
          element={
            <RoleGate section="inventory">
              <FeatureGate code="inventory" label="Inventory">
                <LazyPage component={InventoryPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="sales"
          element={
            <RoleGate section="sales">
              <FeatureGate code="sales" label="Sales">
                <LazyPage component={SalesPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="dispatch"
          element={
            <RoleGate section="dispatch">
              <FeatureGate code="dispatch" label="Dispatch" requires="Basic or higher">
                <LazyPage component={DispatchPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="operators"
          element={
            <RoleGate section="operators">
              <FeatureGate
                code="field_operators"
                label="Field Operators"
                requires="Pro or Enterprise"
              >
                <LazyPage component={FieldOperatorsPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="costs"
          element={
            <RoleGate section="expenses">
              <FeatureGate code="expenses" label="Expenses">
                <LazyPage component={CostsPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="reports"
          element={
            <RoleGate section="reports">
              <FeatureGate code="dashboard" label="Reports">
                <LazyPage component={ReportsPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="users"
          element={
            <RoleGate section="users">
              <FeatureGate code="users" label="Users">
                <LazyPage component={UsersPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="employees"
          element={
            <RoleGate section="employees">
              <FeatureGate code="employees" label="Employees" requires="Pro or Enterprise">
                <LazyPage component={EmployeesPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="automations"
          element={
            <RoleGate section="automations">
              <FeatureGate code="automations" label="Automations" requires="Enterprise">
                <LazyPage component={AutomationsPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="maintenance"
          element={
            <RoleGate section="milling">
              <FeatureGate code="automations" label="Maintenance" requires="Enterprise">
                <LazyPage component={MaintenancePage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="catalog"
          element={
            <RoleGate section="settings">
              <LazyPage component={CatalogPage} />
            </RoleGate>
          }
        />
        <Route
          path="stock-count"
          element={
            <RoleGate section="inventory">
              <FeatureGate code="automations" label="Stock count" requires="Enterprise">
                <LazyPage component={StockCountPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="cash"
          element={
            <RoleGate section="sales">
              <FeatureGate code="cash_count" label="Cash count" requires="Pro or Enterprise">
                <LazyPage component={CashCountPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="collections"
          element={
            <RoleGate section="sales">
              <FeatureGate code="collections" label="Collections" requires="Pro or Enterprise">
                <LazyPage component={CollectionsPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route
          path="tasks"
          element={
            <RoleGate section="tasks">
              <FeatureGate code="automations" label="To do" requires="Enterprise">
                <LazyPage component={TasksPage} />
              </FeatureGate>
            </RoleGate>
          }
        />
        <Route path="settings" element={<LazyPage component={SettingsPage} />} />
        <Route
          path="settings/checkout"
          element={
            <RoleGate section="settings">
              <LazyPage component={CheckoutPage} />
            </RoleGate>
          }
        />
        <Route
          path="settings/checkout/return"
          element={
            <RoleGate section="settings">
              <LazyPage component={CheckoutReturnPage} />
            </RoleGate>
          }
        />
      </Route>
    </Routes>
  );
}

export default function App() {
  useVisualViewport();
  return (
    <BrowserRouter>
      <AuthSessionSync />
      <IdleLogout />
      <AppRoutes />
    </BrowserRouter>
  );
}
