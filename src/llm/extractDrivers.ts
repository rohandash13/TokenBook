// OWNER: D
// Turns a lead's Slack reply into a TeamContext. The LLM only reads the reply;
// if it is unavailable or returns bad JSON, the button answers alone decide.
import type { Month, Team, TeamContext } from "../shared/types.js";
import { getLlm, type LlmClient } from "./client.js";

export type Volume = "lower" | "same" | "higher" | "much_higher";
export type CheckInButtons = { launches?: "yes" | "no"; volume?: Volume };

export type ExtractInput = {
  team: Team;
  month: Month;
  text: string; // free-text reply, may be ""
  buttons: CheckInButtons;
  today: string; // "YYYY-MM-DD", the reply date; fallback events start here
  leadName?: string;
  repliedAt?: string; // ISO timestamp of the reply
};

export async function extractDrivers(
  input: ExtractInput,
  llm: LlmClient | null = getLlm(),
): Promise<TeamContext> {
  // TODO(D): implement — see docs/plan-d.md task 2
  return driversFromButtons(input);
}

/** Deterministic fallback: Higher = 1.3x, Much higher = 2x, Lower = 0.8x, all from `today`. */
export function driversFromButtons(input: ExtractInput): TeamContext {
  // TODO(D): implement — see docs/plan-d.md task 2
  return { team: input.team, month: input.month, replied: true, events: [], quote: input.text || undefined, repliedAt: input.repliedAt, leadName: input.leadName };
}
