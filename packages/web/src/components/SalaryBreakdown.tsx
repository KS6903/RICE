import { monthlyPayslip } from "../utils/payrollDeductions";

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
      agency: "SSS",
      detail: `5% of the ${money(slip.sssCredit)} salary credit`,
      employee: slip.sss.employee,
      employer: slip.sss.employer,
    },
    {
      agency: "PhilHealth",
      detail: "2.5% of basic pay",
      employee: slip.philhealth.employee,
      employer: slip.philhealth.employer,
    },
    {
      agency: "Pag-IBIG",
      detail: "2% of pay up to ₱10,000",
      employee: slip.pagibig.employee,
      employer: slip.pagibig.employer,
    },
    {
      agency: "BIR withholding tax",
      detail: `On ${money(slip.taxable)} taxable pay`,
      employee: slip.withholdingTax,
      employer: null,
    },
  ];

  return (
    <div
      className={`rounded-xl border border-soft p-4 ${className}`}
      data-testid="salary-breakdown"
    >
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-muted">
            <th className="pb-2 text-left font-medium">Monthly pay</th>
            <th className="pb-2 text-right font-medium">Employee</th>
            <th className="pb-2 pl-3 text-right font-medium">Employer adds</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-soft">
            <td className="py-1.5 font-semibold text-primary">Gross pay</td>
            <td className="py-1.5 text-right font-semibold text-primary">{money(slip.gross)}</td>
            <td />
          </tr>
          {rows.map((r) => (
            <tr key={r.agency}>
              <td className="py-1.5 pr-2">
                <span className="text-primary">{r.agency}</span>
                <span className="block text-[11px] text-muted">{r.detail}</span>
              </td>
              <td
                className={`py-1.5 text-right ${
                  r.employee > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted"
                }`}
              >
                {r.employee > 0 ? `−${money(r.employee)}` : money(0)}
              </td>
              <td className="py-1.5 pl-3 text-right text-secondary">
                {r.employer === null ? "—" : money(r.employer)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-soft">
            <td className="py-1.5 text-secondary">Total deductions</td>
            <td className="py-1.5 text-right text-rose-600 dark:text-rose-400">
              −{money(slip.totalDeductions)}
            </td>
            <td className="py-1.5 pl-3 text-right text-secondary">
              {money(slip.sss.employer + slip.philhealth.employer + slip.pagibig.employer)}
            </td>
          </tr>
          <tr className="border-t border-soft">
            <td className="pt-2 font-bold text-primary">Net pay</td>
            <td className="pt-2 text-right text-base font-bold text-emerald-700 dark:text-emerald-400">
              {money(slip.net)}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-[11px] leading-snug text-muted">
        2026 rates: SSS Circular 2024-006, PhilHealth 5% (RA 11223), Pag-IBIG Circular 460 and the
        BIR withholding table (TRAIN). The employer column includes SSS EC. Overtime, holiday pay,
        absences and loans are not counted.
      </p>
    </div>
  );
}
