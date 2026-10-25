// OWNER: D
// Tiny local HTTP listener so Rohan's server can POST /checkin to trigger a Slack check-in.
// Bound to 127.0.0.1 only — not exposed to the internet.
import * as http from "node:http";
import type { Month, Team } from "../shared/types.js";
import { sendCheckIn, type SlackClient, type CheckInDeps } from "./checkin.js";

const TEAMS: readonly Team[] = ["support", "search", "growth", "platform"];

export type TriggerDeps = {
  client: SlackClient;
  deps: CheckInDeps;
};

/**
 * Pure request handler — exported so tests can call it without a real socket.
 * Accepts POST /checkin with JSON body { team: string, month?: string }.
 * Returns 200 on success, 400 on bad team, 503 if Slack is not connected (sendCheckIn throws).
 */
export async function handleTrigger(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  trigger: TriggerDeps,
): Promise<void> {
  if (req.method !== "POST" || req.url !== "/checkin") {
    res.writeHead(404).end("Not found");
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  let parsed: { team?: unknown; month?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400).end("Invalid JSON");
    return;
  }
  const team = parsed.team as string | undefined;
  if (!team || !TEAMS.includes(team as Team)) {
    res.writeHead(400).end(`Bad team. Use one of: ${TEAMS.join(", ")}`);
    return;
  }
  const month = (parsed.month as string | undefined) ?? new Date().toISOString().slice(0, 7);
  try {
    await sendCheckIn(trigger.client, team as Team, month, trigger.deps);
    res.writeHead(200).end("ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(503).end(`Check-in failed: ${msg}`);
  }
}

/**
 * Starts the trigger listener. Returns the server so the caller can close it.
 * Port defaults to SLACK_TRIGGER_PORT env var or 8788.
 */
export function startTrigger(trigger: TriggerDeps, port = Number(process.env.SLACK_TRIGGER_PORT ?? 8788)): http.Server {
  const server = http.createServer((req, res) => {
    handleTrigger(req, res, trigger).catch((err) => {
      console.error("[trigger] unhandled error:", err);
      if (!res.headersSent) res.writeHead(500).end("Internal error");
    });
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[trigger] listening on 127.0.0.1:${port}`);
  });
  return server;
}
