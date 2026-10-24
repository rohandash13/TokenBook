// OWNER: C
import { describe, expect, it } from 'vitest';
import type { Actual, Estimate, Team } from '../shared/types';
import { buildAccrual } from './journal';
import { closeActuals } from './trueup';

const est = (team: Team, estimate: number): Estimate => ({
  team, month: '2026-10', asOf: '2026-10-25', method: 'trueup', estimate, actualToDate: 0, basis: 'b', confidence: 'high',
});
const act = (team: Team, actualUsd: number): Actual => ({ team, month: '2026-10', actualUsd });

describe('closeActuals', () => {
  const accrual = buildAccrual('2026-10', [est('support', 10040), est('growth', 9000)], [], 'Dana');
  const result = closeActuals(accrual, [act('support', 10210), act('growth', 5600)], []);

  it('builds approved reversal and actual entries carrying the accrual approver', () => {
    expect(result.reversal).toMatchObject({ id: 'JE-2026-10-REVERSAL', kind: 'reversal', status: 'approved', approvedBy: 'Dana' });
    expect(result.actual).toMatchObject({ id: 'JE-2026-10-ACTUAL', kind: 'actual', status: 'approved', approvedBy: 'Dana' });
  });

  it('flags Growth and produces a memo input for it only', () => {
    expect(result.variances.find((v) => v.team === 'growth')!.needsMemo).toBe(true);
    expect(result.memoInputs.map((m) => m.team)).toEqual(['growth']);
  });
});
