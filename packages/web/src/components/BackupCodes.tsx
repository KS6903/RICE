import { useState } from "react";
import { KeyRound, Copy, Check, Download } from "lucide-react";

/** One-time display of MFA backup codes with copy/download. The server never
 *  shows these again, so the user must save them now. */
export default function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () => {
    const blob = new Blob([`Oraiza by K Systematics — backup codes\n\n${text}\n`], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "oraiza-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/15 ring-1 ring-inset ring-amber-500/40 text-sm font-medium text-amber-700 dark:text-amber-300">
        <KeyRound size={16} className="mt-0.5 shrink-0" />
        <span>
          Save these recovery codes somewhere safe. Each works once if you lose your authenticator —
          they won&apos;t be shown again.
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 px-3 py-3 rounded-xl bg-slate-500/10 ring-1 ring-inset ring-slate-500/30 font-mono text-sm">
        {codes.map((c) => (
          <span key={c} className="select-all">
            {c}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={copy}
          className="btn-secondary flex-1 inline-flex items-center justify-center gap-1.5"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={download}
          className="btn-secondary flex-1 inline-flex items-center justify-center gap-1.5"
        >
          <Download size={14} /> Download
        </button>
      </div>
    </div>
  );
}
