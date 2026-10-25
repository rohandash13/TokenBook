import { describe, expect, it } from 'vitest';
import { isRelevantEmail } from './evidenceRelevance';
import { readDemoGmailSignals } from '../signals/gmail';

describe('financial email display relevance', () => {
  it('hides unrelated inbox chatter across the team feed', () => {
    const search = readDemoGmailSignals('search', '2026-10').filter(isRelevantEmail);
    expect(search.map((s) => s.id)).toEqual(['gmail:demo:search-routine']);
    expect(isRelevantEmail({ source: 'gmail', text: 'Team lunch October 28. We expect 3x attendance.' })).toBe(false);
  });
  it('retains confirmations, repeated corroboration, and unresolved sizing for review', () => {
    for (const team of ['support', 'growth', 'platform'] as const) {
      const mail = readDemoGmailSignals(team, '2026-10');
      expect(mail.filter(isRelevantEmail)).toEqual(mail);
    }
  });
  it('retains financial messages without requiring a launch or multiplier', () => {
    for (const text of ['Vendor pricing changes next month.', 'Invoice credit pending confirmation.', 'No changes to API usage this month.']) {
      expect(isRelevantEmail({ source: 'gmail', text })).toBe(true);
    }
  });
  it('does not alter Slack or GitHub display', () => {
    expect(isRelevantEmail({ source: 'slack', text: 'Routine update' })).toBe(true);
    expect(isRelevantEmail({ source: 'github', text: 'Release notes' })).toBe(true);
  });
});
