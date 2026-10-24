import { expect, it } from "vitest";
import { MemoryStore } from "@countersign/shared";
import { createPayeeChecker } from "@countersign/gateway";
it("checks a new vendor once and clearly labels approved-list fallback", async () => {
  const s = new MemoryStore();
  const check = createPayeeChecker(s, ["arena.test"]);
  const rs = await Promise.all([check("arena.test"), check("arena.test")]);
  expect(rs[0]).toMatchObject({ crsStatus: "approved_vendor", domain: "arena.test", checkNote: expect.stringContaining("No CRS pull") });
  expect(await s.listPayees()).toHaveLength(1);
  expect((await check("unknown.test")).crsStatus).toBe("failed");
  await s.recordDelivery("arena.test", true);
  expect((await check("arena.test")).deliveryFailures).toBe(1);
});
