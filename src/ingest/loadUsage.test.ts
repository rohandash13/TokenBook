// OWNER: B
import { describe, expect, it } from "vitest";
import { loadActuals, loadContexts, loadUsage, loadUsageRange } from "./loadUsage.js";

const sum = (rows: { costUsd: number }[]) => Math.round(rows.reduce((a, r) => a + r.costUsd, 0) * 100) / 100;

describe("loadUsage", () => {
  it("filters to the month and asOf", () => {
    const rows = loadUsage("2026-10", "2026-10-25");
    expect(rows.every((r) => r.date >= "2026-10-01" && r.date <= "2026-10-25")).toBe(true);
  });

  it("matches the spec's Support worked example", () => {
    const support = loadUsage("2026-10", "2026-10-25").filter((r) => r.team === "support");
    expect(sum(support)).toBe(6120);
    for (let d = 19; d <= 25; d++) expect(sum(support.filter((r) => r.date === `2026-10-${d}`))).toBe(245);
  });

  it("returns the whole month without asOf", () => {
    const days = new Set(loadUsage("2026-10").map((r) => r.date));
    expect(days.size).toBe(31);
  });

  it("includes OpenAI rows", () => {
    expect(loadUsage("2026-10").some((r) => r.source === "openai")).toBe(true);
  });

  it("covers 9 months", () => {
    const months = new Set(loadUsageRange("2026-02", "2026-10").map((r) => r.date.slice(0, 7)));
    expect(months.size).toBe(9);
  });
});

describe("contexts and actuals", () => {
  it("October: support has not replied, growth says 2x from Oct 26", () => {
    const ctx = loadContexts("2026-10");
    expect(ctx.find((c) => c.team === "support")?.replied).toBe(false);
    expect(ctx.find((c) => c.team === "growth")?.events[0]).toMatchObject({ date: "2026-10-26", multiplier: 2 });
  });

  it("actuals equal the sum of usage", () => {
    for (const a of loadActuals("2026-10")) {
      expect(a.actualUsd).toBeCloseTo(sum(loadUsage("2026-10").filter((r) => r.team === a.team)), 2);
    }
  });
});
