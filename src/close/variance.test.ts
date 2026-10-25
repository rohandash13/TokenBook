// OWNER: C
import { describe, expect, it } from 'vitest';
import type { Actual, Estimate, Team } from '../shared/types';
import { buildAccrual } from './journal';
import { computeVariances, needsMemo } from './variance';

describe('needsMemo (both >10% and >$500, strictly)', () => {
  it.each([
    [500, 0.1, false],
    [501, 0.1002, true],
    [450, 0.1125, false],
    [900, 0.09, false],
    [-2000, -0.2, true],
    [-500, -0.5, false],
  ])('variance $%d at %d -> %s', (usd, pct, expected) => {
    expect(needsMemo(usd, pct)).toBe(expected);
  });
});

const est = (team: Team, estimate: number): Estimate => ({
  team, month: '2026-10', asOf: '2026-10-25', method: 'trueup', estimate, actualToDate: 0,
  basis: 'b', confidence: 'high',
});
const act = (team: Team, actualUsd: number): Actual => ({ team, month: '2026-10', actualUsd });

describe('computeVariances', () => {
  const accrual = buildAccrual('2026-10', [est('support', 10040), est('growth', 9000), est('search', 5500)]);

  it('compares actuals with the booked accrual, team by team, in team order', () => {
    const vs = computeVariances(accrual, [act('growth', 5600), act('support', 10210), act('search', 5000), act('platform', 300)]);
    expect(vs.map((v) => v.team)).toEqual(['support', 'search', 'growth', 'platform']);

    const growth = vs.find((v) => v.team === 'growth')!;
    expect(growth).toMatchObject({ estimate: 9000, actual: 5600, varianceUsd: 3400, needsMemo: true });
    // (estimate − actual) / actual: positive = over-accrued, same convention as History and bias
    expect(growth.variancePct).toBeCloseTo(0.6071, 4);

    expect(vs.find((v) => v.team === 'support')!.needsMemo).toBe(false);
    expect(vs.find((v) => v.team === 'search')!).toMatchObject({ varianceUsd: 500, variancePct: 0.1, needsMemo: false }); // exactly on both edges
  });

  it('treats an unaccrued team as 100% under-accrued', () => {
    const platform = computeVariances(accrual, [act('platform', 800)]).find((v) => v.team === 'platform')!;
    expect(platform).toMatchObject({ estimate: 0, actual: 800, varianceUsd: -800, variancePct: -1, needsMemo: true });
  });

  it('treats a missing actual as zero (100% over-accrued)', () => {
    const support = computeVariances(accrual, []).find((v) => v.team === 'support')!;
    expect(support).toMatchObject({ actual: 0, varianceUsd: 10040, variancePct: 1, needsMemo: true });
  });
});
