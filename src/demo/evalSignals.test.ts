// OWNER: D
import { describe, expect, it } from "vitest";
import type { ContextEvent, Team } from "../shared/types.js";
import type { InferResult } from "../llm/inferDrivers.js";
import type { Signal } from "../signals/types.js";
import { evaluate, exitCode, formatReport, type EvalCase, type TeamScore } from "./evalSignals.js";

const sig = (id: string, team: Team): Signal => ({ id, source: "slack", kind: "message", team, date: "2026-10-01", text: "t", url: "u" });
const ev = (date: string, multiplier: number, ...ids: string[]): ContextEvent => ({
  date, multiplier, note: "n", source: "slack",
  evidence: ids.map((id) => ({ source: "slack", id, url: "u", text: "t", date: "2026-10-01" })),
});
const fakeInfer = (results: InferResult[]) => {
  let i = 0;
  return (async () => results[i++ % results.length]) as never;
};
const decoyWhy = new Map([["d1", "old plan"], ["d2", "rumor"]]);
const c = (team: Team, expected: EvalCase["expected"]): EvalCase => ({ team, signals: [sig("a", team)], expected });

describe("evaluate", () => {
  it("computes tp/fp/fn over runs", async () => {
    const infer = fakeInfer([{ events: [ev("2026-10-27", 3, "a"), ev("2026-10-28", 2, "a")], dropped: [], usedLlm: true, flags: [] }]);
    const [s] = await evaluate([c("support", [{ date: "2026-10-27", multiplier: 3 }, { date: "2026-10-29", multiplier: 4 }])], {
      runs: 2, llm: null, decoyWhy, infer, now: () => 0,
    });
    expect(s).toMatchObject({ runs: 2, truePositives: 2, falsePositives: 2, falseNegatives: 2, usedLlmRuns: 2 });
  });

  it("separates decoys proposed (kept or dropped) from kept", async () => {
    const infer = fakeInfer([
      {
        events: [ev("2026-10-27", 3, "a", "d1")],
        dropped: [{ reason: "date not in evidence", event: { evidenceIds: ["d2", "a"] } }, { reason: "uncited", event: {} }],
        usedLlm: true,
        flags: [],
      },
    ]);
    const [s] = await evaluate([c("search", [])], { runs: 2, llm: null, decoyWhy, infer });
    expect(s.decoysKept).toEqual([{ id: "d1", why: "old plan", times: 2 }]);
    expect(s.decoysProposed).toEqual(expect.arrayContaining([
      { id: "d1", why: "old plan", times: 2 },
      { id: "d2", why: "rumor", times: 2 },
    ]));
    expect(s.decoysProposed).toHaveLength(2);
  });

  it("aggregates guard drop reasons and timing", async () => {
    let t = 0;
    const infer = fakeInfer([
      { events: [], dropped: [{ reason: "uncited", event: {} }, { reason: "uncited", event: {} }, { reason: "bad note", event: {} }], usedLlm: false, flags: [] },
    ]);
    const [s] = await evaluate([c("growth", [])], { runs: 2, llm: null, decoyWhy, infer, now: () => (t += 10) });
    expect(s.guardDrops).toEqual([{ reason: "uncited", times: 4 }, { reason: "bad note", times: 2 }]);
    expect(s.msTotal).toBe(20);
  });
});

const base = (team: Team, o: Partial<TeamScore> = {}): TeamScore => ({
  team, runs: 1, truePositives: 1, falsePositives: 0, falseNegatives: 0,
  decoysProposed: [], decoysKept: [], guardDrops: [], usedLlmRuns: 1, msTotal: 50, ...o,
});

describe("formatReport and exitCode", () => {
  it("lists team rows and flags booked decoys", () => {
    const out = formatReport([
      base("support"),
      base("search", { truePositives: 1, falsePositives: 1, decoysKept: [{ id: "d1", why: "old plan", times: 1 }], guardDrops: [{ reason: "uncited", times: 2 }] }),
    ]);
    expect(out).toContain("support");
    expect(out).toContain("search");
    expect(out).toContain("precision");
    expect(out).toContain("0.50");
    expect(out).toContain("overall");
    expect(out).toContain("BOOKED DECOYS");
    expect(out).toContain("d1");
    expect(formatReport([base("support")])).not.toContain("BOOKED");
  });

  it("exits non-zero when a decoy is kept or Support recall < 1", () => {
    expect(exitCode([base("support")])).toBe(0);
    expect(exitCode([base("support"), base("search", { decoysKept: [{ id: "d1", why: "x", times: 1 }] })])).toBe(1);
    expect(exitCode([base("support", { falseNegatives: 1 })])).toBe(1);
    expect(exitCode([base("search", { falseNegatives: 1 })])).toBe(0);
  });
});
