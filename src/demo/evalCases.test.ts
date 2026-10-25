// OWNER: D
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContextEvent } from "../shared/types.js";
import { appendHistory, evaluateCases, formatCaseReport, gitInfo, loadCaseSet, type EvalCaseFile } from "./evalCases.js";
import { formatHistory } from "./evalHistory.js";

const mk = (id: string, category: string, expected: EvalCaseFile["expected"] = []): EvalCaseFile => ({
  id, team: "support", month: "2026-10", asOf: "2026-10-25", category, author: "human", why: "w", expected,
  signals: [{ id: "s1", source: "slack", kind: "message", team: "support", date: "2026-10-01", text: "t", url: "u" }],
});
const ev = (date: string, multiplier: number) => ({ date, multiplier, note: "n", source: "slack", evidence: [] }) as ContextEvent;
const infer = (events: [string, number][]) =>
  (async () => ({ events: events.map(([d, m]) => ev(d, m)), dropped: [], usedLlm: true })) as never;

function setup(files: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "evalcases-"));
  mkdirSync(join(root, "dev"));
  for (const [f, v] of Object.entries(files)) writeFileSync(join(root, "dev", f), JSON.stringify(v));
  return root;
}

describe("loadCaseSet", () => {
  it("loads and merges all json files", () => {
    const root = setup({ "a.json": [mk("a1", "x")], "b.json": [mk("b1", "y")] });
    expect(loadCaseSet("dev", root).map((c) => c.id)).toEqual(["a1", "b1"]);
  });
  it("rejects bad shape naming the file", () => {
    const root = setup({ "bad.json": [{ ...mk("a1", "x"), team: "nope" }] });
    expect(() => loadCaseSet("dev", root)).toThrow(/bad\.json/);
  });
  it("rejects duplicate ids naming the file", () => {
    const root = setup({ "a.json": [mk("dup", "x")], "b.json": [mk("dup", "y")] });
    expect(() => loadCaseSet("dev", root)).toThrow(/b\.json.*duplicate case id "dup".*a\.json/);
  });
  it("rejects duplicate signal ids and >8 signals", () => {
    const c = mk("a1", "x");
    expect(() => loadCaseSet("dev", setup({ "a.json": [{ ...c, signals: [c.signals[0], c.signals[0]] }] }))).toThrow(/a\.json/);
    expect(() => loadCaseSet("dev", setup({ "a.json": [{ ...c, signals: [] }] }))).toThrow(/a\.json/);
  });
  it("missing or empty folder gives []", () => {
    expect(loadCaseSet("test", mkdtempSync(join(tmpdir(), "evalcases-")))).toEqual([]);
    expect(loadCaseSet("dev", setup({}))).toEqual([]);
  });
});

describe("evaluateCases", () => {
  const cases = [
    mk("c1", "real", [{ date: "2026-10-27", multiplier: 3 }]),
    mk("c2", "real", [{ date: "2026-10-28", multiplier: 2 }]),
    mk("c3", "joke", []),
    mk("c4", "joke", []),
  ];
  const run = (n = 1) => {
    let i = 0;
    const order = ["c1", "c2", "c3", "c4"];
    const by: Record<string, [string, number][]> = {
      c1: [["2026-10-27", 3]], // correct
      c2: [["2026-10-29", 2]], // 1 fp + 1 fn
      c3: [], // correct
      c4: [["2026-10-30", 5]], // 1 fp
    };
    const f = (async (_t: unknown, _m: unknown, _s: unknown, _l: unknown, _a: unknown) => {
      const id = order[Math.floor(i++ / n) % 4];
      return { events: by[id].map(([d, m]) => ev(d, m)), dropped: [], usedLlm: true };
    }) as never;
    return evaluateCases(cases, { runs: n, llm: null, infer: f, now: () => 0 });
  };

  it("scores precision, recall, F1, exact match", async () => {
    const r = await run();
    expect(r).toMatchObject({ truePositives: 1, falsePositives: 2, falseNegatives: 1, usedLlmRuns: 4, totalRuns: 4, avgMs: 0 });
    expect(r.precision).toBeCloseTo(1 / 3);
    expect(r.recall).toBeCloseTo(1 / 2);
    expect(r.f1).toBeCloseTo(0.4);
    expect(r.exactMatchRate).toBe(0.5);
  });
  it("breaks down per category and lists failures", async () => {
    const r = await run();
    expect(r.categories).toEqual([
      { category: "joke", cases: 2, exactMatchRate: 0.5, falsePositives: 1, falseNegatives: 0 },
      { category: "real", cases: 2, exactMatchRate: 0.5, falsePositives: 1, falseNegatives: 1 },
    ]);
    expect(r.failing.map((f) => f.id)).toEqual(["c2", "c4"]);
    expect(r.failing[0]).toMatchObject({ category: "real", got: [{ date: "2026-10-29", multiplier: 2 }], failedRuns: 1, runs: 1 });
    const text = formatCaseReport(r);
    expect(text).toContain("FAILING CASES (2)");
    expect(text).toContain("c4 [joke]");
  });
  it("handles multiple runs", async () => {
    const r = await run(2);
    expect(r.totalRuns).toBe(8);
    expect(r.exactMatchRate).toBe(0.5);
  });
  it("handles an empty set", async () => {
    const r = await evaluateCases([], { runs: 3, llm: null, infer: infer([]) });
    expect(r).toMatchObject({ cases: 0, precision: null, recall: null, f1: null, exactMatchRate: null, failing: [] });
    expect(formatCaseReport({ ...r, set: "test" })).toBe("set test: no cases found");
  });
  it("all-correct empty-expectation case gives F1 1", async () => {
    const r = await evaluateCases([mk("z", "joke")], { runs: 1, llm: null, infer: infer([]) });
    expect(r).toMatchObject({ precision: null, f1: 1, exactMatchRate: 1 });
  });
});

