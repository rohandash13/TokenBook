// OWNER: A (Antoine) — stub returning fake numbers of the right shape.
import type { Estimate, Method, Month, Team } from '../shared/types';
import { TEAMS } from '../shared/config';

const FAKE: Record<Team, Record<Method, number>> = {
  support:  { lastmonth: 7000, runrate: 7590, trueup: 7590 },
  search:   { lastmonth: 3100, runrate: 3200, trueup: 3200 },
  growth:   { lastmonth: 4800, runrate: 6100, trueup: 9000 },
  platform: { lastmonth: 2300, runrate: 2400, trueup: 2400 },
};

export function estimateAll(month: Month, asOf: string): Estimate[] {
  return TEAMS.flatMap((team) =>
    (['lastmonth', 'runrate', 'trueup'] as const).map((method) => ({
      team, month, asOf, method,
      actualToDate: Math.round(FAKE[team].runrate * 0.8),
      estimate: FAKE[team][method],
      confidence: team === 'support' ? 'low' : 'high',
      basis: `STUB ${method} for ${team}`,
    })),
  );
}
