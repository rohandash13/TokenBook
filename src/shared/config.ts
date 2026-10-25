// OWNER: shared — teams, account map, thresholds, period helpers (docs/SPEC.md "Config").
import type { Month, Team } from './types';

export const TEAMS: readonly Team[] = ['support', 'search', 'growth', 'platform'];

// Slack ids are read from the named env var in src/slack (this file is also bundled into the web app).
export const TEAM_INFO: Record<Team, { label: string; leadName: string; slackIdEnv: string }> = {
  support:  { label: 'Support',  leadName: 'Priya', slackIdEnv: 'SLACK_LEAD_SUPPORT' },
  search:   { label: 'Search',   leadName: 'Leo'  , slackIdEnv: 'SLACK_LEAD_SEARCH' },
  growth:   { label: 'Growth',   leadName: 'Maya', slackIdEnv: 'SLACK_LEAD_GROWTH' },
  platform: { label: 'Platform', leadName: 'Sam',   slackIdEnv: 'SLACK_LEAD_PLATFORM' },
};

export const EXPENSE_ACCOUNT: Record<Team, string> = {
  support: '5010',
  search: '6130',
  growth: '6130',
  platform: '6130',
};
export const ACCRUED_LIABILITIES = '2100';
export const ACCOUNTS_PAYABLE = '2000';
export const ACCOUNT_NAMES: Record<string, string> = {
  '5010': 'Cost of revenue – AI APIs',
  '6130': 'R&D – AI APIs',
  '2100': 'Accrued liabilities',
  '2000': 'Accounts payable',
};

// Where TrueUp looks for forecast drivers when a lead hasn't replied (docs/plan-signals.md).
// Channels are public Slack channel names the bot has been invited to. GitHub milestones in a shared
// repo are assigned to a team when their title contains one of the team's keywords (case-insensitive).
export const TEAM_SIGNALS: Record<Team, { slackChannels: string[]; githubRepos: string[]; githubMilestoneKeywords: string[] }> = {
  support:  { slackChannels: ['support-eng', 'support-ops'],      githubRepos: ['nikhilrajgopal/northwind-demo'],     githubMilestoneKeywords: ['support'] },
  search:   { slackChannels: ['search-eng', 'search-quality'],    githubRepos: ['nikhilrajgopal/northwind-search'],   githubMilestoneKeywords: ['search'] },
  growth:   { slackChannels: ['growth', 'growth-campaigns'],      githubRepos: ['nikhilrajgopal/northwind-growth'],   githubMilestoneKeywords: ['campaign', 'growth'] },
  platform: { slackChannels: ['platform', 'platform-infra'],      githubRepos: ['nikhilrajgopal/northwind-platform'], githubMilestoneKeywords: ['platform'] },
};

// Channels several teams read; a message counts for a team only when it mentions one of TEAM_KEYWORDS.
export const SHARED_CHANNELS: { name: string; teams: Team[] }[] = [
  { name: 'launches',          teams: ['support', 'search', 'growth', 'platform'] },
  { name: 'incidents',         teams: ['support', 'search', 'growth', 'platform'] },
  { name: 'eng-announcements', teams: ['support', 'search', 'growth', 'platform'] },
];

export const TEAM_KEYWORDS: Record<Team, string[]> = {
  support:  ['support'],
  search:   ['search', 'reindex', 'reranker'],
  growth:   ['growth', 'campaign'],
  platform: ['platform', 'embeddings', 'pipeline'],
};

// Default multiplier for an inferred event when no cited signal states one (e.g. "~3x").
export const KIND_MULTIPLIER = { launch: 2, campaign: 1.5, load_test: 1.3, deprecation: 0.8 } as const;

// A memo is required when BOTH are strictly exceeded.
export const MEMO_THRESHOLD = { pct: 0.1, usd: 500 };

// One convention for every accrual-accuracy number: Variance.variancePct, History errorPct and
// bias (docs/SPEC.md defines bias as the mean of (estimate − actual) / actual).
//   accrualErrorPct = (estimate − actual) / actual, as a fraction: 0.193 means 19.3%.
//   Positive = over-accrued (booked more than the bill); negative = under-accrued.
// So a team's bias is just the average of its monthly variancePct. Display with formatPct (× 100).
// When the bill is 0, any accrual counts as 100% over.
export function accrualErrorPct(estimate: number, actual: number): number {
  if (actual === 0) return estimate === 0 ? 0 : 1;
  return (estimate - actual) / actual;
}

export const DEMO = {
  company: 'Northwind Labs',
  controller: 'Dana',
  month: '2026-10',
  asOf: '2026-10-25',
  asOfDay: 25,
  liveTeam: 'support' as Team, // its October context is cleared by demo reset; Priya replies live
  firstMonth: '2026-02',
} as const;

const pad = (n: number) => String(n).padStart(2, '0');
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseMonth(m: Month): { y: number; mo: number } {
  const [y, mo] = m.split('-').map(Number);
  return { y, mo };
}

export function daysInMonth(m: Month): number {
  const { y, mo } = parseMonth(m);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

// Days after asOf left in its month (asOf itself counts as elapsed).
export function daysRemaining(asOf: string): number {
  return daysInMonth(asOf.slice(0, 7)) - Number(asOf.slice(8, 10));
}

export const lastDayOfMonth = (m: Month): string => `${m}-${pad(daysInMonth(m))}`;

export function nextMonth(m: Month): Month {
  const { y, mo } = parseMonth(m);
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
}

export function prevMonth(m: Month): Month {
  const { y, mo } = parseMonth(m);
  return mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`;
}

export const firstDayOfNextMonth = (m: Month): string => `${nextMonth(m)}-01`;

export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

export const asOfFor = (m: Month): string => `${m}-${pad(DEMO.asOfDay)}`;

export function monthLabel(m: Month): string {
  const { y, mo } = parseMonth(m);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}
