// OWNER: C — workflow optimizer for the Budgets page: for each team, its main AI task priced on its current
// model and on cheaper models (live prices from Apify) that can still do the work, with the quality trade-off.
// Teams over or near budget come first, open, and show whether the best switch covers the overage.
import type { Status, TeamBudgetCheck } from '../../../src/shared/api';
import { TEAM_INFO } from '../../../src/shared/config';
import type { WorkflowPlanView } from '../api';

type Tier = WorkflowPlanView['currentTier'];
const TIER_LABEL: Record<Tier, string> = { light: 'Lightweight', mid: 'Mid', frontier: 'Frontier' };
const STATUS_LABEL: Record<Status, string> = { ok: 'Within budget', warn: 'Near limit', over: 'Over budget' };
const STATUS_CLASS: Record<Status, string> = { ok: 'approved', warn: 'low', over: 'danger' };
const RANK: Record<Status, number> = { over: 0, warn: 1, ok: 2 };
const money = (n: number) => `$${n < 1 ? n.toFixed(n < 0.1 ? 3 : 2) : n.toFixed(2)}`;
const whole = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`tier tier-${tier}`}>{TIER_LABEL[tier]}</span>;
}

export function WorkflowOptimizer({ plans, budgets, error }: { plans: WorkflowPlanView[]; budgets: TeamBudgetCheck[]; error: string | null }) {
  const statusOf = (team: WorkflowPlanView['team']) => budgets.find((b) => b.team === team);
  const ordered = [...plans].sort((a, b) =>
    RANK[statusOf(a.team)?.status ?? 'ok'] - RANK[statusOf(b.team)?.status ?? 'ok']
    || (b.options[0]?.monthlySavingsUsd ?? 0) - (a.options[0]?.monthlySavingsUsd ?? 0));
  const total = plans.reduce((s, p) => s + (p.options[0]?.monthlySavingsUsd ?? 0), 0);
  const firstOpen = ordered[0]?.team;

  return (
    <section className="panel mi-section">
      <div className="mi-section-head">
        <h2>
          Optimize spend <span className="badge src web">Apify</span>
          {total > 0 && <span className="save-pill">up to {whole(total)}/mo</span>}
        </h2>
        <p className="muted">
          Each team's main AI task, priced on its current model and on cheaper models from the live model market that can still do the work.
          Teams over or near budget come first. Suggestions only: test quality on a sample before switching.
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="acc cards">
        {ordered.map((p) => {
          const best = p.options[0];
          const b = statusOf(p.team);
          const overage = b && b.headroomUsd < 0 ? -b.headroomUsd : 0;
          const open = b?.status === 'over' || b?.status === 'warn' || p.team === firstOpen;
          return (
            <details key={p.team} open={open} className={`card-${b?.status ?? 'ok'}`}>
              <summary>
                <span className="acc-title">{TEAM_INFO[p.team].label}</span>
                {b && <span className={`badge ${STATUS_CLASS[b.status]}`}>{STATUS_LABEL[b.status]}</span>}
                <span className="muted acc-task">{p.task}</span>
                <span className="muted">on <strong>{p.currentModel}</strong> · {whole(p.taskSpendUsd)}/mo</span>
                <span className="acc-right">
                  {best ? <span className="save-pill">save {whole(best.monthlySavingsUsd)}/mo</span> : <span className="muted">Already optimal</span>}
                </span>
              </summary>
              <div className="acc-body">
                {overage > 0 && best && (
                  <p className={best.monthlySavingsUsd >= overage ? 'opt-cover ok' : 'opt-cover'}>
                    {TEAM_INFO[p.team].label} is projected {whole(overage)} over its budget.{' '}
                    {best.monthlySavingsUsd >= overage
                      ? `Moving ${p.task} to ${best.model} would bring it back under budget.`
                      : `Moving ${p.task} to ${best.model} covers ${Math.round((best.monthlySavingsUsd / overage) * 100)}% of the overage.`}
                  </p>
                )}
                {p.options.length === 0 && <p className="muted">Already on the cheapest model that suits this work (needs at least {TIER_LABEL[p.minTier].toLowerCase()}).</p>}
                {p.options.map((o, i) => (
                  <div key={o.model} className="opt-row">
                    <div className="opt-main">
                      <div>
                        {i === 0 && <span className="tag tag-best">Best saving</span>}
                        {o.openWeight && <span className="tag">open-weight</span>}
                        <a href={o.url} target="_blank" rel="noreferrer"><strong>{o.model}</strong></a>
                        <span className="muted"> · {o.provider} · {money(o.blendedPerMTok)}/MTok</span> <TierBadge tier={o.tier} />
                      </div>
                      <p className="opt-trade">{o.tradeoff}</p>
                      {o.bestFor && <p className="muted opt-quote">{o.provider} says: “{o.bestFor}”</p>}
                      {o.priceChange && <p className="opt-warn">Price rises from {shortDate(o.priceChange.effectiveDate)}: the saving drops to {whole(o.priceChange.savingsAfterUsd)}/month.</p>}
                    </div>
                    <div className="opt-save">
                      <span className="opt-save-v">−{whole(o.monthlySavingsUsd)}</span>
                      <span className="muted">{Math.round(o.savingsPct * 100)}% of this task</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <p className="muted mi-foot">
        Each team's main task and its share of spend are assumptions for the demo company. Savings = this month's projected spend on the task × (1 − new price ÷ current price), at live prices.
      </p>
    </section>
  );
}
