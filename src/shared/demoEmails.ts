import type { Team } from './types';

// Deliberately synthetic: no mailbox credentials, Gmail API calls, or real recipients.
export type DemoEmail = { id: string; team: Team; date: string; from: string; to: string; subject: string; body: string };
export const DEMO_EMAILS: DemoEmail[] = [
  { id: 'gmail:demo:support-launch', team: 'support', date: '2026-10-25', from: 'Priya <priya@northwind.example>', to: 'Dana <finance@northwind.example>', subject: 'Support agent v2 — rollout confirmation', body: 'Support agent v2 launches October 27, 2026. Support API usage will be 3x the current baseline from October 27 onward. This confirms the existing rollout schedule.\n\nPriya' },
  { id: 'gmail:demo:support-reminder', team: 'support', date: '2026-10-25', from: 'Priya <priya@northwind.example>', to: 'Dana <finance@northwind.example>', subject: 'Reminder: same support rollout', body: 'Reminder: Support agent v2 launches October 27, 2026. Support API usage will be 3x baseline from October 27 onward. This is the same launch, not an additional increase.' },
  { id: 'gmail:demo:search-routine', team: 'search', date: '2026-10-25', from: 'Leo <leo@northwind.example>', to: 'Dana <finance@northwind.example>', subject: 'Search weekly notes', body: 'Search documentation is updated. No changes to API usage are planned for October.' },
  { id: 'gmail:demo:growth-campaign', team: 'growth', date: '2026-10-25', from: 'Maya <maya@northwind.example>', to: 'Dana <finance@northwind.example>', subject: 'Fall campaign confirmation', body: 'Fall campaign launches October 26, 2026. Growth API usage will be 2x baseline from October 26 onward.' },
  { id: 'gmail:demo:platform-unknown', team: 'platform', date: '2026-10-25', from: 'Sam <sam@northwind.example>', to: 'Dana <finance@northwind.example>', subject: 'Platform load test — sizing pending', body: 'Platform load test starts October 29, 2026. API usage will increase, but the expected multiplier is not yet confirmed.' },
  { id: 'gmail:demo:search-chatter', team: 'search', date: '2026-10-25', from: 'Leo <leo@northwind.example>', to: 'Search <search@northwind.example>', subject: 'Team lunch', body: 'Team lunch is on October 28. Please send dietary preferences.' },
];
