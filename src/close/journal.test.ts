// OWNER: C
import { describe, expect, it } from 'vitest';
import type { Actual, Estimate, JournalEntry, Method, Team, TeamContext } from '../shared/types';
import { applyOverrides, assertBalanced, buildAccrual, buildActual, buildReversal } from './journal';
import { roundCents, sumUsd, toCents } from './money';

const est = (team: Team, amount: number, method: Method = 'trueup'): Estimate => ({
  team, month: '2026-10', asOf: '2026-10-25', method, estimate: amount, actualToDate: amount * 0.8,
  basis: `${team} basis`, confidence: 'high',
});
const estimates = [
  est('support', 10040), est('search', 3200.1), est('growth', 9000.555), est('platform', 2400),
  est('support', 7590, 'runrate'), est('support', 7000, 'lastmonth'),
];
const debitCents = (e: JournalEntry) => e.lines.reduce((a, l) => a + toCents(l.debit), 0);
const creditCents = (e: JournalEntry) => e.lines.reduce((a, l) => a + toCents(l.credit), 0);

describe('money', () => {
  it('rounds to cents and sums exactly', () => {
    expect(roundCents(9000.555)).toBe(9000.56);
    expect(toCents(3200.1)).toBe(320010);
    expect(sumUsd([0.1, 0.2])).toBe(0.3);
    expect(sumUsd([])).toBe(0);
  });
});

describe('buildAccrual', () => {
  const accrual = buildAccrual('2026-10', estimates);

  it('books only trueup estimates, one debit per team plus one 2100 credit', () => {
    expect(accrual.lines).toHaveLength(5);
    const support = accrual.lines.find((l) => l.team === 'support')!;
    expect(support).toMatchObject({ account: '5010', debit: 10040, credit: 0 });
    expect(accrual.lines.filter((l) => l.account === '6130')).toHaveLength(3);
    const credit = accrual.lines.find((l) => l.account === '2100')!;
    expect(credit.credit).toBe(sumUsd([10040, 3200.1, 9000.56, 2400]));
    expect(credit.debit).toBe(0);
  });

  it('leaves the team key off the 2100 line', () => {
    const credit = accrual.lines.find((l) => l.account === '2100')!;
    expect('team' in credit).toBe(false);
  });

  it('balances exactly in cents with float-unfriendly amounts', () => {
    expect(debitCents(accrual)).toBe(creditCents(accrual));
    const odd = buildAccrual('2026-10', [est('support', 0.1), est('search', 0.2), est('growth', 3200.1), est('platform', 9000.555)]);
    expect(debitCents(odd)).toBe(creditCents(odd));
    expect(odd.lines.find((l) => l.account === '2100')!.credit).toBe(sumUsd([0.1, 0.2, 3200.1, 9000.56]));
    expect(() => assertBalanced(odd)).not.toThrow();
  });

  it('carries id, date, status', () => {
    expect(accrual).toMatchObject({ id: 'JE-2026-10-ACCRUAL', date: '2026-10-31', kind: 'accrual', status: 'prepared' });
    expect(accrual.approvedBy).toBeUndefined();
    expect(buildAccrual('2026-10', estimates, [], 'Dana').approvedBy).toBe('Dana');
  });

  it('puts basis and usage ref in the evidence, and the 2100 sum line', () => {
    const support = accrual.lines.find((l) => l.team === 'support')!;
    expect(support.evidence).toEqual(['support basis', 'usage:support:2026-10']);
    expect(accrual.lines.find((l) => l.account === '2100')!.evidence).toEqual(['Sum of 4 team estimates']);
  });

  it('adds slack evidence only for a replied context', () => {
    const ctx = (team: Team, replied: boolean): TeamContext => ({ team, month: '2026-10', replied, events: [] });
    const withCtx = buildAccrual('2026-10', estimates, [ctx('support', true), ctx('search', false)]);
    expect(withCtx.lines.find((l) => l.team === 'support')!.evidence).toContain('slack:support:2026-10');
    expect(withCtx.lines.find((l) => l.team === 'search')!.evidence).not.toContain('slack:search:2026-10');
    expect(accrual.lines.find((l) => l.team === 'support')!.evidence).not.toContain('slack:support:2026-10');
    const otherMonth = buildAccrual('2026-10', estimates, [{ ...ctx('support', true), month: '2026-09' }]);
    expect(otherMonth.lines.find((l) => l.team === 'support')!.evidence).not.toContain('slack:support:2026-10');
  });

  it('adds override evidence for overridden rows only', () => {
    const out = buildAccrual('2026-10', applyOverrides(estimates, { support: 9500 }));
    expect(out.lines.find((l) => l.team === 'support')!.evidence).toContain('override:controller');
    expect(out.lines.find((l) => l.team === 'search')!.evidence).not.toContain('override:controller');
    expect(out.lines.find((l) => l.team === 'support')!.debit).toBe(9500);
  });

  it('throws when there are no trueup estimates for the month', () => {
    expect(() => buildAccrual('2026-10', [est('support', 1, 'runrate')])).toThrow(/No trueup estimates for 2026-10/);
  });
});

