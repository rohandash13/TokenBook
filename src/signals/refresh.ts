// OWNER: D
// Reads Slack + GitHub signals per team, infers forecast drivers, and saves an inferred context.
import { pathToFileURL } from "node:url";
import { WebClient } from "@slack/web-api";
import { inferDrivers } from "../llm/inferDrivers.js";
import { DEMO, TEAM_INFO, TEAMS } from "../shared/config.js";
import type { ContextEvent, Month, Team, TeamContext } from "../shared/types.js";
import { listContexts, upsertContext } from "../server/store.js";
import { readGithubSignals } from "./github.js";
import { readSlackSignals, type SlackReaderClient } from "./slack.js";
import type { Signal } from "./types.js";

export type RefreshResult = { team: Team; signals: number; events: number; usedLlm: boolean; skipped?: "lead replied" };

export type RefreshDeps = {
  readSlack: (team: Team, month: Month) => Promise<Signal[]>;
  readGithub: (team: Team, month: Month) => Promise<Signal[]>;
  infer: (team: Team, month: Month, signals: Signal[]) => Promise<{ events: ContextEvent[]; dropped: unknown[]; usedLlm: boolean }>;
  getContext: (team: Team, month: Month) => TeamContext | undefined;
  saveContext: (ctx: TeamContext) => void;
  now?: () => string;
  log?: (msg: string) => void;
};

const cache = new Map<string, Signal[]>();
const key = (team: Team, month: Month) => `${team}:${month}`;

/** Signals from the last refresh of (team, month), for GET /api/signals. */
export function lastSignals(team: Team, month: Month): Signal[] {
  return cache.get(key(team, month)) ?? [];
}

export async function refreshSignals(month: Month, deps: RefreshDeps, teams: readonly Team[] = TEAMS): Promise<RefreshResult[]> {
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const results: RefreshResult[] = [];
  for (const team of teams) {
    const existing = deps.getContext(team, month);
    if (existing?.replied) {
      results.push({ team, signals: 0, events: 0, usedLlm: false, skipped: "lead replied" });
      continue;
    }
    const [slack, github] = await Promise.all([deps.readSlack(team, month), deps.readGithub(team, month)]);
    const signals = [...slack, ...github];
    cache.set(key(team, month), signals);
    const { events, dropped, usedLlm } = await deps.infer(team, month, signals);
    if (dropped.length > 0) log(`${team}: dropped ${dropped.length} proposed event(s)`);
    deps.saveContext({
      team, month, replied: false, inferred: true, inferredAt: now(), events,
      leadName: existing?.leadName ?? TEAM_INFO[team].leadName,
    });
    results.push({ team, signals: signals.length, events: events.length, usedLlm });
  }
  return results;
}

export function defaultRefreshDeps(opts: { offline?: boolean } = {}): RefreshDeps {
  const offline = opts.offline === true;
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const client: SlackReaderClient | null =
    !offline && slackToken ? (new WebClient(slackToken) as unknown as SlackReaderClient) : null;
  return {
    readSlack: (team, month) => readSlackSignals(team, month, { client }),
    readGithub: (team, month) => readGithubSignals(team, month, offline ? { token: "" } : {}),
    infer: (team, month, signals) => (offline ? inferDrivers(team, month, signals, null) : inferDrivers(team, month, signals)),
    getContext: (team, month) => listContexts(month).find((c) => c.team === team),
    saveContext: upsertContext,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile?.(); } catch { /* no .env */ }
  const offline = process.argv.includes("--offline");
  refreshSignals(DEMO.month, defaultRefreshDeps({ offline })).then(
    (results) => {
      for (const r of results) {
        console.log(
          r.skipped
            ? `${r.team}: skipped (${r.skipped})`
            : `${r.team}: ${r.signals} signals, ${r.events} events${r.usedLlm ? " (LLM)" : ""}`,
        );
      }
    },
    (err) => { console.error(err); process.exit(1); },
  );
}
