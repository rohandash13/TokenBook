// OWNER: C (close checklist built by Junghwan)
// Derives where the month-end close stands from the same REST endpoints the screens use.
import type { StoredMemo } from '../../src/shared/api';
import { DEMO, TEAM_INFO, TEAMS } from '../../src/shared/config';
import type { Estimate, JournalEntry, TeamContext, Variance } from '../../src/shared/types';
import { api } from './api';
import { usePoll } from './usePoll';

export type Mark = 'done' | 'todo' | 'attention';
export type Heard = 'lead' | 'signals' | 'none';
export type StepKey = 'checkins' | 'accrual' | 'variance';
export type Step = { key: StepKey; title: string; mark: Mark; detail: string; action: string };

export type CloseSnapshot = {
  contexts: TeamContext[];
  estimates: Estimate[];
  entry: JournalEntry | null;
  variances: Variance[];
  memos: StoredMemo[];
};

export function heardFrom(ctx: TeamContext | undefined): Heard {
  if (ctx?.replied) return 'lead';
  if (ctx?.inferred && ctx.events.length > 0) return 'signals';
  return 'none';
}

export function stepsFor(s: CloseSnapshot): Step[] {
  const silent = TEAMS.filter((t) => heardFrom(s.contexts.find((c) => c.team === t)) === 'none');
  const heard = TEAMS.length - silent.length;
  const memosOpen = s.memos.filter((m) => !m.attached).length;
  const approved = s.entry?.status === 'approved' || s.entry?.status === 'exported';

  return [
    {
      key: 'checkins',
      title: 'Hear from team leads',
      mark: silent.length === 0 ? 'done' : 'attention',
      detail: silent.length === 0 ? 'All four teams accounted for' : `${heard} of ${TEAMS.length} heard from`,
      action: silent.length === 0 ? 'See what leads said' : `Check in with ${silent.map((t) => TEAM_INFO[t].label).join(', ')}`,
    },
    {
      key: 'accrual',
      title: 'Review and approve the accrual',
      mark: approved ? 'done' : s.entry ? 'attention' : 'todo',
      detail: approved
        ? `Approved by ${s.entry?.approvedBy ?? DEMO.controller}${s.entry?.status === 'exported' ? ', exported' : ''}`
        : s.entry ? 'Prepared, waiting for approval' : 'Not prepared yet',
      action: approved ? 'Open the journal entry' : 'Review estimates and approve',
    },
    {
      key: 'variance',
      title: 'Load the bill and explain variances',
      mark: s.variances.length === 0 ? 'todo' : memosOpen > 0 ? 'attention' : 'done',
      detail: s.variances.length === 0 ? 'Actual bill not loaded'
        : memosOpen > 0 ? `${memosOpen} memo${memosOpen > 1 ? 's' : ''} to attach` : 'Variances explained',
      action: s.variances.length === 0 ? 'Load the actual bill' : memosOpen > 0 ? 'Review the audit memo' : 'See variances',
    },
  ];
}

export function useCloseStatus() {
  const month = DEMO.month;
  return usePoll<CloseSnapshot>(async () => {
    const [contexts, estimates, journal, variances, memos] = await Promise.all([
      api.contexts(month),
      api.estimates(month),
      api.journal(month),
      api.variances(month),
      api.memos(month),
    ]);
    const entry = [...journal].reverse().find((j) => j.kind === 'accrual') ?? null;
    return { contexts, estimates, entry, variances, memos };
  }, 3000);
}
