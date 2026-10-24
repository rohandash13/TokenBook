// OWNER: C — wipes data/store and seeds fixture contexts. Also the `npm run demo:reset` CLI.
import { pathToFileURL } from 'node:url';
import { DEMO } from '../shared/config';
import type { TeamContext } from '../shared/types';
import { loadContexts } from '../ingest/loadContexts';
import { resetStore } from './store';

type LoadContexts = () => TeamContext[] | Promise<TeamContext[]>;

// The live team's demo-month reply is withheld: that lead answers live during the demo.
export async function demoReset(load: LoadContexts = loadContexts): Promise<{ contexts: number }> {
  const seed = (await load()).filter((c) => !(c.month === DEMO.month && c.team === DEMO.liveTeam));
  resetStore(seed);
  return { contexts: seed.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  demoReset().then(
    ({ contexts }) => console.log(`Demo reset: store cleared, ${contexts} contexts seeded.`),
    (err) => { console.error(err); process.exit(1); },
  );
}
