import { create } from "zustand";

interface BillingNotice {
  message: string;
  shownAt: number;
}

interface State {
  notice: BillingNotice | null;
  show: (message: string) => void;
  dismiss: () => void;
}

export const useBillingNoticeStore = create<State>((set) => ({
  notice: null,
  show: (message) => set({ notice: { message, shownAt: Date.now() } }),
  dismiss: () => set({ notice: null }),
}));
