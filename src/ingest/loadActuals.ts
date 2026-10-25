// OWNER: B (Junghwan) — stub reading the hand-written fakes.
import { readFileSync } from 'node:fs';
import type { Actual, Month } from '../shared/types';

export function loadActuals(month: Month): Actual[] {
  const all = JSON.parse(readFileSync(new URL('../../data/fixtures/fake/actuals.json', import.meta.url), 'utf8')) as Actual[];
  return all.filter((a) => a.month === month);
}
