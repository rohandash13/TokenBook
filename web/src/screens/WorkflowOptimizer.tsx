// OWNER: C — workflow optimizer for the Budgets page: each team's AI work split into high, medium and low workloads,
// each priced on the models serving it today and on cheaper models (live prices from Apify) that meet its minimum tier.
// How aggressive the suggestion is follows the team's budget: near or over, the cheapest model that meets the minimum;
// within budget, only over-powered work moves down. Teams over or near budget come first, open.
import type { Status, TeamBudgetCheck } from '../../../src/shared/api';
import { TEAM_INFO } from '../../../src/shared/config';
import type { SegmentView, SlicePlanView, WorkflowPlanView } from '../api';

type Tier = SlicePlanView['minTier'];
const TIER_LABEL: Record<Tier, string> = { light: 'Lightweight', mid: 'Mid', frontier: 'Frontier' };
const LEVEL_LABEL: Record<SlicePlanView['level'], string> = { high: 'High', medium: 'Medium', low: 'Low' };
const STATUS_LABEL: Record<Status, string> = { ok: 'Within budget', warn: 'Near limit', over: 'Over budget' };
const STATUS_CLASS: Record<Status, string> = { ok: 'approved', warn: 'low', over: 'danger' };
const STANCE_LABEL: Record<WorkflowPlanView['stance'], string> = { save: 'Saving mode', balanced: 'Balanced' };
const RANK: Record<Status, number> = { over: 0, warn: 1, ok: 2 };
const money = (n: number) => `$${n < 1 ? n.toFixed(n < 0.1 ? 3 : 2) : n.toFixed(2)}`;
const whole = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const today = (segs: SegmentView[]) => segs.map((g) => `${g.model} (${whole(g.spendUsd)})`).join(' + ');

function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`tier tier-${tier}`}>{TIER_LABEL[tier]}</span>;
}

function Workload({ s }: { s: SlicePlanView }) {
  const [best, ...alts] = s.options;
  return (
    <div className="wl-row">
      <div className="wl-work">
        <div><span className={`lvl lvl-${s.level}`}>{LEVEL_LABEL[s.level]}</span> <strong>{s.task}</strong></div>
        <span className="muted">{pct(s.share)} of spend · needs at least <TierBadge tier={s.minTier} /></span>
        <span className="muted">Today: {today(s.current)}</span>
      </div>
      <div className="wl-pick">
        {best ? (
          <>
            <div>
              <span className="muted">Move to </span>
              <a href={best.url} target="_blank" rel="noreferrer"><strong>{best.model}</strong></a>
              <span className="muted"> · {best.provider} · {money(best.blendedPerMTok)}/MTok</span> <TierBadge tier={best.tier} />
              {best.openWeight && <span className="tag">open-weight</span>}
            </div>
            <p className="opt-trade">{best.tradeoff}</p>
            {alts.length > 0 && (
              <p className="muted wl-alts">Also: {alts.map((o) => `${o.model}${o.openWeight ? ' (open-weight)' : ''} −${whole(o.monthlySavingsUsd)}`).join(' · ')}</p>
            )}
            {best.priceChange && <p className="opt-warn">Price rises from {shortDate(best.priceChange.effectiveDate)}: the saving drops to {whole(best.priceChange.savingsAfterUsd)}/month.</p>}
          </>
        ) : (
          <span className="muted">Keep as is: already on the right model for this work and the team's budget.</span>
        )}
        {s.underpowered.length > 0 && (
          <p className="opt-warn">{today(s.underpowered)} is below the {TIER_LABEL[s.minTier].toLowerCase()} minimum for this work: a quality risk, worth moving up.</p>
        )}
      </div>
      <div className="opt-save">
        {best
          ? <><span className="opt-save-v">−{whole(best.monthlySavingsUsd)}</span><span className="muted">{pct(best.savingsPct)} of what moves</span></>
          : <span className="muted">—</span>}
      </div>
    </div>
  );
}

export function WorkflowOptimizer({ plans, budgets, error }: { plans: WorkflowPlanView[]; budgets: TeamBudgetCheck[]; error: string | null }) {
  const statusOf = (team: WorkflowPlanView['team']) => budgets.find((b) => b.team === team);
  const ordered = [...plans].sort((a, b) =>
    RANK[statusOf(a.team)?.status ?? 'ok'] - RANK[statusOf(b.team)?.status ?? 'ok'] || b.monthlySavingsUsd - a.monthlySavingsUsd);
  const total = plans.reduce((s, p) => s + p.monthlySavingsUsd, 0);
  const firstOpen = ordered[0]?.team;

  return (
    <section className="panel mi-section">
      <div className="mi-section-head">
        <h2>
          Optimize spend <span className="badge src web">Apify</span>
          {total > 0 && <span className="save-pill">up to {whole(total)}/mo</span>}
        </h2>
        <p className="muted">
          Each team's work is split into high, medium and low workloads, each with the lightest model tier that can do it.
          Teams near or over budget get the cheapest model that meets each minimum; teams within budget only move work that runs on a stronger model than it needs.
          Suggestions only: test quality on a sample before switching.
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="acc cards">
        {ordered.map((p) => {
          const b = statusOf(p.team);
          const overage = b && b.headroomUsd < 0 ? -b.headroomUsd : 0;
          const open = b?.status === 'over' || b?.status === 'warn' || p.team === firstOpen;
          const routed = new Set(p.slices.flatMap((s) => s.current.map((g) => g.model))).size;
          return (
            <details key={p.team} open={open} className={`card-${b?.status ?? 'ok'}`}>
              <summary>
                <span className="acc-title">{TEAM_INFO[p.team].label}</span>
                {b && <span className={`badge ${STATUS_CLASS[b.status]}`}>{STATUS_LABEL[b.status]}</span>}
                <span className={`stance stance-${p.stance}`}>{STANCE_LABEL[p.stance]}</span>
                <span className="muted acc-task">{whole(p.spendUsd)}/mo across {routed} model{routed === 1 ? '' : 's'}</span>
                <span className="acc-right">
                  {p.monthlySavingsUsd > 0 ? <span className="save-pill">save {whole(p.monthlySavingsUsd)}/mo</span> : <span className="muted">Already optimal</span>}
                </span>
              </summary>
              <div className="acc-body">
                <p className="muted wl-stance">{p.stanceReason}</p>
                {overage > 0 && p.monthlySavingsUsd > 0 && (
                  <p className={p.monthlySavingsUsd >= overage ? 'opt-cover ok' : 'opt-cover'}>
                    {TEAM_INFO[p.team].label} is projected {whole(overage)} over its budget.{' '}
                    {p.monthlySavingsUsd >= overage
                      ? 'These switches would bring it back under budget.'
                      : `These switches cover ${Math.round((p.monthlySavingsUsd / overage) * 100)}% of the overage.`}
                  </p>
                )}
                {p.slices.map((s) => <Workload key={s.level} s={s} />)}
              </div>
            </details>
          );
        })}
      </div>
      <p className="muted mi-foot">
        Each team's workloads, their share of spend and the minimum tier for each are assumptions for the demo company; the hardest work is assumed to run on the team's strongest model today.
        Tiers come from price. Savings = this month's projected spend on that work × (1 − new price ÷ current price), at live prices.
      </p>
    </section>
  );
}
