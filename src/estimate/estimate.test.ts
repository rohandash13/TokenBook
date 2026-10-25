// OWNER: A
import { describe, expect, it } from "vitest";
import type { Actual, TeamContext, UsageDay } from "../shared/types.js";
import { estimateAll, estimateFrom, FAKE_FIXTURES, fixtureSources } from "./estimate.js";

describe("estimateAll on the hand-written October fakes", () => {
  const all = estimateAll("2026-10", "2026-10-25", fixtureSources(FAKE_FIXTURES));
  const trueups = Object.fromEntries(all.filter((e) => e.method === "trueup").map((e) => [e.team, e]));

  it("returns three methods for each of the four teams", () => {
    expect(all).toHaveLength(12);
    for (const e of all) expect(e.basis).not.toBe("");
  });

  it("matches the fixture README", () => {
    expect(trueups.support.estimate).toBeCloseTo(7590, 2);
    expect(trueups.support.confidence).toBe("low");
    expect(trueups.search.estimate).toBeCloseTo(5580, 2);
    expect(trueups.growth.estimate).toBeCloseTo(5550, 2);
    expect(trueups.platform.estimate).toBeCloseTo(2790, 2);
  });

  it("rejects an asOf outside the month", () => {
    expect(() => estimateAll("2026-10", "2026-09-30")).toThrow();
  });
});

describe("estimateAll on the generated 9-month fixtures", () => {
  const all = estimateAll("2026-10", "2026-10-25");
  const trueup = (team: string) => all.find((e) => e.team === team && e.method === "trueup")!;

  it("tells the demo story before Priya replies", () => {
    // Support: no reply yet → Jul–Sep average, about $7,590, low confidence
    expect(trueup("support").estimate).toBeCloseTo(7590, -1);
    expect(trueup("support").confidence).toBe("low");
    // Growth: Maya's 2× campaign → $5,550 (it slips, which trips the memo)
    expect(trueup("growth").estimate).toBeCloseTo(5550, 2);
  });

  it("backtests prior months into a bias suggestion for every team", () => {
    for (const team of ["support", "search", "growth", "platform"]) {
      expect(trueup(team).biasSuggestionPct).toEqual(expect.any(Number));
    }
  });
});

describe("estimateFrom", () => {
  // Two months of flat $100/day; September's lead promised 2× from Sep 26 that never came.
  const usage: UsageDay[] = [];
  for (const [month, n] of [["2026-09", 30], ["2026-10", 25]] as const) {
    for (let d = 1; d <= n; d++) {
      usage.push({ date: `${month}-${String(d).padStart(2, "0")}`, team: "growth", model: "m", costUsd: 100, inputTokens: 0, outputTokens: 0, source: "anthropic" });
    }
  }
  const contexts: TeamContext[] = [
    { team: "growth", month: "2026-09", replied: true, events: [{ date: "2026-09-26", multiplier: 2, note: "campaign" }] },
    { team: "growth", month: "2026-10", replied: true, events: [] },
  ];
  const actuals: Actual[] = [{ team: "growth", month: "2026-09", actualUsd: 3000 }];

  it("backtests prior months for the bias suggestion, on TrueUp rows only", () => {
    const rows = estimateFrom({ usage, contexts, actuals }, "2026-10-25");
    const growth = rows.filter((e) => e.team === "growth");
    // Sep backtest at Sep 25: 2500 + 5 × 200 = 3500 vs 3000 actual → +16.7% over → suggest −16.7%
    expect(growth.find((e) => e.method === "trueup")?.biasSuggestionPct).toBe(-16.7);
    expect(growth.find((e) => e.method === "runrate")?.biasSuggestionPct).toBeUndefined();
  });

  it("doesn't let October usage after asOf leak into the estimate", () => {
    const late = [...usage, { ...usage[0], date: "2026-10-28", costUsd: 1_000_000 }];
    const e = estimateFrom({ usage: late, contexts, actuals }, "2026-10-25").find((x) => x.team === "growth" && x.method === "runrate");
    expect(e?.estimate).toBe(2500 + 6 * 100);
  });
});
