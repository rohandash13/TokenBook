// OWNER: A
import { describe, expect, it } from "vitest";
import type { Actual, TeamContext, UsageDay } from "../shared/types.js";
import { daysRemaining, remainingDates } from "./dates.js";
import { lastMonth, recentDailyRate, runRate, trueUp } from "./methods.js";

const day = (date: string, costUsd: number, team: UsageDay["team"] = "support"): UsageDay => ({
  date, team, model: "claude-sonnet", costUsd, inputTokens: 0, outputTokens: 0, source: "anthropic",
});
const oct = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;

// Spec worked example: $6,120 through Oct 25 at ~$245/day.
// Oct 1–18 sum to $4,405; Oct 19–25 are flat $245 so the weighted rate is exactly $245.
const support: UsageDay[] = [
  ...Array.from({ length: 18 }, (_, i) => day(oct(i + 1), i === 17 ? 4405 - 17 * 244 : 244)),
  ...Array.from({ length: 7 }, (_, i) => day(oct(19 + i), 245)),
];
const asOf = "2026-10-25";

const ctx = (over: Partial<TeamContext>): TeamContext => ({
  team: "support", month: "2026-10", replied: true, events: [], leadName: "Priya", ...over,
});

describe("dates", () => {
  it("counts days left after asOf", () => {
    expect(daysRemaining(asOf)).toBe(6);
    expect(remainingDates(asOf)).toEqual([oct(26), oct(27), oct(28), oct(29), oct(30), oct(31)]);
    expect(daysRemaining("2026-02-28")).toBe(0);
  });
});

describe("recentDailyRate", () => {
  it("weights the newest day most", () => {
    // Days cost 10, 20, ... 70 with weights 1..7: Σ(10i·i)/28 = 50
    const usage = Array.from({ length: 7 }, (_, i) => day(oct(19 + i), 10 * (i + 1)));
    expect(recentDailyRate("support", usage, asOf)).toBeCloseTo(50);
  });

  it("only uses days that have data", () => {
    const usage = [day(oct(1), 100), day(oct(2), 100)];
    expect(recentDailyRate("support", usage, oct(2))).toBe(100);
  });

  it("is 0 for a team with no usage", () => {
    expect(recentDailyRate("growth", support, asOf)).toBe(0);
  });
});

describe("runRate", () => {
  it("matches the spec example: $6,120 + 6 × $245 = $7,590", () => {
    const e = runRate("support", support, asOf);
    expect(e.actualToDate).toBe(6120);
    expect(e.estimate).toBe(7590);
    expect(e).toMatchObject({ method: "runrate", month: "2026-10", confidence: "medium" });
    expect(e.basis).toContain("$6,120 through Oct 25 + 6 days at $245/day");
  });

  it("equals actual to date on the last day of the month", () => {
    const e = runRate("support", support, "2026-10-31");
    expect(e.estimate).toBe(e.actualToDate);
  });
});

