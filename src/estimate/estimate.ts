// OWNER: A
// estimateAll: every team × every method for a month, plus bias from backtesting prior months.
import { existsSync, readFileSync } from "node:fs";
import type { Actual, Estimate, Month, Team, TeamContext, UsageDay } from "../shared/types.js";
import { biasSuggestionPct } from "./bias.js";
import { daysInMonth, monthOf } from "./dates.js";
import { lastMonth, runRate, trueUp } from "./methods.js";

// TODO: use the team list from src/shared/config.ts once the skeleton lands.
const TEAMS: Team[] = ["support", "search", "growth", "platform"];

export type EstimateSources = {
  usage: () => UsageDay[];
  contexts: () => TeamContext[];
  actuals: () => Actual[];
};

type Data = { usage: UsageDay[]; contexts: TeamContext[]; actuals: Actual[] };

/** Three estimates per team for asOf's month. Uses only data known by asOf. */
export function estimateMonth(data: Data, asOf: string): Estimate[] {
  const month = monthOf(asOf);
  const usage = data.usage.filter((u) => u.date <= asOf);
  const history = data.actuals.filter((a) => a.month < month);
  return TEAMS.flatMap((team) => {
    // Latest context wins if a lead replied more than once.
    const context = data.contexts.filter((c) => c.team === team && c.month === month).at(-1);
    return [lastMonth(team, usage, asOf, history), runRate(team, usage, asOf), trueUp(team, usage, context, asOf, history)];
  });
}

/** Re-runs the estimates for every prior month with actuals, at the same day of month as asOf. */
export function backtest(data: Data, asOf: string): Estimate[] {
  const month = monthOf(asOf);
  const day = Number(asOf.slice(8, 10));
  const months = [...new Set(data.actuals.map((a) => a.month))].filter((m) => m < month).sort();
  return months.flatMap((m) => {
    const d = String(Math.min(day, daysInMonth(m))).padStart(2, "0");
    return estimateMonth(data, `${m}-${d}`);
  });
}

/** estimateMonth plus biasSuggestionPct on each TrueUp row. */
export function estimateFrom(data: Data, asOf: string): Estimate[] {
  const past = backtest(data, asOf);
  return estimateMonth(data, asOf).map((e) => {
    if (e.method !== "trueup") return e;
    const bias = biasSuggestionPct(e.team, e.month, past, data.actuals);
    return bias === undefined ? e : { ...e, biasSuggestionPct: bias };
  });
}

function readJson<T>(path: URL): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

// Generated 9-month fixtures when present, otherwise the hand-written October fakes.
// TODO: once they exist, swap in Junghwan's loadUsage and Rohan's store for contexts and actuals.
const GENERATED = new URL("../../data/fixtures/", import.meta.url);
export const FAKE_FIXTURES = new URL("fake/", GENERATED);

export function fixtureSources(dir = existsSync(new URL("usage.json", GENERATED)) ? GENERATED : FAKE_FIXTURES): EstimateSources {
  return {
    usage: () => readJson(new URL("usage.json", dir)),
    contexts: () => readJson(new URL("contexts.json", dir)),
    actuals: () => readJson(new URL("actuals.json", dir)),
  };
}

/** All three methods for every team. The server can pass store-backed sources. */
export function estimateAll(month: Month, asOf: string, sources: EstimateSources = fixtureSources()): Estimate[] {
  if (monthOf(asOf) !== month) throw new Error(`asOf ${asOf} is not in ${month}`);
  return estimateFrom({ usage: sources.usage(), contexts: sources.contexts(), actuals: sources.actuals() }, asOf);
}
