import { describe, expect, it } from 'vitest';
import { allocateRemainingSpend } from '../../web/src/spendProjection';
const dates = ['2026-10-26', '2026-10-27', '2026-10-28'];
describe('overview remaining spend allocation', () => {
  it('preserves the month-end remainder around a launch', () => {
    const amounts = allocateRemainingSpend(dates, 700, [{ date: '2026-10-27', multiplier: 3, note: 'launch' }]);
    expect(amounts).toEqual([100, 300, 300]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(700);
  });
  it('ends a temporary spike and keeps zero-traffic windows empty', () => {
    expect(allocateRemainingSpend(dates, 500, [{ date: '2026-10-27', until: '2026-10-27', multiplier: 3, note: 'spike' }])).toEqual([100, 300, 100]);
    expect(allocateRemainingSpend(dates, 200, [{ date: '2026-10-27', until: '2026-10-27', multiplier: 0, note: 'shutdown' }])).toEqual([100, 0, 100]);
  });
  it('handles an exhausted forecast and an empty projection window', () => {
    expect(allocateRemainingSpend(dates, 0, [])).toEqual([0, 0, 0]);
    expect(allocateRemainingSpend([], 0, [])).toEqual([]);
  });
});
