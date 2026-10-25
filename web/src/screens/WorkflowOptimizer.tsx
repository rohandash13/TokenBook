// OWNER: C — passive cheaper-model suggestions on the Budgets page: for each team's high, medium and low workloads,
// a few substitute models (live prices from Apify) that meet the workload's minimum tier, and what they'd save.
// Teams near or over budget get the cheapest substitutes; teams within budget only see work that's over-powered.
import type { Status, TeamBudgetCheck } from '../../../src/shared/api';
import { TEAM_INFO } from '../../../src/shared/config';
import type { SlicePlanView, WorkflowPlanView } from '../api';

type Tier = SlicePlanView['minTier'];
const TIER_LABEL: Record<Tier, string> = { light: 'Lightweight', mid: 'Mid', frontier: 'Frontier' };
const LEVEL_LABEL: Record<SlicePlanView['level'], string> = { high: 'High', medium: 'Medium', low: 'Low' };
const STATUS_LABEL: Record<Status, string> = { ok: 'Within budget', warn: 'Near limit', over: 'Over budget' };
const STATUS_CLASS: Record<Status, string> = { ok: 'approved', warn: 'low', over: 'danger' };
const RANK: Record<Status, number> = { over: 0, warn: 1, ok: 2 };
const whole = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

function Workload({ s }: { s: SlicePlanView }) {
  const best = s.options[0];
  return (
    <div className="wl-row">
      <span className={`lvl lvl-${s.level}`}>{LEVEL_LABEL[s.level]}</span>
      <span className="muted wl-needs">needs {TIER_LABEL[s.minTier].toLowerCase()}</span>
      <span className="wl-models">
        {s.options.length
          ? s.options.map((o) => <a key={`${o.provider}:${o.model}`} className="wl-chip" href={o.url} target="_blank" rel="noreferrer">{o.model}</a>)
          : <span className="muted">No change suggested</span>}
      </span>
      <span className="wl-save">{best ? `−${whole(best.monthlySavingsUsd)}` : ''}</span>
    </div>
  );
}

export function WorkflowOptimizer({ plans, budgets, error }: { plans: WorkflowPlanView[]; budgets: TeamBudgetCheck[]; error: string | null }) {
  const statusOf = (team: WorkflowPlanView['team']) => budgets.find((b) => b.team === team);
  const ordered = [...plans].sort((a, b) =>
    RANK[statusOf(a.team)?.status ?? 'ok'] - RANK[statusOf(b.team)?.status ?? 'ok'] || b.monthlySavingsUsd - a.monthlySavingsUsd);

  return (
    <section className="panel mi-section">
      <div className="mi-section-head">
        <h2>Cheaper model options <span className="badge src web">Apify</span></h2>
        <p className="muted">Substitutes that meet each workload's minimum tier, at live prices. Teams closer to budget see cheaper options.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="acc cards">
        {ordered.map((p) => {
          const b = statusOf(p.team);
          return (
            <details key={p.team} open={b?.status === 'over' || b?.status === 'warn'} className={`card-${b?.status ?? 'ok'}`}>
              <summary>
                <span className="acc-title">{TEAM_INFO[p.team].label}</span>
                {b && <span className={`badge ${STATUS_CLASS[b.status]}`}>{STATUS_LABEL[b.status]}</span>}
                <span className="acc-right">
                  {p.monthlySavingsUsd > 0 ? <span className="save-pill">up to {whole(p.monthlySavingsUsd)}/mo</span> : <span className="muted">No change suggested</span>}
                </span>
              </summary>
              <div className="acc-body">{p.slices.map((s) => <Workload key={s.level} s={s} />)}</div>
            </details>
          );
        })}
      </div>
      <p className="muted mi-foot">Suggestions only; test quality before switching. Workload mix is an assumption for the demo company.</p>
    </section>
  );
}
