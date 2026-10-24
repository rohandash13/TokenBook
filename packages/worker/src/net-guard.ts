/** Runs first in the worker process. After this, fetch can only reach the gateway (INV1, D8). */
export function installNetGuard(gatewayUrl: string): void {
  const allowed = new URL(gatewayUrl).origin;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    let origin: string;
    try {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      origin = new URL(href).origin;
    } catch {
      return Promise.reject(new Error(`NET_GUARD: unparseable URL blocked; worker may only call ${allowed}`));
    }
    if (origin !== allowed) {
      return Promise.reject(new Error(`NET_GUARD: ${origin} blocked; worker may only call ${allowed}`));
    }
    // A redirect from the gateway must never be followed off-origin.
    return realFetch(input, { ...init, redirect: "manual" });
  };
}
