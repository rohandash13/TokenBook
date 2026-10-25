// OWNER: C
import type { Overrides } from '../shared/api';
import {
  ACCOUNTS_PAYABLE, ACCRUED_LIABILITIES, EXPENSE_ACCOUNT, TEAM_INFO,
  firstDayOfNextMonth, lastDayOfMonth, monthLabel,
} from '../shared/config';
import { formatUsd } from '../shared/format';
import type { Actual, Estimate, JournalEntry, JournalLine, Month, TeamContext } from '../shared/types';
import { roundCents, sumUsd, toCents } from './money';

// An overridden row is marked by its basis: applyOverrides rewrites it to start with this prefix,
// and buildAccrual keys 'override:controller' evidence off it (no change to the Estimate contract).
const OVERRIDE_PREFIX = 'Manual override';

export function applyOverrides(estimates: Estimate[], overrides: Overrides): Estimate[] {
  return estimates.map((e) => {
    const amount = overrides[e.team];
    if (e.method !== 'trueup' || amount === undefined) return e;
    return {
      ...e,
      estimate: roundCents(amount),
      basis: `${OVERRIDE_PREFIX} to ${formatUsd(amount)} (model: ${formatUsd(e.estimate)}; ${e.basis})`,
    };
  });
}

export function assertBalanced(entry: JournalEntry): JournalEntry {
  for (const l of entry.lines) {
    for (const v of [l.debit, l.credit]) {
      if (!Number.isFinite(v) || v < 0 || roundCents(v) !== v) {
        throw new Error(`Entry ${entry.id}: amounts must be non-negative whole cents, got ${v}`);
      }
    }
  }
  const dr = entry.lines.reduce((a, l) => a + toCents(l.debit), 0);
  const cr = entry.lines.reduce((a, l) => a + toCents(l.credit), 0);
  if (dr !== cr) throw new Error(`Unbalanced entry ${entry.id}: debits ${dr / 100} != credits ${cr / 100}`);
  return entry;
}

// The credit total comes from the summed cents of the already-rounded debit lines.
function withCreditLine(debitLines: JournalLine[], account: string, memo: string, evidence: string): JournalLine[] {
  const total = sumUsd(debitLines.map((l) => l.debit));
  return [...debitLines, { account, debit: 0, credit: total, memo, evidence: [evidence] }];
}

export function buildAccrual(
  month: Month,
  estimates: Estimate[],
  contexts: TeamContext[] = [],
  approvedBy?: string,
): JournalEntry {
  const trueups = estimates.filter((e) => e.month === month && e.method === 'trueup');
  if (trueups.length === 0) throw new Error(`No trueup estimates for ${month}`);
  const seen = new Set<string>();
  for (const e of trueups) {
    if (seen.has(e.team)) throw new Error(`Duplicate trueup estimate for ${e.team} in ${month}`);
    seen.add(e.team);
  }
  const label = monthLabel(month);
  const debitLines: JournalLine[] = trueups.map((e) => {
    const evidence = [e.basis, `usage:${e.team}:${month}`];
    if (contexts.some((c) => c.team === e.team && c.month === month && c.replied)) evidence.push(`slack:${e.team}:${month}`);
    if (e.basis.startsWith(OVERRIDE_PREFIX)) evidence.push('override:controller');
    return {
      account: EXPENSE_ACCOUNT[e.team],
      team: e.team,
      debit: roundCents(e.estimate),
      credit: 0,
      memo: `Accrued AI usage — ${TEAM_INFO[e.team].label} — ${label}`,
      evidence,
    };
  });
  return assertBalanced({
    id: `JE-${month}-ACCRUAL`,
    month,
    date: lastDayOfMonth(month),
    kind: 'accrual',
    status: 'prepared',
    lines: withCreditLine(debitLines, ACCRUED_LIABILITIES, `Accrued AI usage — ${label}`, `Sum of ${trueups.length} team estimates`),
    ...(approvedBy !== undefined ? { approvedBy } : {}),
  });
}

export function buildReversal(accrual: JournalEntry): JournalEntry {
  if (accrual.kind !== 'accrual') throw new Error(`Can only reverse an accrual, got ${accrual.kind} ${accrual.id}`);
  return assertBalanced({
    id: `JE-${accrual.month}-REVERSAL`,
    month: accrual.month,
    date: firstDayOfNextMonth(accrual.month),
    kind: 'reversal',
    status: 'approved',
    lines: accrual.lines.map((l) => ({
      ...l,
      debit: l.credit,
      credit: l.debit,
      memo: `Reverse: ${l.memo}`,
      evidence: [`Reversal of ${accrual.id}`],
    })),
    ...(accrual.approvedBy !== undefined ? { approvedBy: accrual.approvedBy } : {}),
  });
}

export function buildActual(month: Month, actuals: Actual[], approvedBy?: string): JournalEntry {
  const label = monthLabel(month);
  const debitLines: JournalLine[] = actuals
    .filter((a) => a.month === month)
    .map((a) => ({
      account: EXPENSE_ACCOUNT[a.team],
      team: a.team,
      debit: roundCents(a.actualUsd),
      credit: 0,
      memo: `AI usage invoiced — ${TEAM_INFO[a.team].label} — ${label}`,
      evidence: [`actuals:${a.team}:${month}`],
    }));
  if (debitLines.length === 0) throw new Error(`No actuals for ${month}`);
  return assertBalanced({
    id: `JE-${month}-ACTUAL`,
    month,
    date: firstDayOfNextMonth(month),
    kind: 'actual',
    status: 'approved',
    lines: withCreditLine(debitLines, ACCOUNTS_PAYABLE, `AI usage invoices — ${label}`, `Sum of ${debitLines.length} team actuals`),
    ...(approvedBy !== undefined ? { approvedBy } : {}),
  });
}
