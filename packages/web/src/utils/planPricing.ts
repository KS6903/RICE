/** Two months free: a year at 10x the monthly price. */
export const TWO_MONTHS_FREE = 16.6667;

/** A year of a plan: 12 months less the annual discount, to the nearest peso.
 *  The server works it out the same way when a plan is saved; this is the preview. */
export function annualPrice(monthly: number, discountPercent: number): number {
  return Math.round((monthly * 12 * (100 - discountPercent)) / 100);
}
