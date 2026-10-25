import { DEMO_EMAILS } from '../shared/demoEmails';
import type { Team } from '../shared/types';
import type { Signal } from './types';

export function readDemoGmailSignals(team: Team, month: string): Signal[] {
  return DEMO_EMAILS.filter((e) => e.team === team && e.date.startsWith(month)).map((e) => ({
    id: e.id, source: 'gmail', kind: 'message', team, date: e.date,
    author: e.from, text: `${e.subject}\n\n${e.body}`, url: `https://mail.google.com/#demo/${encodeURIComponent(e.id)}`,
  }));
}
