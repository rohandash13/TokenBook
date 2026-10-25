// OWNER: A
// Per-team accrual bias. A suggestion shown next to the estimate; never applied automatically.
import type { Actual, Estimate, Month, Team } from "../shared/types.js";

const BIAS_MONTHS = 3;

/**
 * mean((estimate − actual) / actual) of the TrueUp estimate over the last 3 months before
 * `month` that have an actual. A fraction like every other *Pct field (0.083 = 8.3%).
 * Positive means the team usually over-accrues; the UI suggests lowering estimates.
 */
export function biasSuggestionPct(team: Team, month: Month, past: Estimate[], actuals: Actual[]): number | undefined {
  const errors = past
    .filter((e) => e.team === team && e.method === "trueup" && e.month < month)
    .sort((a, b) => b.month.localeCompare(a.month))
    .flatMap((e) => {
      const a = actuals.find((x) => x.team === team && x.month === e.month);
      return a && a.actualUsd > 0 ? [(e.estimate - a.actualUsd) / a.actualUsd] : [];
    })
    .slice(0, BIAS_MONTHS);
  if (!errors.length) return undefined;
  const mean = errors.reduce((s, x) => s + x, 0) / errors.length;
  return Math.round(mean * 10000) / 10000 || 0;
}
