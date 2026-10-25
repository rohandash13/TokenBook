// OWNER: D — opt-in local GitHub CLI access. Credentials stay in gh's credential store.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

type Run = (args: string[]) => Promise<string>;
export function createGithubCliFetch(run: Run = async (args) => (await exec('gh', args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.origin !== 'https://api.github.com' || method !== 'GET' || init?.body ||
      !(/^\/repos\/[\w.-]+\/[\w.-]+\/(?:milestones|releases)$/.test(url.pathname) || url.pathname === '/search/issues')) {
      throw new Error('GitHub CLI adapter allows only signal-reader GET endpoints');
    }
    const body = await run(['api', '--method', 'GET', url.pathname + url.search, '-H', 'Accept: application/vnd.github+json']);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
