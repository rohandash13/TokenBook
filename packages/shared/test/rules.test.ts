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

  it("updateRule is compare-and-set on status", async () => {
    const s = new MemoryStore();
    await s.putRule(rule("proposed"));
    expect(await s.updateRule("r1", "active", { status: "rejected" })).toBeUndefined();
    expect((await s.listRules())[0].status).toBe("proposed");
    const won = await s.updateRule("r1", "proposed", { status: "active", resolvedBy: "Sam", capUsd: 0.5 });
    expect(won).toMatchObject({ ruleId: "r1", status: "active", resolvedBy: "Sam", capUsd: 0.5 });
    expect(await s.updateRule("r1", "proposed", { status: "rejected" })).toBeUndefined();
    expect((await s.listRules())[0]).toMatchObject({ status: "active", capUsd: 0.5 });
    expect(await s.updateRule("nope", "proposed", { status: "active" })).toBeUndefined();
  });

  it("updateRule can patch without changing status (proposed -> proposed)", async () => {
    const s = new MemoryStore();
    await s.putRule(rule("proposed"));
    const r = await s.updateRule("r1", "proposed", { replayResult: { summary: "x" } as never });
    expect(r).toMatchObject({ status: "proposed", replayResult: { summary: "x" } });
  });

  it("updateRule never changes ruleId", async () => {
    const s = new MemoryStore();
    await s.putRule(rule("proposed"));
    await s.updateRule("r1", "proposed", { status: "active", ruleId: "evil" } as Partial<Rule>);
    expect((await s.listRules()).map((r) => [r.ruleId, r.status])).toEqual([["r1", "active"]]);
  });

  it("updateRule clones the patch and the result", async () => {
    const s = new MemoryStore();
    await s.putRule(rule("proposed"));
    const patch = { replayResult: { summary: "a" } as never } as Partial<Rule>;
    const out = await s.updateRule("r1", "proposed", patch);
    (patch.replayResult as unknown as { summary: string }).summary = "mutated";
    out!.capUsd = 999;
    const stored = (await s.listRules())[0];
    expect(stored.capUsd).toBe(1);
    expect((stored.replayResult as unknown as { summary: string }).summary).toBe("a");
  });
});
