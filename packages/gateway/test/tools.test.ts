import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { SimulatedExecutor, createTools } from "@countersign/gateway";
import { MemoryStore } from "@countersign/shared";
import { listen, type Listening } from "../../../tests/helpers/listen";

describe("default fetchPage does not follow redirects", () => {
  const open: Listening[] = [];
  afterEach(async () => { await Promise.all(open.splice(0).map((l) => l.close())); });

  it("a 302 off the allowlist is UPSTREAM_FAILED and the target is never hit", async () => {
    let hits = 0;
    const target = express();
    target.get("/secret", (_req, res) => { hits++; res.send("off-allowlist"); });
    const targetL = await listen(target);
    open.push(targetL);

    const first = express();
    first.get("/go", (_req, res) => res.redirect(302, `${targetL.url}/secret`));
    const firstL = await listen(first);
    open.push(firstL);

    const store = new MemoryStore();
    const tools = createTools({ store, executor: new SimulatedExecutor("s"), fetchHosts: [firstL.host] });
    const task = await tools.createTask({ text: "t", budgetUsd: 1, taskType: "data-lookup" });
    await tools.declarePlan({
      taskId: task.taskId,
      plan: { goal: "g", expected: [{ category: "weather", maxUnitUsd: 0.1, maxQuantity: 1, vendorDomains: [firstL.host], tiers: ["basic"] }] },
    });

    await expect(tools.fetchUrl({ taskId: task.taskId, url: `${firstL.url}/go` })).rejects.toMatchObject({ code: "UPSTREAM_FAILED" });
    expect(hits).toBe(0);
    expect(await store.listPages(task.taskId)).toEqual([]);
  });
});

describe("default fetchPage network failures", () => {
  it("connection refused is UPSTREAM_FAILED, not a raw TypeError", async () => {
    const probe = express();
    const l = await listen(probe);
    const host = l.host;
    const url = l.url;
    await l.close();

    const tools = createTools({ store: new MemoryStore(), executor: new SimulatedExecutor("s"), fetchHosts: [host] });
    const task = await tools.createTask({ text: "t", budgetUsd: 1, taskType: "data-lookup" });
    await tools.declarePlan({
      taskId: task.taskId,
      plan: { goal: "g", expected: [{ category: "weather", maxUnitUsd: 0.1, maxQuantity: 1, vendorDomains: [host], tiers: ["basic"] }] },
    });
    await expect(tools.fetchUrl({ taskId: task.taskId, url: `${url}/x` })).rejects.toMatchObject({ code: "UPSTREAM_FAILED" });
  });
});
