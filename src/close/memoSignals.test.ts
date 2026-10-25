// OWNER: C
import { describe, expect, it } from 'vitest';
import type { MemoInput, TeamContext } from '../shared/types';
import type { Signal } from '../signals/types';
import { citeLine, contradictingSignals, parseCiteLine, withSignalContext } from './memoSignals';

const sig = (over: Partial<Signal>): Signal => ({
  id: over.id ?? 'x', source: 'slack', kind: 'message', team: 'growth', date: '2026-10-19', text: '', url: 'https://slack.com/x', ...over,
});

const growthCtx: TeamContext = {
  team: 'growth', month: '2026-10', replied: true, leadName: 'Maya', quote: 'Fall campaign goes live Oct 26',
  events: [{ date: '2026-10-26', multiplier: 2, note: 'Fall campaign launch' }],
};

const growthSignals: Signal[] = [
  sig({ id: 'a', date: '2026-10-03', author: 'Maya Chen', text: 'Fall campaign goes live Oct 26, expect roughly double the traffic.' }),
  sig({ id: 'b', date: '2026-10-08', text: 'Email segments built: lapsed users (12k).' }),
  sig({ id: 'c', date: '2026-10-19', author: 'Maya Chen', text: 'Fall campaign pushed to Nov 4, creative not ready.' }),
  sig({ id: 'd', date: '2026-10-11', text: 'A/B test moved to variant B.' }), // a slip word, but not about the campaign
  sig({ id: 'e', source: 'github', kind: 'milestone', date: '2026-10-24', url: 'https://github.com/m/1',
    text: "Milestone 'Fall campaign' due 2026-11-04: moved from Oct 26", dueDate: '2026-11-04', previousDueDate: '2026-10-26' }),
];

const input: MemoInput = {
  team: 'growth', month: '2026-10', estimate: 5550, actual: 4651.22, variancePct: 0.1932,
  basis: 'b', approvedBy: 'Dana', sources: ['JE-2026-10-ACCRUAL'],
};

describe('contradictingSignals', () => {
  it('finds the moved milestone first, then slip messages about the driver', () => {
    expect(contradictingSignals(growthCtx, growthSignals).map((s) => s.id)).toEqual(['e', 'c']);
  });

  it('finds nothing when the accrual used no driver', () => {
    expect(contradictingSignals({ ...growthCtx, events: [] }, growthSignals)).toEqual([]);
    expect(contradictingSignals(undefined, growthSignals)).toEqual([]);
  });
});

describe('withSignalContext', () => {
  it('appends contradicting signals as cited source lines', () => {
    const [out] = withSignalContext([input], [growthCtx], () => growthSignals);
    expect(out.sources[0]).toBe('JE-2026-10-ACCRUAL');
    expect(out.sources).toContain(
      `contradicts: GitHub, Oct 24: "Milestone 'Fall campaign' due 2026-11-04: moved from Oct 26" https://github.com/m/1`,
    );
    expect(out.sources).toContain('contradicts: Slack, Oct 19, Maya Chen: "Fall campaign pushed to Nov 4, creative not ready." https://slack.com/x');
  });

  it('cites the evidence an inferred driver relied on', () => {
    const ctx: TeamContext = {
      team: 'support', month: '2026-10', replied: false, inferred: true,
      events: [{ date: '2026-10-27', multiplier: 3, note: 'support launch', source: 'github',
        evidence: [{ source: 'github', id: 'm', url: 'https://github.com/s/1', text: 'Milestone due 2026-10-27', date: '2026-10-24' }] }],
    };
    const [out] = withSignalContext([{ ...input, team: 'support' }], [ctx], () => []);
    expect(out.sources).toContain('evidence: GitHub, Oct 24: "Milestone due 2026-10-27" https://github.com/s/1');
  });

  it('leaves inputs alone when there is nothing to cite', () => {
    const [out] = withSignalContext([input], [], () => growthSignals);
    expect(out).toBe(input);
  });
});

describe('parseCiteLine', () => {
  it('round-trips a cited line and ignores plain sources', () => {
    const line = citeLine('contradicts', { source: 'slack', date: '2026-10-19', author: 'Maya Chen', text: 'pushed to Nov 4', url: 'https://s/x' });
    expect(parseCiteLine(line)).toEqual({ kind: 'contradicts', label: 'Slack, Oct 19, Maya Chen', text: 'pushed to Nov 4', url: 'https://s/x' });
    expect(parseCiteLine('JE-2026-10-ACCRUAL')).toBeUndefined();
  });
});
