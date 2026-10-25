// OWNER: D
// Writes the scenario's Slack channels and persona messages into a real workspace, tagged with seed metadata so reset can find them.
import { SEED_EVENT_TYPE, type Scenario, type SeedMessage } from "./scenario.js";

type Paged = { response_metadata?: { next_cursor?: string } };
type SlackChannel = { id?: string; name?: string; is_member?: boolean };
type SlackMsg = {
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  metadata?: { event_type?: string; event_payload?: Record<string, unknown> };
};

/** The minimal Slack Web API surface we call. `WebClient` satisfies it structurally. */
export type SeedSlackClient = {
  conversations: {
    list(args: { types?: string; limit?: number; cursor?: string; exclude_archived?: boolean }): Promise<Paged & { channels?: SlackChannel[] }>;
    create(args: { name: string; is_private?: boolean }): Promise<{ channel?: SlackChannel }>;
    setPurpose(args: { channel: string; purpose: string }): Promise<unknown>;
    join(args: { channel: string }): Promise<unknown>;
    history(args: { channel: string; include_all_metadata?: boolean; limit?: number; cursor?: string }): Promise<Paged & { messages?: SlackMsg[] }>;
    replies(args: { channel: string; ts: string; include_all_metadata?: boolean; limit?: number; cursor?: string }): Promise<Paged & { messages?: SlackMsg[] }>;
  };
  chat: {
    postMessage(args: {
      channel: string;
      text: string;
      username?: string;
      icon_url?: string;
      thread_ts?: string;
      unfurl_links?: boolean;
      metadata?: { event_type: string; event_payload: Record<string, string> };
    }): Promise<{ ts?: string }>;
    delete(args: { channel: string; ts: string }): Promise<unknown>;
  };
};

export type SeedSlackOpts = {
  reset?: boolean;
  dryRun?: boolean;
  log?: (m: string) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
};

const POST_GAP_MS = 1100;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errCode(err: unknown): string {
  const e = err as { data?: { error?: string }; message?: string; code?: string };
  return e?.data?.error ?? e?.code ?? e?.message ?? "";
}

function isRateLimited(err: unknown): boolean {
  const c = errCode(err);
  const msg = (err as { message?: string })?.message ?? "";
  return c === "ratelimited" || c === "slack_webapi_rate_limited_error" || msg.includes("ratelimited");
}

function retryAfterMs(err: unknown): number {
  const e = err as { retryAfter?: number; data?: { retryAfter?: number }; headers?: Record<string, string> };
  const s = e?.retryAfter ?? e?.data?.retryAfter ?? Number(e?.headers?.["retry-after"]);
  return (Number.isFinite(s) && (s as number) > 0 ? (s as number) : 1) * 1000;
}

