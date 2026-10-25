// OWNER: C — deterministic fake Deps for route tests.
import { TEAMS } from '../shared/config';
import type { Actual, Estimate, Method, Team, TeamContext } from '../shared/types';
import type { Deps } from './deps';
import { listContexts } from './store';

const ACTUALS: Record<Team, number> = { support: 10210, search: 3150, growth: 5600, platform: 2450 };

// Support jumps 7590 -> 10040 once a support context with events exists (the demo moment).
export function fakeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    estimateAll(month, asOf) {
      const boosted = listContexts(month).some((c) => c.team === 'support' && c.events.length > 0);
      const trueup: Record<Team, number> = { support: boosted ? 10040 : 7590, search: 3200, growth: 9000, platform: 2400 };
      return TEAMS.flatMap((team) =>
        (['lastmonth', 'runrate', 'trueup'] as Method[]).map((method): Estimate => ({
          team, month, asOf, method,
          estimate: method === 'trueup' ? trueup[team] : trueup[team] * 0.9,
          actualToDate: trueup[team] * 0.8,
          confidence: team === 'support' && !boosted ? 'low' : 'high',
          basis: `${team} ${method} basis`,
        })),
      );
    },
    loadUsage: () => [],
    loadActuals: (month): Actual[] => TEAMS.map((team) => ({ team, month, actualUsd: ACTUALS[team] })),
    loadContexts: (): TeamContext[] => [
      { team: 'growth', month: '2026-10', replied: true, leadName: 'Maya', quote: 'Big campaign mid-October',
        events: [{ date: '2026-10-15', multiplier: 2, note: 'campaign' }], repliedAt: '2026-10-24T00:00:00Z' },
      // The live-demo team: reset must filter this one out (it has replied).
      { team: 'support', month: '2026-10', replied: true, leadName: 'Priya', quote: 'should be cleared by reset',
        events: [], repliedAt: '2026-10-24T00:00:00Z' },
    ],
    async draftMemo(input) {
      return { ...input, text: `LLM memo for ${input.team}`, createdAt: new Date().toISOString() };
    },
    async sendCheckIn() {},
    async refreshSignals() { return []; },
    async notifyVariance() { return []; },
    async readSignals() { return []; },
    ...overrides,
  };
}