describe("history", () => {
  it("appends one json line with the documented shape", async () => {
    const r = await evaluateCases([mk("z", "joke")], { runs: 2, llm: null, infer: infer([]) });
    const path = join(mkdtempSync(join(tmpdir(), "hist-")), "sub", "history.jsonl");
    const git = { gitSha: "abc1234", dirty: true };
    appendHistory(r, { set: "dev", path, git, at: new Date("2026-10-24T01:02:03Z") });
    appendHistory(r, { set: "test", model: "m-1", path, git });
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0])).toEqual(["at", "gitSha", "dirty", "set", "model", "runs", "cases", "precision", "recall", "f1", "exactMatch"]);
    expect(lines[0]).toMatchObject({ at: "2026-10-24T01:02:03.000Z", gitSha: "abc1234", dirty: true, set: "dev", model: "deterministic", runs: 2, cases: 1, exactMatch: 1 });
    expect(lines[1].model).toBe("m-1");
    expect(formatHistory(lines)).toContain("abc1234*");
  });
  it("gitInfo falls back to unknown", () => {
    expect(gitInfo(() => { throw new Error("no git"); })).toEqual({ gitSha: "unknown", dirty: false });
    expect(gitInfo((c) => (c.includes("rev-parse") ? "abc\n" : " M x\n"))).toEqual({ gitSha: "abc", dirty: true });
  });
});

describe("until normalisation and flags", () => {
  it("scores a windowed event as the multiplier then a 1x on the next day", async () => {
    const c = mk("w1", "temp", [{ date: "2026-10-27", multiplier: 10 }, { date: "2026-10-28", multiplier: 1 }]);
    const f = (async () => ({ events: [{ ...ev("2026-10-27", 10), until: "2026-10-27" }], dropped: [], usedLlm: true })) as never;
    const r = await evaluateCases([c], { runs: 1, llm: null, infer: f, now: () => 0 });
    expect(r).toMatchObject({ truePositives: 2, falsePositives: 0, falseNegatives: 0, exactMatchRate: 1 });
  });
  it("adds no 1x when until is the last day of the month", async () => {
    const c = mk("w2", "temp", [{ date: "2026-10-30", multiplier: 2 }]);
    const f = (async () => ({ events: [{ ...ev("2026-10-30", 2), until: "2026-10-31" }], dropped: [], usedLlm: true })) as never;
    expect((await evaluateCases([c], { runs: 1, llm: null, infer: f, now: () => 0 })).exactMatchRate).toBe(1);
  });
  it("counts flags per run but not as positives", async () => {
    const flag = { date: "2026-10-28", note: "n", reason: "size unknown" };
    const f = (async () => ({ events: [], flags: [flag], dropped: [], usedLlm: true })) as never;
    const r = await evaluateCases([mk("f1", "flag")], { runs: 2, llm: null, infer: f, now: () => 0 });
    expect(r).toMatchObject({ flags: 2, truePositives: 0, falsePositives: 0, exactMatchRate: 1 });
    expect(formatCaseReport(r)).toContain("flags raised (size unknown, not booked): 2");
  });
});
