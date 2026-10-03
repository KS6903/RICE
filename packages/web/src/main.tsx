import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import "./index.css";
// Side-effect import: applies persisted/system theme to <html> before first paint.
import "./stores/themeStore";
import { queryClient } from "./services/queryClient";
import { registerSW } from "virtual:pwa-register";

// The offline cache is for the browser. The desktop app (app://oryza) has its
// own offline store, and its scheme can't host a service worker anyway.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  registerSW({ immediate: true });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ""}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
