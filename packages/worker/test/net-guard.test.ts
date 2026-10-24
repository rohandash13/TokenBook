import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installNetGuard } from "@countersign/worker";

const GW = "http://127.0.0.1:4000";

describe("installNetGuard", () => {
  const original = globalThis.fetch;
  let seen: Array<{ input: unknown; init?: RequestInit }>;

  beforeEach(() => {
    seen = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      seen.push({ input, init });
      return new Response("ok");
    }) as typeof fetch;
    installNetGuard(GW);
  });
  afterEach(() => { globalThis.fetch = original; });

  it("passes the gateway origin as a string, URL and Request", async () => {
    await globalThis.fetch(`${GW}/tools/x`);
    await globalThis.fetch(new URL(`${GW}/tools/y`));
    await globalThis.fetch(new Request(`${GW}/tools/z`));
    expect(seen).toHaveLength(3);
  });

  it("forces redirect: manual on allowed calls, overriding the caller", async () => {
    await globalThis.fetch(`${GW}/a`);
    await globalThis.fetch(`${GW}/b`, { redirect: "follow", method: "POST" });
    expect(seen[0].init?.redirect).toBe("manual");
    expect(seen[1].init?.redirect).toBe("manual");
    expect(seen[1].init?.method).toBe("POST");
  });

  it.each([
    "http://127.0.0.1:4101/x",
    "http://127.0.0.1:4000.evil.test/",
    "https://127.0.0.1:4000/",
  ])("blocks %s without reaching the real fetch", async (url) => {
    await expect(globalThis.fetch(url)).rejects.toThrow(/NET_GUARD/);
    expect(seen).toHaveLength(0);
  });

  it.each(["/tools/x", "not a url"])("rejects invalid URL %s as a rejected promise", async (url) => {
    let p: Promise<Response> | undefined;
    expect(() => { p = globalThis.fetch(url); }).not.toThrow();
    await expect(p).rejects.toThrow(/NET_GUARD/);
    expect(seen).toHaveLength(0);
  });
});
