import { useRef } from 'react';
import { DEMO_EMAILS } from '../../src/shared/demoEmails';
import { TEAM_INFO } from '../../src/shared/config';
import type { Evidence } from '../../src/shared/types';

export function GmailMark() {
  return <svg className="source-mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20V5l9 7 9-7v15" fill="none" stroke="#4285f4" strokeWidth="4" strokeLinejoin="round"/><path d="m3 5 9 7 9-7" fill="none" stroke="#ea4335" strokeWidth="4"/><path d="M21 10v10" stroke="#34a853" strokeWidth="4"/></svg>;
}
export function EmailEvidence({ ev }: { ev: Evidence }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const email = DEMO_EMAILS.find((e) => e.id === ev.id);
  const displayName = (value?: string) => value?.split('<')[0].trim();
  const sender = displayName(email?.from ?? ev.author) ?? 'Sender';
  const date = new Date(`${ev.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return <li className="evidence-item"><button className="evidence-source email-evidence-button" onClick={() => dialog.current?.showModal()}><GmailMark /><b>Gmail</b><span className="evidence-meta">{ev.date} · {email?.from.split('<')[0] ?? ev.author}</span></button><p className="email-subject">{email?.subject ?? 'Email evidence'}</p><p className="evidence-excerpt">{email?.body.replace(/^Hi [^,]+,\s*/, '').split('\n\n')[0] ?? ev.text}</p><dialog ref={dialog} className="email-dialog" aria-label="Email evidence preview"><div className="email-dialog-heading"><GmailMark /><b>Gmail</b><span className="email-folder">Inbox</span><button className="secondary" aria-label="Close email preview" onClick={() => dialog.current?.close()}>Close</button></div><h2>{email?.subject ?? 'Email evidence'}</h2><div className="email-sender-row"><span className="email-sender-avatar">{sender.slice(0, 1)}</span><div><strong>{sender}</strong><span>{email ? TEAM_INFO[email.team].label : 'Finance'} · Northwind Labs</span></div><time dateTime={ev.date}>{date}</time></div><dl><dt>From</dt><dd>{sender}</dd><dt>To</dt><dd>{displayName(email?.to) ?? 'Finance team'}</dd><dt>Date</dt><dd>{date}</dd></dl><p className="email-body">{email?.body ?? ev.text}</p></dialog></li>;
}
