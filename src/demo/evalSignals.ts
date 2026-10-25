// OWNER: D — scores signal inference against the demo scenario's expected events and decoy traps.
// `npm run eval:signals [-- --runs 3 --live --deterministic --team support]`
import { pathToFileURL } from "node:url";
import { inferDrivers } from "../llm/inferDrivers.js";
import { getLlm, type LlmClient } from "../llm/client.js";
import { DEMO, TEAMS } from "../shared/config.js";
import type { Team } from "../shared/types.js";
import { defaultRefreshDeps } from "../signals/refresh.js";
import type { Signal } from "../signals/types.js";
import { loadScenario } from "./loadScenario.js";
import type { Scenario } from "./scenario.js";
import { scenarioToFixtures } from "./toFixtures.js";

export type EvalCase = { team: Team; signals: Signal[]; expected: { date: string; multiplier: number }[] };
export type DecoyCount = { id: string; why: string; times: number };
export type TeamScore = {
  team: Team;
  runs: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number; // summed over runs; match = same date and multiplier
  decoysProposed: DecoyCount[]; // decoy ids cited by a proposed event (kept or dropped)
  decoysKept: DecoyCount[]; // decoy ids backing a kept event that is NOT expected (a real failure)
  guardDrops: { reason: string; times: number }[];
  usedLlmRuns: number;
  msTotal: number;
};

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function evaluate(
  cases: EvalCase[],
  opts: {
    runs: number;
    llm: LlmClient | null;
    decoyWhy: Map<string, string>;
    infer?: typeof inferDrivers;
    now?: () => number;
  },
): Promise<TeamScore[]> {
  const infer = opts.infer ?? inferDrivers;
  const now = opts.now ?? Date.now;
  const scores: TeamScore[] = [];
  for (const c of cases) {
    const proposed = new Map<string, number>();
    const kept = new Map<string, number>();
    const drops = new Map<string, number>();
    const s: TeamScore = {
      team: c.team, runs: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0,
      decoysProposed: [], decoysKept: [], guardDrops: [], usedLlmRuns: 0, msTotal: 0,
    };
    for (let r = 0; r < opts.runs; r++) {
      const t0 = now();
      const res = await infer(c.team, DEMO.month, c.signals, opts.llm);
      s.msTotal += now() - t0;
      s.runs++;
      if (res.usedLlm) s.usedLlmRuns++;
      // Multiset match on date + multiplier.
      const remaining = c.expected.map((e) => `${e.date}|${e.multiplier}`);
      const wrong = new Set<(typeof res.events)[number]>();
      for (const ev of res.events) {
        const i = remaining.indexOf(`${ev.date}|${ev.multiplier}`);
        if (i >= 0) {
          remaining.splice(i, 1);
          s.truePositives++;
        } else {
          s.falsePositives++;
          wrong.add(ev);
        }
      }
      s.falseNegatives += remaining.length;
      const decoyIds = (ids: string[]) => [...new Set(ids)].filter((id) => opts.decoyWhy.has(id));
      // A decoy is "booked" only when it backs a wrong event. A decoy that merely corroborates a
      // correct event (e.g. Growth noting Support's real Oct 27 launch) moves no money.
      for (const ev of res.events) {
        for (const id of decoyIds((ev.evidence ?? []).map((e) => e.id))) {
          if (wrong.has(ev)) bump(kept, id);
          bump(proposed, id);
        }
      }
      for (const d of res.dropped) {
        bump(drops, d.reason);
        const ids = (d.event as { evidenceIds?: unknown } | null)?.evidenceIds;
        if (Array.isArray(ids)) for (const id of decoyIds(ids.filter((x): x is string => typeof x === "string"))) bump(proposed, id);
      }
    }
    const toList = (m: Map<string, number>): DecoyCount[] =>
      [...m].map(([id, times]) => ({ id, why: opts.decoyWhy.get(id) ?? "", times }));
    s.decoysProposed = toList(proposed);
    s.decoysKept = toList(kept);
    s.guardDrops = [...drops].map(([reason, times]) => ({ reason, times })).sort((a, b) => b.times - a.times);
    scores.push(s);
  }
  return scores;
}

