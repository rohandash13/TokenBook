// OWNER: C
import { MEMO_THRESHOLD, TEAMS } from '../shared/config';
import type { Actual, JournalEntry, Variance } from '../shared/types';
import { fromCents, toCents } from './money';

// Strict on both conditions; the dollar comparison is made in whole cents.
export function needsMemo(varianceUsd: number, variancePct: number): boolean {
  return Math.abs(variancePct) > MEMO_THRESHOLD.pct && Math.abs(toCents(varianceUsd)) > toCents(MEMO_THRESHOLD.usd);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computeVariances(accrual: JournalEntry, actuals: Actual[]): Variance[] {
  const forMonth = actuals.filter((a) => a.month === accrual.month);
  const teams = TEAMS.filter((t) => accrual.lines.some((l) => l.team === t) || forMonth.some((a) => a.team === t));
  return teams.map((team) => {
    const estimateCents = sum(accrual.lines.filter((l) => l.team === team).map((l) => toCents(l.debit)));
    const actualCents = sum(forMonth.filter((a) => a.team === team).map((a) => toCents(a.actualUsd)));
    const varianceCents = actualCents - estimateCents;
    const pct = estimateCents === 0 ? (actualCents === 0 ? 0 : 1) : varianceCents / estimateCents;
    return {
      team,
      month: accrual.month,
      estimate: fromCents(estimateCents),
      actual: fromCents(actualCents),
      varianceUsd: fromCents(varianceCents),
      variancePct: Math.round(pct * 10000) / 10000,
      needsMemo: needsMemo(fromCents(varianceCents), pct),
    };
  });
}
