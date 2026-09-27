import axios, { type AxiosRequestConfig } from "axios";
import { useAuthStore } from "../stores/authStore";
import { useBillingNoticeStore } from "../stores/billingNoticeStore";
import { isElectronRuntime } from "./runtime";
import { createSingleFlight } from "./singleFlight";

/** Only the non-httpOnly CSRF cookie is intentionally visible to JavaScript. */
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function csrfHeaders(): Record<string, string> {
  const csrf = getCookie("csrf_token");
  return csrf ? { "X-CSRF-Token": csrf } : {};
}

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const electron = isElectronRuntime();
  const token = useAuthStore.getState().accessToken;

  if (electron && token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    // Browser requests are unconditionally cookie-only, even if stale code
    // attempts to provide a token-bearing config object.
    config.headers.delete?.("Authorization");
  }
  if (electron) config.headers["X-Client-Type"] = "bearer";

  const csrf = getCookie("csrf_token");
  if (csrf) config.headers["X-CSRF-Token"] = csrf;
  return config;
});

async function refreshSession(): Promise<void> {
  const electron = isElectronRuntime();
  const refreshToken = useAuthStore.getState().refreshToken;
  const body = electron && refreshToken ? { refresh_token: refreshToken } : {};
  const { data } = await axios.post("/api/auth/refresh", body, {
    withCredentials: true,
    headers: {
      ...csrfHeaders(),
      ...(electron ? { "X-Client-Type": "bearer" } : {}),
    },
  });

  if (electron) {
    if (!data?.access_token || !data?.refresh_token) {
      throw new Error("Desktop refresh response did not include a token pair.");
    }
    useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
  }
}

// A burst of 401s must rotate a refresh token only once. All failed requests
// await the same promise, then retry against the newly established session.
const refreshOnce = createSingleFlight(refreshSession);

const NO_REFRESH_PATHS = [
  "/auth/login",
  "/auth/signup",
  "/auth/google",
  "/auth/refresh",
  "/auth/logout",
  "/auth/mfa/verify",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isSessionEstablishment = NO_REFRESH_PATHS.some((path) => original?.url?.includes(path));

    if (error.response?.status === 401 && original && !original._retry && !isSessionEstablishment) {
      original._retry = true;
      try {
        await refreshOnce();
        if (!isElectronRuntime() && original.headers) {
          delete (original.headers as Record<string, unknown>).Authorization;
        }
        return api(original);
      } catch {
        await useAuthStore.getState().logout();
      }
    }

    if (error.response?.status === 402) {
      const detail = error.response?.data?.detail;
      const message = typeof detail === "string" ? detail : "This action requires a plan upgrade.";
      useBillingNoticeStore.getState().show(message);
    }
    return Promise.reject(error);
  },
);

export type LogoutCredentials = {
  accessToken: string | null;
  refreshToken: string | null;
};

/**
 * Dedicated client avoids the normal interceptor/store cycle during logout.
 * The immutable credential snapshot is important for Electron; browser logout
 * remains cookie + CSRF authenticated.
 */
export async function logoutSession(credentials: LogoutCredentials): Promise<void> {
  const headers: Record<string, string> = csrfHeaders();
  if (isElectronRuntime() && credentials.accessToken) {
    headers.Authorization = `Bearer ${credentials.accessToken}`;
  }
  if (isElectronRuntime()) headers["X-Client-Type"] = "bearer";
  await axios.post(
    "/api/auth/logout",
    {},
    {
      withCredentials: true,
      headers,
      timeout: 5_000,
    },
  );
}

export default api;
