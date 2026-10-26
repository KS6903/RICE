import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { t } from "../i18n";

/** Point-of-use disclaimers.
 *
 *  Section 5 of the Terms says what Oraiza is not. A disclaimer buried only in
 *  the Terms is easy to argue around; one shown next to the output it applies
 *  to is much harder to. These are deliberately quiet so they can stay visible
 *  permanently rather than being dismissed and forgotten.
 *
 *  Section 7.3(e) of the Terms forbids removing them.
 */

const NOTICES = {
  /** Reports, including the NFA/DA/loan "compliance" outputs. */
  report: t(
    "Internal management report generated from your own entries. It is not certified, audited or accredited, is not a registered book of account, and no government agency has reviewed it. Check every figure before you rely on it or file anything based on it.",
  ),
  /** Anything the app calls an invoice, receipt or payment. */
  invoice: t(
    "Internal sales record. This is not a BIR-registered Official Receipt or Sales Invoice, and Oraiza is not a BIR-accredited invoicing or accounting system. Issue your BIR-compliant documents through your accredited means.",
  ),
  /** Weather forecasts and anything derived from them. */
  forecast: t(
    "Third-party forecast data. Forecasts can be wrong, stale or unavailable, and this is not agronomic advice. Check actual conditions before acting on it.",
  ),
  /** Employee records holding government identifiers. */
  employeeData: t(
    "These records contain sensitive personal information under the Data Privacy Act, including government identifier numbers. Your mill is the Personal Information Controller for them: collect only what you need, give your workers a privacy notice, and limit who can see this page.",
  ),
} as const;

type Props = {
  kind: keyof typeof NOTICES;
  className?: string;
  /** Link to the document that carries the full clause. */
  to?: string;
};

const DEFAULT_LINK: Record<keyof typeof NOTICES, string> = {
  report: "/legal/terms",
  invoice: "/legal/terms",
  forecast: "/legal/terms",
  // The notice tells the mill to give its workers a privacy notice; this is
  // the one it can adapt, and it points back to sections 6.2 and 9.3 of the Terms.
  employeeData: "/legal/employee-notice",
};

export default function LegalNotice({ kind, className = "", to }: Props) {
  return (
    <p
      className={`flex items-start gap-2 text-[11px] leading-snug text-muted ${className}`}
      data-testid={`legal-notice-${kind}`}
    >
      <Info size={13} className="mt-0.5 shrink-0 opacity-70" aria-hidden="true" />
      <span>
        {NOTICES[kind]}{" "}
        <Link to={to ?? DEFAULT_LINK[kind]} className="link">
          {t("Details")}
        </Link>
      </span>
    </p>
  );
}
