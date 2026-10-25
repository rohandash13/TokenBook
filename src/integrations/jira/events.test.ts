// OWNER: C
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { JiraIssueSnapshot } from '../types';
import { dueDateAsOf, jiraEvents, kindOf, relatedIssues, slipNotes, teamOf } from './events';

const fixtures = JSON.parse(
  readFileSync(new URL('../../../data/fixtures/integrations/jira.json', import.meta.url), 'utf8'),
) as JiraIssueSnapshot[];
const byKey = (k: string) => fixtures.find((i) => i.key === k)!;

describe('jira issue → event', () => {
  it('reads team and kind from labels, or team from a component', () => {
    expect(teamOf(byKey('NW-1'))).toBe('support');
    expect(kindOf(byKey('NW-1'))).toBe('launch');
    expect(teamOf({ ...byKey('NW-4'), labels: [], components: ['Search'] })).toBe('search');
    expect(kindOf(byKey('NW-4'))).toBeNull();
  });

  it('uses the multiplier written on the issue: Support launch ~3x from Oct 27', () => {
    const [e] = jiraEvents([byKey('NW-1')], '2026-10-25');
    expect(e).toMatchObject({ team: 'support', date: '2026-10-27', multiplier: 3, source: 'jira', note: 'launch (Jira NW-1)' });
    expect(e.evidence[0]).toMatchObject({ source: 'jira', id: 'NW-1', url: 'https://northwind-labs.atlassian.net/browse/NW-1' });
  });

  it('sees the Growth campaign as of the accrual date, before it slipped', () => {
    expect(dueDateAsOf(byKey('NW-2'), '2026-10-25')).toBe('2026-10-26');
    expect(dueDateAsOf(byKey('NW-2'), '2026-10-29')).toBe('2026-11-04');
    expect(jiraEvents([byKey('NW-2')], '2026-10-25')[0]).toMatchObject({ team: 'growth', date: '2026-10-26', multiplier: 2 });
  });

  it('falls back to the kind default when the issue states no multiplier', () => {
    const plain = { ...byKey('NW-1'), summary: 'Launch Support agent v2', description: '' };
    expect(jiraEvents([plain], '2026-10-25')[0].multiplier).toBe(2);
  });

  it('skips issues without a team, a kind or a due date', () => {
    expect(jiraEvents([byKey('NW-4')], '2026-10-25')).toEqual([]);
    expect(jiraEvents([{ ...byKey('NW-1'), dueDate: null }], '2026-10-25')).toEqual([]);
  });

  it('finds the slip a variance memo should cite', () => {
    expect(relatedIssues(fixtures, 'growth', '2026-10').map((i) => i.key)).toEqual(['NW-2']);
    expect(slipNotes(fixtures, 'growth', '2026-10')).toEqual(['Jira NW-2 due date moved 2026-10-26 → 2026-11-04 on 2026-10-28']);
    expect(slipNotes(fixtures, 'support', '2026-10')).toEqual([]);
  });
});
