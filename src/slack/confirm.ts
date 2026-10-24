// OWNER: D
// The reply a lead gets after their check-in is recorded.
import type { TeamContext } from "../shared/types.js";
import { formatUsd } from "./checkin.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-27" -> "Oct 27" */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : date;
}

function formatMultiplier(x: number): string {
  return `${Number(x.toFixed(1))}x`;
}

export function buildConfirmation(context: TeamContext, beforeUsd: number, afterUsd: number): string {
  if (context.events.length === 0) {
    return `Got it: nothing unusual planned. Your estimate stays at ${formatUsd(afterUsd)}. Dana will review it.`;
  }
  const drivers = context.events
    .map((e) => `${e.note} ${shortDate(e.date)}, about ${formatMultiplier(e.multiplier)}`)
    .join("; ");
  const move =
    Math.round(beforeUsd) === Math.round(afterUsd)
      ? `Your estimate stays at ${formatUsd(afterUsd)}.`
      : `That moves your estimate from ${formatUsd(beforeUsd)} to ${formatUsd(afterUsd)}.`;
  return `Got it: ${drivers}. ${move} Dana will review it.`;
}
