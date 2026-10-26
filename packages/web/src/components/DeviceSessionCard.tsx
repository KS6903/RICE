import { useId, useState } from "react";
import {
  AppWindow,
  ChevronDown,
  ChevronUp,
  Cookie,
  Monitor,
  MonitorSmartphone,
  Smartphone,
  Tablet,
} from "lucide-react";
import type { DeviceSession, SessionCookie } from "../services/AuthService";
import { t } from "../i18n";

const ICONS = {
  Phone: Smartphone,
  Tablet: Tablet,
  Computer: Monitor,
  "Desktop app": AppWindow,
  Unknown: MonitorSmartphone,
} as const;

const when = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const cookieLife = (c: SessionCookie) =>
  c.lasts ?? (c.expires_at ? `until ${when(c.expires_at)}` : t("for this browser session"));

const cookieFlags = (c: SessionCookie) =>
  [
    c.http_only ? t("Hidden from the page's scripts") : t("Readable by the page"),
    c.secure ? t("HTTPS only") : null,
    `SameSite=${c.same_site}`,
    `Path ${c.path}`,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * One signed-in device in Settings > Devices: what it is, where it signed in
 * from and was last used, and, opened up, the cookies it keeps and the exact
 * User-Agent it sent.
 */
export default function DeviceSessionCard({
  session: s,
  onRevoke,
  revoking = false,
}: {
  session: DeviceSession;
  onRevoke?: () => void;
  revoking?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const Icon = ICONS[s.device_type] ?? MonitorSmartphone;
  const kind = [s.device_type !== "Unknown" ? s.device_type : null, s.browser, s.os]
    .filter(Boolean)
    .join(" · ");
  const recorded = !!s.user_agent || !!s.ip_address;

  return (
    <div className="rounded-xl ring-1 ring-inset ring-slate-500/20 bg-slate-500/5">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-500/10 text-secondary">
            <Icon size={17} aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-primary flex flex-wrap items-center gap-2">
              {s.device_name ?? s.client}
              {s.current && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  {t("This device")}
                </span>
              )}
            </p>
            {kind && <p className="text-sm text-secondary">{kind}</p>}
          </div>
        </div>
        {onRevoke && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            className="shrink-0 text-sm font-semibold text-rose-600 dark:text-rose-400 hover:opacity-80"
          >
            {t("Revoke")}
          </button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-4 pb-3 text-xs sm:grid-cols-2">
        <Fact label={t("IP address")}>
          {s.ip_address ?? t("Not recorded")}
          {s.signed_in_ip && s.signed_in_ip !== s.ip_address && (
            <span className="text-muted">
              {" "}
              {t("(signed in from {{signed_in_ip}})", { signed_in_ip: s.signed_in_ip })}
            </span>
          )}
        </Fact>
        <Fact label={t("Session ID")}>
          <span className="font-mono">{s.id.slice(0, 8)}</span>
        </Fact>
        <Fact label={t("Signed in")}>{when(s.signed_in_at)}</Fact>
        <Fact label={t("Last active")}>{when(s.last_active)}</Fact>
        <Fact label={t("Signs out by itself")}>{when(s.expires_at)}</Fact>
      </dl>

      {!recorded && (
        <p className="px-4 pb-3 text-xs text-muted">
          {t(
            "This device signed in before Oraiza kept device details. Sign in on it again to see them.",
          )}
        </p>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between border-t border-soft px-4 py-2 text-xs font-semibold text-secondary hover:text-primary"
      >
        <span className="inline-flex items-center gap-1.5">
          <Cookie size={13} aria-hidden /> {t("Cookies and details")}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div id={detailsId} className="space-y-3 border-t border-soft px-4 py-3 text-xs">
          {s.cookies.length === 0 ? (
            <p className="text-secondary">
              {s.device_type === "Desktop app"
                ? t("The desktop app keeps its sign-in itself, not in browser cookies.")
                : t("No cookies are kept for this session.")}
            </p>
          ) : (
            <ul className="space-y-2">
              {s.cookies.map((c) => (
                <li key={c.name}>
                  <p>
                    <span className="font-mono font-semibold text-primary">{c.name}</span>
                    <span className="text-secondary">: {c.purpose}</span>
                  </p>
                  <p className="text-muted">
                    {t("Lasts")} {cookieLife(c)}. {cookieFlags(c)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div>
            <p className="font-semibold text-secondary">{t("What the device sent (User-Agent)")}</p>
            <p className="mt-0.5 break-all font-mono text-muted">
              {s.user_agent ?? t("Not recorded")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-muted">{label}:</dt>
      <dd className="min-w-0 text-secondary">{children}</dd>
    </div>
  );
}
