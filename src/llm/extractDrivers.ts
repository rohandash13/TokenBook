// OWNER: D
// Turns a lead's Slack reply into a TeamContext. The LLM only reads the reply;
// if it is unavailable or returns bad JSON, the button answers alone decide.
import { z } from "zod";
import type { Month, Team, TeamContext } from "../shared/types.js";
import { completeJson, getLlm, type LlmClient } from "./client.js";

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

type DriverEvent = TeamContext["events"][number];

/** True when `date` is a real calendar day "YYYY-MM-DD" inside `month` ("YYYY-MM"). */
export function isDateInMonth(date: string, month: Month): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Schema for the model's reply. Month checks live here so a bad date also triggers the retry. */
export function driversSchema(month: Month) {
  return z.object({
    events: z.array(
      z.object({
        date: z.string().refine((d) => isDateInMonth(d, month), "date outside month"),
        multiplier: z.number().gt(0).lte(10),
        note: z.string().max(40),
      }),
    ),
    quote: z.string().optional(),
  });
}

export function buildSystemPrompt(): string {
  return [
    "You read a team lead's Slack reply about their expected AI API usage for the rest of the month.",
    'Return only JSON, no prose, of exactly this shape: {"events":[{"date":"YYYY-MM-DD","multiplier":number,"note":string}],"quote":string}.',
    "Each event marks the day a change in spend starts. Dates must be inside the given month.",
    "multiplier is relative to the team's recent daily spend: 1 = unchanged, 2 = double, 0.5 = half. It must be greater than 0 and at most 10.",
    "note is a 2–5 word lowercase phrase (e.g. 'support bot launch'), at most 40 characters.",
    "quote is the lead's reply, copied as written.",
    'If nothing changes, return {"events":[],"quote":"..."} with an empty events array.',
    "Use the button answers as context, but prefer specific dates and sizes stated in the text.",
  ].join("\n");
}

export function buildUserPrompt(input: ExtractInput): string {
  return [
    `Month: ${input.month}`,
    `Today: ${input.today}`,
    `Team: ${input.team}`,
    `Button answers: launches or big runs = ${input.buttons.launches ?? "no answer"}; expected volume vs last week = ${input.buttons.volume ?? "no answer"}`,
    "Reply text:",
    input.text || "(no text)",
  ].join("\n");
}

function baseContext(input: ExtractInput, events: DriverEvent[]): TeamContext {
  return {
    team: input.team,
    month: input.month,
    replied: true,
    events,
    quote: input.text.trim() ? input.text : undefined,
    repliedAt: input.repliedAt,
    leadName: input.leadName,
  };
}

export async function extractDrivers(
  input: ExtractInput,
  llm: LlmClient | null = getLlm(),
): Promise<TeamContext> {
  const result = await completeJson(llm, buildSystemPrompt(), buildUserPrompt(input), driversSchema(input.month));
  if (!result) return driversFromButtons(input);
  // Belt and braces: the schema already checks these, but never book a bad driver.
  const ok = result.events.every(
    (e) => isDateInMonth(e.date, input.month) && e.multiplier > 0 && e.multiplier <= 10,
  );
  if (!ok) return driversFromButtons(input);
  const events = result.events
    .map((e) => ({ date: e.date, multiplier: e.multiplier, note: e.note }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return baseContext(input, events);
}

const VOLUME_DRIVERS: Partial<Record<Volume, { multiplier: number; note: string }>> = {
  higher: { multiplier: 1.3, note: "higher volume" },
  much_higher: { multiplier: 2, note: "much higher volume" },
  lower: { multiplier: 0.8, note: "lower volume" },
};

/** Deterministic fallback: Higher = 1.3x, Much higher = 2x, Lower = 0.8x, all from `today`. */
export function driversFromButtons(input: ExtractInput): TeamContext {
  const { launches, volume } = input.buttons;
  const events: DriverEvent[] = [];
  const driver = volume ? VOLUME_DRIVERS[volume] : undefined;
  if (driver) {
    const note = launches === "yes" ? `${driver.note}, launch planned` : driver.note;
    events.push({ date: input.today, multiplier: driver.multiplier, note });
  } else if (launches === "yes" && !volume) {
    events.push({ date: input.today, multiplier: 1, note: "launch planned" });
  }
  return baseContext(input, events);
}
