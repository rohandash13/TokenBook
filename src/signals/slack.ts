// OWNER: D
// Reads forecast-driver evidence from a team's Slack channels. Falls back to a fixture file.
import fs from "node:fs";
import path from "node:path";
import { TEAM_SIGNALS } from "../shared/config.js";
import type { Month, Team } from "../shared/types.js";
import type { Signal } from "./types.js";

type SlackChannel = { id?: string; name?: string; is_member?: boolean };
type SlackMessage = { ts?: string; text?: string; user?: string; subtype?: string; bot_id?: string };
type Paged = { response_metadata?: { next_cursor?: string } };

/** The minimal Slack Web API surface we call. `app.client` satisfies it structurally. */
export type SlackReaderClient = {
  conversations: {
    list(args: { types?: string; limit?: number; cursor?: string; exclude_archived?: boolean }): Promise<Paged & { channels?: SlackChannel[] }>;
    history(args: { channel: string; oldest?: string; latest?: string; limit?: number; cursor?: string }): Promise<Paged & { messages?: SlackMessage[] }>;
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

async function readLive(client: SlackReaderClient, team: Team, month: Month, log: (m: string) => void): Promise<Signal[]> {
  const { start, end } = windowMs(month);
  const oldest = String(Math.floor(start / 1000));
  const latest = String(Math.floor(end / 1000));
  const channels = await resolveChannels(client, TEAM_SIGNALS[team].slackChannels, log);
  const signals: Signal[] = [];

  for (const { id: channel } of channels) {
    let cursor: string | undefined;
    do {
      const res = await client.conversations.history({ channel, oldest, latest, limit: 200, cursor });
      for (const msg of res.messages ?? []) {
        if (msg.subtype || msg.bot_id || !msg.ts || !msg.text?.trim()) continue;
        signals.push({
          id: `slack:${channel}:${msg.ts}`,
          source: "slack",
          kind: "message",
          team,
          date: isoDate(Number(msg.ts) * 1000),
          text: msg.text,
          author: msg.user,
          url: await permalink(client, channel, msg.ts),
        });
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
