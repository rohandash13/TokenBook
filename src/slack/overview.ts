// OWNER: D
// Month-start overview DM ("here's what TrueUp sees") and month-end summary DM.
// Confirm-by-exception: the lead only replies if something is wrong.
import { TEAM_INFO, TEAMS } from "../shared/config.js";
import type { Estimate, Evidence, Month, Team, TeamContext } from "../shared/types.js";
import type { TrueUpApi } from "./api.js";
import { asOfForMonth } from "./asOf.js";
import { formatUsd, leadUserId, monthName, type Block, type CheckInDeps, type SlackClient } from "./checkin.js";

export type Message = { text: string; blocks: Block[] };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-27" or an ISO timestamp -> "Oct 27" */
export function shortDate(date: string): string {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return MON[m - 1] ? `${MON[m - 1]} ${d}` : date;
}

function multiplierText(x: number): string {
  return `${Math.round(x * 100) / 100}x`;
}

function evidenceLink(e: Evidence): string {
  if (e.source === "slack") return `<${e.url}|Slack message, ${shortDate(e.date)}>`;
  const kind = e.id.startsWith("gh:pr:") ? "GitHub PR" : e.id.startsWith("gh:release:") ? "GitHub release" : "GitHub milestone";
  return `<${e.url}|${kind}>`;
}

const section = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text } });

function trueup(estimates: Estimate[], team: Team): Estimate | undefined {
  return estimates.find((e) => e.team === team && e.method === "trueup");
}

export function buildOverview(
  team: Team,
  month: Month,
  context: TeamContext | undefined,
  estimate: Estimate | undefined,
): Message {
  const label = TEAM_INFO[team].label;
  const header = `Here's what TrueUp sees for ${label} in ${monthName(month)}.`;
  const blocks: Block[] = [section(header)];
  const lines: string[] = [header];

  const events = context?.events ?? [];
  if (events.length === 0) {
    const none = "Nothing unusual found in Slack or GitHub.";
    blocks.push(section(none));
    lines.push(none);
  }
  for (const ev of events) {
    const head = `• ${ev.note} — ${shortDate(ev.date)}, about ${multiplierText(ev.multiplier)}`;
    const links = (ev.evidence ?? []).map(evidenceLink).join(" · ");
    blocks.push(section(links ? `${head}\n${links}` : head));
    lines.push(head);
  }

  if (estimate) {
    const line = `Estimate for ${monthName(month).split(" ")[0]}: ${formatUsd(estimate.estimate)} (${estimate.confidence} confidence).`;
    blocks.push(section(line));
    lines.push(line);
  }

  const ask = context?.replied
    ? context.repliedAt
      ? `You already confirmed this on ${shortDate(context.repliedAt)}.`
      : "You already confirmed this."
    : `*Reply here only if this is wrong* — e.g. "launch moved to Nov 3".`;
  blocks.push(section(ask));
  lines.push(ask.replace(/\*/g, ""));

  return { text: lines.join("\n"), blocks };
}

export function buildOverviewBlocks(
  team: Team,
  month: Month,
  context: TeamContext | undefined,
  estimate: Estimate | undefined,
): Block[] {
  return buildOverview(team, month, context, estimate).blocks;
}

export function buildSummary(month: Month, estimates: Estimate[], contexts: TeamContext[]): Message {
  const lines: string[] = [];
  let total = 0;
  for (const e of estimates.filter((x) => x.method === "trueup")) {
    const ctx = contexts.find((c) => c.team === e.team);
    const source = ctx?.replied
      ? "lead confirmed"
      : ctx?.inferred && ctx.events.length > 0
        ? "inferred from Slack/GitHub"
        : "run-rate, no signal";
    lines.push(`${TEAM_INFO[e.team].label}: ${formatUsd(e.estimate)} — ${source}`);
    total += e.estimate;
  }
  const header = `TrueUp accrual summary for ${monthName(month)}.`;
  const totalLine = `Total accrual: ${formatUsd(total)}`;
  const body = [...lines, totalLine].join("\n");
  return {
    text: `${header}\n${body}`,
    blocks: [section(header), section(body)],
  };
}

type Deps = { api: TrueUpApi; pending: CheckInDeps["pending"]; env?: NodeJS.ProcessEnv };

async function dm(client: SlackClient, userId: string, msg: Message): Promise<void> {
  const opened = await client.conversations.open({ users: userId });
  const channel = opened.channel?.id;
  if (!channel) throw new Error(`could not open a DM with ${userId}`);
  await client.chat.postMessage({ channel, text: msg.text, blocks: msg.blocks });
}

/** Refreshes signals, DMs the lead what TrueUp inferred, and opens a pending check-in for their reply. */
export async function sendOverview(client: SlackClient, team: Team, month: Month, deps: Deps): Promise<void> {
  const userId = leadUserId(team, deps.env);
  if (!userId) throw new Error(`SLACK_LEAD_${team.toUpperCase()} is not set; add the lead's Slack member id to .env`);
  try {
    await deps.api.refreshSignals(month);
  } catch (err) {
    console.warn("[slack] signal refresh failed, using what is stored:", err instanceof Error ? err.message : err);
  }
  const today = new Date().toISOString().slice(0, 10);
  const [contexts, estimates] = await Promise.all([deps.api.getContexts(month), deps.api.getEstimates(month, asOfForMonth(month, today))]);
  const msg = buildOverview(
    team,
    month,
    contexts.find((c) => c.team === team),
    trueup(estimates, team),
  );
  await dm(client, userId, msg);
  deps.pending.start(userId, team, month);
}

/** DMs the month-end summary to every lead with a configured Slack id. */
export async function sendSummary(client: SlackClient, month: Month, deps: Deps): Promise<void> {
  try {
    await deps.api.refreshSignals(month);
  } catch {
    // stored contexts are fine
  }
  const today = new Date().toISOString().slice(0, 10);
  const [contexts, estimates] = await Promise.all([deps.api.getContexts(month), deps.api.getEstimates(month, asOfForMonth(month, today))]);
  const msg = buildSummary(month, estimates, contexts);
  for (const team of TEAMS) {
    const userId = leadUserId(team, deps.env);
    if (userId) await dm(client, userId, msg);
  }
}
