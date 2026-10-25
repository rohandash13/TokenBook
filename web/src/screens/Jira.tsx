// OWNER: C — the Jira issues the TokenBook Forge app sent in, and the driver each one adds to its team's estimate.
import { TEAM_INFO } from '../../../src/shared/config';
import { api } from '../api';
import { usePoll } from '../usePoll';

const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function Jira() {
  const jira = usePoll(() => api.jiraIssues(), 3000);
  const issues = jira.data ?? [];
  const drivers = issues.filter((v) => v.event);
  const slipped = issues.filter((v) => v.issue.dueDateHistory.length > 0);
  const teams = new Set(issues.map((v) => v.team).filter(Boolean));

  return (
    <div className="mi">
      <header className="mi-head">
        <div>
          <h1>Jira</h1>
          <p className="muted">
            The <strong>TokenBook Forge app</strong> runs inside Jira. When an issue labelled with a team (<code>team-search</code>) and a kind
            (<code>launch</code>, <code>campaign</code>, <code>load-test</code>) is created or changed, it sends the issue here, TokenBook adds it to that
            team's estimate, and the app comments the change back on the ticket. Refreshes every 3 seconds.
          </p>
        </div>
      </header>

      <div className="mi-stats">
        <div className="mi-stat"><span className="mi-stat-k">Issues received</span><span className="mi-stat-v">{issues.length}</span><span className="muted">{teams.size} teams</span></div>
        <div className="mi-stat"><span className="mi-stat-k">Spend drivers</span><span className="mi-stat-v">{drivers.length}</span><span className="muted">issues that change an estimate</span></div>
        <div className="mi-stat"><span className="mi-stat-k">Due dates moved</span><span className={`mi-stat-v ${slipped.length ? 'warn' : ''}`}>{slipped.length}</span><span className="muted">cited in variance memos</span></div>
      </div>

      <section className="panel mi-section">
        <div className="mi-section-head">
          <h2>Issues <span className="badge src jira">Atlassian</span></h2>
          <p className="muted">Newest first. A due date that moved out of the month after the accrual explains the variance at close.</p>
        </div>
        {jira.error && <p className="error">{jira.error}</p>}
        <div className="mi-scroll">
          <table className="mi-table">
            <thead><tr><th>Issue</th><th>Team</th><th>Due</th><th>Driver for the estimate</th></tr></thead>
            <tbody>
              {[...issues].sort((a, b) => b.issue.updatedAt.localeCompare(a.issue.updatedAt)).map(({ issue, team, event }) => {
                const slip = issue.dueDateHistory.at(-1);
                return (
                  <tr key={issue.key}>
                    <td>
                      <a href={issue.url} target="_blank" rel="noreferrer"><strong>{issue.key}</strong></a> {issue.summary}
                      <div className="muted">{issue.labels.join(', ') || 'no labels'}</div>
                    </td>
                    <td>{team ? TEAM_INFO[team].label : <span className="muted">no team label</span>}</td>
                    <td>
                      {issue.dueDate ? shortDate(issue.dueDate) : '—'}
                      {slip && <div className="opt-warn">moved {slip.from ?? '—'} → {slip.to ?? '—'} on {slip.at.slice(0, 10)}</div>}
                    </td>
                    <td>{event ? <><strong>{event.multiplier}×</strong> from {shortDate(event.date)}</> : <span className="muted">none</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {issues.length === 0 && <p className="muted">No Jira issues yet. Create one in the SPEND project with a team-* label.</p>}
      </section>
    </div>
  );
}
