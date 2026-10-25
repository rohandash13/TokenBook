// OWNER: C
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StoredMemo } from '../../shared/api';
import type { MemoInput } from '../../shared/types';
import type { JiraIssueSnapshot } from '../types';
import { notifyVariance, withJiraContext } from './notify';

const issues = JSON.parse(
  readFileSync(new URL('../../../data/fixtures/integrations/jira.json', import.meta.url), 'utf8'),
) as JiraIssueSnapshot[];

const input: MemoInput = {
  team: 'growth', month: '2026-10', estimate: 5550, actual: 4651.22, variancePct: 0.1932,
  basis: '2x from Oct 26 per Maya', approvedBy: 'Dana', sources: ['JE-2026-10-ACCRUAL'],
};
const memo: StoredMemo = { ...input, text: 'Growth over-accrued.\nCampaign slipped.', createdAt: '2026-11-03T00:00:00Z', attached: false };

describe('withJiraContext', () => {
  it('cites the Jira slip in the basis and the issue in the sources', () => {
    const [out] = withJiraContext([input], issues);
    expect(out.basis).toBe('2x from Oct 26 per Maya; Jira NW-2 due date moved 2026-10-26 → 2026-11-04 on 2026-10-28');
    expect(out.sources).toEqual(['JE-2026-10-ACCRUAL', 'jira:NW-2']);
  });

  it('leaves teams with no related issue alone', () => {
    const platform = { ...input, team: 'platform' as const };
    expect(withJiraContext([platform], [])[0]).toEqual(platform);
  });
});

describe('notifyVariance', () => {
  it('does nothing without a web trigger URL', async () => {
    expect(await notifyVariance([memo], issues, {})).toEqual([]);
  });

  it('posts each memo with its related issues and returns the task key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ key: 'NW-12' }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await notifyVariance([memo], issues, { url: 'https://x/wt', secret: 's', fetchImpl });
    expect(out).toEqual([{ team: 'growth', key: 'NW-12' }]);
    expect((calls[0].init.headers as Record<string, string>)['x-trueup-secret']).toBe('s');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      team: 'growth', teamLabel: 'Growth', monthLabel: 'Oct 2026', relatedIssueKeys: ['NW-2'],
    });
  });

  it('reports failures instead of throwing', async () => {
    const fetchImpl = (async () => { throw new Error('tunnel down'); }) as unknown as typeof fetch;
    expect(await notifyVariance([memo], issues, { url: 'https://x/wt', secret: 's', fetchImpl })).toEqual([
      { team: 'growth', error: 'tunnel down' },
    ]);
  });
});
