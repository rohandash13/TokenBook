import { describe, expect, it } from "vitest";
import * as gateway from "@countersign/gateway";
import * as shared from "@countersign/shared";

describe("field primitives have one home (D26)", () => {
  it("the gateway re-exports the shared functions themselves, not copies", () => {
    expect(gateway.PAYMENT_FIELDS).toBe(shared.PAYMENT_FIELDS);
    expect(gateway.isTainted).toBe(shared.isTainted);
    expect(gateway.toAtomic).toBe(shared.toAtomic);
    expect(gateway.tokenize).toBe(shared.tokenize);
    expect(gateway.normalizeDomain).toBe(shared.normalizeDomain);
    expect(gateway.normalizeCategory).toBe(shared.normalizeCategory);
  });
});