const ratio = (num: number, den: number) => (den === 0 ? "n/a" : (num / den).toFixed(2));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function formatReport(scores: TeamScore[]): string {
  const headers = ["team", "precision", "recall", "decoys proposed", "decoys booked", "guard drops", "avg ms"];
  const rows = scores.map((s) => [
    s.team,
    ratio(s.truePositives, s.truePositives + s.falsePositives),
    ratio(s.truePositives, s.truePositives + s.falseNegatives),
    String(sum(s.decoysProposed.map((d) => d.times))),
    String(sum(s.decoysKept.map((d) => d.times))),
    String(sum(s.guardDrops.map((d) => d.times))),
    String(s.runs === 0 ? 0 : Math.round(s.msTotal / s.runs)),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ").trimEnd();
  const out = [line(headers), widths.map((w) => "-".repeat(w)).join("-|-"), ...rows.map(line)];

  const tp = sum(scores.map((s) => s.truePositives));
  const fp = sum(scores.map((s) => s.falsePositives));
  const fn = sum(scores.map((s) => s.falseNegatives));
  const llmRuns = sum(scores.map((s) => s.usedLlmRuns));
  const runs = sum(scores.map((s) => s.runs));
  out.push("", `overall: precision ${ratio(tp, tp + fp)}, recall ${ratio(tp, tp + fn)}, LLM used in ${llmRuns}/${runs} runs`);

  const booked = scores.flatMap((s) => s.decoysKept.map((d) => ({ team: s.team, ...d })));
  if (booked.length > 0) {
    out.push("", "BOOKED DECOYS (failure):");
    for (const b of booked) out.push(`  ${b.team}: ${b.id} x${b.times}: ${b.why}`);
  }
  const guard = new Map<string, number>();
  for (const s of scores) for (const g of s.guardDrops) guard.set(g.reason, (guard.get(g.reason) ?? 0) + g.times);
  if (guard.size > 0) out.push("", "guard drops: " + [...guard].map(([r, n]) => `${r} x${n}`).join(", "));
  return out.join("\n");
}

/** Non-zero if any decoy was booked, or Support recall < 1. */
export function exitCode(scores: TeamScore[]): number {
  if (scores.some((s) => s.decoysKept.length > 0)) return 1;
  const support = scores.find((s) => s.team === "support");
  if (support && support.truePositives < support.truePositives + support.falseNegatives) return 1;
  return 0;
}

/**
 * Maps signal ids to the scenario decoy reason. Works for fixture and live signals alike by
 * matching on content: Slack by exact text, GitHub by the item's title/tag inside the signal text.
 */
export function buildDecoyWhy(scenario: Scenario, signals: Signal[]): Map<string, string> {
  const out = new Map<string, string>();
  const slackDecoys = scenario.messages.filter((m) => m.decoy);
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const ghDecoys: { re: (s: Signal) => boolean; why: string }[] = [];
  for (const r of scenario.repos) {
    for (const m of r.milestones) if (m.decoy) ghDecoys.push({ why: m.decoy, re: (s) => s.kind === "milestone" && s.text.startsWith(`Milestone '${m.title}'`) });
    for (const p of r.prs) if (p.decoy) ghDecoys.push({ why: p.decoy, re: (s) => s.kind === "pr" && s.text.endsWith(p.title) });
    for (const rel of r.releases) if (rel.decoy) ghDecoys.push({ why: rel.decoy, re: (s) => s.kind === "release" && s.text.startsWith(`Release ${rel.tag}:`) });
    // Issues are not read as signals, so issue decoys have no signal id to map.
  }
  for (const s of signals) {
    if (s.source === "slack") {
      const m = slackDecoys.find((d) => norm(d.text) === norm(s.text));
      if (m?.decoy) out.set(s.id, m.decoy);
    } else {
      const g = ghDecoys.find((d) => d.re(s));
      if (g) out.set(s.id, g.why);
    }
  }
  return out;
}

function parseArgs(argv: string[]) {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const runs = Number(val("--runs") ?? 3);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  const team = val("--team");
  if (team !== undefined && !TEAMS.includes(team as Team)) throw new Error(`--team must be one of ${TEAMS.join(", ")}`);
  return { runs, live: argv.includes("--live"), deterministic: argv.includes("--deterministic"), team: team as Team | undefined };
}

async function main() {
  try { process.loadEnvFile?.(); } catch { /* no .env */ }
  const args = parseArgs(process.argv.slice(2));
  const scenario = loadScenario();
  const teams = args.team ? [args.team] : [...TEAMS];
  const llm = args.deterministic ? null : getLlm();

  const cases: EvalCase[] = [];
  const decoyWhy = new Map<string, string>();
  const fixtures = args.live ? null : scenarioToFixtures(scenario);
  const liveDeps = args.live ? defaultRefreshDeps() : null;
  for (const team of teams) {
    let signals: Signal[];
    if (fixtures) signals = [...fixtures.slack, ...fixtures.github].filter((s) => s.team === team);
    else {
      const d = liveDeps!;
      signals = [...(await d.readSlack(team, DEMO.month)), ...(await d.readGithub(team, DEMO.month))];
      if (d.sourceFellBack?.(team, DEMO.month)) console.warn(`${team}: live source fell back to fixtures; results are not live`);
    }
    for (const [id, why] of buildDecoyWhy(scenario, signals)) decoyWhy.set(id, why);
    cases.push({ team, signals, expected: scenario.expected[team].events.map((e) => ({ date: e.date, multiplier: e.multiplier })) });
  }

  const scores = await evaluate(cases, { runs: args.runs, llm, decoyWhy });
  console.log(formatReport(scores));
  const model = process.env.ANTHROPIC_MODEL;
  console.log(
    `\nmodel: ${llm ? (model ?? "unknown") : "none (deterministic fallback)"}; source: ${args.live ? "live" : "fixtures"}; ` +
      "cost not computed (no pricing configured).",
  );
  const code = exitCode(scores);
  if (code !== 0) console.error("FAIL: a decoy was booked or Support recall < 1");
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
