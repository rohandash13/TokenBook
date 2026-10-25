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
    expect(teamOf(byKey('SPEND-6'))).toBe('support');
    expect(kindOf(byKey('SPEND-6'))).toBe('launch');
    expect(teamOf({ ...byKey('SPEND-9'), labels: [], components: ['Search'] })).toBe('search');
    expect(kindOf(byKey('SPEND-9'))).toBeNull();
  });

  it('uses the multiplier written on the issue: Support launch ~3x from Oct 27', () => {
    const [e] = jiraEvents([byKey('SPEND-6')], '2026-10-25');
    expect(e).toMatchObject({ team: 'support', date: '2026-10-27', multiplier: 3, source: 'jira', note: 'launch (Jira SPEND-6)' });
    expect(e.evidence[0]).toMatchObject({ source: 'jira', id: 'SPEND-6', url: 'https://one-atlas-ikgm.atlassian.net/browse/SPEND-6' });
  });

  it('sees the Growth campaign as of the accrual date, before it slipped', () => {
    expect(dueDateAsOf(byKey('SPEND-7'), '2026-10-25')).toBe('2026-10-26');
    expect(dueDateAsOf(byKey('SPEND-7'), '2026-10-29')).toBe('2026-11-04');
    expect(jiraEvents([byKey('SPEND-7')], '2026-10-25')[0]).toMatchObject({ team: 'growth', date: '2026-10-26', multiplier: 2 });
  });

  it('falls back to the kind default when the issue states no multiplier', () => {
    const plain = { ...byKey('SPEND-6'), summary: 'Launch Support agent v2', description: '' };
    expect(jiraEvents([plain], '2026-10-25')[0].multiplier).toBe(2);
  });

  it('skips issues without a team, a kind or a due date', () => {
    expect(jiraEvents([byKey('SPEND-9')], '2026-10-25')).toEqual([]);
    expect(jiraEvents([{ ...byKey('SPEND-6'), dueDate: null }], '2026-10-25')).toEqual([]);
  });

  it('finds the slip a variance memo should cite', () => {
    expect(relatedIssues(fixtures, 'growth', '2026-10').map((i) => i.key)).toEqual(['SPEND-7']);
    expect(slipNotes(fixtures, 'growth', '2026-10')).toEqual(['Jira SPEND-7 due date moved 2026-10-26 → 2026-11-04 on 2026-10-28']);
    expect(slipNotes(fixtures, 'support', '2026-10')).toEqual([]);
  });
});
