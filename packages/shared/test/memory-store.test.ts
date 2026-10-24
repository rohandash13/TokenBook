import { describe, expect, it } from "vitest";
import { MemoryStore, type Plan } from "@countersign/shared";

const plan = (taskId: string, goal = "g"): Plan => ({
  taskId,
  goal,
  expected: [{ category: "weather", maxUnitUsd: 0.1, maxQuantity: 2, vendorDomains: ["v"], tiers: ["basic"] }],
  declaredAt: 1,
});

describe("MemoryStore", () => {
  it("clock is strictly increasing even within one millisecond", () => {
    const s = new MemoryStore();
    const ts = Array.from({ length: 50 }, () => s.now());
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
  });

  it("insertPlan succeeds once per task and never overwrites", async () => {
    const s = new MemoryStore();
    expect(await s.insertPlan(plan("t1", "first"))).toBe(true);
    expect(await s.insertPlan(plan("t1", "second"))).toBe(false);
    expect((await s.getPlan("t1"))!.goal).toBe("first");
  });

  it("returns copies, so callers cannot mutate stored records", async () => {
    const s = new MemoryStore();
    await s.insertPlan(plan("t1"));
    (await s.getPlan("t1"))!.goal = "mutated";
    expect((await s.getPlan("t1"))!.goal).toBe("g");
  });

  it("lists pages and quotes per task", async () => {
    const s = new MemoryStore();
    await s.putPage({ pageId: "p1", taskId: "a", url: "u", lines: ["x"], fetchedAt: 1 });
    await s.putPage({ pageId: "p2", taskId: "b", url: "u", lines: ["y"], fetchedAt: 2 });
    expect((await s.listPages("a")).map((p) => p.pageId)).toEqual(["p1"]);
    expect(await s.listQuotes("a")).toEqual([]);
  });
});
