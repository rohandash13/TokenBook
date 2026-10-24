// OWNER: C
import type { JournalEntry } from '../shared/types';

export const CSV_HEADER = 'date,je_id,account,team,debit,credit,memo,evidence';

const amount = (usd: number) => usd.toFixed(2);

// Quote when needed (comma, quote, newline) and prefix formula-like text with a single quote.
function cell(raw: string): string {
  const s = /^[=+@\-]/.test(raw) && !/^-?\d/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) || s !== raw ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(entry: JournalEntry): string {
  const rows = entry.lines.map((l) =>
    [entry.date, entry.id, l.account, l.team ?? '', amount(l.debit), amount(l.credit), l.memo, l.evidence.join(' | ')]
      .map(cell)
      .join(','),
  );
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}
