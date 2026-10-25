// OWNER: C — turns Jira issues into dated volume events, deterministically (no LLM).
import { parseMultiplier } from '../../llm/inferDrivers';
import { TEAMS } from '../../shared/config';
import type { Team } from '../../shared/types';
import { JIRA } from '../config';
import type { ExternalEvent } from '../merge';
import type { JiraIssueSnapshot } from '../types';

export function teamOf(issue: JiraIssueSnapshot): Team | null {
  const names = [
    ...issue.labels.filter((l) => l.startsWith(JIRA.teamLabelPrefix)).map((l) => l.slice(JIRA.teamLabelPrefix.length)),
    ...issue.components,
  ].map((n) => n.toLowerCase());
  return (TEAMS.find((t) => names.includes(t)) as Team | undefined) ?? null;
}

export function kindOf(issue: JiraIssueSnapshot): string | null {
  return issue.labels.find((l) => Object.hasOwn(JIRA.kinds, l)) ?? null;
}

/** The due date as it stood at the end of `asOf`: later changes are undone. */
export function dueDateAsOf(issue: JiraIssueSnapshot, asOf: string): string | null {
  let due = issue.dueDate;
  const later = issue.dueDateHistory.filter((h) => h.at.slice(0, 10) > asOf).sort((a, b) => b.at.localeCompare(a.at));
  for (const h of later) due = h.from;
  return due;
}

/** One event per team-labelled, kind-labelled issue with a due date, dated on that due date. */
export function jiraEvents(issues: JiraIssueSnapshot[], asOf: string): ExternalEvent[] {
  return issues.flatMap((issue): ExternalEvent[] => {
    const team = teamOf(issue);
    const kind = kindOf(issue);
    const date = dueDateAsOf(issue, asOf);
    if (!team || !kind || !date) return [];
    const stated = parseMultiplier(`${issue.summary}\n${issue.description}`)[0];
    return [{
      team, date,
      multiplier: stated ?? JIRA.kinds[kind],
      note: `${kind} (Jira ${issue.key})`,
      source: 'jira',
      evidence: [{ source: 'jira', id: issue.key, url: issue.url, text: issue.summary, date: issue.updatedAt.slice(0, 10) }],
    }];
  });
}

/** Issues for a team whose due date was in, or moved out of, the month: what a variance memo should cite. */
export function relatedIssues(issues: JiraIssueSnapshot[], team: Team, month: string): JiraIssueSnapshot[] {
  return issues.filter((i) => teamOf(i) === team && (
    i.dueDate?.startsWith(month) || i.dueDateHistory.some((h) => h.from?.startsWith(month) || h.to?.startsWith(month))
  ));
}

/** "Jira NW-2 due date moved 2026-10-26 → 2026-11-04 on 2026-10-28" for each move out of the month. */
export function slipNotes(issues: JiraIssueSnapshot[], team: Team, month: string): string[] {
  return relatedIssues(issues, team, month).flatMap((i) =>
    i.dueDateHistory
      .filter((h) => h.from?.startsWith(month) && !h.to?.startsWith(month))
      .map((h) => `Jira ${i.key} due date moved ${h.from} → ${h.to ?? 'none'} on ${h.at.slice(0, 10)}`),
  );
}
