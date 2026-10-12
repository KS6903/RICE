// How an employee's rate turns into a monthly figure. The server works the same
// figure out when it saves (backend/app/services/employee_service.py:
// monthly_from_rate); this is only so the form can show it before saving.

/** A mill runs a six-day week: 26 working days a month, 8 hours a day. */
const WORK_DAYS_PER_MONTH = 26;
const HOURS_PER_DAY = 8;
const WEEKS_PER_MONTH = 52 / 12;
/** Kinsenas: paid on the 15th and the 30th. */
const BIWEEKLY_PAYS_PER_MONTH = 2;

/** Paid by output or by sales: no fixed monthly figure to work out. */
export function isVariablePay(employmentType: string): boolean {
  return employmentType === "piece_rate" || employmentType === "commission";
}

/** What one rate is paid for, by employment type. */
export function rateBasis(employmentType: string): string {
  switch (employmentType) {
    case "monthly":
      return "per month";
    case "biweekly":
      return "per pay, twice a month";
    case "weekly":
      return "per week";
    case "hourly":
      return "per hour";
    case "piece_rate":
      return "per piece or unit of work";
    case "commission":
      return "per sale or target met";
    default:
      return "per day";
  }
}

/** The monthly pay a rate comes to, or null with no rate or for pay by output. */
export function monthlyFromRate(employmentType: string, rate: number): number | null {
  if (!Number.isFinite(rate) || isVariablePay(employmentType)) return null;
  const factor =
    employmentType === "monthly"
      ? 1
      : employmentType === "biweekly"
        ? BIWEEKLY_PAYS_PER_MONTH
        : employmentType === "weekly"
          ? WEEKS_PER_MONTH
          : employmentType === "hourly"
            ? HOURS_PER_DAY * WORK_DAYS_PER_MONTH
            : WORK_DAYS_PER_MONTH;
  return Math.round(rate * factor * 100) / 100;
}

/**
 * The monthly figure a form shows and sends, as a string for its field. A rate
 * works it out. With no rate: blank if the employee had one before (it was
 * cleared), else what was typed or stored before rates drove it. Pure.
 */
export function monthlyForForm(
  form: { employment_type: string; daily_rate: string; monthly_salary: string },
  hadRate: boolean,
): string {
  if (form.daily_rate !== "") {
    const monthly = monthlyFromRate(form.employment_type, parseFloat(form.daily_rate));
    return monthly === null ? "" : String(monthly);
  }
  return hadRate ? "" : form.monthly_salary;
}
