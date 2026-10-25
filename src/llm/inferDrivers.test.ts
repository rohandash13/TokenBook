// OWNER: D
import { describe, expect, it } from "vitest";
import type { LlmClient } from "./client.js";
import { datesInText, deterministicDrivers, guardEvent, inferDrivers, parseMultiplier, volumeMultipliers, type ProposedEvent } from "./inferDrivers.js";
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
    expect(parseMultiplier("3.5x volume")).toEqual([3.5]);
    expect(parseMultiplier("3× load")).toEqual([3]);
    expect(parseMultiplier("3X and 3× and 3.5x")).toEqual([3, 3.5]);
    expect(parseMultiplier("4 times the load")).toEqual([4]);
    expect(parseMultiplier("2 times the traffic")).toEqual([2]);
    expect(parseMultiplier("doubling traffic")).toEqual([2]);
    expect(parseMultiplier("traffic will triple")).toEqual([3]);
    expect(parseMultiplier("halve the API usage")).toEqual([0.5]);
    expect(parseMultiplier("tripling request volume, then half the spend")).toEqual([3, 0.5]);
  });
  it("ignores look-alikes", () => {
    for (const t of [
      "Support agent v2 launches Oct 27", "x-ray pipeline", "due 2026-10-27", "double-check the config",
      "first half of Oct", "x86", "x4", "x3 volume", "we need 2 x more", "10/3x", "2x4", "1x1", "v2", "Oct 27", "4K",
      "3xl", "3 times a day", "triple it", "we will halve it", "doubling, then half",
    ]) {
      expect(parseMultiplier(t), t).toEqual([]);
    }
  });
});

