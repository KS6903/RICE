import { monthlyPayslip } from "../utils/payrollDeductions";
import { t } from "../i18n";

const money = (n: number) =>
  `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A month's gross pay, what each government agency takes from it (and what
 *  the mill adds on top), and the net the employee takes home. Nothing without
 *  a monthly figure. */
export default function SalaryBreakdown({
  monthly,
  className = "",
}: {
  monthly: string | number | null | undefined;
  className?: string;
}) {
  const slip = monthlyPayslip(Number(monthly ?? NaN));
  if (!slip) return null;

  const rows: { agency: string; detail: string; employee: number; employer: number | null }[] = [
    {
      agency: t("SSS"),
      detail: t("5% of the {{sssCredit}} salary credit", { sssCredit: money(slip.sssCredit) }),
      employee: slip.sss.employee,
      employer: slip.sss.employer,
    },
    {
      agency: "PhilHealth",
      detail: t("2.5% of basic pay"),
      employee: slip.philhealth.employee,
      employer: slip.philhealth.employer,
    },
    {
      agency: t("Pag-IBIG"),
      detail: t("2% of pay up to ₱10,000"),
      employee: slip.pagibig.employee,
      employer: slip.pagibig.employer,
    },
    {
      agency: t("BIR withholding tax"),
      detail: t("On {{taxable}} taxable pay", { taxable: money(slip.taxable) }),
      employee: slip.withholdingTax,
      employer: null,
    },
  ];

  return (
    <div
      className={`rounded-xl border border-soft p-2.5 sm:p-4 ${className}`}
      data-testid="salary-breakdown"
    >
      <div
        className="overflow-auto overscroll-x-contain"
        role="region"
        aria-label={t("Monthly salary breakdown")}
        tabIndex={0}
      >
        <table className="w-full break-normal text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted">
              <th className="pb-2 text-left font-medium">{t("Monthly pay")}</th>
              <th className="pb-2 text-right font-medium">{t("Employee")}</th>
              <th className="pb-2 pl-3 text-right font-medium">{t("Employer adds")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-soft">
              <td className="py-1.5 font-semibold text-primary">{t("Gross pay")}</td>
              <td className="py-1.5 text-right whitespace-nowrap font-semibold text-primary">
                {money(slip.gross)}
              </td>
              <td />
            </tr>
            {rows.map((r) => (
              <tr key={r.agency}>
                <td className="py-1.5 pr-2">
                  <span className="text-primary">{r.agency}</span>
                  <span className="block text-[11px] text-muted">{r.detail}</span>
                </td>
                <td
                  className={`py-1.5 text-right whitespace-nowrap ${
                    r.employee > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted"
                  }`}
                >
                  {r.employee > 0 ? `−${money(r.employee)}` : money(0)}
                </td>
                <td className="py-1.5 pl-3 text-right whitespace-nowrap text-secondary">
                  {r.employer === null ? "—" : money(r.employer)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-soft">
              <td className="py-1.5 text-secondary">{t("Total deductions")}</td>
              <td className="py-1.5 text-right whitespace-nowrap text-rose-600 dark:text-rose-400">
                −{money(slip.totalDeductions)}
              </td>
              <td className="py-1.5 pl-3 text-right whitespace-nowrap text-secondary">
                {money(slip.sss.employer + slip.philhealth.employer + slip.pagibig.employer)}
              </td>
            </tr>
            <tr className="border-t border-soft">
              <td className="pt-2 font-bold text-primary">{t("Net pay")}</td>
              <td className="pt-2 text-right whitespace-nowrap text-base font-bold text-emerald-700 dark:text-emerald-400">
                {money(slip.net)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] leading-snug text-muted">
        {t(
          "2026 rates: SSS Circular 2024-006, PhilHealth 5% (RA 11223), Pag-IBIG Circular 460 and the BIR withholding table (TRAIN). The employer column includes SSS EC. Overtime, holiday pay, absences and loans are not counted.",
        )}
      </p>
    </div>
  );
}
