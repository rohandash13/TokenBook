// OWNER: D
// The asOf date to ask the server for when estimating a given month.
import { DEMO, lastDayOfMonth } from "../shared/config.js";
import type { Month } from "../shared/types.js";

/** Today if it falls in `month`; the month's last day if it is past; its first day if future. The demo month uses DEMO.asOf. */
export function asOfForMonth(month: Month, today: string): string {
  if (month === DEMO.month) return DEMO.asOf;
  if (today.slice(0, 7) === month) return today;
  if (month < today.slice(0, 7)) return lastDayOfMonth(month);
  return `${month}-01`;
}
