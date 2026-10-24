import { expect, it } from "vitest";
import { idempotencyKey } from "@countersign/gateway";
it("payment identity ignores untrusted purpose and changes with charged fields", () => {
  const req = { url: "http://arena.test/api/report", payeeDomain: "arena.test", amountUsd: 5, tier: "basic", quantity: 1, purpose: "first" };
  const key = idempotencyKey("t", req.payeeDomain, req);
  expect(idempotencyKey("t", req.payeeDomain, { ...req, purpose: "changed" })).toBe(key);
  for (const over of [{ url: req.url + "?city=A" }, { amountUsd: 6 }, { tier: "premium" }, { quantity: 2 }]) expect(idempotencyKey("t", req.payeeDomain, { ...req, ...over })).not.toBe(key);
});
