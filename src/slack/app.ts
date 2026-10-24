// OWNER: D
// TrueUp Slack app (Bolt, Socket Mode).
//   npm run slack                                   start and listen for replies
//   npm run slack -- --checkin support [--month 2026-10]   also DM one check-in
import { App, LogLevel } from "@slack/bolt";
import type { Month, Team } from "../shared/types.js";
import { extractDrivers } from "../llm/extractDrivers.js";
import { createApi, trueupEstimate, type TrueUpApi } from "./api.js";
import { sendCheckIn, type SlackClient } from "./checkin.js";
import { buildConfirmation } from "./confirm.js";
import { parseButtonValue, PendingStore } from "./extractDrivers.js";

const TEAMS: Team[] = ["support", "search", "growth", "platform"];

function currentMonth(now = new Date()): Month {
  return now.toISOString().slice(0, 7);
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Handles a lead's free-text reply; returns the text to post back. Never throws. */
export async function handleReply(
  userId: string,
  text: string,
  deps: { api: TrueUpApi; pending: PendingStore; leadName?: string },
): Promise<string> {
  const p = deps.pending.get(userId);
  if (!p) return "I don't have an open check-in for you. Finance will send one at month end.";
  const today = new Date().toISOString().slice(0, 10);
  try {
    const before = trueupEstimate(await deps.api.getEstimates(p.month, today), p.team) ?? 0;
    const context = await extractDrivers({
      team: p.team,
      month: p.month,
      text,
      buttons: p.buttons,
      today,
      leadName: deps.leadName,
      repliedAt: new Date().toISOString(),
    });
    await deps.api.postContext(context);
    const after = trueupEstimate(await deps.api.getEstimates(p.month, today), p.team) ?? before;
    deps.pending.clear(userId);
    return buildConfirmation(context, before, after);
  } catch (err) {
    console.error("[slack] reply failed:", err);
    return "Sorry, I couldn't reach TrueUp to record that. Please try again in a minute.";
  }
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
}

main().catch((err) => {
  console.error("[slack] fatal:", err);
  process.exit(1);
});
