// OWNER: A
import { describe, expect, it } from "vitest";
import type { Actual, Estimate } from "../shared/types.js";
import { biasSuggestionPct } from "./bias.js";

const est = (month: string, estimate: number, method: Estimate["method"] = "trueup"): Estimate => ({
  team: "growth", month, asOf: `${month}-25`, method, actualToDate: 0, estimate, confidence: "high", basis: "",
});
const act = (month: string, actualUsd: number): Actual => ({ team: "growth", month, actualUsd });

describe("biasSuggestionPct", () => {
  it("is the mean fractional error over the last 3 prior months", () => {
    const past = [est("2026-06", 5000), est("2026-07", 1100), est("2026-08", 1200), est("2026-09", 900)];
    const actuals = [act("2026-06", 1000), act("2026-07", 1000), act("2026-08", 1000), act("2026-09", 1000)];
    // Jul +10%, Aug +20%, Sep −10% → mean +6.67%: over-accrues. June is outside the window.
    expect(biasSuggestionPct("growth", "2026-10", past, actuals)).toBe(0.0667);
  });

  it("is negative for a team that under-accrues", () => {
    expect(biasSuggestionPct("growth", "2026-10", [est("2026-09", 800)], [act("2026-09", 1000)])).toBe(-0.2);
  });

  it("ignores other methods, other teams, the current month and months without actuals", () => {
    const past = [
      est("2026-09", 2000, "runrate"),
      { ...est("2026-09", 2000), team: "search" as const },
      est("2026-10", 2000),
      est("2026-08", 2000),
    ];
    expect(biasSuggestionPct("growth", "2026-10", past, [act("2026-09", 1000), act("2026-10", 1000)])).toBeUndefined();
  });

  it("is 0, not −0, when estimates were exact", () => {
    expect(Object.is(biasSuggestionPct("growth", "2026-10", [est("2026-09", 1000)], [act("2026-09", 1000)]), 0)).toBe(true);
  });
});
