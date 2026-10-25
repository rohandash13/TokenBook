// OWNER: C — configuration for the Atlassian (Jira) and Apify integrations.
import { KIND_MULTIPLIER } from '../shared/config';

export const JIRA = {
  projectKey: process.env.JIRA_PROJECT_KEY || 'SPEND',
  /** The Jira site people open in a browser (Forge's own API base is api.atlassian.com, which isn't browsable). */
  siteUrl: (process.env.JIRA_SITE_URL || 'https://one-atlas-ikgm.atlassian.net').replace(/\/$/, ''),
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
  liveIssueKey: process.env.JIRA_LIVE_ISSUE ?? 'SPEND-1',
};

/** The issue opened inside its project's issue view, and the project's issue list. */
export const jiraIssueUrl = (key: string, projectKey = key.split('-')[0]) =>
  `${JIRA.siteUrl}/jira/software/c/projects/${projectKey}/issues/${key}`;
export const jiraProjectUrl = (projectKey = JIRA.projectKey) => `${JIRA.siteUrl}/jira/software/c/projects/${projectKey}/issues`;

/** Fixture model ids and how each appears on its provider's pricing page. */
export const MODELS: { id: string; provider: 'anthropic' | 'openai'; pattern: RegExp }[] = [
  { id: 'claude-haiku', provider: 'anthropic', pattern: /haiku/i },
  { id: 'claude-sonnet', provider: 'anthropic', pattern: /sonnet/i },
  { id: 'claude-opus', provider: 'anthropic', pattern: /opus/i },
  { id: 'gpt-4.1-mini', provider: 'openai', pattern: /gpt-4\.1[ -]mini/i },
];

export const APIFY = {
  actor: 'apify~website-content-crawler',
  memoryMb: 1024,
  runSyncUrl: (actor: string) => `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`,
  pricePages: [
    { provider: 'anthropic', url: 'https://docs.claude.com/en/docs/about-claude/pricing' },
    { provider: 'openai', url: 'https://openai.com/api/pricing/' },
  ],
  /** Provider pages for the model market (prices verified against the page). */
  catalogSources: [
    { provider: 'Anthropic', url: 'https://docs.claude.com/en/docs/about-claude/pricing', crawler: 'cheerio', openWeight: false },
    { provider: 'Google', url: 'https://ai.google.dev/gemini-api/docs/pricing', crawler: 'playwright:firefox', openWeight: false }, // model names only render in a browser
    { provider: 'xAI', url: 'https://docs.x.ai/developers/pricing', crawler: 'cheerio', openWeight: false },
    { provider: 'DeepSeek', url: 'https://api-docs.deepseek.com/quick_start/pricing', crawler: 'cheerio', openWeight: true },
    { provider: 'Moonshot (Kimi)', url: 'https://platform.moonshot.ai/docs/pricing/chat', crawler: 'playwright:firefox', openWeight: true },
    { provider: 'Mistral', url: 'https://mistral.ai/pricing', crawler: 'cheerio', openWeight: true },
    // openai.com/api/pricing blocks scrapers (it timed out even through Apify's unblocker), so OpenAI comes from a
    // third-party tracker that lists OpenAI's prices; the UI labels these rows with their source.
    { provider: 'OpenAI', url: 'https://benchlm.ai/openai/api-pricing', crawler: 'cheerio', openWeight: false, via: 'benchlm.ai' },
  ] as { provider: string; url: string; crawler: 'cheerio' | 'playwright:firefox'; openWeight: boolean; via?: string }[],
  /** Google searches (Apify RAG Web Browser) for public news that may change AI spend. */
  marketQueries: [
    'AI API price change announcement LLM per million tokens',
    'LLM model deprecation retirement date API 2026',
    'H100 B200 GPU cloud rental price per hour',
  ],
  marketPages: [
    { url: 'https://www.anthropic.com/news' },
    { url: 'https://www.runpod.io/pricing' },
  ],
};
