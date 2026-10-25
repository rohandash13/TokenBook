// OWNER: D
// Reads Slack + GitHub signals per team, infers forecast drivers, and saves an inferred context.
import { pathToFileURL } from "node:url";
import { WebClient } from "@slack/web-api";
import { inferDrivers } from "../llm/inferDrivers.js";
import { DEMO, TEAM_INFO, TEAMS } from "../shared/config.js";
import type { ContextEvent, DriverFlag, Month, Team, TeamContext } from "../shared/types.js";
import { listContexts, upsertContext } from "../server/store.js";
import { readGithubSignals } from "./github.js";
import { readSlackSignals, type SlackReaderClient } from "./slack.js";
import type { Signal } from "./types.js";

export type RefreshResult = { team: Team; signals: number; events: number; usedLlm: boolean; skipped?: "lead replied" | "source unavailable" };

export type RefreshDeps = {
  readSlack: (team: Team, month: Month) => Promise<Signal[]>;
  readGithub: (team: Team, month: Month) => Promise<Signal[]>;
  infer: (team: Team, month: Month, signals: Signal[]) => Promise<{ events: ContextEvent[]; flags?: DriverFlag[]; dropped: unknown[]; usedLlm: boolean }>;
  /** Optional: true if a live read for (team, month) fell back to fixtures. Checked after reads. */
  sourceFellBack?: (team: Team, month: Month) => boolean;
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

/** Forget cached signals (used by demoReset). */
export function clearSignalCache(): void {
  cache.clear();
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
    if (deps.sourceFellBack?.(team, month)) {
      log(`${team}: live source unavailable, not saving fixture data`);
      results.push({ team, signals: 0, events: 0, usedLlm: false, skipped: "source unavailable" });
      continue;
    }
    const signals = [...slack, ...github];
    cache.set(key(team, month), signals);
    const result = await deps.infer(team, month, signals);
    const { events, dropped, usedLlm } = result;
    const flags = result.flags ?? [];
    if (dropped.length > 0) log(`${team}: dropped ${dropped.length} proposed event(s)`);
    const latest = deps.getContext(team, month);
    if (latest?.replied) {
      results.push({ team, signals: signals.length, events: 0, usedLlm, skipped: "lead replied" });
      continue;
    }
    deps.saveContext({
      team, month, replied: false, inferred: true, inferredAt: now(), events, flags,
      leadName: existing?.leadName ?? TEAM_INFO[team].leadName,
    });
    results.push({ team, signals: signals.length, events: events.length, usedLlm });
  }
  return results;
}

export function defaultRefreshDeps(opts: { offline?: boolean; deterministic?: boolean } = {}): RefreshDeps {
  const offline = opts.offline === true;
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;
  const githubConfigured = !!githubToken || process.env.GITHUB_USE_CLI === "1";
  const client: SlackReaderClient | null =
    !offline && slackToken ? (new WebClient(slackToken) as unknown as SlackReaderClient) : null;
  // Readers log a "using fixture" warning when they fall back; record it per (team, month).
  const fellBack = new Set<string>();
  const recorder = (k: string) => (msg: string) => {
    console.warn(msg);
    if (/using fixture/.test(msg)) fellBack.add(k);
  };
  return {
    readSlack: (team, month) => readSlackSignals(team, month, { client, log: recorder(`slack:${key(team, month)}`) }),
    readGithub: (team, month) =>
      readGithubSignals(team, month, offline ? { token: "" } : { log: recorder(`github:${key(team, month)}`) }),
    sourceFellBack: (team, month) => {
      if (offline) return false;
      const k = key(team, month);
      const slackBad = !!slackToken && fellBack.delete(`slack:${k}`);
      const githubBad = githubConfigured && fellBack.delete(`github:${k}`);
      fellBack.delete(`slack:${k}`); fellBack.delete(`github:${k}`);
      return slackBad || githubBad;
    },
    infer: async (team, month, signals) => {
      const r = await (offline || opts.deterministic ? inferDrivers(team, month, signals, null) : inferDrivers(team, month, signals));
      // inferDrivers cites signals by id; the stored context carries the evidence itself (like events do).
      const byId = new Map(signals.map((s) => [s.id, s]));
      const flags: DriverFlag[] = r.flags.map((f) => ({
        date: f.date, note: f.note, reason: f.reason,
        evidence: f.evidenceIds.flatMap((id) => {
          const sig = byId.get(id);
          return sig ? [{ source: sig.source, id: sig.id, url: sig.url, text: sig.text.slice(0, 200), date: sig.date, ...(sig.author && { author: sig.author }) }] : [];
        }),
      }));
      return { ...r, flags };
    },
    getContext: (team, month) => listContexts(month).find((c) => c.team === team),
    saveContext: upsertContext,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile?.(); } catch { /* no .env */ }
  const offline = process.argv.includes("--offline");
  refreshSignals(DEMO.month, defaultRefreshDeps({ offline, deterministic: process.argv.includes("--deterministic") })).then(
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
