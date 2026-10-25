// OWNER: C — month-end close → Jira. Memos cite what Jira knew; each new variance memo opens a Jira task
// through the Forge app's web trigger (FORGE_WEBTRIGGER_URL, secret JIRA_WEBHOOK_SECRET).
import { monthLabel, TEAM_INFO } from '../../shared/config';
import type { StoredMemo } from '../../shared/api';
import type { MemoInput, Team } from '../../shared/types';
import type { JiraIssueSnapshot } from '../types';
import { relatedIssues, slipNotes } from './events';

/** Adds Jira slips to the memo basis and the Jira issues to its sources (no numbers are invented). */
export function withJiraContext(inputs: MemoInput[], issues: JiraIssueSnapshot[]): MemoInput[] {
  return inputs.map((i) => {
    const notes = slipNotes(issues, i.team, i.month);
    const keys = relatedIssues(issues, i.team, i.month).map((x) => `jira:${x.key}`);
    return {
      ...i,
      basis: notes.length ? `${i.basis}; ${notes.join('; ')}` : i.basis,
      sources: [...i.sources, ...keys.filter((k) => !i.sources.includes(k))],
    };
  });
}

export type NotifyResult = { team: Team; key?: string; error?: string };

export async function notifyVariance(
  memos: StoredMemo[],
  issues: JiraIssueSnapshot[],
  opts: { url?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<NotifyResult[]> {
  const { url, secret, fetchImpl = fetch, timeoutMs = 8000 } = opts;
  if (!url || !secret) return [];
  const results: NotifyResult[] = [];
  for (const memo of memos) {
    const body = {
      month: memo.month,
      monthLabel: monthLabel(memo.month),
      team: memo.team,
      teamLabel: TEAM_INFO[memo.team].label,
      memoText: memo.text,
      sources: memo.sources,
      relatedIssueKeys: relatedIssues(issues, memo.team, memo.month).map((i) => i.key),
    };
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-trueup-secret': secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
      results.push(res.ok && json.key ? { team: memo.team, key: json.key } : { team: memo.team, error: json.error ?? `HTTP ${res.status}` });
    } catch (err) {
      results.push({ team: memo.team, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
