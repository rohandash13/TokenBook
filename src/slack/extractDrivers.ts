// OWNER: D
// Slack side of driver extraction: turns Bolt button clicks into CheckInButtons
// and remembers each lead's answers until their free-text reply arrives.
// (The LLM part lives in src/llm/extractDrivers.ts.)
import type { Month, Team } from "../shared/types.js";
import type { CheckInButtons, Volume } from "../llm/extractDrivers.js";

export type ButtonValue = {
  team: Team;
  month: Month;
  field: "launches" | "volume";
  answer: string;
};

const LAUNCHES = ["yes", "no"] as const;
const VOLUMES: Volume[] = ["lower", "same", "higher", "much_higher"];

/** Parses a check-in button's value. Returns null for anything we didn't send. */
export function parseButtonValue(value: string | undefined): ButtonValue | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<ButtonValue>;
    if (!v.team || !v.month || !v.answer) return null;
    if (v.field === "launches" && (LAUNCHES as readonly string[]).includes(v.answer)) return v as ButtonValue;
    if (v.field === "volume" && (VOLUMES as string[]).includes(v.answer)) return v as ButtonValue;
    return null;
  } catch {
    return null;
  }
}

/** Merges one button answer into the answers so far. */
export function applyButton(buttons: CheckInButtons, v: ButtonValue): CheckInButtons {
  if (v.field === "launches") return { ...buttons, launches: v.answer as "yes" | "no" };
  return { ...buttons, volume: v.answer as Volume };
}

export type PendingCheckIn = { team: Team; month: Month; buttons: CheckInButtons };

/** In-memory store of open check-ins, keyed by the lead's Slack user id. Lost on restart; fine for a demo. */
export class PendingStore {
  private byUser = new Map<string, PendingCheckIn>();

  start(userId: string, team: Team, month: Month): PendingCheckIn {
    const p = { team, month, buttons: {} };
    this.byUser.set(userId, p);
    return p;
  }

  get(userId: string): PendingCheckIn | undefined {
    return this.byUser.get(userId);
  }

  /** Records a button click; creates the check-in if the app restarted since it was sent. */
  recordButton(userId: string, v: ButtonValue): PendingCheckIn {
    let p = this.byUser.get(userId);
    if (!p || p.team !== v.team || p.month !== v.month) p = this.start(userId, v.team, v.month);
    p.buttons = applyButton(p.buttons, v);
    return p;
  }

  clear(userId: string): void {
    this.byUser.delete(userId);
  }
}
