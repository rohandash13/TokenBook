export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type LlmProxy = (body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;

/** D7: the worker has no API key and no network; it calls this through the gateway. Model comes from env only. */
export function createLlmProxy(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): LlmProxy {
  const doFetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  return async (body) => {
    const res = await doFetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ ...body, model: opts.model }),
    });
    return { status: res.status, json: await res.json() };
  };
}
