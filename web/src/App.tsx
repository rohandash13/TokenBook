// OWNER: C (app shell by Junghwan)
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEMO, monthLabel, TEAM_INFO } from '../../src/shared/config';
import { formatUsd } from '../../src/shared/format';
import { api } from './api';
import { IconArrowUp, IconChat, IconPlug, IconCheck, IconClock, IconLedger, IconOverview, IconReset, IconScale, IconTrend, Logo } from './icons';
import { AccrualReview } from './screens/AccrualReview';
import { History } from './screens/History';
import { Budgets } from './screens/Budgets';
import { Integrations } from './screens/Integrations';
import { Jira } from './screens/Jira';
import { LeadSheet } from './screens/LeadSheet';
import { Signals } from './screens/Signals';
import { VarianceMemo } from './screens/VarianceMemo';
import { clearSignOffs } from './SignOff';
import type { CloseSnapshot, Mark, StepKey } from './useCloseStatus';
import { stepsFor, useCloseStatus } from './useCloseStatus';

type View = 'lead' | StepKey | 'history' | 'budgets' | 'integrations' | 'jira';
const VIEWS: View[] = ['lead', 'checkins', 'accrual', 'variance', 'history', 'budgets', 'integrations', 'jira'];

type NavItem = { key: View; label: string; icon: ReactNode; step?: StepKey };
const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ key: 'lead', label: 'Overview', icon: <IconOverview /> }] },
  { section: 'Close', items: [
    { key: 'checkins', label: 'Signals', icon: <IconChat />, step: 'checkins' },
    { key: 'accrual', label: 'Accrual', icon: <IconLedger />, step: 'accrual' },
    { key: 'variance', label: 'Variances', icon: <IconScale />, step: 'variance' },
  ] },
  { section: 'Insights', items: [
    { key: 'history', label: 'Accuracy', icon: <IconClock /> },
    { key: 'budgets', label: 'Budgets', icon: <IconScale /> },
  ] },
  { section: 'Integrations', items: [
    { key: 'integrations', label: 'Market', icon: <IconTrend /> },
    { key: 'jira', label: 'Jira', icon: <IconPlug /> },
  ] },
];
const TITLES: Record<View, string> = {
  lead: 'Overview', checkins: 'Signals', accrual: 'Accrual', variance: 'Variances', history: 'Accuracy', budgets: 'Budgets', integrations: 'Market', jira: 'Jira',
};

function viewFromHash(): View {
  const h = location.hash.slice(1) as View;
  return VIEWS.includes(h) ? h : 'lead';
}

const CONF = { high: 'High', medium: 'Medium', low: 'Low' } as const;

type Toast = { id: number; text: string; sub?: string; big?: boolean; down?: boolean };

