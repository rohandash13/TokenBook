// OWNER: C
import type { HistoryReport, HistoryRow, MethodError } from '../shared/api';
import type { Method, Month, Team } from '../shared/types';

const METHODS: Method[] = ['lastmonth', 'runrate', 'trueup'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round4 = (x: number) => Math.round(x * 10000) / 10000;

// Builds a row with errorPct = (estimate - actual) / actual, rounded to 4 places (0 when actual is 0).
export function historyRow(
  month: Month,
  team: Team,
  actual: number,
  estimates: Partial<Record<Method, number>>,
): HistoryRow {
  const errorPct: Partial<Record<Method, number>> = {};
  for (const m of METHODS) {
    const e = estimates[m];
    if (e !== undefined) errorPct[m] = actual === 0 ? 0 : round4((e - actual) / actual);
  }
  return { month, team, actual, estimates, errorPct };
}

export function computeHistory(rows: HistoryRow[], biasByTeam: Partial<Record<Team, number>>): HistoryReport {
  const byMethod: MethodError[] = METHODS.map((method) => {
    const withMethod = rows.filter((r) => r.estimates[method] !== undefined);
    const err = (r: HistoryRow) => Math.abs(r.estimates[method]! - r.actual);
    const maeUsd = mean(withMethod.map(err));
    const maePct = mean(withMethod.filter((r) => r.actual !== 0).map((r) => err(r) / r.actual));
    return { method, maeUsd: Math.round(maeUsd * 100) / 100, maePct: round4(maePct), n: withMethod.length };
  });
  return { months: [...new Set(rows.map((r) => r.month))].sort(), rows, byMethod, biasByTeam };
}
