// OWNER: C
import { describe, expect, it } from 'vitest';
import type { HistoryRow } from '../shared/api';
import { computeHistory, historyRow } from './history';

const row = (month: string, est: { lastmonth?: number; runrate?: number; trueup?: number }, actual = 200): HistoryRow =>
  historyRow(month, 'support', actual, est);

describe('historyRow', () => {
  it('fills errorPct = (estimate - actual) / actual rounded to 4 places', () => {
    const r = historyRow('2026-09', 'growth', 300, { runrate: 400, trueup: 290 });
    expect(r.errorPct).toEqual({ runrate: 0.3333, trueup: -0.0333 });
    expect(r).toMatchObject({ month: '2026-09', team: 'growth', actual: 300, estimates: { runrate: 400, trueup: 290 } });
  });

  it('counts any accrual against a zero bill as 100% over, like variancePct', () => {
    expect(historyRow('2026-09', 'growth', 0, { runrate: 50, trueup: 0 }).errorPct).toEqual({ runrate: 1, trueup: 0 });
  });
});

describe('computeHistory', () => {
  const bias = { support: 0.05, search: 0, growth: 0.3, platform: -0.02 };
  const rows = [
    row('2026-09', { lastmonth: 100, runrate: 180, trueup: 210 }),
    row('2026-08', { lastmonth: 300, runrate: 220, trueup: 190 }),
  ];
  const report = computeHistory(rows, bias);

  it('computes mean absolute error per method in fixed order', () => {
    expect(report.byMethod.map((m) => m.method)).toEqual(['lastmonth', 'runrate', 'trueup']);
    expect(report.byMethod[0]).toEqual({ method: 'lastmonth', maeUsd: 100, maePct: 0.5, n: 2 });
    expect(report.byMethod[1]).toEqual({ method: 'runrate', maeUsd: 20, maePct: 0.1, n: 2 });
    expect(report.byMethod[2]).toEqual({ method: 'trueup', maeUsd: 10, maePct: 0.05, n: 2 });
  });

  it('lists months unique and sorted, passes rows and bias through untouched', () => {
    const dup = computeHistory([...rows, historyRow('2026-09', 'search', 100, { trueup: 100 })], bias);
    expect(dup.months).toEqual(['2026-08', '2026-09']);
    expect(report.rows).toBe(rows);
    expect(report.biasByTeam).toEqual(bias);
  });

  it('skips methods missing from a row', () => {
    const r = computeHistory([row('2026-09', { trueup: 210 }), row('2026-08', { lastmonth: 300, trueup: 190 })], bias);
    expect(r.byMethod[0]).toEqual({ method: 'lastmonth', maeUsd: 100, maePct: 0.5, n: 1 });
    expect(r.byMethod[1]).toEqual({ method: 'runrate', maeUsd: 0, maePct: 0, n: 0 });
    expect(r.byMethod[2].n).toBe(2);
  });

  it('skips actual === 0 rows for the percentage only', () => {
    const r = computeHistory([row('2026-09', { trueup: 50 }, 0), row('2026-08', { trueup: 150 }, 100)], bias);
    expect(r.byMethod[2]).toEqual({ method: 'trueup', maeUsd: 50, maePct: 0.5, n: 2 });
  });

  it('handles empty input', () => {
    const empty = computeHistory([], bias);
    expect(empty.byMethod[0]).toEqual({ method: 'lastmonth', maeUsd: 0, maePct: 0, n: 0 });
    expect(empty.months).toEqual([]);
  });
});
