// OWNER: C — budgets and spend policies: per-team monthly budgets and company-wide per-model caps,
// checked against TrueUp's projection for the month. Deterministic; the LLM is not involved.
import { TEAMS } from '../shared/config';
import type { BudgetReport, ModelCapCheck, Policies, Status, TeamBudgetCheck } from '../shared/api';
import type { Estimate, Month, UsageDay } from '../shared/types';

const round2 = (x: number) => Math.round(x * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function statusOf(projected: number, limit: number, warnAt: number): Status {
  if (limit <= 0) return 'ok';
  if (projected > limit) return 'over';
  return projected >= warnAt * limit ? 'warn' : 'ok';
}

/**
 * Teams: the trueup estimate against the team's budget.
 * Models: month-to-date cost on the model plus each team's remaining projection, split by that team's
 * share of the last 7 days' cost on the model.
 */
export function checkBudgets(policies: Policies, estimates: Estimate[], usage: UsageDay[], month: Month, asOf: string): BudgetReport {
  const trueup = (team: string) => estimates.find((e) => e.team === team && e.method === 'trueup');
  const teams: TeamBudgetCheck[] = TEAMS.flatMap((team) => {
    const budget = policies.teamBudgets[team];
    const est = trueup(team);
    if (budget === undefined || !est) return [];
    return [{
      team, budgetUsd: budget, projectedUsd: round2(est.estimate), actualToDateUsd: round2(est.actualToDate),
      pctOfBudget: round2(est.estimate / budget), headroomUsd: round2(budget - est.estimate),
      status: statusOf(est.estimate, budget, policies.warnAt),
    }];
  });

  const inMonth = usage.filter((u) => u.date.startsWith(month) && u.date <= asOf);
  const recentFrom = addDays(asOf, -6);
  const models: ModelCapCheck[] = policies.modelCaps.map(({ model, capUsd }) => {
    const toDate = sum(inMonth.filter((u) => u.model === model).map((u) => u.costUsd));
    const remaining = sum(TEAMS.map((team) => {
      const est = trueup(team);
      if (!est) return 0;
      const recent = inMonth.filter((u) => u.team === team && u.date >= recentFrom);
      const total = sum(recent.map((u) => u.costUsd));
      const onModel = sum(recent.filter((u) => u.model === model).map((u) => u.costUsd));
      return total > 0 ? Math.max(0, est.estimate - est.actualToDate) * (onModel / total) : 0;
    }));
    const projected = toDate + remaining;
    return {
      model, capUsd, actualToDateUsd: round2(toDate), projectedUsd: round2(projected),
      pctOfCap: round2(projected / capUsd), status: statusOf(projected, capUsd, policies.warnAt),
    };
  });

  const alerts = [
    ...teams.filter((t) => t.status !== 'ok').map((t) => t.status === 'over'
      ? `${t.team} is projected at $${Math.round(t.projectedUsd).toLocaleString('en-US')}, $${Math.round(-t.headroomUsd).toLocaleString('en-US')} over its $${t.budgetUsd.toLocaleString('en-US')} budget`
      : `${t.team} is at ${Math.round(t.pctOfBudget * 100)}% of its $${t.budgetUsd.toLocaleString('en-US')} budget`),
    ...models.filter((m) => m.status !== 'ok').map((m) => m.status === 'over'
      ? `${m.model} is projected at $${Math.round(m.projectedUsd).toLocaleString('en-US')} against a $${m.capUsd.toLocaleString('en-US')} company cap`
      : `${m.model} is at ${Math.round(m.pctOfCap * 100)}% of its $${m.capUsd.toLocaleString('en-US')} cap`),
  ];
  return { month, asOf, warnAt: policies.warnAt, teams, models, alerts };
}
