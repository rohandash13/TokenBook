// OWNER: D
// Reads forecast-driver evidence from a team's Slack channels. Falls back to a fixture file.
import fs from "node:fs";
import path from "node:path";
import { SHARED_CHANNELS, TEAM_KEYWORDS, TEAM_SIGNALS } from "../shared/config.js";
import { SEED_EVENT_TYPE } from "../demo/scenario.js";
import type { Month, Team } from "../shared/types.js";
import type { Signal } from "./types.js";

type SlackChannel = { id?: string; name?: string; is_member?: boolean };
type SlackMessage = {
  ts?: string; text?: string; user?: string; subtype?: string; bot_id?: string; username?: string;
  reply_count?: number; thread_ts?: string; metadata?: { event_type?: string };
};
type Paged = { response_metadata?: { next_cursor?: string } };

/** The minimal Slack Web API surface we call. `app.client` satisfies it structurally. */
export type SlackReaderClient = {
  conversations: {
    list(args: { types?: string; limit?: number; cursor?: string; exclude_archived?: boolean }): Promise<Paged & { channels?: SlackChannel[] }>;
    history(args: { channel: string; oldest?: string; latest?: string; limit?: number; cursor?: string; include_all_metadata?: boolean }): Promise<Paged & { messages?: SlackMessage[] }>;
    replies(args: { channel: string; ts: string; limit?: number; cursor?: string; include_all_metadata?: boolean }): Promise<Paged & { messages?: SlackMessage[] }>;
  };
  chat: {
    getPermalink(args: { channel: string; message_ts: string }): Promise<{ permalink?: string }>;
  };
};

type Deps = { client?: SlackReaderClient | null; fixturePath?: string; log?: (msg: string) => void };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Window start (14 days before the 1st, UTC) and end (last second of the last day, UTC), in ms. */
function windowMs(month: Month): { start: number; end: number } {
  const [y, m] = month.split("-").map(Number);
  return {
    start: Date.UTC(y, m - 1, 1) - 14 * DAY_MS,
    end: Date.UTC(y, m, 1) - 1000,
  };
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function resolveChannels(client: SlackReaderClient, names: string[], log: (m: string) => void) {
  const found = new Map<string, SlackChannel>();
  let cursor: string | undefined;
  do {
    const res = await client.conversations.list({ types: "public_channel", exclude_archived: true, limit: 200, cursor });
    for (const c of res.channels ?? []) if (c.name) found.set(c.name, c);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const ids: { id: string; name: string }[] = [];
  for (const name of names) {
    const c = found.get(name);
    if (!c?.id) log(`slack signals: channel #${name} not found, skipping`);
    else if (c.is_member === false) log(`slack signals: bot is not a member of #${name}, skipping`);
    else ids.push({ id: c.id, name });
  }
  return ids;
}

async function permalink(client: SlackReaderClient, channel: string, ts: string): Promise<string> {
  try {
    const res = await client.chat.getPermalink({ channel, message_ts: ts });
    if (res.permalink) return res.permalink;
  } catch {
    // fall through to the constructed link
  }
  return `https://slack.com/archives/${channel}/p${ts.replace(".", "")}`;
}

const escapeRe = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive match at a word start ("campaign" matches "campaigns", "search" not "research"). */
export function mentionsTeam(team: Team, text: string): boolean {
  return TEAM_KEYWORDS[team].some((k) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(k)}`, "iu").test(text));
}

const isSeeded = (m: SlackMessage) => m.metadata?.event_type === SEED_EVENT_TYPE;

/** Seeded persona messages are accepted; every other bot or subtype message is skipped. */
function accept(msg: SlackMessage): boolean {
  if (!msg.ts || !msg.text?.trim()) return false;
  if (isSeeded(msg)) return true;
  if (msg.bot_id) return false;
  return !msg.subtype;
}

async function readLive(client: SlackReaderClient, team: Team, month: Month, log: (m: string) => void): Promise<Signal[]> {
  const { start, end } = windowMs(month);
  const oldest = String(Math.floor(start / 1000));
  const latest = String(Math.floor(end / 1000));
  const own = TEAM_SIGNALS[team].slackChannels;
  const shared = SHARED_CHANNELS.filter((c) => c.teams.includes(team)).map((c) => c.name).filter((n) => !own.includes(n));
  const sharedSet = new Set(shared);
  const channels = await resolveChannels(client, [...own, ...shared], log);
  const signals: Signal[] = [];
  const seen = new Set<string>();

  const push = async (channel: string, name: string, msg: SlackMessage) => {
    if (!accept(msg)) return;
    const ts = msg.ts!;
    if (sharedSet.has(name) && !mentionsTeam(team, msg.text!)) return;
    const id = `slack:${channel}:${ts}`;
    if (seen.has(id)) return;
    seen.add(id);
    signals.push({
      id,
      source: "slack",
      kind: "message",
      team,
      date: isoDate(Number(ts) * 1000),
      text: msg.text!,
      author: isSeeded(msg) ? (msg.username ?? msg.user) : msg.user,
      url: await permalink(client, channel, ts),
    });
  };

  for (const { id: channel, name } of channels) {
    let cursor: string | undefined;
    do {
      const res = await client.conversations.history({ channel, oldest, latest, limit: 200, cursor, include_all_metadata: true });
      for (const msg of res.messages ?? []) {
        await push(channel, name, msg);
        if (msg.ts && (msg.reply_count ?? 0) > 0) {
          let rc: string | undefined;
          do {
            const rep = await client.conversations.replies({ channel, ts: msg.ts, limit: 200, cursor: rc, include_all_metadata: true });
            for (const r of rep.messages ?? []) {
              if (r.ts === msg.ts) continue;
              await push(channel, name, r);
            }
            rc = rep.response_metadata?.next_cursor || undefined;
          } while (rc);
        }
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }
  return signals;
}

function readFixture(team: Team, month: Month, fixturePath?: string): Signal[] {
  const file = path.resolve(process.cwd(), fixturePath ?? "data/fixtures/signals/slack.json");
  if (!fs.existsSync(file)) return [];
  const all = JSON.parse(fs.readFileSync(file, "utf8")) as Signal[];
  const { start, end } = windowMs(month);
  const from = isoDate(start);
  const to = isoDate(end);
  return all.filter((s) => s.team === team && s.date >= from && s.date <= to);
}

const byDateThenId = (a: Signal, b: Signal) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export async function readSlackSignals(team: Team, month: Month, deps: Deps = {}): Promise<Signal[]> {
  const log = deps.log ?? ((msg: string) => console.warn(msg));
  let signals: Signal[];
  if (!deps.client) {
    log("slack signals: no Slack client, using fixture");
    signals = readFixture(team, month, deps.fixturePath);
  } else {
    try {
      signals = await readLive(deps.client, team, month, log);
    } catch (err) {
      log(`slack signals: Slack call failed (${err instanceof Error ? err.message : String(err)}), using fixture`);
      signals = readFixture(team, month, deps.fixturePath);
    }
  }
  return signals.sort(byDateThenId);
}