export async function seedSlack(
  scenario: Scenario,
  client: SeedSlackClient,
  opts: SeedSlackOpts = {},
): Promise<{ channels: number; posted: number; deleted: number }> {
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? realSleep;
  const dry = !!opts.dryRun;
  const result = { channels: 0, posted: 0, deleted: 0 };

  async function listChannels(): Promise<Map<string, SlackChannel>> {
    const byName = new Map<string, SlackChannel>();
    let cursor: string | undefined;
    do {
      const res = await client.conversations.list({ types: "public_channel", limit: 200, cursor, exclude_archived: true });
      for (const c of res.channels ?? []) if (c.name) byName.set(c.name, c);
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return byName;
  }

  // 1. Channels
  const existing = await listChannels();
  const channelIds = new Map<string, string>(); // name -> id
  for (const sc of scenario.channels) {
    let ch = existing.get(sc.name);
    if (!ch) {
      if (dry) {
        log(`[dry-run] would create #${sc.name}`);
        channelIds.set(sc.name, `dry:${sc.name}`);
        result.channels++;
        continue;
      }
      try {
        const created = await client.conversations.create({ name: sc.name });
        ch = created.channel ?? undefined;
        log(`created #${sc.name}`);
        if (ch?.id) await client.conversations.setPurpose({ channel: ch.id, purpose: sc.purpose });
      } catch (err) {
        if (errCode(err) !== "name_taken") throw err;
        ch = (await listChannels()).get(sc.name);
        log(`#${sc.name} already exists (name_taken)`);
        if (!ch) throw err;
      }
      if (ch) ch.is_member = ch.is_member ?? true; // creator is a member
    } else if (!ch.is_member) {
      if (dry) log(`[dry-run] would join #${sc.name}`);
      else {
        await client.conversations.join({ channel: ch.id! });
        log(`joined #${sc.name}`);
      }
    }
    if (!ch?.id) throw new Error(`Could not resolve Slack channel #${sc.name}`);
    channelIds.set(sc.name, ch.id);
    result.channels++;
  }

  // 2. Find seeded messages (for reset and idempotence)
  async function scanSeeded(channel: string): Promise<{ ts: string; id?: string }[]> {
    const out = new Map<string, { ts: string; id?: string }>();
    const note = (m: SlackMsg) => {
      if (m.ts && m.metadata?.event_type === SEED_EVENT_TYPE) {
        const id = m.metadata.event_payload?.id;
        out.set(m.ts, { ts: m.ts, id: typeof id === "string" ? id : undefined });
      }
    };
    let cursor: string | undefined;
    const parents: string[] = [];
    do {
      const res = await client.conversations.history({ channel, include_all_metadata: true, limit: 200, cursor });
      for (const m of res.messages ?? []) {
        note(m);
        if (m.ts && (m.reply_count ?? 0) > 0) parents.push(m.ts);
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
    for (const ts of parents) {
      let rc: string | undefined;
      do {
        const res = await client.conversations.replies({ channel, ts, include_all_metadata: true, limit: 200, cursor: rc });
        for (const m of res.messages ?? []) note(m);
        rc = res.response_metadata?.next_cursor || undefined;
      } while (rc);
    }
    return [...out.values()];
  }

  // id -> ts per channel name, for already-present seeded messages
  const present = new Map<string, Map<string, string>>();
  for (const sc of scenario.channels) {
    const channel = channelIds.get(sc.name)!;
    present.set(sc.name, new Map());
    if (channel.startsWith("dry:")) continue;
    const seeded = await scanSeeded(channel);
    if (opts.reset) {
      // Delete newest first so replies go before their parents.
      for (const s of seeded.sort((a, b) => Number(b.ts) - Number(a.ts))) {
        if (dry) log(`[dry-run] would delete seeded message ${s.id ?? s.ts} in #${sc.name}`);
        else {
          await client.chat.delete({ channel, ts: s.ts });
          log(`deleted ${s.id ?? s.ts} in #${sc.name}`);
        }
        result.deleted++;
      }
    } else {
      for (const s of seeded) if (s.id) present.get(sc.name)!.set(s.id, s.ts);
    }
  }

  // 3. Post
  const personas = new Map(scenario.personas.map((p) => [p.id, p]));
  const order = new Map(scenario.messages.map((m, i) => [m.id, i]));
  const byDay = (a: SeedMessage, b: SeedMessage) => a.day.localeCompare(b.day) || order.get(a.id)! - order.get(b.id)!;
  const sorted = [...scenario.messages].sort(byDay);
  const pending = [...sorted.filter((m) => !m.replyTo), ...sorted.filter((m) => m.replyTo)];

  const lastPostedIn = new Set<string>();
  const post = async (args: Parameters<SeedSlackClient["chat"]["postMessage"]>[0]) => {
    if (lastPostedIn.has(args.channel)) await sleep(POST_GAP_MS);
    try {
      return await client.chat.postMessage(args);
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      const wait = retryAfterMs(err);
      log(`rate limited; waiting ${wait / 1000}s`);
      await sleep(wait);
      return await client.chat.postMessage(args);
    } finally {
      lastPostedIn.add(args.channel);
    }
  };

  for (const m of pending) {
    const channel = channelIds.get(m.channel);
    const ids = present.get(m.channel);
    if (!channel || !ids) throw new Error(`Message ${m.id} references unknown channel #${m.channel}`);
    const persona = personas.get(m.persona);
    if (!persona) throw new Error(`Message ${m.id} references unknown persona ${m.persona}`);
    if (ids.has(m.id)) {
      log(`skip ${m.id} (already seeded)`);
      continue;
    }
    let thread_ts: string | undefined;
    if (m.replyTo) {
      thread_ts = ids.get(m.replyTo);
      if (!thread_ts && !dry) throw new Error(`Parent ${m.replyTo} of ${m.id} has not been posted`);
    }
    if (dry) {
      log(`[dry-run] would post ${m.id} to #${m.channel} as ${persona.name}${m.replyTo ? ` (reply to ${m.replyTo})` : ""}`);
      ids.set(m.id, `dry:${m.id}`);
      result.posted++;
      continue;
    }
    const res = await post({
      channel,
      text: m.text,
      username: `${persona.name} · ${persona.title}`,
      icon_url: persona.avatar,
      metadata: { event_type: SEED_EVENT_TYPE, event_payload: { id: m.id, day: m.day, persona: m.persona } },
      ...(thread_ts ? { thread_ts } : {}),
      unfurl_links: false,
    });
    if (!res.ts) throw new Error(`Slack returned no ts for ${m.id}`);
    ids.set(m.id, res.ts);
    result.posted++;
    log(`posted ${m.id} to #${m.channel}`);
  }

  return result;
}
