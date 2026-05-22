import axios from "axios";
import { useAuthStore } from "../stores/authStore";
import { useBillingNoticeStore } from "../stores/billingNoticeStore";

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = useAuthStore.getState().refreshToken;
      if (refresh) {
        try {
          const { data } = await axios.post("/api/auth/refresh", { refresh_token: refresh });
          useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
          original.headers.Authorization = `Bearer ${data.access_token}`;
          return api(original);
        } catch {
          useAuthStore.getState().logout();
        }
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
