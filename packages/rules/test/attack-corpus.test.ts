import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, isTainted, normalizeDomain, type Rule } from "@countersign/shared";
import { ATTACK_CORPUS, instantiateAttack, lookalikeOf, matchTier1 } from "@countersign/rules";

const NOW = 1_800_000_000_000;
const HOST = "127.0.0.1:4101";
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
    expect(ATTACK_CORPUS).toHaveLength(8);
  });

  it("placeholders resolve against the candidate rule; literals stay literal", () => {
    const r = rule({ capUsd: 0.25 });
    expect(instantiateAttack(byId("atk-upsell-under-cap"), r, NOW)).toMatchObject({
      floor: "approve", payee: HOST, category: "weather", taskType: "data-lookup", amountUsd: 0.25, rules: [r], now: NOW,
    });
    expect(instantiateAttack(byId("atk-upsell-15"), r, NOW).amountUsd).toBe(15);
    expect(instantiateAttack(byId("atk-decimal-slip"), r, NOW).amountUsd).toBe(40);
    const look = instantiateAttack(byId("atk-lookalike-trusted"), r, NOW);
    expect(look.payee).toBe(lookalikeOf(HOST));
    expect(normalizeDomain(look.payee)).not.toBe(normalizeDomain(HOST));
  });

  it("every case but the trusted-origin lookalike carries a tainted field; that one differs by payee", () => {
    for (const c of ATTACK_CORPUS) {
      const tainted = PAYMENT_FIELDS.some((f) => isTainted(c.context.fieldOrigins[f]));
      expect(tainted, c.caseId).toBe(c.caseId !== "atk-lookalike-trusted");
    }
  });

  it("no case is matched by a rule copied from a legit purchase, even with a $1,000,000 cap", () => {
    for (const capUsd of [0.1, 15, 1_000_000]) {
      for (const c of ATTACK_CORPUS) {
        expect(matchTier1(instantiateAttack(c, rule({ capUsd }), NOW)), `${c.caseId} cap ${capUsd}`).toBeUndefined();
      }
    }
  });
});
