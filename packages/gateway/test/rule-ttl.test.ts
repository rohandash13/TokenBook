import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_TTL_MS, MAX_RULE_TTL_MS } from "@countersign/rules";
import { ruleTtlFromEnv } from "@countersign/gateway";

describe("RULE_TTL_MS (D29)", () => {
  it("unset or blank -> 7 days; a positive integer -> that many ms", () => {
    expect(ruleTtlFromEnv({})).toBe(DEFAULT_RULE_TTL_MS);
    expect(ruleTtlFromEnv({ RULE_TTL_MS: " " })).toBe(DEFAULT_RULE_TTL_MS);
    expect(ruleTtlFromEnv({ RULE_TTL_MS: "3600000" })).toBe(3_600_000);
  });

  it("anything else is a startup error, never a silent default", () => {
    for (const v of ["0", "-5", "1.5", "abc", "1e400"]) expect(() => ruleTtlFromEnv({ RULE_TTL_MS: v }), v).toThrow();
  });

  it("a value above MAX_RULE_TTL_MS (365 days) is a startup error: proposeRule would reject it after money moved", () => {
    expect(ruleTtlFromEnv({ RULE_TTL_MS: String(MAX_RULE_TTL_MS) })).toBe(MAX_RULE_TTL_MS);
    expect(() => ruleTtlFromEnv({ RULE_TTL_MS: String(MAX_RULE_TTL_MS + 1) })).toThrow(/365 days/);
  });
});
