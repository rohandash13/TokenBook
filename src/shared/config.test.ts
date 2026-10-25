import { describe, expect, it } from 'vitest';
import {
  DEMO, EXPENSE_ACCOUNT, asOfFor, daysRemaining, firstDayOfNextMonth, lastDayOfMonth,
  monthLabel, monthsBetween, nextMonth, prevMonth,
} from './config';

describe('period helpers', () => {
  it('finds the last day of a month', () => {
    expect(lastDayOfMonth('2026-10')).toBe('2026-10-31');
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2026-11')).toBe('2026-11-30');
  });
  it('rolls months over year boundaries', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(firstDayOfNextMonth('2026-10')).toBe('2026-11-01');
    expect(firstDayOfNextMonth('2026-12')).toBe('2027-01-01');
  });
  it('lists months inclusively', () => {
    expect(monthsBetween('2026-02', '2026-05')).toEqual(['2026-02', '2026-03', '2026-04', '2026-05']);
  });
  it('uses the 25th as the as-of day, matching the demo', () => {
    expect(asOfFor('2026-10')).toBe(DEMO.asOf);
    expect(asOfFor('2026-03')).toBe('2026-03-25');
  });
  it('labels months', () => {
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });
  it('maps teams to accounts', () => {
    expect(EXPENSE_ACCOUNT).toEqual({ support: '5010', search: '6130', growth: '6130', platform: '6130' });
  });
});

describe('daysRemaining', () => {
  it('counts days after as-of in the month', () => {
    expect(daysRemaining('2026-10-25')).toBe(6);
    expect(daysRemaining('2026-02-28')).toBe(0);
  });
});
