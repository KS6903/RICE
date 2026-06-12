import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@rice-mill/shared";

interface AuthState {
  user: User | null;
  /** In-memory ONLY — never persisted. The browser session lives in httpOnly
   *  cookies set by the server (JS can't read them, so XSS can't steal them).
   *  These fields exist for the Electron desktop app's Bearer/sync flow and as
   *  a fast path right after login. */
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      setUser: (user) => set({ user }),
      logout: () => {
        // Server-side revocation: kills the refresh-session family, blocklists
        // the access token, and clears the httpOnly cookies. Fire-and-forget —
        // local state is cleared regardless. Dynamic import avoids a static
        // api <-> store import cycle.
        import("../services/api").then(({ default: api }) => api.post("/auth/logout").catch(() => {}));
        set({ user: null, accessToken: null, refreshToken: null });
      },
      // After a reload there is no in-memory token, but a persisted user means a
      // (probable) live cookie session — /auth/me verifies it and logs out on 401.
      isAuthenticated: () => !!get().accessToken || !!get().user,
    }),
    {
      name: "rice-mill-auth",
      // SECURITY: persist only the non-sensitive profile. Tokens were previously
      // persisted to localStorage, which made them readable by any XSS payload.
      partialize: (s) => ({ user: s.user }) as AuthState,
      // v1 strips tokens that older clients stored under this key.
      version: 1,
      migrate: (persisted: any) => ({ user: persisted?.user ?? null }),
    }
  )
);
