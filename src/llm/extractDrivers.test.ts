// OWNER: D
import { describe, expect, it } from "vitest";
import type { LlmClient } from "./client.js";
import { driversFromButtons, extractDrivers, type ExtractInput } from "./extractDrivers.js";

function fakeLlm(replies: string[]): LlmClient & { calls: number; lastSystem?: string; lastUser?: string } {
  const fake = {
    calls: 0,
    lastSystem: undefined as string | undefined,
    lastUser: undefined as string | undefined,
    async complete(system: string, user: string) {
      fake.lastSystem = system;
      fake.lastUser = user;
      const reply = replies[Math.min(fake.calls, replies.length - 1)];
      fake.calls++;
      return reply;
    },
  };
  return fake;
}

const base: ExtractInput = {
  team: "support",
  month: "2026-10",
  text: "We launch the new bot on Oct 27, expect roughly triple traffic after that.",
  buttons: { launches: "yes", volume: "much_higher" },
  today: "2026-10-24",
  leadName: "Priya",
  repliedAt: "2026-10-24T16:02:00Z",
};

const good = JSON.stringify({
  events: [{ date: "2026-10-27", multiplier: 3, note: "New support bot launch" }],
  quote: "Launching Oct 27, about 3x (model paraphrase)",
});

describe("extractDrivers", () => {
  it("accepts good JSON and keeps the lead's own words as the quote", async () => {
    const llm = fakeLlm([good]);
    const ctx = await extractDrivers(base, llm);
    expect(llm.calls).toBe(1);
    expect(ctx).toEqual({
      team: "support",
      month: "2026-10",
      replied: true,
      events: [{ date: "2026-10-27", multiplier: 3, note: "New support bot launch" }],
      quote: base.text,
      repliedAt: base.repliedAt,
      leadName: "Priya",
    });
    expect(llm.lastSystem).toContain('"events"');
    expect(llm.lastUser).toContain("Month: 2026-10");
    expect(llm.lastUser).toContain("Today: 2026-10-24");
    expect(llm.lastUser).toContain("much_higher");
  });

  it("tolerates fenced JSON", async () => {
    const ctx = await extractDrivers(base, fakeLlm(["```json\n" + good + "\n```"]));
    expect(ctx.events[0].multiplier).toBe(3);
  });

  it("retries once after bad JSON", async () => {
    const llm = fakeLlm(["not json at all", good]);
    const ctx = await extractDrivers(base, llm);
    expect(llm.calls).toBe(2);
    expect(ctx.events).toEqual([{ date: "2026-10-27", multiplier: 3, note: "New support bot launch" }]);
  });

  it("falls back to buttons after bad JSON twice", async () => {
    const llm = fakeLlm(["nope", '{"events": "wrong"}']);
    const ctx = await extractDrivers(base, llm);
    expect(llm.calls).toBe(2);
    expect(ctx).toEqual(driversFromButtons(base));
    expect(ctx.events[0]).toMatchObject({ date: "2026-10-24", multiplier: 2 });
  });

  it("rejects an out-of-month date and falls back", async () => {
    const bad = JSON.stringify({ events: [{ date: "2026-11-02", multiplier: 3, note: "launch" }], quote: "x" });
    const ctx = await extractDrivers(base, fakeLlm([bad]));
    expect(ctx).toEqual(driversFromButtons(base));
  });

  it("rejects an impossible calendar date", async () => {
    const bad = JSON.stringify({ events: [{ date: "2026-10-32", multiplier: 3, note: "launch" }], quote: "x" });
    expect(await extractDrivers(base, fakeLlm([bad]))).toEqual(driversFromButtons(base));
  });

  it.each([0, -1, 10.5])("rejects multiplier %s and falls back", async (m) => {
    const bad = JSON.stringify({ events: [{ date: "2026-10-27", multiplier: m, note: "launch" }], quote: "x" });
    expect(await extractDrivers(base, fakeLlm([bad]))).toEqual(driversFromButtons(base));
  });

  it("accepts multiplier exactly 10", async () => {
    const ok = JSON.stringify({ events: [{ date: "2026-10-27", multiplier: 10, note: "launch" }], quote: "x" });
    expect((await extractDrivers(base, fakeLlm([ok]))).events[0].multiplier).toBe(10);
  });

  it("rejects notes over 40 chars", async () => {
    const bad = JSON.stringify({ events: [{ date: "2026-10-27", multiplier: 2, note: "x".repeat(41) }], quote: "x" });
    expect(await extractDrivers(base, fakeLlm([bad]))).toEqual(driversFromButtons(base));
  });

  it("accepts empty events when nothing changes", async () => {
    const ctx = await extractDrivers(base, fakeLlm([JSON.stringify({ events: [], quote: "same as usual" })]));
    expect(ctx.events).toEqual([]);
    expect(ctx.quote).toBe(base.text);
  });

  it("uses the button fallback when there is no LLM", async () => {
    const ctx = await extractDrivers(base, null);
    expect(ctx).toEqual(driversFromButtons(base));
    expect(ctx.replied).toBe(true);
  });
});

describe("driversFromButtons", () => {
  const input = (buttons: ExtractInput["buttons"], text = ""): ExtractInput => ({ ...base, buttons, text });

  it.each([
    ["higher", 1.3],
    ["much_higher", 2],
    ["lower", 0.8],
  ] as const)("volume %s maps to %sx from today", (volume, multiplier) => {
    const ctx = driversFromButtons(input({ volume }));
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0]).toMatchObject({ date: "2026-10-24", multiplier });
    expect(ctx.events[0].note.length).toBeGreaterThan(0);
  });

  it("same volume adds no event", () => {
    expect(driversFromButtons(input({ volume: "same" })).events).toEqual([]);
  });

  it("missing volume adds no event", () => {
    expect(driversFromButtons(input({})).events).toEqual([]);
    expect(driversFromButtons(input({ launches: "no" })).events).toEqual([]);
  });

  it("launch yes with no volume is a note-only 1x event", () => {
    const ctx = driversFromButtons(input({ launches: "yes" }));
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0]).toMatchObject({ date: "2026-10-24", multiplier: 1 });
    expect(ctx.events[0].note).toMatch(/launch/i);
  });

  it("sets reply fields and leaves quote undefined for empty text", () => {
    const ctx = driversFromButtons(input({ volume: "higher" }));
    expect(ctx).toMatchObject({ team: "support", month: "2026-10", replied: true, leadName: "Priya", repliedAt: base.repliedAt });
    expect(ctx.quote).toBeUndefined();
    expect(driversFromButtons(input({}, "busy week")).quote).toBe("busy week");
  });
});
