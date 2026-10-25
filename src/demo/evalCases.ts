// OWNER: D — case-file evaluation sets (dev/test/human), scoring and run history.
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { inferDrivers } from "../llm/inferDrivers.js";
import type { LlmClient } from "../llm/client.js";
import { TEAMS } from "../shared/config.js";
import type { ContextEvent, Team } from "../shared/types.js";
import type { Signal } from "../signals/types.js";

export type CaseSet = "dev" | "test" | "human";
export type ExpectedEvent = { date: string; multiplier: number };
export type EvalCaseFile = {
  id: string;
  team: Team;
  month: string;
  asOf: string;
  category: string;
  author: "generated-dev" | "generated-test" | "human";
  signals: Signal[];
  expected: ExpectedEvent[];
  why: string;
};

const signalSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["slack", "github"]),
  kind: z.enum(["message", "milestone", "release", "pr"]),
  team: z.enum(TEAMS as [Team, ...Team[]]),
  date: z.string(),
  text: z.string(),
  url: z.string(),
  author: z.string().optional(),
  dueDate: z.string().optional(),
  previousDueDate: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
export const caseFileSchema = z
  .object({
    id: z.string().min(1),
    team: z.enum(TEAMS as [Team, ...Team[]]),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category: z.string().min(1),
    author: z.enum(["generated-dev", "generated-test", "human"]),
    signals: z.array(signalSchema).min(1).max(8),
    expected: z.array(z.object({ date: z.string(), multiplier: z.number() })),
    why: z.string(),
  })
  .refine((c) => new Set(c.signals.map((s) => s.id)).size === c.signals.length, { message: "duplicate signal ids within case" });

export const EVAL_ROOT = "data/eval";

