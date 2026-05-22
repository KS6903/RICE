import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import BillingNoticeBanner from "../BillingNoticeBanner";
import SubscriptionGuard from "../SubscriptionGuard";

export default function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <BillingNoticeBanner />
        <main className="flex-1 overflow-y-auto p-6">
          <SubscriptionGuard>
            <Outlet />
          </SubscriptionGuard>
        </main>
      </div>
    </div>
  );
}
