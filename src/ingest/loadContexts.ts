// OWNER: B (Junghwan) — seed contexts for every month (what leads said). Stub reads the fakes.
import { readFileSync } from 'node:fs';
import type { TeamContext } from '../shared/types';

export function loadContexts(): TeamContext[] {
  return JSON.parse(readFileSync(new URL('../../data/fixtures/fake/contexts.json', import.meta.url), 'utf8')) as TeamContext[];
}
