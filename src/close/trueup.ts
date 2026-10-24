// OWNER: C
import type { Actual, JournalEntry, MemoInput, TeamContext, Variance } from '../shared/types';
import { buildActual, buildReversal } from './journal';
import { buildMemoInputs } from './memoTrigger';
import { computeVariances } from './variance';

export type CloseActualsResult = {
  reversal: JournalEntry;
  actual: JournalEntry;
  variances: Variance[];
  memoInputs: MemoInput[];
};

// Pure orchestration of the true-up so the route stays thin.
export function closeActuals(accrual: JournalEntry, actuals: Actual[], contexts: TeamContext[]): CloseActualsResult {
  const reversal = buildReversal(accrual);
  const actual = buildActual(accrual.month, actuals, accrual.approvedBy);
  const variances = computeVariances(accrual, actuals);
  return { reversal, actual, variances, memoInputs: buildMemoInputs(variances, accrual, contexts) };
}
