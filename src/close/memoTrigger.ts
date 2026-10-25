// OWNER: C
import { DEMO, TEAM_INFO, monthLabel } from '../shared/config';
import { formatPct, formatUsd } from '../shared/format';
import type { JournalEntry, Memo, MemoInput, TeamContext, Variance } from '../shared/types';

export function buildMemoInputs(variances: Variance[], accrual: JournalEntry, contexts: TeamContext[]): MemoInput[] {
  return variances
    .filter((v) => v.needsMemo)
    .map((v) => {
      const line = accrual.lines.find((l) => l.team === v.team);
      const ctx = contexts.find((c) => c.team === v.team && c.month === v.month);
      const input: MemoInput = {
        team: v.team,
        month: v.month,
        estimate: v.estimate,
        actual: v.actual,
        variancePct: v.variancePct,
        basis: line ? line.evidence.join('; ') : 'No accrual line for this team',
        approvedBy: accrual.approvedBy ?? DEMO.controller,
        sources: [
          accrual.id,
          `JE-${v.month}-ACTUAL`,
          `actuals:${v.team}:${v.month}`,
          ...(ctx?.replied ? [`slack:${v.team}:${v.month}${ctx.repliedAt ? `@${ctx.repliedAt}` : ''}`] : []),
        ],
      };
      if (ctx?.quote) input.quote = ctx.quote;
      return input;
    });
}

export function placeholderMemo(i: MemoInput): Memo {
  const lead = TEAM_INFO[i.team].leadName;
  const diff = i.estimate - i.actual; // for the text only; same sign as variancePct
  const direction = diff > 0 ? 'over-accrued' : diff < 0 ? 'under-accrued' : 'on target';
  const repliedAt = i.sources.find((s) => s.startsWith('slack:'))?.split('@')[1];
  const said = i.quote
    ? `${lead} said${repliedAt ? ` (replied ${repliedAt})` : ''}: "${i.quote}".`
    : `${lead} did not reply to the month-end check-in.`;
  return {
    ...i,
    text:
      `${TEAM_INFO[i.team].label} AI usage for ${monthLabel(i.month)} was ${formatUsd(i.actual)} ` +
      `against an accrual of ${formatUsd(i.estimate)}: ${direction} by ${formatUsd(Math.abs(diff))} ` +
      `(${formatPct(i.variancePct)} of actual). The accrual basis was: ${i.basis}. ${said} ` +
      `Accrual approved by ${i.approvedBy}. ` +
      `[Placeholder: LLM draft unavailable; controller to complete.]`,
    createdAt: new Date().toISOString(),
  };
}

// Never throws: any draft failure falls back to the deterministic placeholder.
export async function draftMemos(inputs: MemoInput[], draft: (i: MemoInput) => Promise<Memo>): Promise<Memo[]> {
  return Promise.all(
    inputs.map(async (i) => {
      try {
        const memo = await draft(i);
        // C enforces the numbers: every MemoInput field comes from the input, only the prose from the drafter.
        if (typeof memo?.text !== 'string' || memo.text.trim() === '') return placeholderMemo(i);
        return { ...i, text: memo.text, createdAt: memo.createdAt ?? new Date().toISOString() };
      } catch (err) {
        console.warn(`draftMemo failed for ${i.team}, using placeholder:`, err instanceof Error ? err.message : String(err));
        return placeholderMemo(i);
      }
    }),
  );
}