describe("trueUp", () => {
  it("matches the spec example: 3× launch from Oct 27 → $10,040", () => {
    const context = ctx({
      events: [{ date: oct(27), multiplier: 3, note: "Support agent launch" }],
      quote: "launching Oct 27, expect about 3x", repliedAt: "2026-10-24T14:14:00-07:00",
    });
    const e = trueUp("support", support, context, asOf, []);
    expect(e.estimate).toBe(10040);
    expect(e.confidence).toBe("high");
    expect(e.basis).toContain("1 day at $245/day + 5 days at $735/day");
    expect(e.basis).toContain("3× from Oct 27");
    expect(e.basis).toContain('Per Priya, replied Oct 24: "launching Oct 27, expect about 3x"');
  });

  it("uses signal-inferred events at medium confidence and cites the evidence", () => {
    const context = ctx({
      replied: false, inferred: true,
      events: [{
        date: oct(27), multiplier: 3, note: "support launch", source: "slack",
        evidence: [
          { source: "slack", id: "slack:C1:1", url: "https://slack.com/x", text: "launches Oct 27, expect ~3x", date: oct(20), author: "Priya Raman" },
          { source: "github", id: "gh:m:1", url: "https://github.com/x", text: "Milestone 'Support agent v2 launch' due 2026-10-27", date: oct(24) },
          { source: "jira", id: "jira:1", url: "https://jira.example/x", text: "third item is not quoted", date: oct(21) },
        ],
      }],
    });
    const e = trueUp("support", support, context, asOf, []);
    expect(e.estimate).toBe(10040);
    expect(e.confidence).toBe("medium");
    expect(e.basis).toContain(`Evidence: Slack, Oct 20, Priya Raman: "launches Oct 27, expect ~3x"; GitHub, Oct 24: "Milestone 'Support agent v2 launch' due 2026-10-27".`);
    expect(e.basis).not.toContain("third item");
    expect(e.basis).not.toContain("replied");
  });

  it("uses the run-rate at medium when signals were checked and showed no change", () => {
    const e = trueUp("support", support, ctx({ replied: false, inferred: true }), asOf, []);
    expect(e.estimate).toBe(7590);
    expect(e.confidence).toBe("medium");
    expect(e.basis).toContain("Signals checked: no upcoming changes found.");
    expect(e.basis).not.toContain("Evidence:");
  });

  it("treats inferred events dated before asOf as already in actuals, not as drivers", () => {
    const context = ctx({ replied: false, inferred: true, events: [{ date: oct(20), multiplier: 3, note: "old launch", source: "slack" }] });
    const e = trueUp("support", support, context, asOf, []);
    expect(e.estimate).toBe(7590);
    expect(e.confidence).toBe("medium");
    expect(e.basis).toContain("Already in actuals: old launch (Oct 20)");
    expect(e.basis).toContain("no upcoming changes found");
  });

  it("still uses the low-confidence average when nothing was checked and nobody replied", () => {
    const e = trueUp("support", support, ctx({ replied: false }), asOf, []);
    expect(e.confidence).toBe("low");
  });

  it("dates a UTC reply timestamp in Pacific time", () => {
    // 5:28 PM PT on Oct 24 is already Oct 25 in UTC.
    const e = trueUp("support", support, ctx({ repliedAt: "2026-10-25T00:28:00.000Z" }), asOf, []);
    expect(e.basis).toContain("replied Oct 24");
  });

  it("equals run-rate when the lead expects no change", () => {
    const e = trueUp("support", support, ctx({ quote: "Steady." }), asOf, []);
    expect(e.estimate).toBe(7590);
    expect(e.confidence).toBe("high");
  });

  it("multiplies overlapping events", () => {
    const context = ctx({
      events: [
        { date: oct(27), multiplier: 2, note: "launch" },
        { date: oct(30), multiplier: 1.5, note: "batch run" },
      ],
    });
    // Oct 26 at 245, Oct 27–29 at 490, Oct 30–31 at 735
    expect(trueUp("support", support, context, asOf, []).estimate).toBe(6120 + 245 + 3 * 490 + 2 * 735);
  });

  it("books a one-day 10× spike with until", () => {
    const context = ctx({ events: [{ date: oct(27), until: oct(27), multiplier: 10, note: "backfill" }] });
    const e = trueUp("support", support, context, asOf, []);
    expect(e.estimate).toBe(7590 + 9 * 245);
    expect(e.basis).toContain("10× on Oct 27 only");
  });

  it("reduces a shutdown window to zero and resumes baseline afterward", () => {
    const context = ctx({ events: [{ date: oct(27), until: oct(29), multiplier: 0, note: "shutdown" }] });
    expect(trueUp("support", support, context, asOf, []).estimate).toBe(6120 + 3 * 245);
  });

  it("applies successive total-volume windows without multiplying them together", () => {
    const context = ctx({ events: [
      { date: oct(27), until: oct(28), multiplier: 2, note: "initial total" },
      { date: oct(29), multiplier: 3, note: "new total" },
    ] });
    expect(trueUp("support", support, context, asOf, []).estimate).toBe(6120 + 245 + 2 * 490 + 3 * 735);
  });

  it("books a two-day window", () => {
    const context = ctx({ events: [{ date: oct(27), until: oct(29), multiplier: 2, note: "reindex" }] });
    const e = trueUp("support", support, context, asOf, []);
    expect(e.estimate).toBe(7590 + 3 * 245);
    expect(e.basis).toContain("2× Oct 27–29");
  });

  it("lists flags in the basis without changing the estimate", () => {
    const flag = { date: oct(27), note: "new agent launch", reason: "size unknown" as const };
    const plain = trueUp("support", support, ctx({ quote: "ok" }), asOf, []);
    const e = trueUp("support", support, ctx({ quote: "ok", flags: [flag] }), asOf, []);
    expect(e.estimate).toBe(plain.estimate);
    expect(e.confidence).toBe("medium");
    expect(e.basis).toContain("Flagged for review: new agent launch on Oct 27 (size unknown).");
  });

  it("starts an event dated asOf ('from today') on the next day", () => {
    // Slack's button fallback dates events today, and asOf is today.
    const context = ctx({ events: [{ date: asOf, multiplier: 2, note: "Much higher" }] });
    const e = trueUp("support", support, context, asOf, []);
    expect(e.estimate).toBe(6120 + 6 * 490);
    expect(e.basis).toContain("2× from Oct 26");
  });

  it("ignores an event dated before asOf: it is already in the actuals", () => {
    const context = ctx({ events: [{ date: oct(15), multiplier: 1.8, note: "Index rebuild" }] });
    const e = trueUp("support", support, context, asOf, []);
    expect(e.estimate).toBe(7590);
    expect(e.basis).toContain("Already in actuals: Index rebuild (Oct 15)");
  });

  describe("no reply", () => {
    // Jul–Sep: 92 days at $245/day
    const history: Actual[] = [
      { team: "support", month: "2026-07", actualUsd: 31 * 245 },
      { team: "support", month: "2026-08", actualUsd: 31 * 245 },
      { team: "support", month: "2026-09", actualUsd: 30 * 245 },
      { team: "support", month: "2026-06", actualUsd: 999_999 }, // outside the 3-month window
    ];

    it("uses the trailing 3-month daily average with low confidence", () => {
      // Recent rate is 245 too, so make history differ to prove which one is used.
      const lower = history.map((h) => ({ ...h, actualUsd: (h.actualUsd / 245) * 200 }));
      const e = trueUp("support", support, ctx({ replied: false }), asOf, lower);
      expect(e.estimate).toBe(6120 + 6 * 200);
      expect(e.confidence).toBe("low");
      expect(e.basis).toContain("No signals collected yet");
      expect(e.basis).toContain("Jul–Sep average");
    });

    it("gives the demo's $7,590 with Jul–Sep at $245/day", () => {
      expect(trueUp("support", support, ctx({ replied: false }), asOf, history).estimate).toBe(7590);
    });

    it("treats a missing context as no reply", () => {
      expect(trueUp("support", support, undefined, asOf, history).confidence).toBe("low");
    });

    it("falls back to run-rate when there is no history", () => {
      const e = trueUp("support", support, ctx({ replied: false }), asOf, []);
      expect(e.estimate).toBe(7590);
      expect(e.confidence).toBe("low");
      expect(e.basis).toContain("no prior history");
    });
  });
});

describe("lastMonth", () => {
  it("carries last month's actual forward", () => {
    const e = lastMonth("support", support, asOf, [{ team: "support", month: "2026-09", actualUsd: 7100 }]);
    expect(e).toMatchObject({ method: "lastmonth", estimate: 7100, actualToDate: 6120, confidence: "low" });
    expect(e.basis).toContain("Sep actual of $7,100");
  });

  it("shows actual to date when there is no prior month", () => {
    expect(lastMonth("support", support, asOf, []).estimate).toBe(6120);
  });
});
