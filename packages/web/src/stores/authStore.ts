import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@rice-mill/shared";
import { clearSessionQueryCache, securityContextFingerprint } from "../services/sessionCache";
import { isElectronRuntime, setDesktopSyncToken } from "../services/runtime";
import { followAccountLanguage } from "../i18n";

interface AuthState {
  user: User | null;
  /**
   * In-memory only. Browser sessions live in httpOnly cookies; these fields
   * exist solely for Electron's Bearer/native-sync path.
   */
  accessToken: string | null;
  refreshToken: string | null;
  reauthenticationRequired: boolean;
  setTokens: (access?: string | null, refresh?: string | null) => void;
  setUser: (user: User) => void;
  requireReauthentication: () => void;
  logout: () => Promise<void>;
  isAuthenticated: () => boolean;
}

let logoutPromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      reauthenticationRequired: false,
      setTokens: (access, refresh) => {
        // Never make browser token response bodies JavaScript session state.
        if (!isElectronRuntime()) {
          set({ accessToken: null, refreshToken: null });
          return;
        }

        const accessToken = access ?? null;
        const refreshToken = refresh ?? null;
        set({ accessToken, refreshToken });
        void setDesktopSyncToken(accessToken ?? "").catch(() => {});
      },
      setUser: (user) => {
        const previous = get().user;
        if (securityContextFingerprint(previous) !== securityContextFingerprint(user)) {
          // Cancel and remove tenant data before the new context is observable.
          clearSessionQueryCache();
        }
        set({ user });
        // The account's language, if it chose one, on whatever device it's on.
        followAccountLanguage(user.language);
      },
      requireReauthentication: () => set({ reauthenticationRequired: true }),
      logout: () => {
        if (logoutPromise) return logoutPromise;

        // Capture Electron credentials before state changes. Browser logout
        // uses the cookie + CSRF snapshot assembled by logoutSession().
        const credentials = {
          accessToken: get().accessToken,
          refreshToken: get().refreshToken,
        };
        const serverLogout = import("../services/api").then(({ logoutSession }) =>
          logoutSession(credentials),
        );

        clearSessionQueryCache();
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          reauthenticationRequired: false,
        });
        const desktopCleanup = setDesktopSyncToken("");

        logoutPromise = Promise.allSettled([serverLogout, desktopCleanup])
          .then(() => undefined)
          .finally(() => {
            logoutPromise = null;
          });
        return logoutPromise;
      },
      // A persisted profile tells the app to verify the cookie session on load.
      isAuthenticated: () => !!get().accessToken || !!get().user,
    }),
    {
      name: "rice-mill-auth",
      // Profiles may be persisted for cookie-session bootstrapping; tokens may not.
      partialize: (s) => ({ user: s.user }) as AuthState,
      // v1 strips tokens that older clients stored under this key.
      version: 1,
      migrate: (persisted: any) => ({ user: persisted?.user ?? null }),
    },
  ),
);
