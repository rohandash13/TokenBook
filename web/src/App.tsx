// OWNER: C
import { useState } from 'react';
import { DEMO, monthLabel } from '../../src/shared/config';
import { api } from './api';
import { AccrualReview } from './screens/AccrualReview';
import { History } from './screens/History';
import { Signals } from './screens/Signals';
import { VarianceMemo } from './screens/VarianceMemo';

const TABS = [
  { key: 'accrual', label: 'Accrual review', el: <AccrualReview /> },
  { key: 'signals', label: 'Signals', el: <Signals /> },
  { key: 'variance', label: 'Variance & memo', el: <VarianceMemo /> },
  { key: 'history', label: 'History', el: <History /> },
] as const;

export function App() {
  type Key = (typeof TABS)[number]['key'];
  const fromHash = () => TABS.find((t) => `#${t.key}` === location.hash)?.key ?? 'accrual';
  const [tab, setTabState] = useState<Key>(fromHash);
  const setTab = (k: Key) => { setTabState(k); history.replaceState(null, '', `#${k}`); };

  const [resetErr, setResetErr] = useState<string | null>(null);

  async function reset() {
    setResetErr(null);
    if (!confirm('Reset demo data?')) return;
    try {
      await api.reset();
      location.reload();
    } catch (e) {
      setResetErr(`Reset failed: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <header>
        <h1>TrueUp</h1>
        <span className="sub">{DEMO.company} · {monthLabel(DEMO.month)} close · as of {DEMO.asOf}</span>
        <span className="spacer" />
        {resetErr && <span className="error">{resetErr}</span>}
        <button className="secondary" onClick={reset}>Reset demo</button>
      </header>
      <nav>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </nav>
      <main>{TABS.find((t) => t.key === tab)!.el}</main>
    </>
  );
}
