// OWNER: D
import { describe, expect, it } from "vitest";
import { seedSlack, type SeedSlackClient } from "./seedSlack.js";
import { SEED_EVENT_TYPE, type Scenario } from "./scenario.js";

type Msg = { ts: string; channel: string; text: string; thread_ts?: string; reply_count?: number; metadata?: { event_type?: string; event_payload?: Record<string, unknown> } };

function fake(opts: { channels?: { id: string; name: string; is_member: boolean }[]; messages?: Msg[]; failPostOnce?: unknown } = {}) {
  const channels = [...(opts.channels ?? [])];
  const messages: Msg[] = [...(opts.messages ?? [])];
  const calls: string[] = [];
  const posts: any[] = [];
  const deletes: string[] = [];
  let n = 1000;
  let fail = opts.failPostOnce;
  const client: SeedSlackClient = {
    conversations: {
      async list() { calls.push("list"); return { channels }; },
      async create({ name }) { calls.push("create"); const c = { id: `C_${name}`, name, is_member: true }; channels.push(c); return { channel: c }; },
      async setPurpose() { calls.push("setPurpose"); return {}; },
      async join({ channel }) { calls.push("join:" + channel); return {}; },
      async history({ channel }) { calls.push("history"); return { messages: messages.filter((m) => m.channel === channel && !m.thread_ts) }; },
      async replies({ channel, ts }) { calls.push("replies"); return { messages: messages.filter((m) => m.channel === channel && (m.ts === ts || m.thread_ts === ts)) }; },
    },
    chat: {
      async postMessage(a) {
        calls.push("post");
        if (fail) { const e = fail; fail = undefined; throw e; }
        posts.push(a);
        const ts = String(++n);
        messages.push({ ts, channel: a.channel, text: a.text, thread_ts: a.thread_ts, metadata: a.metadata });
        return { ts };
      },
      async delete({ channel, ts }) { calls.push("delete"); deletes.push(`${channel}:${ts}`); const i = messages.findIndex((m) => m.channel === channel && m.ts === ts); if (i >= 0) messages.splice(i, 1); return {}; },
    },
  };
  return { client, calls, posts, deletes, messages, channels };
}

const scenario: Scenario = {
  company: "Northwind",
  month: "2026-10",
  personas: [
    { id: "priya", name: "Priya Raman", title: "Support lead", team: "support", avatar: "https://x/p.png" },
    { id: "sam", name: "Sam Lee", title: "Eng", team: "support", avatar: "https://x/s.png" },
  ],
  channels: [
    { name: "support-eng", purpose: "Support", teams: ["support"] },
    { name: "growth", purpose: "Growth", teams: ["growth"] },
  ],
  messages: [
    { id: "r1", channel: "support-eng", persona: "sam", day: "2026-10-05", text: "reply", replyTo: "a" },
    { id: "a", channel: "support-eng", persona: "priya", day: "2026-10-04", text: "launch" },
    { id: "g1", channel: "growth", persona: "priya", day: "2026-10-03", text: "campaign" },
  ],
  repos: [],
  legacyCleanup: [],
  expected: {} as Scenario["expected"],
};

const sleep = async () => {};

describe("seedSlack", () => {
  it("creates missing channels, joins non-member ones, posts parents before replies", async () => {
    const f = fake({ channels: [{ id: "C_growth", name: "growth", is_member: false }] });
    const r = await seedSlack(scenario, f.client, { sleep });
    expect(f.calls).toContain("create");
    expect(f.calls).toContain("setPurpose");
    expect(f.calls).toContain("join:C_growth");
    expect(r).toEqual({ channels: 2, posted: 3, deleted: 0 });
    const reply = f.posts.find((p) => p.text === "reply");
    const parent = f.messages.find((m) => m.text === "launch")!;
    expect(f.posts.findIndex((p) => p.text === "launch")).toBeLessThan(f.posts.indexOf(reply));
    expect(reply.thread_ts).toBe(parent.ts);
  });

  it("uses persona username/icon and seed metadata", async () => {
    const f = fake();
    await seedSlack(scenario, f.client, { sleep });
    const p = f.posts.find((x) => x.text === "launch");
    expect(p.username).toBe("Priya Raman · Support lead");
    expect(p.icon_url).toBe("https://x/p.png");
    expect(p.unfurl_links).toBe(false);
    expect(p.metadata).toEqual({ event_type: SEED_EVENT_TYPE, event_payload: { id: "a", day: "2026-10-04", persona: "priya" } });
  });

  it("skips already-seeded ids and threads under the existing parent", async () => {
    const f = fake({
      channels: [{ id: "C_support-eng", name: "support-eng", is_member: true }, { id: "C_growth", name: "growth", is_member: true }],
      messages: [{ ts: "1", channel: "C_support-eng", text: "launch", reply_count: 0, metadata: { event_type: SEED_EVENT_TYPE, event_payload: { id: "a" } } }],
    });
    const r = await seedSlack(scenario, f.client, { sleep });
    expect(r.posted).toBe(2);
    expect(f.posts.find((p) => p.text === "reply").thread_ts).toBe("1");
    expect(f.posts.some((p) => p.text === "launch")).toBe(false);
  });

  it("reset deletes only seeded messages including thread replies", async () => {
    const seeded = (id: string) => ({ event_type: SEED_EVENT_TYPE, event_payload: { id } });
    const f = fake({
      channels: [{ id: "C_support-eng", name: "support-eng", is_member: true }, { id: "C_growth", name: "growth", is_member: true }],
      messages: [
        { ts: "1", channel: "C_support-eng", text: "launch", reply_count: 1, metadata: seeded("a") },
        { ts: "2", channel: "C_support-eng", text: "reply", thread_ts: "1", metadata: seeded("r1") },
        { ts: "3", channel: "C_support-eng", text: "human", reply_count: 1 },
        { ts: "4", channel: "C_support-eng", text: "human reply", thread_ts: "3" },
        { ts: "5", channel: "C_growth", text: "other", metadata: { event_type: "something_else" } },
      ],
    });
    const r = await seedSlack(scenario, f.client, { reset: true, sleep });
    expect(r.deleted).toBe(2);
    expect(f.deletes.sort()).toEqual(["C_support-eng:1", "C_support-eng:2"]);
    expect(r.posted).toBe(3);
  });

  it("dryRun makes no write calls", async () => {
    const f = fake({ channels: [{ id: "C_growth", name: "growth", is_member: false }] });
    const logs: string[] = [];
    const r = await seedSlack(scenario, f.client, { dryRun: true, reset: true, sleep, log: (m) => logs.push(m) });
    const writes = f.calls.filter((c) => c === "create" || c === "setPurpose" || c.startsWith("join") || c === "post" || c === "delete");
    expect(writes).toEqual([]);
    expect(r.posted).toBe(3);
    expect(logs.some((l) => l.includes("dry-run"))).toBe(true);
  });

  it("retries once after ratelimited, waiting retryAfter", async () => {
    const f = fake({ failPostOnce: Object.assign(new Error("ratelimited"), { data: { error: "ratelimited" }, retryAfter: 3 }) });
    const waits: number[] = [];
    const r = await seedSlack(scenario, f.client, { sleep: async (ms) => { waits.push(ms); } });
    expect(r.posted).toBe(3);
    expect(waits).toContain(3000);
    expect(f.calls.filter((c) => c === "post").length).toBe(4);
  });
});
