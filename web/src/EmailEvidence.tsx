import { useRef } from 'react';
import { DEMO_EMAILS } from '../../src/shared/demoEmails';
import type { Evidence } from '../../src/shared/types';

export function GmailMark() {
  return <svg className="source-mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20V5l9 7 9-7v15" fill="none" stroke="#4285f4" strokeWidth="4" strokeLinejoin="round"/><path d="m3 5 9 7 9-7" fill="none" stroke="#ea4335" strokeWidth="4"/><path d="M21 10v10" stroke="#34a853" strokeWidth="4"/></svg>;
}
export function EmailEvidence({ ev }: { ev: Evidence }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const email = DEMO_EMAILS.find((e) => e.id === ev.id);
  return <li className="evidence-item"><button className="evidence-source email-evidence-button" onClick={() => dialog.current?.showModal()}><GmailMark /><b>Gmail</b><span className="evidence-meta">{ev.date} · {email?.from.split('<')[0] ?? ev.author}</span><span className="email-demo-label">Demo email</span></button><p className="email-subject">{email?.subject ?? 'Email evidence'}</p><p className="evidence-excerpt">{ev.text}</p><dialog ref={dialog} className="email-dialog" aria-label="Email evidence preview"><div className="email-dialog-heading"><GmailMark /><b>Gmail</b><span className="email-demo-label">Synthetic demo email</span><button className="secondary" aria-label="Close email preview" onClick={() => dialog.current?.close()}>Close</button></div><h2>{email?.subject ?? 'Email evidence'}</h2><dl><dt>From</dt><dd>{email?.from ?? ev.author}</dd><dt>To</dt><dd>{email?.to ?? 'Demo finance team'}</dd><dt>Date</dt><dd>{ev.date}</dd></dl><p className="email-body">{email?.body ?? ev.text}</p><p className="email-privacy-note">Synthetic data · No Gmail account connected · Email extraction runs locally. This preview does not send email.</p></dialog></li>;
}
