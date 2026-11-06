import { create } from "zustand";

/**
 * BossAdmin's "confirm it's you" before a change (backend core/admin_guard.py).
 *
 * A change the server turns down with code "confirm_required" waits here (see
 * services/api.ts): AdminConfirmHost asks for the password and authenticator
 * code, sends them to /admin/confirm, and the change goes again. Several
 * changes waiting at once share one asking.
 */
type State = {
  open: boolean;
  error: string | null;
  /** Set by the host: sends the proof; resolves true when the server took it. */
  waiters: ((ok: boolean) => void)[];
  ask: () => Promise<boolean>;
  settle: (ok: boolean) => void;
  setError: (error: string | null) => void;
};

export const useAdminConfirmStore = create<State>((set, get) => ({
  open: false,
  error: null,
  waiters: [],
  ask: () =>
    new Promise<boolean>((resolve) => {
      set({ open: true, waiters: [...get().waiters, resolve] });
    }),
  settle: (ok) => {
    const waiting = get().waiters;
    set({ open: false, error: null, waiters: [] });
    waiting.forEach((resolve) => resolve(ok));
  },
  setError: (error) => set({ error }),
}));
