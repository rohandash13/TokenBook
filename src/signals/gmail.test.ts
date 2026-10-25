import { describe, it, expect } from 'vitest';
import { readDemoGmailSignals } from './gmail';
import { inferDrivers } from '../llm/inferDrivers';
import { defaultRefreshDeps } from './refresh';

describe('synthetic Gmail evidence', () => {
  it('scopes the inbox to a team and month', () => {
    expect(readDemoGmailSignals('support', '2026-10')).toHaveLength(2);
    expect(readDemoGmailSignals('support', '2026-11')).toEqual([]);
    expect(readDemoGmailSignals('search', '2026-10').every((s) => s.team === 'search')).toBe(true);
  });
  it('deduplicates repeated launch emails and rejects routine chatter locally', async () => {
    const support = await inferDrivers('support', '2026-10', readDemoGmailSignals('support', '2026-10'), null);
    expect(support.events).toHaveLength(1);
    expect(support.events[0]).toMatchObject({ date: '2026-10-27', multiplier: 3 });
    expect(support.events[0].evidence?.every((e) => e.source === 'gmail')).toBe(true);
    const search = await inferDrivers('search', '2026-10', readDemoGmailSignals('search', '2026-10'), null);
    expect(search.events).toEqual([]);
  });
  it('keeps unknown email sizes out of the forecast', async () => {
    const result = await inferDrivers('platform', '2026-10', readDemoGmailSignals('platform', '2026-10'), null);
    expect(result.events).toEqual([]);
    expect(result.flags.some((f) => f.reason === 'size unknown')).toBe(true);
  });
  it('corroborates a Slack driver without doubling its forecast multiplier', async () => {
    const result = await defaultRefreshDeps({ deterministic: true }).infer('support', '2026-10', [
      { id: 'slack:test', source: 'slack', kind: 'message', team: 'support', date: '2026-10-25', author: 'Priya', text: 'Support agent v2 launches October 27, 2026. Support API usage will be 3x baseline from October 27 onward.', url: 'https://example.com/evidence' },
      ...readDemoGmailSignals('support', '2026-10'),
    ]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].multiplier).toBe(3);
    expect(new Set(result.events[0].evidence?.map((e) => e.source))).toEqual(new Set(['slack', 'gmail']));
  });
});
