import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import BillingNoticeBanner from "../BillingNoticeBanner";
import VerifyEmailBanner from "../VerifyEmailBanner";
import SubscriptionGuard from "../SubscriptionGuard";
import Tour from "../help/Tour";
import { useAccountTheme } from "../../hooks/useAccountTheme";
import { useNavDrawer } from "./NavDrawer";

export default function AppShell() {
  useAccountTheme();
  const nav = useNavDrawer();
  return (
    <div className="app-viewport flex overflow-hidden">
      <Sidebar open={nav.open} onClose={() => nav.setOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header menuOpen={nav.open} onMenu={() => nav.setOpen(true)} />
        <VerifyEmailBanner />
        <BillingNoticeBanner />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl animate-grad-fade-up">
            <SubscriptionGuard>
              <Outlet />
            </SubscriptionGuard>
          </div>
        </main>
      </div>
      <Tour />
    </div>
  );
}
