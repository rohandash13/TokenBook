// OWNER: D
// The monthly check-in DM: Block Kit layout (pure) and the sender.
import type { Month, Team } from "../shared/types.js";
import type { TrueUpApi } from "./api.js";
import type { ButtonValue, PendingStore } from "./extractDrivers.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 1234.5 -> "$1,235" */
export function formatUsd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "2026-10" -> "October 2026" */
export function monthName(month: Month): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`;
}

export function teamName(team: Team): string {
  return team.charAt(0).toUpperCase() + team.slice(1);
}

export function headerText(team: Team, month: Month, actualToDate: number): string {
  return `Closing ${monthName(month)} for ${teamName(team)}. ${formatUsd(actualToDate)} of AI APIs used so far.`;
}

// Minimal Block Kit shapes; enough for what we send.
type Text = { type: "plain_text" | "mrkdwn"; text: string };
type Button = { type: "button"; text: Text; action_id: string; value: string };
export type Block =
  | { type: "section"; block_id?: string; text: Text }
  | { type: "actions"; block_id: string; elements: Button[] };

function button(team: Team, month: Month, field: ButtonValue["field"], answer: string, label: string): Button {
  const value: ButtonValue = { team, month, field, answer };
  // action_ids must be unique within a message, so the answer is part of the id.
  return {
    type: "button",
    text: { type: "plain_text", text: label },
    action_id: `checkin_${field}_${answer}`,
    value: JSON.stringify(value),
  };
}

export function buildCheckInBlocks(team: Team, month: Month, actualToDate: number): Block[] {
  return [
    { type: "section", block_id: "checkin_header", text: { type: "mrkdwn", text: headerText(team, month, actualToDate) } },
    { type: "section", text: { type: "mrkdwn", text: "*Any launches or big runs planned?*" } },
    {
      type: "actions",
      block_id: "checkin_launches",
      elements: [
        button(team, month, "launches", "yes", "Yes"),
        button(team, month, "launches", "no", "No"),
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: "*Expected volume vs last week?*" } },
    {
      type: "actions",
      block_id: "checkin_volume",
      elements: [
        button(team, month, "volume", "lower", "Lower"),
        button(team, month, "volume", "same", "Same"),
        button(team, month, "volume", "higher", "Higher"),
        button(team, month, "volume", "much_higher", "Much higher"),
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: "*Anything else finance should know?* Reply in this DM." } },
  ];
}

/** The slice of Bolt's WebClient we use; a fake is easy to pass in tests. */
export type SlackClient = {
  conversations: { open(args: { users: string }): Promise<{ channel?: { id?: string } }> };
  chat: { postMessage(args: { channel: string; text: string; blocks?: Block[] }): Promise<unknown> };
};

export type CheckInDeps = { api: TrueUpApi; pending: PendingStore; env?: NodeJS.ProcessEnv };

export function leadUserId(team: Team, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[`SLACK_LEAD_${team.toUpperCase()}`] || undefined;
}

/** DMs the team lead the check-in and marks it pending. Throws if the lead id is unset. */
export async function sendCheckIn(client: SlackClient, team: Team, month: Month, deps: CheckInDeps): Promise<void> {
  const userId = leadUserId(team, deps.env);
  if (!userId) throw new Error(`SLACK_LEAD_${team.toUpperCase()} is not set; add the lead's Slack member id to .env`);
  const dm = await client.conversations.open({ users: userId });
  const channel = dm.channel?.id;
  if (!channel) throw new Error(`could not open a DM with ${userId}`);
  const actualToDate = await deps.api.getActualToDate(team, month);
  const blocks = buildCheckInBlocks(team, month, actualToDate);
  await client.chat.postMessage({ channel, text: headerText(team, month, actualToDate), blocks });
  deps.pending.start(userId, team, month);
}
