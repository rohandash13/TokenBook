import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, isTainted, normalizeDomain, type Rule } from "@countersign/shared";
import { ATTACK_CORPUS, instantiateAttack, lookalikeOf, matchTier1 } from "@countersign/rules";

const NOW = 1_800_000_000_000;
const HOST = "vendor.test:4101";
const FIXED_LOOKALIKE = "vend0r.test:4101";
const rule = (over: Partial<Rule> = {}): Rule => ({
  ruleId: "cand", payee: HOST, category: "weather", capUsd: 0.1, taskType: "data-lookup",
  expiresAt: NOW + 1000, createdBy: "Sam", status: "active", ...over,
});
const byId = (id: string) => ATTACK_CORPUS.find((c) => c.caseId === id)!;

describe("attack corpus (spec §11, D31)", () => {
  it("covers every spec §11 attack expressible as a Tier 1 context, with unique ids and labels", () => {
    expect(new Set(ATTACK_CORPUS.map((c) => c.specAttack))).toEqual(
      new Set(["premium-upsell", "quantity-inflation", "purpose-drift", "lookalike-domain", "decimal-slip"]),
    );
    expect(new Set(ATTACK_CORPUS.map((c) => c.caseId)).size).toBe(ATTACK_CORPUS.length);
    for (const c of ATTACK_CORPUS) expect(c.name.length).toBeGreaterThan(10);
    expect(ATTACK_CORPUS).toHaveLength(12);
  });

  it("placeholders resolve against the candidate rule; literals stay literal", () => {
    const r = rule({ capUsd: 0.25 });
    expect(instantiateAttack(byId("atk-upsell-under-cap"), r, NOW)).toMatchObject({
      floor: "approve", payee: HOST, category: "weather", taskType: "data-lookup", amountUsd: 0.25, rules: [r], now: NOW,
    });
    expect(instantiateAttack(byId("atk-upsell-15"), r, NOW).amountUsd).toBe(15);
    expect(instantiateAttack(byId("atk-decimal-slip"), r, NOW).amountUsd).toBe(40);
    const look = instantiateAttack(byId("atk-lookalike-page"), r, NOW);
    expect(look.payee).toBe(lookalikeOf(HOST));
    expect(normalizeDomain(look.payee)).not.toBe(normalizeDomain(HOST));
    expect(instantiateAttack(byId("atk-lookalike-fixed"), r, NOW).payee).toBe(FIXED_LOOKALIKE);
  });

  const TRUSTED = ["atk-premium-trusted", "atk-decimal-slip-trusted", "atk-lookalike-fixed", "atk-never-gift-cards", "atk-never-wire-transfer"];

  it("the trusted-origin cases carry fixed concrete values (nothing derived from the rule) and no tainted field; all others are tainted", () => {
    for (const c of ATTACK_CORPUS) {
      const tainted = PAYMENT_FIELDS.some((f) => isTainted(c.context.fieldOrigins[f]));
      expect(tainted, c.caseId).toBe(!TRUSTED.includes(c.caseId));
      expect(c.why.length, c.caseId).toBeGreaterThan(10);
    }
    for (const id of TRUSTED) {
      const ctx = byId(id).context;
      for (const v of [ctx.payee, ctx.category, ctx.taskType]) expect(v.startsWith("@"), id).toBe(false);
      expect(typeof ctx.amountUsd, id).toBe("number");
    }
    expect(byId("atk-premium-trusted").context).toMatchObject({ payee: HOST, category: "weather", taskType: "data-lookup", amountUsd: 15 });
    expect(byId("atk-decimal-slip-trusted").context.amountUsd).toBe(40);
  });

  it("tainted cases never match, even for a $1,000,000 cap", () => {
    for (const c of ATTACK_CORPUS.filter((c) => !TRUSTED.includes(c.caseId))) {
      expect(matchTier1(instantiateAttack(c, rule({ capUsd: 1_000_000 }), NOW)), c.caseId).toBeUndefined();
    }
  });

  it("a legitimate narrow rule matches no case; broad rules match the trusted ones they should", () => {
    for (const c of ATTACK_CORPUS) expect(matchTier1(instantiateAttack(c, rule({ capUsd: 0.2 }), NOW)), c.caseId).toBeUndefined();
    const hits = (r: Rule) => ATTACK_CORPUS.filter((c) => matchTier1(instantiateAttack(c, r, NOW))).map((c) => c.caseId);
    expect(hits(rule({ capUsd: 20 }))).toEqual(["atk-premium-trusted"]);
    expect(hits(rule({ capUsd: 40 }))).toEqual(["atk-premium-trusted", "atk-decimal-slip-trusted"]);
    expect(hits(rule({ payee: FIXED_LOOKALIKE }))).toEqual(["atk-lookalike-fixed"]);
    expect(hits(rule({ category: "gift-cards", capUsd: 1 }))).toEqual(["atk-never-gift-cards"]);
    expect(hits(rule({ category: "wire-transfer", capUsd: 1 }))).toEqual(["atk-never-wire-transfer"]);
  });
});
