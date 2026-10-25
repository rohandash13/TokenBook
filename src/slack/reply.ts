// OWNER: D
// Handles a lead's free-text DM reply. Kept apart from app.ts so tests can import it without starting Bolt.
import type { TeamContext } from "../shared/types.js";
import { extractDrivers } from "../llm/extractDrivers.js";
import { trueupEstimate, type TrueUpApi } from "./api.js";
import { asOfForMonth } from "./asOf.js";
import { buildConfirmation, buildKeptConfirmation } from "./confirm.js";
import type { PendingStore } from "./extractDrivers.js";

/** Handles a lead's free-text reply; returns the text to post back. Never throws. */
export async function handleReply(
  userId: string,
  text: string,
  deps: { api: TrueUpApi; pending: PendingStore; leadName?: string },
): Promise<string> {
  const p = deps.pending.get(userId);
  if (!p) return "I don't have an open check-in for you. Finance will send one at month end.";
  const today = new Date().toISOString().slice(0, 10);
  const asOf = asOfForMonth(p.month, today);
  try {
    const before = trueupEstimate(await deps.api.getEstimates(p.month, asOf), p.team) ?? 0;
    const extracted = await extractDrivers({
      team: p.team,
      month: p.month,
      text,
      buttons: p.buttons,
      today,
      leadName: deps.leadName,
      repliedAt: new Date().toISOString(),
    });

    let stored: TeamContext | undefined;
    try {
      stored = (await deps.api.getContexts(p.month)).find((c) => c.team === p.team);
    } catch (err) {
      console.warn("[slack] could not load stored context, continuing:", err instanceof Error ? err.message : err);
    }

    let context: TeamContext = {
      ...extracted,
      events: extracted.events.map((e) => ({ ...e, source: "lead" as const })),
    };
    let kept = false;
    if (stored?.inferred && stored.events.length > 0 && extracted.events.length === 0) {
      // The lead confirmed (or said nothing new): keep what TrueUp inferred, with its evidence.
      context = { ...extracted, events: stored.events };
      kept = true;
    }

    await deps.api.postContext(context);
    const after = trueupEstimate(await deps.api.getEstimates(p.month, asOf), p.team) ?? before;
    deps.pending.clear(userId);
    return kept ? buildKeptConfirmation(context, after) : buildConfirmation(context, before, after);
  } catch (err) {
    console.error("[slack] reply failed:", err);
    return "Sorry, I couldn't reach TrueUp to record that. Please try again in a minute.";
  }
}
