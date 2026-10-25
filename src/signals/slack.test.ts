// OWNER: D
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SEED_EVENT_TYPE } from "../demo/scenario.js";
import { readSlackSignals, type SlackReaderClient } from "./slack.js";
import type { Signal } from "./types.js";

type Msg = { ts: string; text?: string; user?: string; subtype?: string; bot_id?: string; username?: string; reply_count?: number; metadata?: { event_type?: string } };

function fakeClient(opts: {
  listPages?: { channels: { id: string; name: string; is_member?: boolean }[]; next?: string }[];
  history?: Record<string, Msg[][]>;
  replies?: Record<string, Msg[][]>; // key: `${channel}:${parentTs}`
  permalink?: () => Promise<{ permalink?: string }>;
}) {
  const listPages = opts.listPages ?? [{ channels: [{ id: "C1", name: "support-eng", is_member: true }] }];
  const list = vi.fn(async (args: { cursor?: string }) => {
    const i = args.cursor ? Number(args.cursor) : 0;
    const p = listPages[i];
    return { channels: p.channels, response_metadata: { next_cursor: p.next ?? "" } };
  });
  const history = vi.fn(async (args: { channel: string; oldest?: string; latest?: string; cursor?: string }) => {
    const pages = opts.history?.[args.channel] ?? [[]];
    const i = args.cursor ? Number(args.cursor) : 0;
    return { messages: pages[i], response_metadata: { next_cursor: i + 1 < pages.length ? String(i + 1) : "" } };
  });
  const replies = vi.fn(async (args: { channel: string; ts: string; cursor?: string }) => {
    const pages = opts.replies?.[`${args.channel}:${args.ts}`] ?? [[]];
    const i = args.cursor ? Number(args.cursor) : 0;
    return { messages: pages[i], response_metadata: { next_cursor: i + 1 < pages.length ? String(i + 1) : "" } };
  });
  const getPermalink = vi.fn(opts.permalink ?? (async (a: { channel: string; message_ts: string }) => ({ permalink: `https://x/${a.channel}/${a.message_ts}` })));
  const client: SlackReaderClient = { conversations: { list, history, replies }, chat: { getPermalink } };
  return { client, list, history, replies, getPermalink };
}

const TS = 1792803900; // inside October 2026

describe("readSlackSignals", () => {
  it("resolves channel names across paginated conversations.list", async () => {
    const { client, list, history } = fakeClient({
      listPages: [
        { channels: [{ id: "C9", name: "other" }], next: "1" },
        { channels: [{ id: "C1", name: "support-eng", is_member: true }] },
      ],
      history: { C1: [[{ ts: String(TS), text: "hi", user: "U1" }]] },
    });
    const out = await readSlackSignals("support", "2026-10", { client, log: () => {} });
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0]).toMatchObject({ types: "public_channel", exclude_archived: true, limit: 200 });
    expect(history).toHaveBeenCalledTimes(1);
    expect(out.map((s) => s.id)).toEqual([`slack:C1:${TS}`]);
  });

  it("skips missing channels and channels the bot is not in, logging once each", async () => {
    const log = vi.fn();
    const { client, history } = fakeClient({ listPages: [{ channels: [{ id: "C2", name: "growth", is_member: false }] }] });
    expect(await readSlackSignals("growth", "2026-10", { client, log })).toEqual([]);
    expect(history).not.toHaveBeenCalled();
    // growth, growth-campaigns, launches, incidents, eng-announcements: one log each
    expect(log).toHaveBeenCalledTimes(5);
    expect(log.mock.calls.filter(([m]) => String(m).includes("not a member"))).toHaveLength(1);

    const log2 = vi.fn();
    const f2 = fakeClient({ listPages: [{ channels: [] }] });
    expect(await readSlackSignals("growth", "2026-10", { client: f2.client, log: log2 })).toEqual([]);
    expect(log2).toHaveBeenCalledTimes(5);
  });

  it("paginates conversations.history and sorts by date then id", async () => {
    const { client, history } = fakeClient({
      history: { C1: [[{ ts: "1792803900.000200", text: "b", user: "U1" }], [{ ts: "1792803900.000100", text: "a", user: "U1" }, { ts: "1792000000.000100", text: "early", user: "U1" }]] },
    });
    const out = await readSlackSignals("support", "2026-10", { client, log: () => {} });
    expect(history).toHaveBeenCalledTimes(2);
    expect(out.map((s) => s.text)).toEqual(["early", "a", "b"]);
  });

  it("skips subtype, bot and empty messages", async () => {
    const { client } = fakeClient({
      history: { C1: [[
        { ts: "1792803901.000100", text: "joined", subtype: "channel_join", user: "U1" },
        { ts: "1792803902.000100", text: "beep", bot_id: "B1" },
        { ts: "1792803903.000100", text: "  " },
        { ts: "1792803904.000100", text: "keep me", user: "U2" },
      ]] },
    });
    const out = await readSlackSignals("support", "2026-10", { client, log: () => {} });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "slack", kind: "message", team: "support", text: "keep me", author: "U2" });
  });

  it("converts ts to a UTC date", async () => {
    const { client } = fakeClient({ history: { C1: [[{ ts: `${TS}.000100`, text: "x", user: "U1" }]] } });
    const out = await readSlackSignals("support", "2026-10", { client, log: () => {} });
    expect(out[0].date).toBe(new Date(TS * 1000).toISOString().slice(0, 10));
  });

  it("falls back to a constructed permalink when getPermalink throws", async () => {
    const { client } = fakeClient({
      history: { C1: [[{ ts: "1792803900.000100", text: "x", user: "U1" }]] },
      permalink: async () => { throw new Error("nope"); },
    });
    const out = await readSlackSignals("support", "2026-10", { client, log: () => {} });
    expect(out[0].url).toBe("https://slack.com/archives/C1/p1792803900000100");
  });

  it("passes the window as oldest/latest unix-second strings", async () => {
    const { client, history } = fakeClient({});
    await readSlackSignals("support", "2026-10", { client, log: () => {} });
    const args = history.mock.calls[0][0];
    expect(args.oldest).toBe(String(Date.UTC(2026, 9, 1) / 1000 - 14 * 86400));
    expect(args.latest).toBe(String(Date.UTC(2026, 10, 1) / 1000 - 1));
  });
});

