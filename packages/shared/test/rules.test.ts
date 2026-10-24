import { describe, expect, it } from "vitest";
import { MemoryStore, type Rule } from "@countersign/shared";

const rule = (status: Rule["status"]): Rule => ({
  ruleId: "r1",
  payee: "vendor.test:4101",
  category: "weather",
  capUsd: 1,
  taskType: "data-lookup",
  expiresAt: 2_000_000_000_000,
  createdBy: "test",
  status,
});

describe("MemoryStore rules", () => {
  it("putRule upserts by ruleId and listRules returns them", async () => {
    const s = new MemoryStore();
    await s.putRule(rule("proposed"));
    await s.putRule(rule("active"));
    await s.putRule({ ...rule("active"), ruleId: "r2" });
    const rules = await s.listRules();
    expect(rules.map((r) => [r.ruleId, r.status])).toEqual([["r1", "active"], ["r2", "active"]]);
  });

  it("returns copies", async () => {
    const s = new MemoryStore();
    await s.putRule(rule("active"));
    (await s.listRules())[0].capUsd = 999;
    expect((await s.listRules())[0].capUsd).toBe(1);
  });
});
