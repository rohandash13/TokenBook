// OWNER: D
// Tiny fetch client for the TrueUp REST API (Owner C's server).
// Exported as an interface so tests and the Slack app can swap in a fake.
import type { Estimate, Month, Team, TeamContext, UsageDay } from "../shared/types.js";

export type TrueUpApi = {
  postContext(ctx: TeamContext): Promise<void>;
  getEstimates(month: Month, asOf: string): Promise<Estimate[]>;
  getActualToDate(team: Team, month: Month): Promise<number>;
  getContexts(month: Month): Promise<TeamContext[]>;
  /** Asks the server to re-read Slack/GitHub signals. Resolves quietly if the server doesn't have the route yet. */
  refreshSignals(month: Month): Promise<void>;
};

export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.TRUEUP_API_URL || `http://localhost:${env.PORT || 8787}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** The server may return a bare array or wrap it ({ estimates: [...] }); accept both. */
function asArray<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  const inner = (body as Record<string, unknown> | null)?.[key];
  return Array.isArray(inner) ? (inner as T[]) : [];
}

export function createApi(baseUrl: string = apiBaseUrl()): TrueUpApi {
  return {
    async postContext(ctx) {
      const res = await fetch(`${baseUrl}/api/contexts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ctx),
      });
      if (!res.ok) throw new Error(`POST /api/contexts failed: ${res.status}`);
    },
    async getEstimates(month, asOf) {
      const qs = new URLSearchParams({ month, asOf });
      return asArray<Estimate>(await getJson(`${baseUrl}/api/estimates?${qs}`), "estimates");
    },
    async getContexts(month) {
      const qs = new URLSearchParams({ month });
      return asArray<TeamContext>(await getJson(`${baseUrl}/api/contexts?${qs}`), "contexts");
    },
    async refreshSignals(month) {
      const qs = new URLSearchParams({ month });
      const res = await fetch(`${baseUrl}/api/signals/refresh?${qs}`, { method: "POST" });
      if (res.status === 404) return; // not available yet
      if (!res.ok) throw new Error(`POST /api/signals/refresh failed: ${res.status}`);
    },
    async getActualToDate(team, month) {
      const qs = new URLSearchParams({ month });
      const usage = asArray<UsageDay>(await getJson(`${baseUrl}/api/usage?${qs}`), "usage");
      return usage.filter((u) => u.team === team).reduce((sum, u) => sum + u.costUsd, 0);
    },
  };
}

/** The TrueUp-method estimate for one team, or undefined if the server has none. */
export function trueupEstimate(estimates: Estimate[], team: Team): number | undefined {
  return estimates.find((e) => e.team === team && e.method === "trueup")?.estimate;
}
