// OWNER: C — configuration for the Atlassian (Jira) and Apify integrations.
import { KIND_MULTIPLIER } from '../shared/config';

export const JIRA = {
  projectKey: process.env.JIRA_PROJECT_KEY || 'NW',
  /** Issue label → default multiplier when the issue text states none ("~3x", "double volume"). */
  kinds: {
    launch: KIND_MULTIPLIER.launch,
    campaign: KIND_MULTIPLIER.campaign,
    'load-test': KIND_MULTIPLIER.load_test,
    deprecation: KIND_MULTIPLIER.deprecation,
  } as Record<string, number>,
  /** Label `team-support` assigns an issue to a team (a component named after the team also works). */
  teamLabelPrefix: 'team-',
  /** Withheld by demo reset: the presenter creates it live in Jira. Empty string seeds it. */
  liveIssueKey: process.env.JIRA_LIVE_ISSUE ?? 'NW-5',
};

/** Fixture model ids and how each appears on its provider's pricing page. */
export const MODELS: { id: string; provider: 'anthropic' | 'openai'; pattern: RegExp }[] = [
  { id: 'claude-haiku', provider: 'anthropic', pattern: /haiku/i },
  { id: 'claude-sonnet', provider: 'anthropic', pattern: /sonnet/i },
  { id: 'claude-opus', provider: 'anthropic', pattern: /opus/i },
  { id: 'gpt-4.1-mini', provider: 'openai', pattern: /gpt-4\.1[ -]mini/i },
];

export const APIFY = {
  actor: 'apify~website-content-crawler',
  runSyncUrl: (actor: string) => `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`,
  pricePages: [
    { provider: 'anthropic', url: 'https://www.anthropic.com/pricing' },
    { provider: 'openai', url: 'https://openai.com/api/pricing/' },
  ],
  marketPages: [
    { url: 'https://www.anthropic.com/news' },
    { url: 'https://www.runpod.io/pricing' },
  ],
};