describe('assertBalanced', () => {
  it('throws on an unbalanced entry', () => {
    const bad = buildAccrual('2026-10', estimates);
    bad.lines[0] = { ...bad.lines[0], debit: bad.lines[0].debit + 0.01 };
    expect(() => assertBalanced(bad)).toThrow(/Unbalanced entry JE-2026-10-ACCRUAL/);
  });
  it('throws on sub-cent or negative amounts', () => {
    const bad = buildAccrual('2026-10', estimates);
    bad.lines[0] = { ...bad.lines[0], debit: 10.005 };
    expect(() => assertBalanced(bad)).toThrow(/cents/);
    const neg = buildAccrual('2026-10', estimates);
    neg.lines[0] = { ...neg.lines[0], debit: -1 };
    expect(() => assertBalanced(neg)).toThrow(/cents/);
  });
});

describe('buildReversal', () => {
  const accrual = buildAccrual('2026-10', estimates, [], 'Dana');
  const reversal = buildReversal(accrual);

  it('mirrors every accrual line', () => {
    expect(reversal.lines).toHaveLength(accrual.lines.length);
    reversal.lines.forEach((l, i) => {
      expect(l.account).toBe(accrual.lines[i].account);
      expect(l.team).toBe(accrual.lines[i].team);
      expect(l.debit).toBe(accrual.lines[i].credit);
      expect(l.credit).toBe(accrual.lines[i].debit);
      expect(l.evidence).toEqual(['Reversal of JE-2026-10-ACCRUAL']);
    });
    expect('team' in reversal.lines.find((l) => l.account === '2100')!).toBe(false);
    expect(debitCents(reversal)).toBe(creditCents(reversal));
  });

  it('is dated day 1 of next month, approved, with approvedBy copied', () => {
    expect(reversal).toMatchObject({ id: 'JE-2026-10-REVERSAL', date: '2026-11-01', kind: 'reversal', status: 'approved', approvedBy: 'Dana' });
  });

  it('refuses to reverse something that is not an accrual', () => {
    expect(() => buildReversal(reversal)).toThrow(/only reverse an accrual/);
  });
});

describe('buildActual', () => {
  const actuals: Actual[] = [
    { team: 'support', month: '2026-10', actualUsd: 10210 },
    { team: 'growth', month: '2026-10', actualUsd: 5600.25 },
  ];
  const actual = buildActual('2026-10', actuals, 'Dana');

  it('debits expense by team and credits 2000 for the total', () => {
    expect(actual.lines.find((l) => l.team === 'support')).toMatchObject({ account: '5010', debit: 10210, evidence: ['actuals:support:2026-10'] });
    expect(actual.lines.find((l) => l.team === 'growth')).toMatchObject({ account: '6130', debit: 5600.25 });
    const ap = actual.lines.find((l) => l.account === '2000')!;
    expect(ap.credit).toBe(15810.25);
    expect(ap.evidence).toEqual(['Sum of 2 team actuals']);
    expect('team' in ap).toBe(false);
    expect(debitCents(actual)).toBe(creditCents(actual));
    expect(actual).toMatchObject({ id: 'JE-2026-10-ACTUAL', date: '2026-11-01', kind: 'actual', status: 'approved', approvedBy: 'Dana' });
  });

  it('balances with float-unfriendly actuals and throws with none', () => {
    const odd = buildActual('2026-10', [
      { team: 'support', month: '2026-10', actualUsd: 0.1 },
      { team: 'search', month: '2026-10', actualUsd: 0.2 },
      { team: 'growth', month: '2026-10', actualUsd: 9000.555 },
    ]);
    expect(debitCents(odd)).toBe(creditCents(odd));
    expect(() => buildActual('2026-10', [])).toThrow(/No actuals for 2026-10/);
  });
});

describe('applyOverrides', () => {
  it('replaces only the trueup amount for overridden teams and records why', () => {
    const out = applyOverrides(estimates, { support: 9500 });
    const support = out.find((e) => e.team === 'support' && e.method === 'trueup')!;
    expect(support.estimate).toBe(9500);
    expect(support.basis).toMatch(/^Manual override to \$9,500 \(model: \$10,040/);
    expect(out.find((e) => e.team === 'support' && e.method === 'runrate')!.estimate).toBe(7590);
    expect(out.find((e) => e.team === 'search')!.estimate).toBe(3200.1);
    expect(estimates[0].estimate).toBe(10040);
  });
});
