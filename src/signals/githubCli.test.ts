// OWNER: D
import { expect, it, vi } from 'vitest';
import { createGithubCliFetch } from './githubCli.js';

it('uses only explicit GET requests through gh without exposing or copying tokens', async () => {
  const run = vi.fn(async () => '[{"number":1}]');
  const res = await createGithubCliFetch(run)('https://api.github.com/repos/demo/repo/milestones?state=all');
  expect(await res.json()).toEqual([{ number: 1 }]);
  expect(run).toHaveBeenCalledWith(['api', '--method', 'GET', '/repos/demo/repo/milestones?state=all', '-H', 'Accept: application/vnd.github+json']);
});
it('rejects writes, foreign hosts and unrelated API endpoints', async () => {
  const run = vi.fn(async () => '{}');
  const fetcher = createGithubCliFetch(run);
  for (const [url, init] of [
    ['https://api.github.com/repos/demo/repo/milestones', { method: 'POST' }],
    ['https://example.com/repos/demo/repo/milestones', undefined],
    ['https://api.github.com/user', undefined],
    ['https://api.github.com/repos/demo/repo/releases', { body: '{}' }],
  ] as const) await expect(fetcher(url, init)).rejects.toThrow('only signal-reader GET');
  expect(run).not.toHaveBeenCalled();
});
it('propagates an unavailable CLI so the reader can use its guarded fallback', async () => {
  const fetcher = createGithubCliFetch(async () => { throw new Error('gh unavailable'); });
  await expect(fetcher('https://api.github.com/search/issues?q=repo:demo/repo')).rejects.toThrow('gh unavailable');
});
