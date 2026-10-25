// OWNER: C — model stack on the Budgets page: each team's real mix of models (last 7 days of usage) and a proposed
// stack where every model is swapped for the cheapest model of the same tier on the live market. The saving is on
// the spend still to come this month, so it lowers the month-end projection directly. Suggestions only.
import type { Status, StackLine, TeamStack } from '../../../src/shared/api';
import { TEAM_INFO } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import { shortDate } from '../Evidence';

const TIER_LABEL = { light: 'Lightweight', mid: 'Mid', frontier: 'Frontier' } as const;
type Tier = keyof typeof TIER_LABEL;
// The stack reads top-down, like the Market tiers: frontier, then mid, then lightweight.
const TIER_ORDER: Tier[] = ['frontier', 'mid', 'light'];

/** A team's lines grouped by tier, every tier present (empty when unused); unlisted models go last. */
function byTier(lines: StackLine[]): { tier: Tier | null; lines: StackLine[] }[] {
  const groups: { tier: Tier | null; lines: StackLine[] }[] = TIER_ORDER.map((tier) => ({ tier, lines: lines.filter((l) => l.current?.tier === tier) }));
  const unlisted = lines.filter((l) => !l.current);
  return unlisted.length ? [...groups, { tier: null, lines: unlisted }] : groups;
}

function UnusedTier({ tier }: { tier: Tier }) {
  return (
    <tr className="stack-unused">
      <td><span className={`tier tier-${tier}`}>{TIER_LABEL[tier]}</span></td>
      <td colSpan={6} className="muted">Not used</td>
    </tr>
  );
}
const STATUS_LABEL: Record<Status, string> = { ok: 'Within budget', warn: 'Near limit', over: 'Over budget' };
const STATUS_CLASS: Record<Status, string> = { ok: 'approved', warn: 'low', over: 'danger' };
const RANK: Record<Status, number> = { over: 0, warn: 1, ok: 2 };
const perMTok = (n: number) => `$${n.toFixed(2)}/MTok`;

function Line({ l }: { l: StackLine }) {
  return (
    <tr>
      <td>{l.current ? <span className={`tier tier-${l.current.tier}`}>{TIER_LABEL[l.current.tier]}</span> : <span className="muted">Unlisted</span>}</td>
      <td>
        {l.current ? <><b>{l.current.model}</b> <span className="muted">· {l.current.provider} · {perMTok(l.current.blendedPerMTok)}</span></> : <b>{l.usageModel}</b>}
      </td>
      <td className="num">{Math.round(l.share * 100)}%</td>
      <td>
        {l.proposed
          ? <><a href={l.proposed.url} target="_blank" rel="noreferrer"><b>{l.proposed.model}</b></a> <span className="muted">· {l.proposed.provider} · {perMTok(l.proposed.blendedPerMTok)}</span></>
          : <span className="muted">Keep: already the cheapest {l.current ? TIER_LABEL[l.current.tier].toLowerCase() : ''} model</span>}
        {l.stepDown && (
          <div className="step-down">
            or step down to Mid: <a href={l.stepDown.model.url} target="_blank" rel="noreferrer">{l.stepDown.model.model}</a>
            {' '}<span className="muted">· {l.stepDown.model.provider} · {perMTok(l.stepDown.model.blendedPerMTok)} · saves {formatUsd(l.stepDown.savingUsd)}</span>
          </div>
        )}
      </td>
      <td className="num">{formatUsd(l.remainingUsd)}</td>
      <td className="num">{formatUsd(l.remainingAfterUsd)}</td>
      <td className="num">{l.savingUsd > 0 ? <b className="ok">−{formatUsd(l.savingUsd)}</b> : ''}</td>
    </tr>
  );
}

export function ModelStack({ teams, error }: { teams: TeamStack[]; error: string | null }) {
  const ordered = [...teams].sort((a, b) => RANK[a.status ?? 'ok'] - RANK[b.status ?? 'ok'] || b.savingUsd - a.savingUsd);
  const window = teams[0] ? `${shortDate(teams[0].mixFrom)} to ${shortDate(teams[0].mixTo)}` : '';

  return (
    <section className="panel mi-section">
      <div className="mi-section-head">
        <h2>Model stack <span className="badge src web">Apify</span></h2>
        <p className="muted">Each team's models from real usage ({window}), and the cheapest model in the same tier at live prices. Savings apply to the rest of the month.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="acc cards">
        {ordered.map((t) => (
          <details key={t.team} open={t.status === 'over' || t.status === 'warn'} className={`card-${t.status ?? 'ok'}`}>
            <summary>
              <span className="acc-title">{TEAM_INFO[t.team].label}</span>
              {t.status && <span className={`badge ${STATUS_CLASS[t.status]}`}>{STATUS_LABEL[t.status]}</span>}
              <span className="acc-right">
                {t.savingUsd > 0 ? <span className="save-pill">Save {formatUsd(t.savingUsd)}</span> : <span className="muted">No cheaper stack</span>}
              </span>
            </summary>
            <div className="acc-body">
              <p className="stack-summary">
                Spent {formatUsd(t.spentUsd)} · {formatUsd(t.remainingUsd)} still to spend · projected <b>{formatUsd(t.projectedUsd)}</b>
                {t.savingUsd > 0 && <> → <b className="ok">{formatUsd(t.proposedProjectedUsd)}</b> on the proposed stack</>}
              </p>
              <table className="mi-table stack-table">
                <thead>
                  <tr>
                    <th>Tier</th><th>Current model</th><th className="num">Share</th><th>Proposed model</th>
                    <th className="num">Rest of month</th><th className="num">On proposed</th><th className="num">Saving</th>
                  </tr>
                </thead>
                <tbody>
                  {byTier(t.lines).flatMap((g) => g.lines.length
                    ? g.lines.map((l) => <Line key={l.usageModel} l={l} />)
                    : g.tier ? [<UnusedTier key={g.tier} tier={g.tier} />] : [])}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
      <p className="muted mi-foot">Suggestions only. Same-tier models are priced alike, not proven equal; test on a sample before switching. Savings totals use the same-tier swap; stepping down to Mid is an alternative.</p>
    </section>
  );
}
