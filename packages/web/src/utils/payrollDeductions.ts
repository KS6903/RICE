// What a month's pay comes to after the government takes its share: SSS,
// PhilHealth and Pag-IBIG contributions, then BIR withholding tax on what is
// left. Rates in force for 2026 (none changed since 2025):
//
// - SSS: Circular 2024-006, from January 2025. 15% of the monthly salary
//   credit (MSC): 5% employee, 10% employer, plus the employer's EC of ₱10
//   (MSC below ₱15,000) or ₱30. The MSC is pay rounded to the nearest ₱500,
//   from ₱5,000 to ₱35,000; the part above ₱20,000 goes to the MPF (WISP).
// - PhilHealth: RA 11223, 5% of basic monthly pay from ₱10,000 to ₱100,000,
//   split evenly.
// - Pag-IBIG: HDMF Circular 460, from February 2024. 2% each on pay up to
//   ₱10,000; the employee pays 1% when pay is ₱1,500 or less.
// - BIR: RR 11-2018 Annex E (TRAIN), from January 2023, on pay less the three
//   employee contributions above.

const SSS_MSC_MIN = 5000;
const SSS_MSC_MAX = 35000;
const SSS_MSC_STEP = 500;
const SSS_EMPLOYEE_RATE = 0.05;
const SSS_EMPLOYER_RATE = 0.1;
const SSS_EC_HIGHER_FROM = 15000;

const PHILHEALTH_RATE = 0.05;
const PHILHEALTH_FLOOR = 10000;
const PHILHEALTH_CEILING = 100000;

const PAGIBIG_MAX_FUND_SALARY = 10000;
const PAGIBIG_LOW_PAY = 1500;

/** BIR monthly table: over `from`, pay `base` plus `rate` of the excess. */
const BIR_MONTHLY: { from: number; base: number; rate: number }[] = [
  { from: 666667, base: 183541.8, rate: 0.35 },
  { from: 166667, base: 33541.8, rate: 0.3 },
  { from: 66667, base: 8541.8, rate: 0.25 },
  { from: 33333, base: 1875, rate: 0.2 },
  { from: 20833, base: 0, rate: 0.15 },
];

export interface Share {
  employee: number;
  employer: number;
}

export interface MonthlyPayslip {
  gross: number;
  /** The SSS monthly salary credit the contribution is worked out on. */
  sssCredit: number;
  /** Employer share includes the EC. */
  sss: Share;
  philhealth: Share;
  pagibig: Share;
  /** Gross less the employee's three contributions. */
  taxable: number;
  withholdingTax: number;
  /** Everything taken from the employee's pay. */
  totalDeductions: number;
  net: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The SSS monthly salary credit for a month's pay. */
export function sssCredit(gross: number): number {
  const rounded = Math.floor((gross + SSS_MSC_STEP / 2) / SSS_MSC_STEP) * SSS_MSC_STEP;
  return Math.min(SSS_MSC_MAX, Math.max(SSS_MSC_MIN, rounded));
}

/** BIR withholding tax on a month's taxable pay. */
export function withholdingTax(taxable: number): number {
  const bracket = BIR_MONTHLY.find((b) => taxable > b.from);
  return bracket ? cents(bracket.base + (taxable - bracket.from) * bracket.rate) : 0;
}

/** A month's gross pay broken down into deductions and net, or null without one. */
export function monthlyPayslip(gross: number): MonthlyPayslip | null {
  if (!Number.isFinite(gross) || gross <= 0) return null;

  const credit = sssCredit(gross);
  const sss = {
    employee: cents(credit * SSS_EMPLOYEE_RATE),
    employer: cents(credit * SSS_EMPLOYER_RATE + (credit < SSS_EC_HIGHER_FROM ? 10 : 30)),
  };

  const premium = cents(
    Math.min(PHILHEALTH_CEILING, Math.max(PHILHEALTH_FLOOR, gross)) * PHILHEALTH_RATE,
  );
  const philhealth = { employee: cents(premium / 2), employer: cents(premium / 2) };

  const fundSalary = Math.min(PAGIBIG_MAX_FUND_SALARY, gross);
  const pagibig = {
    employee: cents(fundSalary * (gross <= PAGIBIG_LOW_PAY ? 0.01 : 0.02)),
    employer: cents(fundSalary * 0.02),
  };

  const contributions = cents(sss.employee + philhealth.employee + pagibig.employee);
  const taxable = cents(Math.max(0, gross - contributions));
  const tax = withholdingTax(taxable);
  const totalDeductions = cents(contributions + tax);

  return {
    gross: cents(gross),
    sssCredit: credit,
    sss,
    philhealth,
    pagibig,
    taxable,
    withholdingTax: tax,
    totalDeductions,
    net: cents(gross - totalDeductions),
  };
}