describe("shared channels, seeded personas and threads", () => {
  const listPages = [{ channels: [
    { id: "C1", name: "support-eng", is_member: true },
    { id: "C7", name: "launches", is_member: true },
  ] }];
  const seeded = { event_type: SEED_EVENT_TYPE };
  const quiet = () => {};

  it("keeps shared-channel messages for a team only when a keyword matches", async () => {
    const msgs = [[
      { ts: "1792803901.000100", text: "Support agent v2 ships Monday", user: "U1" },
      { ts: "1792803902.000100", text: "Search reindex tonight", user: "U2" },
      { ts: "1792803903.000100", text: "Unrelated chatter", user: "U3" },
      { ts: "1792803904.000100", text: "Research notes", user: "U3" },
    ]];
    const { client } = fakeClient({ listPages, history: { C7: msgs } });
    const support = await readSlackSignals("support", "2026-10", { client, log: quiet });
    expect(support.map((s) => s.text)).toEqual(["Support agent v2 ships Monday"]);
    const search = await readSlackSignals("search", "2026-10", { client, log: quiet });
    expect(search.map((s) => s.text)).toEqual(["Search reindex tonight"]);
  });

  it("does not filter a team's own channels by keyword", async () => {
    const { client } = fakeClient({ listPages, history: { C1: [[{ ts: "1792803901.000100", text: "no keywords here", user: "U1" }]] } });
    expect(await readSlackSignals("support", "2026-10", { client, log: quiet })).toHaveLength(1);
  });

  it("accepts seeded bot messages with the persona as author; rejects other bot messages", async () => {
    const { client } = fakeClient({ history: { C1: [[
      { ts: "1792803901.000100", text: "from persona", subtype: "bot_message", bot_id: "B1", username: "Priya Raman", metadata: seeded },
      { ts: "1792803902.000100", text: "plain bot", subtype: "bot_message", bot_id: "B1", username: "Bot" },
      { ts: "1792803903.000100", text: "other metadata", subtype: "bot_message", bot_id: "B1", metadata: { event_type: "other" } },
      { ts: "1792803904.000100", text: "joined", subtype: "channel_join", user: "U1" },
    ]] } });
    const out = await readSlackSignals("support", "2026-10", { client, log: quiet });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "from persona", author: "Priya Raman" });
  });

  it("requests metadata and includes thread replies without the parent duplicate", async () => {
    const parent = "1792803901.000100";
    const { client, history, replies } = fakeClient({
      history: { C1: [[{ ts: parent, text: "parent", user: "U1", reply_count: 2 }]] },
      replies: { [`C1:${parent}`]: [
        [{ ts: parent, text: "parent", user: "U1" }, { ts: "1792803902.000100", text: "reply one", subtype: "bot_message", bot_id: "B1", username: "Leo", metadata: seeded }],
        [{ ts: "1792803903.000100", text: "bot noise", bot_id: "B1" }, { ts: "1792803904.000100", text: "reply two", user: "U2" }],
      ] },
    });
    const out = await readSlackSignals("support", "2026-10", { client, log: quiet });
    expect(out.map((s) => s.text)).toEqual(["parent", "reply one", "reply two"]);
    expect(out[1].author).toBe("Leo");
    expect(history.mock.calls[0][0]).toMatchObject({ include_all_metadata: true });
    expect(replies).toHaveBeenCalledTimes(2);
    expect(replies.mock.calls[0][0]).toMatchObject({ channel: "C1", ts: parent, include_all_metadata: true });
  });

  it("does not call replies for messages without replies", async () => {
    const { client, replies } = fakeClient({ history: { C1: [[{ ts: "1792803901.000100", text: "solo", user: "U1" }]] } });
    await readSlackSignals("support", "2026-10", { client, log: quiet });
    expect(replies).not.toHaveBeenCalled();
  });
});

describe("fixture fallback", () => {
  const sig = (id: string, team: Signal["team"], date: string): Signal => ({ id, source: "slack", kind: "message", team, date, text: "t", url: "u" });

  function tempFixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-fixture-"));
    const file = path.join(dir, "slack.json");
    fs.writeFileSync(file, JSON.stringify([
      sig("a", "support", "2026-10-20"),
      sig("b", "growth", "2026-10-20"),
      sig("c", "support", "2026-08-01"),
      sig("d", "support", "2026-09-20"),
    ]));
    return file;
  }

  it("uses the fixture, filtered by team and window, when client is null", async () => {
    const log = vi.fn();
    const out = await readSlackSignals("support", "2026-10", { client: null, fixturePath: tempFixture(), log });
    expect(out.map((s) => s.id)).toEqual(["d", "a"]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("uses the fixture when a Slack call throws, logging one warning", async () => {
    const log = vi.fn();
    const { client } = fakeClient({});
    client.conversations.list = async () => { throw new Error("boom"); };
    const out = await readSlackSignals("support", "2026-10", { client, fixturePath: tempFixture(), log });
    expect(out.map((s) => s.id)).toEqual(["d", "a"]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("returns [] when the fixture file is missing", async () => {
    const out = await readSlackSignals("support", "2026-10", { client: null, fixturePath: "/nonexistent/slack.json", log: () => {} });
    expect(out).toEqual([]);
  });
});
