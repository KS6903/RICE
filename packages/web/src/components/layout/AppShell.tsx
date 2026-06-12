import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import BillingNoticeBanner from "../BillingNoticeBanner";
import VerifyEmailBanner from "../VerifyEmailBanner";
import SubscriptionGuard from "../SubscriptionGuard";

export default function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <VerifyEmailBanner />
        <BillingNoticeBanner />
        <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl animate-grad-fade-up">
            <SubscriptionGuard>
              <Outlet />
            </SubscriptionGuard>
          </div>
        </main>
      </div>
    </div>
  );
}
