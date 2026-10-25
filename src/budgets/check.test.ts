// OWNER: C
import { describe, expect, it } from 'vitest';
import type { Policies } from '../shared/api';
import type { Estimate, Team, UsageDay } from '../shared/types';
import { checkBudgets, statusOf } from './check';

const est = (team: Team, estimate: number, actualToDate: number): Estimate => ({
  team, month: '2026-10', asOf: '2026-10-25', method: 'trueup', estimate, actualToDate, confidence: 'medium', basis: 'b',
});
const day = (date: string, team: Team, model: string, costUsd: number): UsageDay => ({
  date, team, model, costUsd, inputTokens: 1, outputTokens: 1, source: 'anthropic',
});
const policies: Policies = { warnAt: 0.9, teamBudgets: { support: 8500, search: 6000, platform: 3200 }, modelCaps: [{ model: 'claude-opus', capUsd: 1300 }] };

describe('statusOf', () => {
  it('is ok below warnAt, warn from warnAt up to the limit, over above it', () => {
    expect(statusOf(5000, 6000, 0.9)).toBe('ok');
    expect(statusOf(5400, 6000, 0.9)).toBe('warn');
    expect(statusOf(6000, 6000, 0.9)).toBe('warn');
    expect(statusOf(6000.01, 6000, 0.9)).toBe('over');
  });
});

describe('checkBudgets', () => {
  const estimates = [est('support', 10040, 6120), est('search', 5580, 4500), est('platform', 2790, 2250), est('growth', 5550, 3750)];
  // Platform: last 7 days $90/day, half on Opus; 1,000 of Opus spent this month before that.
  const usage = [
    day('2026-10-05', 'platform', 'claude-opus', 1000),
    ...Array.from({ length: 7 }, (_, i) => day(`2026-10-${19 + i}`, 'platform', 'claude-opus', 45)),
    ...Array.from({ length: 7 }, (_, i) => day(`2026-10-${19 + i}`, 'platform', 'claude-haiku', 45)),
    day('2026-09-30', 'platform', 'claude-opus', 9999),
  ];
  const r = checkBudgets(policies, estimates, usage, '2026-10', '2026-10-25');

  it('checks each budgeted team against its trueup estimate', () => {
    expect(r.teams.map((t) => [t.team, t.status])).toEqual([['support', 'over'], ['search', 'warn'], ['platform', 'ok']]);
    expect(r.teams[0]).toMatchObject({ budgetUsd: 8500, projectedUsd: 10040, headroomUsd: -1540, pctOfBudget: 1.18 });
  });

  it('projects a model cap from month-to-date cost plus each team’s remaining spend on that model', () => {
    // To date: 1000 + 7×45 = 1315. Remaining for platform: (2790 − 2250) × 50% = 270. Projected 1585 > 1300.
    expect(r.models).toEqual([{ model: 'claude-opus', capUsd: 1300, actualToDateUsd: 1315, projectedUsd: 1585, pctOfCap: 1.22, status: 'over' }]);
  });

  it('writes plain-English alerts for every warning and breach', () => {
    expect(r.alerts).toEqual([
      'support is projected at $10,040, $1,540 over its $8,500 budget',
      'search is at 93% of its $6,000 budget',
      'claude-opus is projected at $1,585 against a $1,300 company cap',
    ]);
  });
});
