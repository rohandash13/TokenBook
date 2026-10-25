import type { JournalEntry } from '../../src/shared/types';
import { formatUsd } from '../../src/shared/format';
import { shortDateTime } from './Evidence';

export function ApprovalReceipt({ entry, currentForecast }: { entry: JournalEntry | null; currentForecast?: number }) {
  if (!entry || entry.status === 'prepared') return null;
  const amount = entry.lines.reduce((sum, line) => sum + line.debit, 0);
  const changed = currentForecast !== undefined && Math.abs(currentForecast - amount) >= 1;
  return <section className="approval-receipt" aria-label="Journal approval record"><header><b>Journal approved · {formatUsd(amount)}</b><span className="badge approved">{entry.status === 'exported' ? 'CSV exported' : 'Ready to export'}</span></header><p>{entry.approvedBy ?? 'Reviewer'}{entry.approvedAt ? ` · ${shortDateTime(entry.approvedAt)}` : ''}<span className="receipt-id">{entry.id}</span></p>{entry.exportedAt && <p>CSV exported {shortDateTime(entry.exportedAt)} · Posting to your accounting system is a separate step.</p>}{entry.status === 'exported' && !entry.exportedAt && <p>CSV downloaded · Posting to your accounting system is a separate step.</p>}{changed && <p className="receipt-changed">Latest forecast is {formatUsd(currentForecast!)}. The approved journal stays at {formatUsd(amount)}.</p>}</section>;
}
