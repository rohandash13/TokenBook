// OWNER: B
// Seeded, deterministic fixture generator: 9 months (2026-02 … 2026-10) of usage for Northwind Labs.
// Writes data/fixtures/{usage,contexts,actuals,events}.json. Run: npm run gen
//
// October is pinned to the hand-written fakes so every owner sees the same demo numbers:
//   support  $6,120 through Oct 25, $245/day Oct 19–25 → run-rate $7,590, with 3x from Oct 27 → $10,040
//   growth   lead says 2x from Oct 26, but the campaign slips to November → memo fires
// Support's Jul–Sep average is ~$245/day so the no-reply fallback also lands near $7,590.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Actual, Team, TeamContext, UsageDay } from "../shared/types.js";

const OUT_DIR = join(process.cwd(), "data", "fixtures");
const SEED = 20261024;
const MONTHS = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const AS_OF = "2026-10-25";

// ---------- seeded random ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const noise = (pct: number) => 1 + (rand() * 2 - 1) * pct;

// ---------- helpers ----------
const round2 = (n: number) => Math.round(n * 100) / 100;
const daysInMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
};
const dateOf = (m: string, d: number) => `${m}-${String(d).padStart(2, "0")}`;
const isWeekend = (date: string) => {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
};
const WEEKEND_FACTOR = 0.6;

// ---------- teams and models ----------
type ModelSpec = { model: string; share: number; source: "anthropic" | "openai"; usdPerMTok: number };
const MODELS: Record<Team, ModelSpec[]> = {
  support: [
    { model: "claude-sonnet", share: 0.75, source: "anthropic", usdPerMTok: 6 },
    { model: "claude-haiku", share: 0.25, source: "anthropic", usdPerMTok: 1.6 },
  ],
  search: [
    { model: "claude-sonnet", share: 0.6, source: "anthropic", usdPerMTok: 6 },
    { model: "gpt-4.1-mini", share: 0.4, source: "openai", usdPerMTok: 0.7 },
  ],
  growth: [
    { model: "claude-haiku", share: 0.7, source: "anthropic", usdPerMTok: 1.6 },
    { model: "claude-sonnet", share: 0.3, source: "anthropic", usdPerMTok: 6 },
  ],
  platform: [
    { model: "claude-opus", share: 0.5, source: "anthropic", usdPerMTok: 30 },
    { model: "claude-haiku", share: 0.3, source: "anthropic", usdPerMTok: 1.6 },
    { model: "gpt-4.1-mini", share: 0.2, source: "openai", usdPerMTok: 0.7 },
  ],
};
const TEAMS: Team[] = ["support", "search", "growth", "platform"];
const LEADS: Record<Team, string> = { support: "Priya", search: "Leo", growth: "Maya", platform: "Sam" };

// Average daily cost per month (Feb … Oct). Growth trend built in; support flattens Jul–Sep near $245.
const LEVELS: Record<Team, number[]> = {
  support: [150, 165, 180, 200, 220, 247, 258, 268, 245], // Jul–Sep raised ~5% to offset the haiku price cut
  search: [120, 128, 135, 142, 150, 158, 165, 172, 180],
  growth: [95, 100, 108, 115, 122, 130, 138, 145, 150],
  platform: [60, 63, 66, 70, 74, 78, 82, 86, 90],
};

// ---------- planted events (ground truth) ----------
// Mid-period price change: claude-haiku list price cut 20% from 2026-06-01 (same tokens, lower cost).
const PRICE_CHANGE = { model: "claude-haiku", date: "2026-06-01", costFactor: 0.8 };

type Spike = { team: Team; from: string; to: string; multiplier: number };
const SPIKES: Spike[] = [
  { team: "search", from: "2026-06-15", to: "2026-06-19", multiplier: 1.8 }, // reindex, lead called it
  { team: "growth", from: "2026-04-08", to: "2026-04-14", multiplier: 1.5 }, // spring campaign, lead called it
  { team: "support", from: "2026-10-27", to: "2026-10-31", multiplier: 3 }, // launch (demo)
];

