// OWNER: C — every event the integrations contribute to the estimate, as of a date.
import { listJiraIssues } from '../server/store';
import type { UsageDay } from '../shared/types';
import { jiraEvents } from './jira/events';
import type { ExternalEvent } from './merge';

export function collectExternalEvents(asOf: string, _usage: UsageDay[]): ExternalEvent[] {
  return [...jiraEvents(listJiraIssues(), asOf)];
}
