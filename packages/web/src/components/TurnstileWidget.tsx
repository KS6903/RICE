import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** Cloudflare Turnstile, the bot check on the sign-up form.
 *
 *  The browser only collects a token; the API checks it with Cloudflare before
 *  making the account (backend/app/core/turnstile.py). A token works once, so
 *  after a failed attempt the form calls reset() for a fresh one. */

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptLoading) {
    scriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing"));
      script.onerror = () => {
        scriptLoading = null;
        reject(new Error("Turnstile failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptLoading;
}

export type TurnstileHandle = { reset: () => void };

type Props = {
  siteKey: string;
  action: string;
  /** The token, or "" when it expired, failed, or was reset. */
  onToken: (token: string) => void;
};

const TurnstileWidget = forwardRef<TurnstileHandle, Props>(function TurnstileWidget(
  { siteKey, action, onToken },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // The latest callback, without re-rendering the widget when it changes.
  const tokenSink = useRef(onToken);
  useEffect(() => {
    tokenSink.current = onToken;
  });

  useImperativeHandle(ref, () => ({
    reset: () => {
      tokenSink.current("");
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          callback: (token: string) => tokenSink.current(token),
          "expired-callback": () => tokenSink.current(""),
          "error-callback": () => tokenSink.current(""),
        });
      })
      .catch(() => tokenSink.current(""));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  return <div ref={container} className="flex justify-center" data-testid="turnstile" />;
});

export default TurnstileWidget;