/** Watches the close and announces what just happened. */
function useCloseToasts(snap: CloseSnapshot | null) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prev = useRef<CloseSnapshot | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = snap;
    if (!p || !snap) return;
    type Say = { text: string; sub?: string; big?: boolean; down?: boolean };
    const say: Say[] = [];
    const push = (text: string) => say.push({ text });

    // The money moment: a team's month-end estimate moved.
    for (const e of snap.estimates.filter((x) => x.method === 'trueup')) {
      const before = p.estimates.find((x) => x.method === 'trueup' && x.team === e.team);
      if (!before) continue;
      const ctx = snap.contexts.find((c) => c.team === e.team);
      const why = ctx?.replied ? `From ${ctx.leadName ?? 'the lead'}'s reply` : ctx?.inferred ? 'From Slack and GitHub signals' : 'Recalculated';
      const label = TEAM_INFO[e.team].label;
      if (Math.abs(e.estimate - before.estimate) >= 1) {
        say.push({ text: `${label} ${formatUsd(before.estimate)} → ${formatUsd(e.estimate)}`, sub: why, big: true, down: e.estimate < before.estimate });
      } else if (e.confidence !== before.confidence) {
        // Same number, firmer footing: a lead confirmed what the signals suggested.
        say.push({ text: `${label} confirmed, ${CONF[before.confidence]} → ${CONF[e.confidence]} confidence`, sub: `${formatUsd(e.estimate)}, ${why.charAt(0).toLowerCase()}${why.slice(1)}`, big: true });
      }
    }
    if (!p.entry && snap.entry) push('Accrual entry prepared');
    if (p.entry?.status === 'prepared' && snap.entry?.status === 'approved') push(`Approved by ${snap.entry.approvedBy ?? DEMO.controller}`);
    if (p.entry?.status !== 'exported' && snap.entry?.status === 'exported') push('Exported to ERP');
    if (p.variances.length === 0 && snap.variances.length > 0) push('Actual bill loaded');
    for (const m of snap.memos) {
      const before = p.memos.find((x) => x.team === m.team);
      if (!before) push(`${TEAM_INFO[m.team].label} memo drafted`);
      else if (!before.attached && m.attached) push('Memo attached');
    }
    for (const c of snap.contexts) {
      const before = p.contexts.find((x) => x.team === c.team);
      if (c.replied && !before?.replied) push(`${c.leadName ?? 'Lead'} replied in Slack`);
    }
    if (!say.length) return;
    const add = say.map((x, i) => ({ id: Date.now() + i, ...x }));
    setToasts((t) => [...t, ...add]);
    add.forEach((a) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), a.big ? 6000 : 3800));
  }, [snap]);
  return toasts;
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const { data: snap, error } = useCloseStatus();
  const steps = snap ? stepsFor(snap) : [];
  const toasts = useCloseToasts(snap);
  const markOf = (k?: StepKey): Mark | null => (k ? steps.find((s) => s.key === k)?.mark ?? null : null);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function go(v: View) {
    location.hash = v === 'lead' ? '' : v;
    setView(v);
    window.scrollTo({ top: 0 });
  }

  async function reset() {
    setResetErr(null);
    if (!confirm('Reset the demo?')) return;
    try {
      await api.reset();
      clearSignOffs();
      location.hash = '';
      location.reload();
    } catch (e) {
      setResetErr((e as Error).message);
    }
  }

  const done = steps.filter((s) => s.mark === 'done').length;

  return (
    <div className="app">
      <aside className="sidebar">
        <button className="logo" onClick={() => go('lead')}>
          <Logo /> <span>TokenBook</span>
        </button>

        <div className="org">
          <span className="org-name">{DEMO.company}</span>
        </div>

        <nav aria-label="Main">
          {NAV.map((group, gi) => (
            <div key={group.section ?? gi} className="nav-group">
              {group.section && <span className="nav-section">{group.section}</span>}
              {group.items.map((n) => {
                const mark = markOf(n.step);
                return (
                  <button key={n.key} className={`nav-item ${view === n.key ? 'active' : ''}`} onClick={() => go(n.key)}>
                    {n.icon}
                    <span>{n.label}</span>
                    {mark === 'done' && <span className="nav-done" aria-label="done"><IconCheck /></span>}
                    {mark === 'attention' && <span className="nav-dot" aria-label="needs attention" />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="progress-card">
          <div className="progress-head"><span>Close progress</span><span>{done}/3</span></div>
          <div className="progress-bar"><span style={{ width: `${(done / 3) * 100}%` }} /></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="crumbs">
            <span className="period-pill">{monthLabel(DEMO.month)}</span>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{TITLES[view]}</span>
          </div>
          <div className="topbar-right">
            {(error || resetErr) && <span className="error">{error ? 'Server offline' : resetErr}</span>}
            <button className="icon-btn" title="Reset demo" aria-label="Reset demo" onClick={reset}><IconReset /></button>
            <div className="user">
              <span className="avatar">{DEMO.controller[0]}</span>
              <span className="user-meta"><b>{DEMO.controller}</b><small>Controller</small></span>
            </div>
          </div>
        </header>

        <main key={view} className="page">
          {view === 'lead' && <LeadSheet snap={snap} steps={steps} go={go} />}
          {view === 'checkins' && <Signals />}
          {view === 'accrual' && <AccrualReview />}
          {view === 'variance' && <VarianceMemo />}
          {view === 'history' && <History />}
          {view === 'budgets' && <Budgets />}
          {view === 'integrations' && <Integrations />}
          {view === 'jira' && <Jira />}
        </main>
      </div>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.big ? 'toast-big' : ''} ${t.down ? 'toast-down' : ''}`}>
            <span className="toast-icon">{t.big ? <IconArrowUp /> : <IconCheck />}</span>
            <span className="toast-body"><span>{t.text}</span>{t.sub && <small>{t.sub}</small>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
