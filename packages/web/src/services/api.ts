import axios from "axios";
import { useAuthStore } from "../stores/authStore";
import { useBillingNoticeStore } from "../stores/billingNoticeStore";

/** Read a cookie by name — only used for the non-httpOnly csrf_token, which the
 *  server requires back as the X-CSRF-Token header (double-submit CSRF check).
 *  The session tokens themselves are httpOnly and invisible to JS by design. */
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
  // Send/receive the httpOnly session cookies on every request.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  // Bearer fast path: in-memory token (Electron desktop sync; the moments right
  // after login). The server prefers this header and skips cookie/CSRF checks —
  // a cross-site page can never set an Authorization header.
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const csrf = getCookie("csrf_token");
  if (csrf) config.headers["X-CSRF-Token"] = csrf;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    // Never run the refresh dance for the auth endpoints themselves (a failed
    // login/refresh/logout must not trigger another refresh → infinite loop).
    const isAuthPath = ["/auth/login", "/auth/refresh", "/auth/logout"].some((p) =>
      original?.url?.includes(p)
    );
    if (err.response?.status === 401 && !original._retry && !isAuthPath) {
      original._retry = true;
      try {
        // Web: the refresh token rides in its httpOnly cookie (empty body).
        // Electron: the in-memory refresh token goes in the body.
        const refresh = useAuthStore.getState().refreshToken;
        const { data } = await axios.post(
          "/api/auth/refresh",
          refresh ? { refresh_token: refresh } : {},
          { withCredentials: true, headers: { "X-CSRF-Token": getCookie("csrf_token") ?? "" } }
        );
        useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
      }
    }
    if (err.response?.status === 402) {
      const detail = err.response?.data?.detail;
      const message = typeof detail === "string" ? detail : "This action requires a plan upgrade.";
      useBillingNoticeStore.getState().show(message);
    }
    return Promise.reject(err);
  }
);

export default api;
