// OWNER: C
import { useEffect, useState } from 'react';
import type { StoredMemo } from '../../../src/shared/api';
import { DEMO, TEAM_INFO } from '../../../src/shared/config';
import { formatPct, formatUsd } from '../../../src/shared/format';
import type { JournalEntry, Variance } from '../../../src/shared/types';
import { parseCiteLine } from '../../../src/close/memoSignals';
import { api } from '../api';
import { SignOff } from '../SignOff';
import { shortDate, shortDateTime, titleCase } from '../Evidence';

const ENTRY_LABEL = { accrual: 'Accrual', reversal: 'Reversal', actual: 'Actual bill' } as const;
// Source tags like "actuals:growth:2026-10" stay in the memo for the audit trail; the card lists entry ids.
const isTag = (x: string) => !/\s/.test(x) && x.includes(':');

const monthName = new Date(`${DEMO.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

export function VarianceMemo() {
  const month = DEMO.month;
  const [variances, setVariances] = useState<Variance[]>([]);
  const [memos, setMemos] = useState<StoredMemo[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [v, m, j] = await Promise.all([api.variances(month), api.memos(month), api.journal(month)]);
    setVariances(v); setMemos(m); setEntries(j);
  }
  useEffect(() => { refresh().catch((e) => setMsg((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadActuals() {
    setBusy(true);
    try { await api.loadActuals(month); await refresh(); setMsg(null); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  const posted = entries.filter((e) => e.kind !== 'accrual');
  const replaceMemo = (m: StoredMemo) => setMemos((ms) => ms.map((x) => (x.team === m.team ? m : x)));

  return (
    <>
      <section className="panel">
        <h2>{monthName} actuals and true-up</h2>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="primary" disabled={busy} onClick={loadActuals}>
            {posted.length ? 'Reload actuals' : `Load ${monthName} actuals`}
          </button>
          {posted.length > 0 && (
            <span className="muted">
              Posted {shortDate(posted[0].date)}:{' '}
              {posted.map((e, i) => (
                <span key={e.id} title={`${e.id} · ${titleCase(e.status)}`}>
                  {i > 0 && ' · '}{ENTRY_LABEL[e.kind]} (<a href={api.exportUrl(e.id)} onClick={() => setTimeout(() => void refresh().catch(() => {}), 800)}>CSV</a>)
                </span>
              ))}
            </span>
          )}
        </div>
        {variances.length === 0 && !msg && <p className="muted" style={{ marginTop: 12 }}>Load the {monthName} bill to compare it with the accrual.</p>}
        {msg && <p className="error">{msg}</p>}
      </section>

      <div className="split">
        <div>
          {variances.length > 0 && (
            <section className="panel">
              <h2>Variance by team</h2>
              <table>
                <thead>
                  <tr>
                    <th>Team</th><th className="num">Accrued</th><th className="num">Actual</th>
                    <th className="num" title="Accrued minus actual: positive means over-accrued">Over / (under)</th><th className="num">% of actual</th><th />
                  </tr>
                </thead>
                <tbody>
                  {variances.map((v) => (
                    <tr key={v.team} className={v.needsMemo ? 'danger' : ''}>
                      <td>{TEAM_INFO[v.team].label}</td>
                      <td className="num">{formatUsd(v.estimate, true)}</td>
                      <td className="num">{formatUsd(v.actual, true)}</td>
                      <td className="num">{formatUsd(v.varianceUsd, true)}</td>
                      <td className="num">{formatPct(v.variancePct)}</td>
                      <td>{v.needsMemo && <span className="badge danger" title="Required when a variance is over 10% and over $500">Memo required</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
        <div>
          {memos.map((m) => <MemoCard key={m.team} memo={m} onChange={replaceMemo} />)}
          {variances.length > 0 && memos.length === 0 && <p className="muted">No variance needs a memo.</p>}
        </div>
      </div>
    </>
  );
}

function MemoCard({ memo, onChange }: { memo: StoredMemo; onChange: (m: StoredMemo) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memo.text);
  const [err, setErr] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const long = memo.text.length > 600;

  async function run(fn: () => Promise<StoredMemo>) {
    try { const m = await fn(); setText(m.text); onChange(m); setEditing(false); setErr(null); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <section className="panel">
      <h2>
        {TEAM_INFO[memo.team].label} audit memo
        {memo.attached && <span className="badge attached">Attached</span>}
        {memo.editedAt && <span className="muted">Edited {shortDateTime(memo.editedAt)}</span>}
      </h2>
      {editing ? <textarea value={text} onChange={(e) => setText(e.target.value)} /> : (
        <>
          <p className={`memo-text ${long && !full ? 'clamped' : ''}`}>{memo.text}</p>
          {long && <button className="link-btn" onClick={() => setFull(!full)}>{full ? 'Show less' : 'Read full memo'}</button>}
        </>
      )}
      <MemoSources sources={memo.sources} jiraTaskKey={memo.jiraTaskKey} />
      <SignOff id={`memo:${memo.month}:${memo.team}`} preparedBy="Claude"
        preparedHow={`AI draft using only TokenBook's figures${memo.editedAt ? `; edited by ${DEMO.controller}` : ''}`}
        reviewer={DEMO.controller} reviewed={memo.attached} pendingText={`Draft, waiting for ${DEMO.controller} to attach`} />
      <div className="actions">
        {editing ? (
          <>
            <button className="primary" onClick={() => run(() => api.editMemo(memo.month, memo.team, text))}>Save</button>
            <button className="secondary" onClick={() => { setText(memo.text); setEditing(false); }}>Cancel</button>
          </>
        ) : (
          <>
            <button className="primary" disabled={memo.attached} onClick={() => run(() => api.attachMemo(memo.month, memo.team))}>
              {memo.attached ? 'Attached to records' : 'Attach to records'}
            </button>
            <button className="secondary" disabled={memo.attached} onClick={() => setEditing(true)}>Edit memo</button>
          </>
        )}
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  );
}

// Signals that contradicted the accrual stay visible; what it relied on, the entries and Jira sit under "Sources".
function MemoSources({ sources, jiraTaskKey }: { sources: string[]; jiraTaskKey?: string }) {
  const cited = sources.map((s) => ({ s, c: parseCiteLine(s) }));
  const against = cited.filter((x) => x.c?.kind === 'contradicts');
  const used = cited.filter((x) => x.c?.kind === 'evidence');
  const plain = cited.filter((x) => !x.c && !isTag(x.s)).map((x) => x.s);
  const list = (xs: typeof cited) => (
    <ul className="evidence">
      {xs.map(({ s, c }) => (
        <li key={s}><a href={c!.url} target="_blank" rel="noreferrer">{c!.label}</a> <span className="excerpt">“{c!.text}”</span></li>
      ))}
    </ul>
  );
  return (
    <>
      {against.length > 0 && (
        <div className="callout warn">
          <b>Team signals contradicted the booked driver before approval</b>
          {list(against)}
        </div>
      )}
      {(used.length > 0 || plain.length > 0 || jiraTaskKey) && (
        <details className="memo-sources">
          <summary>Sources</summary>
          {used.length > 0 && <div className="cited"><span className="muted">Signals the accrual relied on</span>{list(used)}</div>}
          {plain.length > 0 && <p className="muted">Entries: {plain.join(' · ')}</p>}
          {jiraTaskKey && <p className="muted">Jira follow-up task: {jiraTaskKey}</p>}
        </details>
      )}
    </>
  );
}
