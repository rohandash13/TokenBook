import { api } from './api';
import { usePoll } from './usePoll';
import { HistoryReportView } from './screens/History';
import type { Method } from '../../src/shared/types';
import { monthLabel } from '../../src/shared/config';

const METHODS: { method: Method; label: string }[] = [
  { method: 'trueup', label: 'TokenBook' },
  { method: 'runrate', label: 'Run-rate' },
  { method: 'lastmonth', label: 'Last month' },
];

export function ForecastPerformance() {
  const { data, error, reload } = usePoll(() => api.history(), 0);
  return <section className="forecast-performance" aria-labelledby="forecast-performance-heading">
    <header><div><h2 id="forecast-performance-heading">Forecast performance</h2><p>{data?.months.length ? `${monthLabel(data.months[0])} – ${monthLabel(data.months[data.months.length - 1])}` : 'Past completed months'} · Average forecast error ↓</p></div><span className="performance-hint">Lower is better</span></header>
    {error ? <p role="alert">Could not load performance. <button className="link-btn" onClick={() => void reload()}>Retry</button></p> : !data ? <p className="muted">Loading performance…</p> : <>
      <div className="performance-methods">{METHODS.map(({ method, label }) => {
        const score = data.byMethod.find((m) => m.method === method);
        return <div key={method}><span>{label}</span><strong>{score?.n ? `${(score.maePct * 100).toFixed(2)}%` : '—'}</strong></div>;
      })}</div>
      {data.rows.length > 0 ? <details className="performance-breakdown"><summary><span className="disclosure-show">View breakdown</span><span className="disclosure-hide">Hide breakdown</span><span className="performance-result-count">{data.rows.length} results</span></summary><HistoryReportView data={data} embedded /></details> : <p className="muted">Performance appears once completed bills are available.</p>}
    </>}
  </section>;
}
