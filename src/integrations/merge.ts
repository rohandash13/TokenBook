// OWNER: C — layers events collected from Jira (Atlassian Forge app) and the web (Apify) onto each
// team's context, so the estimate engine sees them without any change to its contract.
import { TEAM_INFO } from '../shared/config';
import type { ContextEvent, Evidence, Month, Team, TeamContext } from '../shared/types';

/** An event a collector derived deterministically, before it is attached to a team's context. */
export type ExternalEvent = {
  team: Team;
  date: string;
  multiplier: number;
  note: string;
  source: 'jira' | 'web';
  evidence: Evidence[];
};

const monthOf = (date: string): Month => date.slice(0, 7);

function lastIndex(contexts: TeamContext[], team: Team, month: Month): number {
  for (let i = contexts.length - 1; i >= 0; i--) if (contexts[i].team === team && contexts[i].month === month) return i;
  return -1;
}

/**
 * Appends collected events to the matching (team, month) context.
 * - A lead's reply keeps `replied: true`; an unreplied context becomes `inferred: true`.
 * - An event on a date the context already has is applied once: the existing version wins, and the
 *   collector's evidence is attached to it as corroboration (a launch seen in GitHub and in Jira).
 * - A team with no context for the month gets an inferred one.
 * - A context that exists but hasn't been checked yet (no lead reply, signals not read) is left alone:
 *   Jira and web events count, like Slack and GitHub, once the team's signals are checked.
 * Never mutates its input.
 */
export function withExternalEvents(contexts: TeamContext[], external: ExternalEvent[]): TeamContext[] {
  const out = [...contexts];
  const groups = new Map<string, ExternalEvent[]>();
  for (const e of external) {
    const key = `${e.team}|${monthOf(e.date)}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const [key, events] of groups) {
    const [team, month] = key.split('|') as [Team, Month];
    const idx = lastIndex(out, team, month);
    const base = idx >= 0 ? out[idx] : undefined;
    if (base && !base.replied && !base.inferred) continue; // not checked yet
    const existing = (base?.events ?? []).map((e) => ({ ...e }));
    const taken = new Set(existing.map((e) => e.date));
    const added: ContextEvent[] = [];
    let corroborated = false;
    for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
      const same = existing.find((x) => x.date === e.date);
      if (same) {
        const have = new Set((same.evidence ?? []).map((x) => x.id));
        const extra = e.evidence.filter((x) => !have.has(x.id));
        if (extra.length) { same.evidence = [...(same.evidence ?? []), ...extra]; corroborated = true; }
        continue;
      }
      if (taken.has(e.date)) continue;
      taken.add(e.date);
      added.push({ date: e.date, multiplier: e.multiplier, note: e.note, source: e.source, evidence: e.evidence });
    }
    if (added.length === 0 && !corroborated) continue;
    if (base) {
      out[idx] = { ...base, events: [...existing, ...added], ...(base.replied || added.length === 0 ? {} : { inferred: true }) };
    } else {
      const latest = added.flatMap((e) => e.evidence ?? []).map((x) => x.date).sort().at(-1);
      out.push({
        team, month, replied: false, inferred: true, events: added, leadName: TEAM_INFO[team].leadName,
        ...(latest ? { inferredAt: latest } : {}),
      });
    }
  }
  return out;
}
