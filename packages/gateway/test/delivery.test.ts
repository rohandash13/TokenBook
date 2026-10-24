import { describe, expect, it } from "vitest";
import { checkDelivery, computeMetrics } from "@countersign/gateway";
import { MemoryStore } from "@countersign/shared";
const check = (data: unknown, paidAtomic = "100000") => checkDelivery({ data, url: "http://arena.test/api/weather", quotedAtomic: "100000", paidAtomic });
describe("delivery and metrics", () => {
  it("distinguishes empty, wrong schema, wrong payment amount and correct delivery", () => {
    for (const data of [null, undefined, {}, [], ""]) expect(check(data).status).toBe("empty");
    expect(check({ wrong: true }).status).toBe("bad_format");
    const good = { city: "Berkeley", tier: "basic", tempC: 18, conditions: "fog" };
    expect(check(good).status).toBe("ok");
    expect(check(good, "200000")).toMatchObject({ status: "bad_format", amountMismatch: true });
    expect(checkDelivery({ data: good, url: "http://arena.test/api/weather", quotedAtomic: "100000" }).status).toBe("unknown");
  });
  it("empty metrics have unknown rates and no fabricated activity", async () => {
    expect(await computeMetrics(new MemoryStore())).toMatchObject({ paymentCount: 0, autonomyRate: null, avgTier1LatencyMs: null, totalCostUsd: 0, moneySavedUsd: 0 });
  });
});
