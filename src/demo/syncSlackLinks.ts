// OWNER: D — reads existing seeded Slack messages and saves verified permalinks for offline evidence.
// Run: npx tsx src/demo/syncSlackLinks.ts. Does not post, edit, or delete Slack messages.
import { readFileSync, writeFileSync } from 'node:fs';
import { WebClient } from '@slack/web-api';
import { loadScenario } from './loadScenario.js';
import { scenarioToFixtures } from './toFixtures.js';
import { loadSlackLinks, SLACK_LINKS_PATH } from '../signals/slackLinks.js';
import { listContexts, upsertContext } from '../server/store.js';
import { SEED_EVENT_TYPE } from './scenario.js';

async function main() {
  try { process.loadEnvFile(); } catch { /* missing token is reported below */ }
  if (!process.env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN is required');
  const client = new WebClient(process.env.SLACK_BOT_TOKEN);
  const auth = await client.auth.test();
  const scenario = loadScenario();
  const wanted = new Set(scenario.channels.map((c) => c.name));
  const channels: { id: string; name: string }[] = [];
  let cursor: string | undefined;
  do {
    const r = await client.conversations.list({ types: 'public_channel', exclude_archived: true, limit: 200, cursor });
    for (const c of r.channels ?? []) if (c.id && c.name && wanted.has(c.name) && c.is_member) channels.push({ id: c.id, name: c.name });
    cursor = r.response_metadata?.next_cursor || undefined;
  } while (cursor);
  const links = loadSlackLinks();
  const fixtures = scenarioToFixtures(scenario).slack;
  let matched = 0;
  const visited = new Set<string>();
  const accept = async (channel: { id: string; name: string }, msg: { ts?: string; text?: string; metadata?: { event_type?: string; event_payload?: Record<string, unknown> } }) => {
    if (!msg.ts || visited.has(`${channel.id}:${msg.ts}`)) return;
    visited.add(`${channel.id}:${msg.ts}`);
    if (msg.metadata?.event_type !== SEED_EVENT_TYPE) return;
    const planned = scenario.messages.find((m) => m.id === msg.metadata?.event_payload?.id && m.channel === channel.name && m.text === msg.text);
    if (!planned) return; // A seed id alone is insufficient: the actual content must still match.
    const permalink = await client.chat.getPermalink({ channel: channel.id, message_ts: msg.ts });
    if (!permalink.permalink) throw new Error(`No permalink for ${planned.id}`);
    for (const f of fixtures.filter((f) => f.text === planned.text && f.id.startsWith(`slack:C_${channel.name.toUpperCase().replace(/-/g, '_')}:`))) links[f.id] = permalink.permalink;
    matched++;
  };
  for (const channel of channels) {
    let cursor: string | undefined;
    do {
      const r = await client.conversations.history({ channel: channel.id, limit: 200, include_all_metadata: true, cursor });
      for (const msg of r.messages ?? []) {
        await accept(channel, msg);
        if (msg.ts && (msg.reply_count ?? 0) > 0) {
          let rc: string | undefined;
          do {
            const replies = await client.conversations.replies({ channel: channel.id, ts: msg.ts, limit: 200, include_all_metadata: true, cursor: rc });
            for (const reply of replies.messages ?? []) await accept(channel, reply);
            rc = replies.response_metadata?.next_cursor || undefined;
          } while (rc);
        }
      }
      cursor = r.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }
  writeFileSync(SLACK_LINKS_PATH, JSON.stringify(links, null, 2) + '\n');
  // Repair existing evidence without changing inferred dates, multipliers, lead replies, or journals.
  let repaired = 0;
  for (const context of listContexts()) {
    let changed = false;
    for (const entry of [...context.events, ...(context.flags ?? [])]) for (const evidence of entry.evidence ?? []) {
      const url = evidence.source === 'slack' ? links[evidence.id] : undefined;
      if (url && url !== evidence.url) { evidence.url = url; repaired++; changed = true; }
    }
    if (changed) upsertContext(context);
  }
  // Keep generated fixtures clickable even when consumed outside readSlackSignals.
  const file = 'data/fixtures/signals/slack.json';
  const rows = JSON.parse(readFileSync(file, 'utf8')) as typeof fixtures;
  for (const row of rows) if (links[row.id]) row.url = links[row.id];
  writeFileSync(file, JSON.stringify(rows, null, 2) + '\n');
  const unresolved = [...new Set(fixtures.filter((f) => !links[f.id]).map((f) => f.id))];
  console.log(JSON.stringify({ workspace: auth.team, url: auth.url, matchedSeedMessages: matched, repairedStoredLinks: repaired, unresolvedFixtureMessages: unresolved.length }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
