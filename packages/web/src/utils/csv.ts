const FORMULA_PREFIX = /^\s*[=+\-@]/;
const CONTROL_PREFIX = /^[\t\r\n]/;

/** Encode one CSV cell while preventing spreadsheet formula execution. */
export function encodeCsvCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  let text = String(value);
  if (FORMULA_PREFIX.test(text) || CONTROL_PREFIX.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function encodeCsvRow(values: readonly unknown[]): string {
  return values.map(encodeCsvCell).join(",");
}
