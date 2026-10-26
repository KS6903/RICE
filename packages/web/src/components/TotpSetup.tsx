import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Smartphone } from "lucide-react";
import { t } from "../i18n";

/** The "add this account to your authenticator" step of TOTP enrollment.
 *
 *  The QR code encodes the otpauth:// URI, which carries the shared secret, so it
 *  is drawn here in the browser and never sent to a QR-image service. It sits on
 *  a white tile in both themes: authenticator scanners expect dark modules on a
 *  light background, and an inverted code fails on a lot of phones.
 *
 *  Scanning needs a second device. On a phone there is nothing to point the
 *  camera at, so the otpauth:// link hands the account straight to the installed
 *  authenticator instead, and the typed key underneath covers everything else. */
export default function TotpSetup({ secret, otpauthUri }: { secret: string; otpauthUri: string }) {
  const [copied, setCopied] = useState(false);
  // Groups of four are far easier to type into an app than 32 unbroken characters.
  const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? secret;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        {t(
          "Scan this code with your authenticator app (Google Authenticator, Authy, 1Password…), then enter the 6-digit code it shows.",
        )}
      </p>

      <div className="flex justify-center">
        <div className="rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-900/10">
          <QRCodeSVG
            value={otpauthUri}
            size={200}
            level="M"
            // The four-module quiet zone the QR spec asks for; scanners lock on
            // noticeably faster with it than with a code drawn edge to edge.
            marginSize={4}
            role="img"
            aria-label={t("QR code for your authenticator app")}
            data-testid="totp-qr"
          />
        </div>
      </div>

      <a
        href={otpauthUri}
        className="sm:hidden btn-secondary w-full inline-flex items-center justify-center gap-1.5"
      >
        <Smartphone size={14} /> {t("Open in authenticator app")}
      </a>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted">
          {t("Can't scan it? Enter this key instead:")}
        </p>
        <div className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl bg-slate-500/10 ring-1 ring-inset ring-slate-500/30">
          <code className="flex-1 font-mono text-sm break-all select-all" data-testid="totp-key">
            {grouped}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? t("Key copied") : t("Copy key")}
            className="shrink-0 h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-primary hover:bg-slate-500/10 transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