const events = [
  { id: "ev-support-launch", team: "support", kind: "launch", date: "2026-10-27", multiplier: 3, happened: true,
    saidByLead: "only after check-in (Priya replies in the demo)",
    description: "Support AI agent launch; volume ~3x from Oct 27." },
  { id: "ev-growth-slip", team: "growth", kind: "campaign_slipped", date: "2026-10-26", multiplier: 2, happened: false,
    saidByLead: "yes (Maya: live Oct 26, ~2x)",
    description: "Fall campaign planned for Oct 26 slipped to November; October usage stays flat. Trips the memo." },
  { id: "ev-haiku-price", team: null, kind: "price_change", date: PRICE_CHANGE.date, multiplier: PRICE_CHANGE.costFactor, happened: true,
    saidByLead: "n/a", description: "claude-haiku price cut 20% from 2026-06-01; tokens unchanged, cost lower." },
  { id: "ev-search-noreply", team: "search", kind: "no_reply", date: "2026-07-01", multiplier: 1, happened: true,
    saidByLead: "no reply", description: "Search lead didn't reply in July; replied: false (fallback path)." },
  { id: "ev-platform-missing", team: "platform", kind: "missing_context", date: "2026-04-01", multiplier: 1, happened: true,
    saidByLead: "no record", description: "No context record at all for platform in April." },
  { id: "ev-search-reindex", team: "search", kind: "batch_run", date: "2026-06-15", multiplier: 1.8, happened: true,
    saidByLead: "yes", description: "Search reindex Jun 15–19 at ~1.8x." },
  { id: "ev-growth-spring", team: "growth", kind: "campaign", date: "2026-04-08", multiplier: 1.5, happened: true,
    saidByLead: "yes", description: "Spring campaign Apr 8–14 at ~1.5x." },
  { id: "ev-platform-wrong", team: "platform", kind: "wrong_forecast", date: "2026-08-10", multiplier: 1.5, happened: false,
    saidByLead: "yes (Sam: big eval run mid-Aug)", description: "Platform lead predicted an eval run that never happened." },
];

// ---------- daily totals per team ----------
function spikeFor(team: Team, date: string) {
  return SPIKES.filter((s) => s.team === team && date >= s.from && date <= s.to).reduce((m, s) => m * s.multiplier, 1);
}

function genericMonth(team: Team, mi: number): Record<string, number> {
  const m = MONTHS[mi];
  const n = daysInMonth(m);
  const dates = Array.from({ length: n }, (_, i) => dateOf(m, i + 1));
  const weights = dates.map((d) => (isWeekend(d) ? WEEKEND_FACTOR : 1));
  const avgW = weights.reduce((a, b) => a + b, 0) / n;
  const out: Record<string, number> = {};
  dates.forEach((d, i) => {
    out[d] = (LEVELS[team][mi] * weights[i]) / avgW * noise(0.08) * spikeFor(team, d);
  });
  return out;
}

// October: Oct 1–25 pinned to the fakes, Oct 26–31 follows the planted events.
const OCT_PIN: Record<Team, { toDate: number; last7: number }> = {
  support: { toDate: 6120, last7: 245 },
  search: { toDate: 4500, last7: 180 },
  growth: { toDate: 3750, last7: 150 },
  platform: { toDate: 2250, last7: 90 },
};

function octoberMonth(team: Team): Record<string, number> {
  const m = "2026-10";
  const out: Record<string, number> = {};
  const { toDate, last7 } = OCT_PIN[team];
  // Oct 1–18: weekday/weekend shape with noise, scaled to hit the exact total.
  const early = Array.from({ length: 18 }, (_, i) => dateOf(m, i + 1));
  const raw = early.map((d) => (isWeekend(d) ? WEEKEND_FACTOR : 1) * noise(0.06));
  const target = toDate - 7 * last7;
  const scale = target / raw.reduce((a, b) => a + b, 0);
  const cents = raw.map((r) => round2(r * scale));
  cents[cents.length - 1] = round2(cents[cents.length - 1] + target - cents.reduce((a, b) => a + b, 0));
  early.forEach((d, i) => (out[d] = cents[i]));
  // Oct 19–25 flat so the 7-day recent rate is exact under any weighting.
  for (let d = 19; d <= 25; d++) out[dateOf(m, d)] = last7;
  // Oct 26–31: after asOf. Light noise; support launch 3x from Oct 27; growth campaign slipped (no 2x).
  for (let d = 26; d <= 31; d++) {
    const date = dateOf(m, d);
    out[date] = last7 * noise(0.04) * spikeFor(team, date);
  }
  return out;
}

// ---------- split a day across models, cents exact ----------
// `total` is the day's cost at pre-cut list prices. In normal months the haiku price cut lowers cost for the
// same tokens. October is pinned, so there the cost is kept exact and tokens are derived from the new price.
function splitDay(team: Team, date: string, total: number, pinned: boolean): UsageDay[] {
  const specs = MODELS[team];
  const parts = specs.map((s) => round2(total * s.share));
  parts[0] = round2(parts[0] + round2(total) - round2(parts.reduce((a, b) => a + b, 0)));
  const rows = specs.map((s, i) => {
    const cut = s.model === PRICE_CHANGE.model && date >= PRICE_CHANGE.date ? PRICE_CHANGE.costFactor : 1;
    const costUsd = pinned ? parts[i] : round2(parts[i] * cut);
    const mtok = pinned ? parts[i] / (s.usdPerMTok * cut) : parts[i] / s.usdPerMTok;
    return {
      date, team, model: s.model, costUsd,
      inputTokens: Math.round(mtok * 0.8e6), outputTokens: Math.round(mtok * 0.2e6), source: s.source,
    };
  });
  return withFrontierSlice(team, total, rows);
}

