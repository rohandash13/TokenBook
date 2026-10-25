// OWNER: C — wipes data/store and seeds fixture contexts. Also the `npm run demo:reset` CLI.
import { pathToFileURL } from 'node:url';
import { DEMO, TEAMS } from '../shared/config';
import { clearSignalCache, defaultRefreshDeps, refreshSignals, type RefreshResult } from '../signals/refresh';
import type { Month, Team, TeamContext } from '../shared/types';
import { defaultDeps } from './deps';
import { seedIntegrations } from '../integrations/seed';
import { resetStore } from './store';

type LoadContexts = () => TeamContext[] | Promise<TeamContext[]>;
type Refresh = (month: Month, teams: readonly Team[]) => Promise<RefreshResult[]>;

const offlineRefresh: Refresh = (month, teams) => refreshSignals(month, defaultRefreshDeps({ offline: true }), teams);

// In the demo month, Support, Search and Platform start without a lead reply: TrueUp reads their Slack
// and GitHub instead (docs/plan-demo-world.md). Growth keeps Maya's stale "goes live Oct 26" reply, so
// the demo shows a lead's word overriding signals, and the variance memo when the campaign slips.
// A `replied: false` context is kept: it is the "no reply yet" state.
// The live team (Support) is left unscanned: it opens at the run-rate with low confidence, and the
// presenter clicks "Refresh signals" on stage to move it to the launch-driven estimate.
const SIGNAL_TEAMS: readonly Team[] = ['support', 'search', 'platform'];

export async function demoReset(
  load: LoadContexts = defaultDeps.loadContexts,
  refresh: Refresh = offlineRefresh,
): Promise<{ contexts: number; inferred: number; jiraIssues: number; priceSnapshots: number; marketSignals: number }> {
  clearSignalCache();
  const seed = (await load()).filter((c) => !(c.month === DEMO.month && SIGNAL_TEAMS.includes(c.team) && c.replied));
  resetStore(seed);
  const integrations = seedIntegrations();
  const results = await refresh(DEMO.month, TEAMS.filter((t) => t !== DEMO.liveTeam));
  return { contexts: seed.length, inferred: results.filter((r) => !r.skipped && r.events > 0).length, ...integrations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  demoReset().then(
    ({ contexts, inferred }) =>
      console.log(`Demo reset: store cleared, ${contexts} contexts seeded, ${inferred} teams with inferred events.`),
    (err) => { console.error(err); process.exit(1); },
  );
}
