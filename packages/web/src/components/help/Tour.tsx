import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { checklistHidden, setChecklistHidden, useHelpStore } from "../../stores/helpStore";
import { useAccess } from "../../hooks/useAccess";
import { tourStops } from "./tourStops";
import { t } from "../../i18n";

const GAP = 14;
const EDGE = 16;
const ARROW = 12;
// Solid, not glass: a see-through tooltip turns muddy over the dimmed page.
const SURFACE = "rgb(var(--surface-raised))";

type Placement = {
  left: number;
  top: number;
  /** Which edge of the tooltip the arrow sits on, and how far along it. */
  arrow: { side: "left" | "top"; at: number };
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** Beside a sidebar item, or under a header control, with the arrow aimed at
 *  the middle of it. Null centers the tooltip (nothing to point at). */
function placeTooltip(rect: DOMRect | null, width: number, height: number): Placement | null {
  if (!rect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (rect.left < vw / 2 && rect.right + GAP + width <= vw - EDGE) {
    const mid = rect.top + rect.height / 2;
    const top = clamp(mid - 32, EDGE, Math.max(EDGE, vh - height - EDGE));
    return {
      left: rect.right + GAP,
      top,
      arrow: { side: "left", at: clamp(mid - top, 18, height - 18) },
    };
  }
  const mid = rect.left + rect.width / 2;
  const left = clamp(mid - width + 32, EDGE, vw - width - EDGE);
  return {
    left,
    top: rect.bottom + GAP,
    arrow: { side: "top", at: clamp(mid - left, 18, width - 18) },
  };
}

/** The walkthrough: a tooltip that steps through the menu, opening each page
 *  behind it. Starts only when asked (the ? button, or the dashboard
 *  checklist). */
export default function Tour() {
  const touring = useHelpStore((s) => s.touring);
  return touring ? <TourRun /> : null;
}

function TourRun() {
  const stopTour = useHelpStore((s) => s.stopTour);
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? "";
  const { canView } = useAccess();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Fixed at the start: the stops don't shift under the user mid-tour.
  const [stops] = useState(() => tourStops(user, canView));
  const [startedOn] = useState(pathname);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [height, setHeight] = useState(200);
  const tipRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const stop = stops[i];
  const first = i === 0;
  const last = i === stops.length - 1;
  const width = Math.min(320, window.innerWidth - EDGE * 2);
  // Hidden the dashboard checklist? The last stop offers it back.
  const offerChecklist = useMemo(() => last && checklistHidden(userId), [last, userId]);

  // Open the page being described.
  useEffect(() => {
    if (stop.to && stop.to !== pathname) navigate(stop.to);
    // Only when the stop changes: following the user's own clicks isn't the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);

  // Find what to point at, and keep pointing at it as things move.
  useLayoutEffect(() => {
    const el = stop.target ? document.querySelector(`[data-tour="${stop.target}"]`) : null;
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView?.({ block: "nearest" });
    // On a phone the menu is tucked away off-screen: center the tooltip
    // rather than aim it at nothing.
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect(r.right <= 0 || r.left >= window.innerWidth ? null : r);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [stop]);

  useLayoutEffect(() => {
    if (tipRef.current) setHeight(tipRef.current.offsetHeight);
  }, [i, rect]);

  useEffect(() => nextRef.current?.focus(), [i]);

  const finish = (completed: boolean) => {
    stopTour();
    // Finishing returns them to where they started; ending early leaves them
    // on the page they chose to stay on.
    if (completed && startedOn !== pathname) navigate(startedOn);
  };
  const next = () => (last ? finish(true) : setI((n) => n + 1));
  const back = () => setI((n) => Math.max(0, n - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const place = placeTooltip(rect, width, height);
  const position: React.CSSProperties = place
    ? { left: place.left, top: place.top }
    : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

  // Portalled so the overlay and the measured (viewport) coordinates line up
  // even when an ancestor is transformed.
  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {/* Swallows clicks so a stray one doesn't wander off mid-tour. */}
      <div className="absolute inset-0" aria-hidden />
      {rect ? (
        <div
          aria-hidden
          className="absolute rounded-xl ring-2 ring-emerald-400 transition-all duration-300 motion-reduce:transition-none pointer-events-none"
          style={{
            left: rect.left - 4,
            top: rect.top - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.6)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-slate-950/60 pointer-events-none" />
      )}

      <div
        ref={tipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="absolute rounded-xl border border-soft p-5 shadow-2xl text-primary"
        style={{ width, backgroundColor: SURFACE, ...position }}
      >
        {place && (
          <span
            aria-hidden
            className="absolute h-3 w-3 rotate-45 border-soft"
            style={{
              backgroundColor: SURFACE,
              ...(place.arrow.side === "left"
                ? {
                    left: -ARROW / 2 - 1,
                    top: place.arrow.at - ARROW / 2,
                    borderLeftWidth: 1,
                    borderBottomWidth: 1,
                  }
                : {
                    top: -ARROW / 2 - 1,
                    left: place.arrow.at - ARROW / 2,
                    borderLeftWidth: 1,
                    borderTopWidth: 1,
                  }),
            }}
          />
        )}

        <button
          type="button"
          onClick={() => finish(false)}
          className="absolute right-3 top-3 h-7 w-7 grid place-items-center rounded-lg text-muted hover:text-primary"
          aria-label={t("End tour")}
        >
          <X size={16} />
        </button>

        <h2 id="tour-title" className="pr-8 text-base font-bold text-primary">
          {stop.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-sm text-secondary">
          {stop.body}
        </p>
        {offerChecklist && (
          <button
            type="button"
            onClick={() => {
              setChecklistHidden(userId, false);
              stopTour();
              navigate("/");
            }}
            className="mt-2 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {t("Bring back the getting-started checklist")}
          </button>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">
            {first ? "" : `${i} of ${stops.length - 1}`}
          </span>
          <div className="flex gap-2">
            {first ? (
              <button type="button" onClick={() => finish(false)} className="btn-secondary">
                {t("Not now")}
              </button>
            ) : (
              <button type="button" onClick={back} className="btn-secondary">
                {t("Back")}
              </button>
            )}
            <button ref={nextRef} type="button" onClick={next} className="btn-primary">
              {first ? t("Start tour") : last ? t("Done") : t("Next")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