describe("volumeMultipliers", () => {
  it("keeps multipliers about API volume", () => {
    expect(volumeMultipliers("expect ~3x traffic on the API")).toEqual([3]);
    expect(volumeMultipliers("sizing for ~3x API calls")).toEqual([3]);
    expect(volumeMultipliers("doubling traffic")).toEqual([2]);
  });
  it("drops multipliers about anything else", () => {
    for (const t of [
      "Reranker is 2x faster", "cut p95 latency 3x", "ticket backlog is 2x", "2x more examples",
      "coffee consumption will 10x", "Reranker is 2x faster since the Oct 28 deploy",
    ]) {
      expect(volumeMultipliers(t), t).toEqual([]);
    }
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
  it("drops a non-volume multiplier cited by the LLM", async () => {
    const sig: Signal = { ...support[0], id: "slack:C1:9", text: "Reranker is 2x faster since the Oct 28 deploy" };
    const proposal = ev({ date: "2026-10-28", multiplier: 2, evidenceIds: [sig.id] });
    const r = await inferDrivers("support", MONTH, [sig], fake({ events: [proposal] }));
    expect(r.events).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["multiplier not in evidence"]);
  });
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
  it("drops a message-only event whose date a milestone superseded", async () => {
    const proposal = ev({ kind: "campaign", date: "2026-10-21", multiplier: undefined, note: "fall campaign", evidenceIds: ["slack:C2:1"] });
    const r = await inferDrivers("growth", MONTH, growth, fake({ events: [proposal] }));
    expect(r.events).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["date superseded by milestone"]);
  });
  describe("milestone moved within the month", () => {
    const id = "gh:milestone:nikhilrajgopal/northwind-demo:3";
    const moved: Signal[] = [
      { id, source: "github", kind: "milestone", team: "growth", date: "2026-10-01", url: "https://gh/3",
        text: "Milestone 'Fall campaign' due 2026-10-28: moved from Oct 21", dueDate: "2026-10-28", previousDueDate: "2026-10-21" },
    ];
    const prop = (date: string) => ev({ kind: "campaign", date, multiplier: undefined, note: "fall campaign", evidenceIds: [id] });
    it("drops the old date even though the text mentions it", async () => {
      const r = await inferDrivers("growth", MONTH, moved, fake({ events: [prop("2026-10-21")] }));
      expect(r.events).toEqual([]);
      expect(r.dropped.map((d) => d.reason)).toEqual(["date superseded by milestone"]);
    });
    it("keeps the new dueDate", async () => {
      const r = await inferDrivers("growth", MONTH, moved, fake({ events: [prop("2026-10-28")] }));
      expect(r.dropped).toEqual([]);
      expect(r.events).toHaveLength(1);
    });
    it("does not accept a non-dueDate date parsed from milestone text", () => {
      const byId = new Map(moved.map((s) => [s.id, s]));
      expect(guardEvent(prop("2026-10-29"), MONTH, new Map([[id, { ...moved[0], text: "due Oct 29", previousDueDate: undefined }]]))).toEqual({ ok: false, reason: "date not in evidence" });
      expect(guardEvent(prop("2026-10-28"), MONTH, byId).ok).toBe(true);
    });
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
  it("skips hypothetical or cancelled messages and non-volume multipliers", () => {
    const m = support[0];
    for (const text of [
      "If Support agent v2 launches Oct 27, expect ~3x traffic on the API",
      "Support agent v2 launch cancelled, was Oct 27 ~3x traffic",
      "Support agent v2 launches Oct 27 in staging, ~3x traffic",
      "Support agent v2 launches Oct 27, p95 latency 3x",
    ]) {
      expect(deterministicDrivers("support", MONTH, [{ ...m, text }]), text).toEqual([]);
    }
  });
  it("ignores closed or cancelled milestones", () => {
    for (const text of ["Milestone 'Support agent v2 launch' due 2026-10-27 (closed)", "Milestone 'Support agent v2 launch' cancelled, due 2026-10-27"]) {
      const ms = { ...support[1], text };
      expect(deterministicDrivers("support", MONTH, [ms])).toEqual([]);
    }
  });
  it("empty signals never call the LLM", async () => {
    const llm = fake({ events: [] });
    const r = await inferDrivers("support", MONTH, [], llm);
    expect(llm.calls).toBe(0);
    expect(r).toEqual({ events: [], dropped: [], usedLlm: false });
  });
});

describe("decoy rules (deterministic)", () => {
  const msg = (id: string, text: string, team: Signal["team"] = "support"): Signal => ({
    id, source: "slack", kind: "message", team, date: "2026-10-23", url: `https://slack/${id}`, text,
  });

  it("drops events dated before as-of", async () => {
    const past = msg("p1", "The Oct 8 campaign send drove 3x traffic to the landing page", "growth");
    const r = await inferDrivers("growth", MONTH, [past], null, "2026-10-20");
    expect(r.events).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["date before as-of (already in actuals)"]);
    const ok = await inferDrivers("support", MONTH, [msg("f1", "Support launch Oct 27 will be 3x traffic")], null, "2026-10-20");
    expect(ok.events).toHaveLength(1);
  });

  it("guardEvent rejects date before as-of", () => {
    const byId = new Map(support.map((s) => [s.id, s]));
    const g = guardEvent(ev({}), MONTH, byId, "2026-10-28");
    expect(g).toEqual({ ok: false, reason: "date before as-of (already in actuals)" });
  });

  it.each([
    "launch dropped from the plan Oct 27, 3x traffic",
    "Oct 27 launch will not happen, 3x traffic",
    "We won't ship the Oct 27 launch, 3x traffic",
    "Oct 27 launch is not shipping, 3x traffic",
    "Oct 27 launch scrapped, 3x traffic",
    "Oct 27 launch shelved, 3x traffic",
    "Oct 27 launch on hold, 3x traffic",
    "Oct 27 launch descoped, 3x traffic",
    "Oct 27 launch pulled, 3x traffic",
    "drop the Oct 27 launch, 3x traffic",
  ])("skips cancel phrase: %s", (t) => {
    expect(deterministicDrivers("support", MONTH, [msg("c", t)])).toEqual([]);
  });

  it("excludes other-team mentions from event creation", () => {
    const m = msg("g1", "Growth FYI: Support's launch on Oct 27 will 3x API traffic", "growth");
    expect(deterministicDrivers("growth", MONTH, [m])).toEqual([]);
    expect(deterministicDrivers("support", MONTH, [m])).toEqual([]);
  });

  it("excludes other-team and cancelled messages as milestone evidence", () => {
    const other = msg("o1", "Growth will share Support's Oct 27 launch post");
    const cancelled = msg("o2", "Support Oct 27 launch dropped, was 5x traffic");
    const good = msg("o3", "Oct 27 go-live, plan for ~3x API traffic");
    const out = deterministicDrivers("support", MONTH, [support[1], other, cancelled, good]);
    expect(out).toHaveLength(1);
    expect(out[0].evidenceIds).toEqual([SMS, "o3"]);
    expect(out[0].multiplier).toBe(3);
  });
});
