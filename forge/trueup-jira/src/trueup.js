// OWNER: C — calls the TrueUp API through the tunnel. Set with:
//   forge variables set TRUEUP_URL https://<name>.trycloudflare.com
//   forge variables set --encrypt TRUEUP_SECRET <same value as JIRA_WEBHOOK_SECRET in TrueUp's .env>
import api from '@forge/api';

const base = () => (process.env.TRUEUP_URL || '').replace(/\/$/, '');

export async function trueup(path, init = {}) {
  if (!base()) throw new Error('TRUEUP_URL is not set: forge variables set TRUEUP_URL https://...');
  const res = await api.fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-trueup-secret': process.env.TRUEUP_SECRET || '',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`TrueUp ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
