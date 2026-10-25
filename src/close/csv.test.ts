// OWNER: C
import { describe, expect, it } from 'vitest';
import type { JournalEntry } from '../shared/types';
import { CSV_HEADER, toCsv } from './csv';

const entry: JournalEntry = {
  id: 'JE-2026-10-ACCRUAL', month: '2026-10', date: '2026-10-31', kind: 'accrual', status: 'approved', approvedBy: 'Dana',
  lines: [
    { account: '5010', team: 'support', debit: 10040, credit: 0,
      memo: 'Accrued AI usage — Support — Oct 2026',
      evidence: ['$6,120 through Oct 25; "3x" from Oct 27 (Priya, Slack)', 'usage:support:2026-10'] },
    { account: '2100', debit: 0, credit: 10040, memo: '=HYPERLINK("x")', evidence: ['Sum of 1 team estimates'] },
  ],
};

describe('toCsv', () => {
  const lines = toCsv(entry).split('\n');

  it('starts with the exact header', () => {
    expect(CSV_HEADER).toBe('date,je_id,account,team,debit,credit,memo,evidence');
    expect(lines[0]).toBe(CSV_HEADER);
  });

  it('writes one row per line with two-decimal amounts, blank team when absent, and a trailing newline', () => {
    expect(lines).toHaveLength(4); // header, 2 rows, '' after trailing newline
    expect(lines[3]).toBe('');
    expect(lines[1].startsWith('2026-10-31,JE-2026-10-ACCRUAL,5010,support,10040.00,0.00,')).toBe(true);
    expect(lines[2].startsWith('2026-10-31,JE-2026-10-ACCRUAL,2100,,0.00,10040.00,')).toBe(true);
  });

  it('uses LF endings only', () => {
    expect(toCsv(entry)).not.toContain('\r');
  });

  it('joins evidence with " | " and quotes commas, doubling embedded quotes', () => {
    expect(lines[1]).toContain('"$6,120 through Oct 25; ""3x"" from Oct 27 (Priya, Slack) | usage:support:2026-10"');
  });

  it('guards every cell starting with = + - @ tab or CR, including negative-looking text', () => {
    const row = (memo: string): string => toCsv({ ...entry, lines: [{ ...entry.lines[0], memo }] }).split('\n')[1];
    expect(row("-2+3+cmd|' /C calc'!A0")).toContain(`,"'-2+3+cmd|' /C calc'!A0",`);
    expect(row('-5')).toContain(`,"'-5",`);
    expect(row('+1')).toContain(`,"'+1",`);
    expect(row('@SUM(1)')).toContain(`,"'@SUM(1)",`);
    expect(row('\tcmd')).toContain(",\"'\tcmd\",");
    expect(row('\rcmd')).toContain(",\"'\rcmd\",");
  });

  it('neutralises spreadsheet formulas', () => {
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
