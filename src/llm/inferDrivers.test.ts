// OWNER: D
import { describe, expect, it } from "vitest";
import type { LlmClient } from "./client.js";
import { datesInText, deterministicDrivers, guardEvent, inferDrivers, parseMultiplier, type ProposedEvent } from "./inferDrivers.js";
import type { Signal } from "../signals/types.js";

const MONTH = "2026-10";
const SMSG = "slack:C1:1";
const SMS = "gh:milestone:nikhilrajgopal/northwind-demo:1";

const support: Signal[] = [
  { id: SMSG, source: "slack", kind: "message", team: "support", date: "2026-10-25", url: "https://slack/1", author: "Priya",
    text: "Support agent v2 launches Oct 27, expect ~3x traffic on the API" },
  { id: SMS, source: "github", kind: "milestone", team: "support", date: "2026-10-01", url: "https://gh/1",
    text: "Milestone 'Support agent v2 launch' due 2026-10-27", dueDate: "2026-10-27" },
];
const growth: Signal[] = [
  { id: "slack:C2:1", source: "slack", kind: "message", team: "growth", date: "2026-10-25", url: "https://slack/2", text: "Fall campaign kicks off Oct 21" },
  { id: "slack:C2:2", source: "slack", kind: "message", team: "growth", date: "2026-10-25", url: "https://slack/3", text: "Campaign pushed to Nov 4, creative not ready" },
  { id: "gh:milestone:nikhilrajgopal/northwind-demo:2", source: "github", kind: "milestone", team: "growth", date: "2026-10-01", url: "https://gh/2",
    text: "Milestone 'Fall campaign' due 2026-11-04: moved from Oct 21", dueDate: "2026-11-04", previousDueDate: "2026-10-21" },
];

function fake(reply: unknown): LlmClient & { calls: number } {
  return { calls: 0, async complete() { this.calls++; return typeof reply === "string" ? reply : JSON.stringify(reply); } };
}
const ev = (o: Partial<ProposedEvent>): ProposedEvent => ({
  kind: "launch", date: "2026-10-27", multiplier: 3, note: "support launch", evidenceIds: [SMSG, SMS], ...o,
});

describe("parseMultiplier", () => {
  it("matches stated multipliers", () => {
    expect(parseMultiplier("expect ~3x traffic")).toEqual([3]);
    expect(parseMultiplier("3X and 3× and 3.5x")).toEqual([3, 3.5]);
    expect(parseMultiplier("about x3 volume")).toEqual([3]);
    expect(parseMultiplier("4 times the load")).toEqual([4]);
    expect(parseMultiplier("triple it")).toEqual([3]);
    expect(parseMultiplier("doubling, then half")).toEqual([2, 0.5]);
    expect(parseMultiplier("we will halve it")).toEqual([0.5]);
  });
  it("ignores look-alikes", () => {
    expect(parseMultiplier("Support agent v2 launches Oct 27")).toEqual([]);
    expect(parseMultiplier("x-ray pipeline")).toEqual([]);
    expect(parseMultiplier("due 2026-10-27")).toEqual([]);
  });
});

describe("datesInText", () => {
  it("finds written dates", () => {
    expect(datesInText("launches Oct 27 and October 28th", 2026)).toEqual(["2026-10-27", "2026-10-28"]);
    expect(datesInText("pushed to NOV 4", 2026)).toEqual(["2026-11-04"]);
    expect(datesInText("on 10/27 or 2026-10-29", 2026)).toEqual(["2026-10-27", "2026-10-29"]);
    expect(datesInText("nothing here, Oct 2026 or v2", 2026)).toEqual([]);
  });
});

describe("inferDrivers with an LLM", () => {
  it("keeps a grounded 3x launch with merged evidence", async () => {
    const r = await inferDrivers("support", MONTH, support, fake({ events: [ev({})] }));
    expect(r.usedLlm).toBe(true);
    expect(r.dropped).toEqual([]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ date: "2026-10-27", multiplier: 3, source: "slack" });
    expect(r.events[0].evidence).toHaveLength(2);
  });
  const dropCases: [string, Partial<ProposedEvent>, string][] = [
    ["invented multiplier", { multiplier: 4 }, "multiplier not in evidence"],
    ["date not in evidence", { date: "2026-10-29" }, "date not in evidence"],
    ["unknown id", { evidenceIds: ["nope"] }, "unknown evidence id"],
    ["date outside month", { date: "2026-11-04" }, "date outside month"],
    ["bad note", { note: "  " }, "bad note"],
  ];
  for (const [name, patch, reason] of dropCases) {
    it(`drops: ${name}`, async () => {
      const r = await inferDrivers("support", MONTH, support, fake({ events: [ev(patch)] }));
      expect(r.events).toEqual([]);
      expect(r.dropped.map((d) => d.reason)).toEqual([reason]);
    });
  }
  it("drops uncited events (guard)", () => {
    const byId = new Map(support.map((s) => [s.id, s]));
    expect(guardEvent(ev({ evidenceIds: [] }), MONTH, byId)).toEqual({ ok: false, reason: "uncited" });
  });
  it("drops a campaign citing the slipped milestone", async () => {
    const proposal = ev({ kind: "campaign", date: "2026-10-21", multiplier: undefined, note: "fall campaign",
      evidenceIds: ["gh:milestone:nikhilrajgopal/northwind-demo:2"] });
    const r = await inferDrivers("growth", MONTH, growth, fake({ events: [proposal] }));
    expect(r.events).toEqual([]);
    expect(r.dropped[0].reason).toBe("milestone moved out of month");
  });
  it("fills the table multiplier when none is given", async () => {
    const proposal = ev({ multiplier: undefined, evidenceIds: [SMS] });
    const r = await inferDrivers("support", MONTH, support, fake({ events: [proposal] }));
    expect(r.events).toHaveLength(1);
    expect(r.events[0].multiplier).toBe(2);
    expect(r.events[0].source).toBe("github");
  });
  it("de-duplicates identical events", async () => {
    const r = await inferDrivers("support", MONTH, support, fake({ events: [ev({}), ev({})] }));
    expect(r.events).toHaveLength(1);
  });
  it("falls back to the deterministic path after bad JSON twice", async () => {
    const llm = fake("not json at all");
    const r = await inferDrivers("support", MONTH, support, llm);
    expect(llm.calls).toBe(2);
    expect(r.usedLlm).toBe(false);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ date: "2026-10-27", multiplier: 3 });
  });
});

describe("deterministic path (llm null)", () => {
  it("support: one launch event at 3x", async () => {
    const r = await inferDrivers("support", MONTH, support, null);
    expect(r.usedLlm).toBe(false);
    expect(r.dropped).toEqual([]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ date: "2026-10-27", multiplier: 3, note: "support launch" });
  });
  it("growth: no events", async () => {
    const r = await inferDrivers("growth", MONTH, growth, null);
    expect(r.events).toEqual([]);
    expect(deterministicDrivers("growth", MONTH, growth)).toEqual([]);
  });
  it("message-only event needs a date in month and a multiplier", () => {
    const m = support[0];
    expect(deterministicDrivers("support", MONTH, [m])).toHaveLength(1);
    expect(deterministicDrivers("support", MONTH, [{ ...m, text: "launch on Oct 27" }])).toEqual([]);
  });
  it("empty signals never call the LLM", async () => {
    const llm = fake({ events: [] });
    const r = await inferDrivers("support", MONTH, [], llm);
    expect(llm.calls).toBe(0);
    expect(r).toEqual({ events: [], dropped: [], usedLlm: false });
  });
});
