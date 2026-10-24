import { afterEach, describe, expect, it } from "vitest";
import { SimulatedExecutor, createGatewayApp, createTools } from "@countersign/gateway";
import { MemoryStore } from "@countersign/shared";
import { listen, type Listening } from "../../../tests/helpers/listen";

describe("body-parser errors", () => {
  const open: Listening[] = [];
  afterEach(async () => { await Promise.all(open.splice(0).map((l) => l.close())); });

  async function start() {
    const tools = createTools({ store: new MemoryStore(), executor: new SimulatedExecutor("s"), fetchHosts: [], catalog: [], payeeAllowlist: [] });
    const l = await listen(createGatewayApp(tools));
    open.push(l);
    return l;
  }

  it("malformed JSON is a 400 JSON BAD_INPUT envelope", async () => {
    const l = await start();
    const res = await fetch(`${l.url}/tools/fetch_url`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_INPUT");
  });

  it("oversized body is a 413 JSON BAD_INPUT envelope", async () => {
    const l = await start();
    const res = await fetch(`${l.url}/tools/fetch_url`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "a".repeat(1_100_000) }) });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("BAD_INPUT");
  });
});
