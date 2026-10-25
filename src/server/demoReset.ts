// OWNER: C — wipes data/store and seeds fixture contexts. Also the `npm run demo:reset` CLI.
import { pathToFileURL } from 'node:url';
import { DEMO } from '../shared/config';
import { defaultRefreshDeps, refreshSignals, type RefreshResult } from '../signals/refresh';
import type { Month, TeamContext } from '../shared/types';
import { defaultDeps } from './deps';
import { resetStore } from './store';

type LoadContexts = () => TeamContext[] | Promise<TeamContext[]>;
type Refresh = (month: Month) => Promise<RefreshResult[]>;

const offlineRefresh: Refresh = (month) => refreshSignals(month, defaultRefreshDeps({ offline: true }));

// The live team's demo-month reply is withheld (that lead answers live during the demo), but a
// `replied: false` context is kept: it is the "no reply yet" state that drives low confidence.
export async function demoReset(
  load: LoadContexts = defaultDeps.loadContexts,
  refresh: Refresh = offlineRefresh,
): Promise<{ contexts: number; inferred: number }> {
  const seed = (await load()).filter((c) => !(c.month === DEMO.month && c.team === DEMO.liveTeam && c.replied));
  resetStore(seed);
  const results = await refresh(DEMO.month);
  return { contexts: seed.length, inferred: results.filter((r) => !r.skipped && r.events > 0).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  demoReset().then(
    ({ contexts, inferred }) =>
      console.log(`Demo reset: store cleared, ${contexts} contexts seeded, ${inferred} teams with inferred events.`),
    (err) => { console.error(err); process.exit(1); },
  );
}
