// OWNER: B
// Reads usage, contexts and actuals from fixtures. Works offline with no keys.
// Order: data/fixtures/*.json (generated, 9 months) → data/fixtures/fake/*.json (hand-written, October only).
// Override the folder with FIXTURES_DIR. The Anthropic Admin API is a bonus and plugs in at loadUsageLive().

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Actual, Month, TeamContext, UsageDay } from "../shared/types.js";

const ROOT = process.env.FIXTURES_DIR ?? join(process.cwd(), "data", "fixtures");
const cache = new Map<string, unknown>();

function readFixture<T>(name: string): T {
  if (cache.has(name)) return cache.get(name) as T;
  for (const dir of [ROOT, join(ROOT, "fake")]) {
    const path = join(dir, name);
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf8")) as T;
      cache.set(name, data);
      return data;
    }
  }
  throw new Error(`fixture not found: ${name} (looked in ${ROOT} and ${join(ROOT, "fake")}). Run npm run gen.`);
}

/** Drop cached fixtures, e.g. after npm run gen or a demo reset. */
export function clearFixtureCache(): void {
  cache.clear();
}

/**
 * Usage rows for one month, all teams and sources (anthropic + openai), sorted by date.
 * With asOf ("2026-10-25"), only days on or before asOf. Without asOf, the whole month.
 */
export function loadUsage(month: Month, asOf?: string): UsageDay[] {
  return readFixture<UsageDay[]>("usage.json")
    .filter((u) => u.date.startsWith(month) && (asOf === undefined || u.date <= asOf))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Usage across several months, e.g. trailing history for the no-reply fallback or bias. */
export function loadUsageRange(fromMonth: Month, toMonth: Month): UsageDay[] {
  return readFixture<UsageDay[]>("usage.json")
    .filter((u) => u.date.slice(0, 7) >= fromMonth && u.date.slice(0, 7) <= toMonth)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** What each lead "said" for a month. A team can be missing (no record at all). */
export function loadContexts(month: Month): TeamContext[] {
  return readFixture<TeamContext[]>("contexts.json").filter((c) => c.month === month);
}

/** Actual billed cost per team; omit month for every month (History page). */
export function loadActuals(month?: Month): Actual[] {
  return readFixture<Actual[]>("actuals.json").filter((a) => month === undefined || a.month === month);
}
