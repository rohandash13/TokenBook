// OWNER: C — data the Atlassian (Jira) and Apify integrations collect. Internal to lane C.

/** A Jira issue as the Forge app sends it (and as fixtures store it). */
export type JiraIssueSnapshot = {
  key: string;
  url: string;
  projectKey: string;
  summary: string;
  description: string;
  labels: string[];
  components: string[];
  dueDate: string | null;
  /** Due-date changes, oldest first. `at` is an ISO timestamp; from/to are YYYY-MM-DD or null. */
  dueDateHistory: { at: string; from: string | null; to: string | null }[];
  createdAt: string;
  updatedAt: string;
};

export type PriceRow = { provider: string; model: string; inputPerMTok: number; outputPerMTok: number };

/** One scrape of a provider pricing page. `origin` keeps fixture and live scrapes from being diffed together. */
export type PriceSnapshot = {
  provider: string;
  url: string;
  fetchedAt: string;
  origin: 'fixture' | 'live';
  text: string;
  rows: PriceRow[];
};

export type PriceChange = {
  provider: string;
  model: string;
  from: PriceRow;
  to: PriceRow;
  announcedAt: string;
  effectiveDate: string;
  url: string;
  excerpt: string;
};

/** Public information that may affect AI spend. Shown with its source; never changes a number. */
export type MarketSignal = {
  id: string;
  kind: 'gpu' | 'release' | 'deprecation' | 'outage' | 'pricing' | 'other';
  title: string;
  date: string;
  url: string;
  excerpt: string;
  models: string[];
};