/** Reads every *.json file (each an array of cases) in `<root>/<set>`. */
export function loadCaseSet(set: CaseSet, root: string = EVAL_ROOT): EvalCaseFile[] {
  const dir = join(root, set);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const seen = new Map<string, string>();
  const out: EvalCaseFile[] = [];
  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`${f}: invalid JSON (${(e as Error).message})`);
    }
    const parsed = z.array(caseFileSchema).safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`${f}: invalid case file at ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    for (const c of parsed.data) {
      const prev = seen.get(c.id);
      if (prev !== undefined) throw new Error(`${f}: duplicate case id "${c.id}" (first seen in ${prev})`);
      seen.set(c.id, f);
      out.push(c as EvalCaseFile);
    }
  }
  return out;
}

export type CategoryRow = { category: string; cases: number; exactMatchRate: number; falsePositives: number; falseNegatives: number };
export type FailingCase = {
  id: string; category: string; why: string;
  expected: ExpectedEvent[]; got: ExpectedEvent[]; failedRuns: number; runs: number;
};
export type CaseReport = {
  set?: string;
  cases: number;
  runs: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  exactMatchRate: number | null; // fraction of (case, run) pairs fully right
  categories: CategoryRow[];
  failing: FailingCase[];
  flags: number; // size-unknown flags raised across all runs (not booked, not scored)
  usedLlmRuns: number;
  totalRuns: number; // cases * runs
  avgMs: number;
};

/**
 * Kept events as the frozen test set writes them: a temporary change (`until` before month end)
 * is two drivers, the multiplier then a 1x on the day after `until`.
 */
export function normaliseEvents(events: ContextEvent[]): ExpectedEvent[] {
  const out: ExpectedEvent[] = [];
  for (const e of events) {
    out.push({ date: e.date, multiplier: e.multiplier });
    if (e.until) {
      const last = new Date(`${e.until}T00:00:00Z`);
      const next = new Date(last);
      next.setUTCDate(next.getUTCDate() + 1);
      if (next.getUTCMonth() === last.getUTCMonth()) out.push({ date: next.toISOString().slice(0, 10), multiplier: 1 });
    }
  }
  return out;
}

const key = (e: ExpectedEvent) => `${e.date}|${e.multiplier}`;
const div = (a: number, b: number) => (b === 0 ? null : a / b);

export async function evaluateCases(
  cases: EvalCaseFile[],
  opts: { runs: number; llm: LlmClient | null; infer?: typeof inferDrivers; now?: () => number },
): Promise<CaseReport> {
  const infer = opts.infer ?? inferDrivers;
  const now = opts.now ?? Date.now;
  let tp = 0, fp = 0, fn = 0, flagCount = 0, exact = 0, llmRuns = 0, ms = 0, totalRuns = 0;
  const cats = new Map<string, { cases: number; exact: number; runs: number; fp: number; fn: number }>();
  const failing: FailingCase[] = [];
  for (const c of cases) {
    const cat = cats.get(c.category) ?? { cases: 0, exact: 0, runs: 0, fp: 0, fn: 0 };
    cats.set(c.category, cat);
    cat.cases++;
    let failedRuns = 0;
    let firstBad: ExpectedEvent[] | null = null;
    for (let r = 0; r < opts.runs; r++) {
      const t0 = now();
      const res = await infer(c.team, c.month, c.signals, opts.llm, c.asOf);
      ms += now() - t0;
      totalRuns++;
      cat.runs++;
      if (res.usedLlm) llmRuns++;
      flagCount += res.flags?.length ?? 0;
      const got = normaliseEvents(res.events);
      const remaining = c.expected.map(key);
      let runFp = 0;
      for (const g of got) {
        const i = remaining.indexOf(key(g));
        if (i >= 0) { remaining.splice(i, 1); tp++; } else runFp++;
      }
      const runFn = remaining.length;
      fp += runFp; fn += runFn; cat.fp += runFp; cat.fn += runFn;
      if (runFp === 0 && runFn === 0) { exact++; cat.exact++; } else { failedRuns++; firstBad ??= got; }
    }
    if (failedRuns > 0) {
      failing.push({ id: c.id, category: c.category, why: c.why, expected: c.expected, got: firstBad ?? [], failedRuns, runs: opts.runs });
    }
  }
  const precision = div(tp, tp + fp);
  const recall = div(tp, tp + fn);
  // Nothing expected and nothing booked: precision/recall undefined; treat F1 as 1 if no errors at all.
  const f1 = precision !== null && recall !== null ? (precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall))
    : tp + fp + fn === 0 && totalRuns > 0 ? 1 : null;
  return {
    cases: cases.length, runs: opts.runs, truePositives: tp, falsePositives: fp, falseNegatives: fn,
    precision, recall, f1, exactMatchRate: div(exact, totalRuns),
    categories: [...cats].map(([category, v]) => ({
      category, cases: v.cases, exactMatchRate: v.runs === 0 ? 0 : v.exact / v.runs, falsePositives: v.fp, falseNegatives: v.fn,
    })).sort((a, b) => a.category.localeCompare(b.category)),
    failing, flags: flagCount, usedLlmRuns: llmRuns, totalRuns, avgMs: totalRuns === 0 ? 0 : Math.round(ms / totalRuns),
  };
}

const fmt = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));
const evs = (es: ExpectedEvent[]) => (es.length === 0 ? "[]" : es.map((e) => `${e.date} x${e.multiplier}`).join(", "));

export function formatCaseReport(r: CaseReport): string {
  if (r.cases === 0) return `${r.set ? `set ${r.set}: ` : ""}no cases found`;
  const headers = ["category", "cases", "exact match", "false pos", "false neg"];
  const rows = r.categories.map((c) => [c.category, String(c.cases), fmt(c.exactMatchRate), String(c.falsePositives), String(c.falseNegatives)]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((x) => x[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(" | ").trimEnd();
  const out = [line(headers), widths.map((w) => "-".repeat(w)).join("-|-"), ...rows.map(line)];
  out.push("", `overall: ${r.cases} cases x ${r.runs} runs; precision ${fmt(r.precision)}, recall ${fmt(r.recall)}, F1 ${fmt(r.f1)}, exact match ${fmt(r.exactMatchRate)}`);
  out.push(`flags raised (review required): ${r.flags}`);
  out.push(`LLM used in ${r.usedLlmRuns}/${r.totalRuns} runs; avg ${r.avgMs} ms/run`);
  if (r.failing.length > 0) {
    out.push("", `FAILING CASES (${r.failing.length}):`);
    for (const f of r.failing) {
      out.push(`  ${f.id} [${f.category}] failed ${f.failedRuns}/${f.runs} runs`, `    expected: ${evs(f.expected)}`, `    got:      ${evs(f.got)}`, `    why: ${f.why}`);
    }
  }
  return out.join("\n");
}

// ---- history ----
export const HISTORY_PATH = "data/eval/history.jsonl";
export type HistoryLine = {
  at: string; gitSha: string; dirty: boolean; set: string; model: string; runs: number;
  cases: number; precision: number | null; recall: number | null; f1: number | null; exactMatch: number | null;
};

export function gitInfo(exec: (cmd: string) => string = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })): { gitSha: string; dirty: boolean } {
  let gitSha = "unknown";
  let dirty = false;
  try { gitSha = exec("git rev-parse --short HEAD").trim() || "unknown"; } catch { /* not a repo */ }
  try { dirty = exec("git status --porcelain").trim().length > 0; } catch { /* not a repo */ }
  return { gitSha, dirty };
}

export function appendHistory(
  report: CaseReport,
  meta: { set: string; model?: string; path?: string; at?: Date; git?: { gitSha: string; dirty: boolean } },
): HistoryLine {
  const git = meta.git ?? gitInfo();
  const line: HistoryLine = {
    at: (meta.at ?? new Date()).toISOString(), gitSha: git.gitSha, dirty: git.dirty, set: meta.set,
    model: meta.model || "deterministic", runs: report.runs, cases: report.cases,
    precision: report.precision, recall: report.recall, f1: report.f1, exactMatch: report.exactMatchRate,
  };
  const path = meta.path ?? HISTORY_PATH;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(line) + "\n");
  return line;
}
