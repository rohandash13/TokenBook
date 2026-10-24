// OWNER: C
import { useState } from 'react';
import { DEMO, monthLabel } from '../../src/shared/config';
import { api } from './api';
import { AccrualReview } from './screens/AccrualReview';
import { CheckinPreview } from './screens/CheckinPreview';
import { History } from './screens/History';
import { VarianceMemo } from './screens/VarianceMemo';

const TABS = [
  { key: 'accrual', label: 'Accrual review', el: <AccrualReview /> },
  { key: 'checkin', label: 'Slack check-ins', el: <CheckinPreview /> },
  { key: 'variance', label: 'Variance & memo', el: <VarianceMemo /> },
  { key: 'history', label: 'History', el: <History /> },
] as const;

export function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('accrual');

  async function reset() {
    if (!confirm('Reset demo data?')) return;
    await api.reset();
    location.reload();
  }

  return (
    <>
      <header>
        <h1>TrueUp</h1>
        <span className="sub">{DEMO.company} · {monthLabel(DEMO.month)} close · as of {DEMO.asOf}</span>
        <span className="spacer" />
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
