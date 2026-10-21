import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import "./index.css";
// Side-effect import: applies persisted/system theme to <html> before first paint.
import "./stores/themeStore";
import { queryClient } from "./services/queryClient";
import { googleClientId, googleSignInEnabled } from "./utils/googleSignIn";
import { registerSW } from "virtual:pwa-register";

// The offline cache is for the browser. The desktop app (app://oraiza) has its
// own offline store, and its scheme can't host a service worker anyway.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  registerSW({
    immediate: true,
    // Pages already come from the network (vite.config.ts), so the page is the
    // new build by the time a new worker takes over. Reloading then would only
    // blink the screen and drop whatever was being typed.
    onNeedReload: () => {},
  });
}

const app = (
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);

// Google's script is only loaded when Google sign-in is set up: see googleSignIn.ts.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {googleSignInEnabled() ? (
      <GoogleOAuthProvider clientId={googleClientId()}>{app}</GoogleOAuthProvider>
    ) : (
      app
    )}
  </React.StrictMode>,
);
