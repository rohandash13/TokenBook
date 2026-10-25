// OWNER: D
import { describe, expect, it } from 'vitest';
import { applySlackLinks } from './slackLinks.js';
import type { Signal } from './types.js';

const s: Signal = { id: 'slack:fixture:1', team: 'support', source: 'slack', kind: 'message', date: '2026-10-06', text: 'Launch Oct 27, 3x API calls', url: 'https://northwind.slack.com/archives/C_FAKE/p1' };

describe('verified Slack fixture links', () => {
  it('uses actual channel/message permalinks while preserving forecast evidence content', () => {
    const url = 'https://northwindlabsglobal.slack.com/archives/C123ABC/p1792800000000001?thread_ts=1792800000.000001&cid=C123ABC';
    const [actual] = applySlackLinks([s], { [s.id]: url });
    expect(actual).toEqual({ ...s, url });
    expect(s.url).toContain('C_FAKE');
  });
  it.each(['javascript:alert(1)', 'https://example.com/archives/C123/p1', 'https://northwind.slack.com/archives/C_FAKE/p1'])('ignores invalid manifest links: %s', (url) => {
    expect(applySlackLinks([s], { [s.id]: url })).toEqual([s]);
  });
  it('leaves unmatched evidence and GitHub links unchanged', () => {
    const github = { ...s, source: 'github' as const, url: 'https://github.com/org/repo/milestone/1' };
    expect(applySlackLinks([s], {})).toEqual([s]);
    expect(applySlackLinks([github], { [s.id]: 'https://northwindlabsglobal.slack.com/archives/C123/p123' })).toEqual([github]);
  });
});
