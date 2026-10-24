/** Runs first in the worker process. After this, fetch can only reach the gateway (INV1, D8). */
export function installNetGuard(gatewayUrl: string): void {
  const allowed = new URL(gatewayUrl).origin;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const origin = new URL(href).origin;
    if (origin !== allowed) {
      return Promise.reject(new Error(`NET_GUARD: ${origin} blocked; worker may only call ${allowed}`));
    }
    return realFetch(input, init);
  };
}