// Every team keeps some frontier work on Opus, so each stack spans three tiers. The slice is carved out of an
// uncut model's row after the split, so every day's total (and every actual) stays exact to the cent.
const OPUS = { model: "claude-opus", source: "anthropic" as const, usdPerMTok: 30 };
const FRONTIER_SLICE: Partial<Record<Team, { from: string; share: number }>> = {
  support: { from: "claude-sonnet", share: 0.1 },
  search: { from: "claude-sonnet", share: 0.1 },
  growth: { from: "claude-sonnet", share: 0.1 },
};
const SPEC_PRICE: Record<string, number> = { "claude-sonnet": 6 };

function withFrontierSlice(team: Team, total: number, rows: UsageDay[]): UsageDay[] {
  const slice = FRONTIER_SLICE[team];
  const from = slice && rows.find((r) => r.model === slice.from);
  if (!slice || !from) return rows;
  const opusCost = Math.min(round2(total * slice.share), from.costUsd);
  const tokens = (cost: number, perMTok: number) => {
    const mtok = cost / perMTok;
    return { inputTokens: Math.round(mtok * 0.8e6), outputTokens: Math.round(mtok * 0.2e6) };
  };
  const rest = round2(from.costUsd - opusCost);
  return [
    ...rows.map((r) => (r === from ? { ...r, costUsd: rest, ...tokens(rest, SPEC_PRICE[r.model]) } : r)),
    { date: from.date, team, model: OPUS.model, costUsd: opusCost, ...tokens(opusCost, OPUS.usdPerMTok), source: OPUS.source },
  ];
}

// ---------- contexts: what the leads "said" ----------
function contextsFor(): TeamContext[] {
  const out: TeamContext[] = [];
  const at = (m: string, day: number, hh: string) => `${dateOf(m, day)}T${hh}:00-07:00`;
  for (const m of MONTHS) {
    for (const team of TEAMS) {
      if (team === "platform" && m === "2026-04") continue; // one missing
      const base = { team, month: m, leadName: LEADS[team] };
      if (team === "search" && m === "2026-07") { out.push({ ...base, replied: false, events: [] }); continue; } // no reply
      if (team === "support" && m === "2026-10") { out.push({ ...base, replied: false, events: [] }); continue; } // demo: before Priya replies
      if (team === "growth" && m === "2026-10") {
        out.push({ ...base, replied: true, events: [{ date: "2026-10-26", multiplier: 2, note: "Fall campaign launch" }],
          quote: "Fall campaign goes live Oct 26, expect roughly double volume.", repliedAt: at(m, 24, "16:40") });
        continue;
      }
      if (team === "growth" && m === "2026-04") {
        out.push({ ...base, replied: true, events: [{ date: "2026-04-08", multiplier: 1.5, note: "Spring campaign (one week)" }],
          quote: "Spring campaign runs the week of Apr 8, maybe 1.5x.", repliedAt: at(m, 6, "10:15") });
        continue;
      }
      if (team === "search" && m === "2026-06") {
        out.push({ ...base, replied: true, events: [{ date: "2026-06-15", multiplier: 1.8, note: "Index rebuild Jun 15–19" }],
          quote: "Rebuilding the index Jun 15 to 19, heavy for those days.", repliedAt: at(m, 12, "14:02") });
        continue;
      }
      if (team === "platform" && m === "2026-08") { // wrong: eval run never happened
        out.push({ ...base, replied: true, events: [{ date: "2026-08-10", multiplier: 1.5, note: "Big eval run" }],
          quote: "Big eval run starting mid-August.", repliedAt: at(m, 8, "09:30") });
        continue;
      }
      out.push({ ...base, replied: true, events: [], quote: "Nothing unusual planned.", repliedAt: at(m, 24, "17:00") });
    }
  }
  return out;
}

// ---------- main ----------
function main() {
  const usage: UsageDay[] = [];
  MONTHS.forEach((m, mi) => {
    for (const team of TEAMS) {
      const days = m === "2026-10" ? octoberMonth(team) : genericMonth(team, mi);
      for (const [date, total] of Object.entries(days)) usage.push(...splitDay(team, date, total, m === "2026-10"));
    }
  });
  usage.sort((a, b) => a.date.localeCompare(b.date) || a.team.localeCompare(b.team) || a.model.localeCompare(b.model));

  const actuals: Actual[] = [];
  for (const m of MONTHS) for (const team of TEAMS) {
    const sum = usage.filter((u) => u.team === team && u.date.startsWith(m)).reduce((a, u) => a + u.costUsd, 0);
    actuals.push({ team, month: m, actualUsd: round2(sum) });
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const write = (name: string, data: unknown) => writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2) + "\n");
  write("usage.json", usage);
  write("contexts.json", contextsFor());
  write("actuals.json", actuals);
  write("events.json", { seed: SEED, asOf: AS_OF, events });

  console.log(`fixtures: ${usage.length} usage rows, ${actuals.length} actuals → ${OUT_DIR}`);
}

main();
