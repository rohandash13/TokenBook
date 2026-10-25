// OWNER: C (sign-offs by Junghwan)
// Workpaper sign-off: who prepared a piece of work and who reviewed it.
// The server doesn't keep review times, so the time shown is when this browser first saw the sign-off.
import { useEffect, useState } from 'react';

const PREFIX = 'trueup.signoff.';

function readTime(key: string): string | null {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}
function writeTime(key: string, iso: string) {
  try { localStorage.setItem(PREFIX + key, iso); } catch { /* storage unavailable: show no time */ }
}
export function clearSignOffs() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* nothing to clear */ }
}

/** Time a sign-off was first seen, recorded once when `signed` becomes true. */
export function useSignedAt(key: string, signed: boolean): string | null {
  const [at, setAt] = useState<string | null>(() => readTime(key));
  useEffect(() => {
    if (!signed || at) return;
    const now = new Date().toISOString();
    writeTime(key, now);
    setAt(now);
  }, [key, signed, at]);
  return signed ? at : null;
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

export type SignOffProps = {
  id: string;                 // stable key, e.g. the journal entry id or "memo:2026-10:growth"
  preparedBy: string;         // "TrueUp", "Claude"
  preparedHow: string;        // "calculated from usage and lead input"
  reviewer: string;           // "Dana"
  reviewerRole?: string;      // "Controller"
  reviewed: boolean;
  pendingText?: string;       // shown when not yet reviewed
  hideLabels?: boolean;       // drop the "Prepared" / "Reviewed" captions (kept for screen readers)
};

export function SignOff({ id, preparedBy, preparedHow, reviewer, reviewerRole = 'Controller', reviewed, pendingText, hideLabels }: SignOffProps) {
  const at = useSignedAt(id, reviewed);
  const ai = /claude|ai/i.test(preparedBy);
  const label = (text: string) => hideLabels ? null : <span className="signoff-label">{text}</span>;
  return (
    <div className={`signoff ${reviewed ? 'is-signed' : ''}`}>
      <div className="signoff-cell" title={preparedHow} aria-label={hideLabels ? 'Prepared' : undefined}>
        {label('Prepared')}
        <span className="signoff-value">{preparedBy}{ai ? <span className="pill ai">AI draft</span> : <span className="pill calc">Calculated</span>}</span>
      </div>
      <div className="signoff-cell" title={pendingText} aria-label={hideLabels ? 'Reviewed' : undefined}>
        {label('Reviewed')}
        <span className="signoff-value">
          {reviewed
            ? <><span className="sig">{reviewer}</span><span className="faint">{reviewerRole}{at ? `, ${time(at)}` : ''}</span></>
            : <span className="pill wait">Needs review</span>}
        </span>
      </div>
    </div>
  );
}
