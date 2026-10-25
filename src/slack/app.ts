// OWNER: D
// TrueUp Slack app (Bolt, Socket Mode).
//   npm run slack                                   start and listen for replies
//   npm run slack -- --checkin support [--month 2026-10]   also DM one check-in
//   npm run slack -- --overview support [--month 2026-10]  DM what TrueUp inferred (confirm by exception)
//   npm run slack -- --summary [--month 2026-10]           DM the month-end summary to every lead
import { App, LogLevel } from "@slack/bolt";
import type { Month, Team } from "../shared/types.js";
import { createApi } from "./api.js";
import { sendCheckIn, type SlackClient } from "./checkin.js";
import { sendOverview, sendSummary } from "./overview.js";
import { startTrigger } from "./trigger.js";
import { handleReply } from "./reply.js";
export { handleReply };
import { parseButtonValue, PendingStore } from "./extractDrivers.js";

const TEAMS: Team[] = ["support", "search", "growth", "platform"];

function currentMonth(now = new Date()): Month {
  return now.toISOString().slice(0, 7);
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  try {
    process.loadEnvFile?.();
  } catch {
    // no .env file; rely on the real environment
  }
  const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET } = process.env;
  if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN || !SLACK_SIGNING_SECRET) {
    console.log("[slack] SLACK_BOT_TOKEN, SLACK_APP_TOKEN and SLACK_SIGNING_SECRET must be set in .env. Skipping the Slack app.");
    process.exit(0);
  }

  const api = createApi();
  const pending = new PendingStore();
  const app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    signingSecret: SLACK_SIGNING_SECRET,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  app.action(/^checkin_/, async ({ ack, body, action }) => {
    await ack();
    if (action.type !== "button") return;
    const v = parseButtonValue(action.value);
    if (v) pending.recordButton(body.user.id, v);
  });

  app.message(async ({ message, say, client }) => {
    // Only plain user messages in DMs; skip bot posts, edits, joins, etc.
    if (message.channel_type !== "im" || message.subtype !== undefined || !message.text) return;
    let leadName: string | undefined;
    try {
      const info = await client.users.info({ user: message.user });
      leadName = info.user?.real_name || info.user?.name;
    } catch {
      // name is nice to have
    }
    await say(await handleReply(message.user, message.text, { api, pending, leadName }));
  });

  await app.start();
  console.log("[slack] TrueUp Slack app running (Socket Mode)");
  startTrigger({ client: app.client as unknown as SlackClient, deps: { api, pending } });

  const argv = process.argv.slice(2);
  const team = argValue(argv, "--checkin");
  if (team) {
    if (!TEAMS.includes(team as Team)) {
      console.error(`[slack] unknown team "${team}"; use one of ${TEAMS.join(", ")}`);
      return;
    }
    const month = argValue(argv, "--month") ?? currentMonth();
    try {
      await sendCheckIn(app.client as unknown as SlackClient, team as Team, month, { api, pending });
      console.log(`[slack] check-in sent to ${team} for ${month}`);
    } catch (err) {
      console.error("[slack] check-in failed:", err instanceof Error ? err.message : err);
    }
  }

  const overviewTeam = argValue(argv, "--overview");
  const month = argValue(argv, "--month") ?? currentMonth();
  const client = app.client as unknown as SlackClient;
  if (overviewTeam) {
    if (!TEAMS.includes(overviewTeam as Team)) {
      console.error(`[slack] unknown team "${overviewTeam}"; use one of ${TEAMS.join(", ")}`);
      return;
    }
    try {
      await sendOverview(client, overviewTeam as Team, month, { api, pending });
      console.log(`[slack] overview sent to ${overviewTeam} for ${month}`);
    } catch (err) {
      console.error("[slack] overview failed:", err instanceof Error ? err.message : err);
    }
  }
  if (argv.includes("--summary")) {
    try {
      await sendSummary(client, month, { api, pending });
      console.log(`[slack] summary sent for ${month}`);
    } catch (err) {
      console.error("[slack] summary failed:", err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("[slack] fatal:", err);
  process.exit(1);
});
