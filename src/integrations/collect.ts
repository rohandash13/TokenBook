// OWNER: C — every event the integrations contribute to the estimate, as of a date.
import { listJiraIssues, listPriceSnapshots } from '../server/store';
import type { UsageDay } from '../shared/types';
import { priceEvents } from './apify/impact';
import { priceChanges } from './apify/prices';
import { jiraEvents } from './jira/events';
import type { ExternalEvent } from './merge';

export function collectExternalEvents(asOf: string, usage: UsageDay[]): ExternalEvent[] {
  return [...jiraEvents(listJiraIssues(), asOf), ...priceEvents(priceChanges(listPriceSnapshots()), usage, asOf)];
}
