// OWNER: A
// Period helpers for the estimate engine.
// TODO: switch to the helpers in src/shared/config.ts once Rohan's skeleton lands.
import type { Month } from "../shared/types.js";

export function monthOf(date: string): Month {
  return date.slice(0, 7);
}

export function daysInMonth(month: Month): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Days left in the month after `asOf` (asOf itself counts as done). */
export function daysRemaining(asOf: string): number {
  return daysInMonth(monthOf(asOf)) - Number(asOf.slice(8, 10));
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The dates after `asOf` through month end. */
export function remainingDates(asOf: string): string[] {
  return Array.from({ length: daysRemaining(asOf) }, (_, i) => addDays(asOf, i + 1));
}

export function prevMonth(month: Month, n = 1): Month {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

/** "2026-10-27" → "Oct 27" */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "2026-09" → "Sep" */
export function shortMonth(month: Month): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}
