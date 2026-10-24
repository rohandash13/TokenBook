# Countersign Milestone 3 (Hold Queue + Rule Chips + Replay + Activation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every HOLD into a routed hold an approver can resolve. Approving a hold pays the held request (simulated) and proposes a narrow Tier 1 rule; replay checks the rule against every stored decision and a labelled attack corpus; activation refuses a rule that would auto-approve a known-bad decision or an attack. Spec acceptance (§13 row 3): approving a hold creates a proposed rule; replay reports counts; the next similar purchase is Tier 1 in ms at $0.

**Architecture:** New pure package `packages/rules` (depends only on `@countersign/shared` + zod) owns the Tier 1 matcher, rule proposal, narrowing, approver routing, the attack corpus and replay. The gateway's `runTier1` becomes a timing wrapper around `matchTier1`, so live Tier 1 and replay run the same code (D26). The field primitives the matcher needs (`toAtomic`, `tokenize`, `normalizeDomain`, `normalizeCategory`, `PAYMENT_FIELDS`, `isTainted`) move to `@countersign/shared`; the gateway re-exports them unchanged. `pay_and_fetch` opens one `Hold` per held verdict (routed by `config/approvers.json`). New gateway module `holds.ts` serves the worker tool `get_hold` and the operator API (`/admin/holds`, `/admin/rules`). The worker loop polls `get_hold` while a payment is held and hands the resolution to the model.

**Tech Stack:** unchanged. Node ≥20.12, pnpm 9.15.0, TypeScript, tsx, vitest, Express 5, zod 3.

**Inputs:** M2 plan `docs/superpowers/plans/2026-10-24-countersign-m2.md` (all M2 code is assumed present as written there, merged with the review fixes already in the repo), spec `docs/SPEC.md` §5, §9, §11, §13, and the M3 design notes (binding).

## Global Constraints

- Testnet only: `X402_NETWORK=base-sepolia`. No real money, no real third-party services.
- `fetch_url`, `pay_and_fetch` and an approved hold's payment may only reach hosts we host (arena), listed in `config/allowlist.json`.
- Never commit secrets. `.env*` is gitignored except `.env.example`, which holds names only.
- Model IDs come from env vars (`JUDGE_MODEL`, `ATTACKER_MODEL`, `WORKER_MODEL`), never hardcoded. Tests use obviously fake ids such as `test-judge-model`.
- No invented prices or numbers. Replay counts and the `summary` string come only from a real replay run. The attack corpus is hand-written and labelled; it carries no statistics.
- Invariants 1, 2 and 4 tests stay green and unchanged. M2's INV3 tests stay green and unchanged.
- Invariant 3 everywhere: no rule, proposal or replay path may ever auto-approve a field with origin `PAGE`, `UNKNOWN` or missing. A tainted held decision never proposes a rule (a human may still approve it once). The Tier 1 matcher refuses any tainted context before looking at a rule.
- Fail closed: get_hold on anything the task does not own → 404; still open after the wait → the worker sees the original held result; executor failure after a human approval → no data, logged as `executor_failure`; replay finds a known-bad or attack match → activation refused.
- Nothing lowers a verdict automatically (D4). Only a human approval turns a HOLD into a payment, and it is logged in the hash chain.
- Anything simulated is labelled `simulated` in API responses, logs and README.
- `MemoryStore` returns clones; never rely on mutating a returned record.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Shell: Git Bash on Windows. Run all commands from the repo root `C:\Users\rohid\Countersign`. Text files are LF (D14).

## New decisions made by this plan (added to `DECISIONS.md` in Task 8)

- **D26** `packages/rules` owns the Tier 1 matcher (`tier1Eligible`, `ruleMatches`, `matchTier1`), proposal, narrowing, routing and replay; it depends only on `@countersign/shared`. The primitives the matcher needs move to `@countersign/shared/src/fields.ts`; the gateway re-exports them. Gateway → rules → shared, no cycle. Gateway `runTier1` wraps `matchTier1`, so live Tier 1 and replay are one code path.
- **D27** One hold per held verdict decision, routed by `config/approvers.json` (first matching route; `category` normalized, `amountUsd <= maxUsd`; else `default`). The hold stores the exact `PaymentRequest` and the `quoteId`, so an approval pays the stored quote (re-parsed with `parseQuote`) with the same idempotency key M2 computed. Block never creates a hold.
- **D28** Human resolutions are logged in the hash chain: `kind: "human_approval"` (verdict approve, tier null, same `paymentRequestId`, `linkedDecisionId` = held decision) and `kind: "human_rejection"` (verdict block). Budget remaining counts human approvals whose payment did not fail (D23 extended). Approval claims the hold with a compare-and-set (`updateHold(holdId, "open", …)`) before paying, so a double click cannot pay twice. Cross-hold budget races remain M4 (reservations).
- **D29** Proposals are narrow by default: this payee, this category, this task type, cap = the approved amount, expiry = `RULE_TTL_MS` (default 7 days). No proposal when any payment field of the held decision is tainted or the category is unknown ("one-off approval only"). Narrowing may only lower the cap (> 0) and pull the expiry in (> now); any other change → 400. A payment that failed after approval still proposes a rule: the rule records the human's judgment, not the vendor's uptime.
- **D30** Replay semantics: cases = every `kind: "verdict"` decision, re-run through `matchTier1` with its recorded origins, payee, category, amount, its task's task type and its recorded floor (approve iff `floorReasons` is empty), at the replay time. The candidate is evaluated as if active. Known-bad = decisions whose hold a human rejected + verdict decisions with verdict block. `knownBadMatched` and `attacksMatched` count matches by the candidate alone; `wouldAutoApprove` uses candidate + existing active rules; `newlyAutoApproved` = approved only because of the candidate. `casesChecked` = decisions checked + attack cases checked. Activation re-runs replay and refuses (409 `REPLAY_FAILED`, report in `error.details.replay`) if either list is non-empty; the failing report is stored on the still-proposed rule.
- **D31** Attack corpus cases are templates instantiated against the candidate rule (`@rule` payee/category/task type, `@cap` amount, `@lookalike` payee) with an approve floor, so every attack is tried at the rule's own vendor, under its cap, with only Tier 1 in the way (the "moment" setup). Duplicate purchase is not in the M3 corpus: in a Tier 1 context it is indistinguishable from a legitimate repeat and is caught by the M4 duplicate check; it joins the corpus in M4.
- **D32** `Decision.latencyMs` measures Countersign's decision (trace, floors, Tier 1/Tier 2), starting after the vendor quote is stored. The quote round-trip is the vendor's latency, not the gate's.
- **D33** The worker waits on holds: when `pay_and_fetch` returns `held`, the loop polls `POST /tools/get_hold { taskId, decisionId }` every `pollMs` (default 1000) up to `waitMs` (default 120000) and returns the resolution (`approved` with data, `approved` with "payment failed: …", or `rejected`) as that tool's result. Still open, a non-200 or a thrown call → the original held result. `get_hold` answers 404 `HOLD_NOT_FOUND` unless the task owns a held decision (no existence leak). While an approved hold's payment is in flight, `get_hold` reports `open`.
- **D34** `/admin/holds` and `/admin/rules` are unauthenticated like `/admin/tasks` (D13). The approver is the name in the request body; routing decides whose queue a hold appears in, it does not authenticate.

## File Structure

```
config/approvers.json                     NEW  routes + default approver (D27)
.env.example                              MOD  + RULE_TTL_MS
package.json                              MOD  + @countersign/rules devDependency

packages/shared/src/
  fields.ts                               NEW  PAYMENT_FIELDS, isTainted, toAtomic, tokenize, normalizeDomain, normalizeCategory (D26)
  types.ts                                MOD  + Hold, HoldStatus, HoldPayment, HoldPatch, ReplayResult; Rule/Decision/DecisionKind extended
  store.ts                                MOD  + putHold, getHold, getHoldByDecision, listHolds, updateHold
  memory-store.ts                         MOD  holds
  index.ts                                MOD
packages/shared/test/fields.test.ts, holds.test.ts                           NEW

packages/rules/                           NEW  package (spec §15 layout)
  package.json
  src/match.ts                            Tier1Input, tier1Eligible, ruleMatches, matchTier1
  src/propose.ts                          DEFAULT_RULE_TTL_MS, proposeRule, narrowRule, NarrowError
  src/routing.ts                          ApproverConfigSchema, parseApprovers, routeHold, DEFAULT_APPROVER_CONFIG
  src/attack-corpus.ts                    ATTACK_CORPUS, instantiateAttack, lookalikeOf
  src/replay.ts                           replayRule, replayPassed, decisionTier1Input, ReplayContext
  src/index.ts
  test/match.test.ts, propose.test.ts, routing.test.ts, attack-corpus.test.ts, replay.test.ts

packages/gateway/
  package.json                            MOD  + @countersign/rules
  src/normalize.ts                        MOD  four primitives re-exported from shared
  src/tracer.ts                           MOD  PAYMENT_FIELDS/isTainted re-exported from shared
  src/tier1.ts                            MOD  delegates to @countersign/rules
  src/floors.ts                           MOD  budget counts human approvals
  src/common.ts                           NEW  ToolError (+details), ToolErrorCode, idempotencyKey, EXECUTOR_FAILED_PREFIX, parseInput
  src/holds.ts                            NEW  get_hold, hold queue, approve/reject, rules list/activate/reject
  src/tools.ts                            MOD  opens holds; spreads hold tools; latency start (D32)
  src/server.ts                           MOD  new routes, status codes, error details
  src/main.ts                             MOD  approvers + RULE_TTL_MS
  src/index.ts                            MOD
  test/shared-fields.test.ts, tier1-rules.test.ts, m3-gateway-unit.test.ts, rule-ttl.test.ts   NEW

packages/worker/src/gateway-client.ts     MOD  + getHold
packages/worker/src/loop.ts               MOD  waitForHold, runWorker poll options
packages/worker/test/hold-wait.test.ts    NEW
packages/worker/test/loop.test.ts         MOD  fake client gains getHold; pay test uses waitMs 0

tests/helpers/stack.ts                    MOD  approvers/ruleTtlMs/attackCorpus options, getJson, weatherReq, TEST_APPROVERS
tests/m3-holds.test.ts                    NEW
tests/m3-admin.test.ts                    NEW
tests/m3-acceptance.test.ts               NEW  spec §13 row 3
tests/invariants/inv3-rules.test.ts       NEW
DECISIONS.md, README.md                   MOD
```

---

## IMPORTANT: the repo has diverged from the M1 and M2 plans' code (review fixes). The repo is the source of truth.

When this plan shows "old" code from the M2 plan or replaces a whole file, merge the change into the ACTUAL file and preserve every fix already there:
- All M1 fixes listed in the M2 plan header (loopback binding with `GATEWAY_HOST`, `redirect: "manual"` everywhere, strict `parseQuote`, the JSON error middleware in `server.ts`, worker net guard, `exhausted: true`, `Object.hasOwn` price lookups).
- M2 review fixes already committed (for example the stricter money/number regexes and host-token matching in `packages/gateway/src/normalize.ts`, canonical `qty` handling in the arena). Edits in this plan touch only the named blocks; leave everything else as it is.
- If an "old" block in an edit step does not match the actual file character for character, apply the same change to the equivalent code and say so in the task report.
- DECISIONS.md already has D1–D25. This plan's decisions are D26–D34.
- Test counts in this plan are approximate given extra review tests; judge by "all pass".
- If merging is ambiguous in a way that could weaken an invariant, STOP and report NEEDS_CONTEXT.

---

### Task 1: Shared field primitives, hold and replay types, Store hold methods

**Files:**
- Create: `packages/shared/src/fields.ts`
- Modify: `packages/shared/src/types.ts`, `packages/shared/src/store.ts`, `packages/shared/src/memory-store.ts`, `packages/shared/src/index.ts`, `packages/gateway/src/normalize.ts`, `packages/gateway/src/tracer.ts`
- Test: `packages/shared/test/fields.test.ts`, `packages/shared/test/holds.test.ts`, `packages/gateway/test/shared-fields.test.ts`

**Interfaces:**
- Consumes: M2 `Origin`, `PaymentField`, `PaymentRequest`, `Rule`, `Decision`, `DecisionKind`, `Store`, `MemoryStore`, `hashDecision`, `verifyChain`; gateway `normalize.ts` and `tracer.ts` as committed.
- Produces:
  - `fields.ts` (exported from `@countersign/shared`): `PAYMENT_FIELDS: PaymentField[]`, `isTainted(o: Origin | undefined): boolean`, `toAtomic(usd: number): number`, `tokenize(s: string): string[]`, `normalizeDomain(s: string): string`, `normalizeCategory(s: string): string` — bodies identical to M2's gateway versions. The gateway keeps exporting the same six names (re-exports; identical function objects).
  - Types: `ReplayResult { ranAt: number; decisionsChecked: number; attacksChecked: number; casesChecked: number; wouldAutoApprove: number; newlyAutoApproved: number; knownBadMatched: Array<{ decisionId: string; why: string }>; attacksMatched: Array<{ caseId: string; name: string }>; summary: string }`; `Rule` gains optional `replayResult?: ReplayResult; sourceHoldId?: string; resolvedBy?: string; resolvedAt?: number`; `DecisionKind = "verdict" | "executor_failure" | "human_approval" | "human_rejection"`; `Decision` gains `linkedDecisionId?: string`; `HoldStatus = "open" | "approved" | "rejected"`; `HoldPayment { status: "settled" | "failed"; reason: string; data?: unknown; decisionId: string }`; `Hold { holdId; decisionId; taskId; routedTo; status: HoldStatus; req: PaymentRequest; quoteId: string; createdAt: number; resolvedAt?; resolvedBy?; resolutionDecisionId?; payment?: HoldPayment; proposedRuleId? }`; `HoldPatch = Partial<Omit<Hold, "holdId" | "decisionId" | "taskId">>`.
  - `Store` gains: `putHold(hold: Hold): Promise<void>` (throws if the holdId or decisionId already has a hold), `getHold(holdId: string): Promise<Hold | undefined>`, `getHoldByDecision(decisionId: string): Promise<Hold | undefined>`, `listHolds(filter?: { status?: HoldStatus }): Promise<Hold[]>` (insertion order), `updateHold(holdId: string, from: HoldStatus, patch: HoldPatch): Promise<Hold | undefined>` (compare-and-set on status; undefined if missing or status ≠ `from`; identity fields never change).

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/fields.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, isTainted, normalizeCategory, normalizeDomain, toAtomic, tokenize } from "@countersign/shared";

describe("shared field primitives (D26)", () => {
  it("PAYMENT_FIELDS lists the five traced fields in order", () => {
    expect(PAYMENT_FIELDS).toEqual(["payee", "amount", "tier", "quantity", "category"]);
  });

  it("isTainted: PAGE, UNKNOWN and missing are taint; TASK, PLAN, QUOTE are not", () => {
    expect(isTainted("PAGE")).toBe(true);
    expect(isTainted("UNKNOWN")).toBe(true);
    expect(isTainted(undefined)).toBe(true);
    expect(isTainted("TASK")).toBe(false);
    expect(isTainted("PLAN")).toBe(false);
    expect(isTainted("QUOTE")).toBe(false);
  });

  it("normalizers behave exactly as the M2 gateway versions", () => {
    expect(normalizeDomain("https://www.Vendor.TEST:4101/docs?x=1")).toBe("vendor.test:4101");
    expect(normalizeDomain("WWW.weatherco.test.")).toBe("weatherco.test");
    expect(normalizeCategory(" Crypto Prices ")).toBe("crypto-prices");
    expect(tokenize("Premium-Tier, x2")).toEqual(["premium", "tier", "x2"]);
    expect(toAtomic(0.1 * 3)).toBe(300000);
  });
});
```

`packages/shared/test/holds.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MemoryStore, verifyChain, type DecisionDraft, type Hold } from "@countersign/shared";

const hold = (over: Partial<Hold> = {}): Hold => ({
  holdId: "h1",
  decisionId: "d1",
  taskId: "t1",
  routedTo: "Sam",
  status: "open",
  req: { url: "http://v.test/api/weather?tier=basic", payeeDomain: "v.test", amountUsd: 0.1, tier: "basic", quantity: 1, purpose: "p" },
  quoteId: "q1",
  createdAt: 1,
  ...over,
});

describe("MemoryStore holds", () => {
  it("putHold, getHold and getHoldByDecision", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    expect(await s.getHold("h1")).toEqual(hold());
    expect(await s.getHoldByDecision("d1")).toEqual(hold());
    expect(await s.getHold("nope")).toBeUndefined();
    expect(await s.getHoldByDecision("nope")).toBeUndefined();
  });

  it("one hold per holdId and per decision", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    await expect(s.putHold(hold({ decisionId: "d2" }))).rejects.toThrow();
    await expect(s.putHold(hold({ holdId: "h2" }))).rejects.toThrow();
    expect(await s.listHolds()).toHaveLength(1);
  });

  it("listHolds filters by status, in insertion order", async () => {
    const s = new MemoryStore();
    await s.putHold(hold({ holdId: "a", decisionId: "da" }));
    await s.putHold(hold({ holdId: "b", decisionId: "db", status: "rejected" }));
    await s.putHold(hold({ holdId: "c", decisionId: "dc" }));
    expect((await s.listHolds()).map((h) => h.holdId)).toEqual(["a", "b", "c"]);
    expect((await s.listHolds({ status: "open" })).map((h) => h.holdId)).toEqual(["a", "c"]);
    expect((await s.listHolds({ status: "rejected" })).map((h) => h.holdId)).toEqual(["b"]);
    expect(await s.listHolds({ status: "approved" })).toEqual([]);
  });

  it("updateHold is compare-and-set on status", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    const claimed = await s.updateHold("h1", "open", { status: "approved", resolvedBy: "Sam", resolvedAt: 5 });
    expect(claimed).toMatchObject({ holdId: "h1", status: "approved", resolvedBy: "Sam", resolvedAt: 5 });
    expect(await s.updateHold("h1", "open", { status: "rejected" })).toBeUndefined();
    expect((await s.getHold("h1"))!.status).toBe("approved");
    expect(await s.updateHold("h1", "approved", { proposedRuleId: "r1" })).toMatchObject({ status: "approved", proposedRuleId: "r1" });
    expect(await s.updateHold("nope", "open", { status: "approved" })).toBeUndefined();
  });

  it("updateHold never changes holdId, decisionId or taskId", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    const sneaky = { status: "approved", holdId: "x", decisionId: "y", taskId: "z" } as unknown as Partial<Hold>;
    await s.updateHold("h1", "open", sneaky);
    expect(await s.getHold("h1")).toMatchObject({ holdId: "h1", decisionId: "d1", taskId: "t1", status: "approved" });
    expect(await s.getHold("x")).toBeUndefined();
  });

  it("returns copies", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    (await s.getHold("h1"))!.req.amountUsd = 999;
    (await s.listHolds())[0].status = "rejected";
    expect(await s.getHold("h1")).toEqual(hold());
  });

  it("human decisions chain like any other decision (D28)", async () => {
    const s = new MemoryStore();
    const base: DecisionDraft = {
      decisionId: "d1", paymentRequestId: "p1", taskId: "t1", kind: "verdict", tier: 2, verdict: "hold",
      fieldOrigins: {}, evidence: {}, amountUsd: 0.1, payeeDomain: "v.test", category: "weather", floorReasons: [],
      reasons: ["judge: hold"], latencyMs: 1, costUsd: null, createdAt: 1,
    };
    await s.appendDecision(base);
    await s.appendDecision({ ...base, decisionId: "d2", kind: "human_approval", tier: null, verdict: "approve", linkedDecisionId: "d1", reasons: ["approved by Sam"], costUsd: 0, createdAt: 2 });
    await s.appendDecision({ ...base, decisionId: "d3", kind: "human_rejection", tier: null, verdict: "block", linkedDecisionId: "d1", reasons: ["rejected by Sam"], costUsd: 0, createdAt: 3 });
    const log = await s.listDecisions();
    expect(log.map((d) => d.kind)).toEqual(["verdict", "human_approval", "human_rejection"]);
    expect(log[1].linkedDecisionId).toBe("d1");
    expect(verifyChain(log)).toEqual({ ok: true });
  });
});
```

`packages/gateway/test/shared-fields.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/shared packages/gateway/test/shared-fields.test.ts`
Expected: FAIL. `fields.test.ts`: `PAYMENT_FIELDS` is undefined; `holds.test.ts`: `s.putHold is not a function`; `shared-fields.test.ts`: `expected [Function toAtomic] to be undefined`. The M1/M2 shared tests still pass.

- [ ] **Step 3: Write `packages/shared/src/fields.ts`**

```ts
import type { Origin, PaymentField } from "./types";

/**
 * D26: primitives shared by the gateway (tracer, floors) and packages/rules (Tier 1 matcher, replay).
 * Pure, no I/O. Moved here verbatim from the M2 gateway so both sides use the same functions.
 */
export const PAYMENT_FIELDS: PaymentField[] = ["payee", "amount", "tier", "quantity", "category"];

/** PAGE and UNKNOWN are taint; a missing origin is treated as UNKNOWN (fail closed). */
export function isTainted(o: Origin | undefined): boolean {
  return o === undefined || o === "PAGE" || o === "UNKNOWN";
}

/** USD -> 6-decimal integer units (USDC atomic). All amount comparisons go through this. */
export function toAtomic(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** "https://www.Vendor.test:4101/docs" -> "vendor.test:4101". Port kept: arena hosts differ only by port. */
export function normalizeDomain(s: string): string {
  let t = s.trim().toLowerCase();
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  t = t.split(/[/?#]/)[0];
  t = t.replace(/^www\./, "");
  t = t.replace(/\.$/, "");
  return t;
}

/** " Crypto Prices " -> "crypto-prices". */
export function normalizeCategory(s: string): string {
  return tokenize(s).join("-");
}
```
If the committed gateway versions of these four functions differ from M2's text (review fixes), copy the committed bodies here instead, so behavior does not change.

- [ ] **Step 4: Extend `packages/shared/src/types.ts`** (four edits)

Edit A. Replace:
```ts
/** Tier 1 rule. expiresAt is epoch ms (D19). Proposal/approval flow is M3. */
export interface Rule {
  ruleId: string;
  payee: string;
  category: string;
  capUsd: number;
  taskType: string;
  expiresAt: number;
  createdBy: string;
  status: RuleStatus;
}
```
with:
```ts
/** What replay found for a candidate rule (spec §9, D30). Every count comes from a real run. */
export interface ReplayResult {
  ranAt: number;
  decisionsChecked: number;
  attacksChecked: number;
  casesChecked: number; // decisionsChecked + attacksChecked
  wouldAutoApprove: number;
  newlyAutoApproved: number;
  knownBadMatched: Array<{ decisionId: string; why: string }>;
  attacksMatched: Array<{ caseId: string; name: string }>;
  summary: string; // "N cases, M attacks matched, K known-bad matched"
}

/** Tier 1 rule. expiresAt is epoch ms (D19). Proposed from an approved hold, activated after replay (M3). */
export interface Rule {
  ruleId: string;
  payee: string;
  category: string;
  capUsd: number;
  taskType: string;
  expiresAt: number;
  createdBy: string;
  status: RuleStatus;
  replayResult?: ReplayResult;
  sourceHoldId?: string;
  resolvedBy?: string; // who activated or rejected it
  resolvedAt?: number;
}
```

Edit B. Replace:
```ts
/** "verdict" = the decision for a payment request; "executor_failure" = follow-up block after a failed pay (D23). */
export type DecisionKind = "verdict" | "executor_failure";
```
with:
```ts
/**
 * "verdict" = the decision for a payment request; "executor_failure" = follow-up block after a failed pay (D23);
 * "human_approval" / "human_rejection" = an approver resolved a hold (D28).
 */
export type DecisionKind = "verdict" | "executor_failure" | "human_approval" | "human_rejection";
```

Edit C. In `interface Decision`, replace:
```ts
  ruleId?: string;
  fieldOrigins: Partial<Record<PaymentField, Origin>>;
```
with:
```ts
  ruleId?: string;
  linkedDecisionId?: string; // human decisions and their executor failures: the decision they resolve (D28)
  fieldOrigins: Partial<Record<PaymentField, Origin>>;
```

Edit D. Append at the end of the file:
```ts
export type HoldStatus = "open" | "approved" | "rejected";

/** Result of executing an approved hold. decisionId = the human_approval (settled) or executor_failure (failed) decision. */
export interface HoldPayment {
  status: "settled" | "failed";
  reason: string;
  data?: unknown;
  decisionId: string;
}

/** One per held verdict decision (D27). */
export interface Hold {
  holdId: string;
  decisionId: string;
  taskId: string;
  routedTo: string;
  status: HoldStatus;
  /** The exact request, so an approval pays with the same idempotency key as the original attempt. */
  req: PaymentRequest;
  /** The stored quote the approval pays against. */
  quoteId: string;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  resolutionDecisionId?: string;
  payment?: HoldPayment;
  proposedRuleId?: string;
}

/** Fields an update may change. holdId, decisionId and taskId never change. */
export type HoldPatch = Partial<Omit<Hold, "holdId" | "decisionId" | "taskId">>;
```

- [ ] **Step 5: Extend `packages/shared/src/store.ts`** (two edits)

Replace:
```ts
import type { Decision, DecisionDraft, Page, Plan, Quote, Rule, Task } from "./types";
```
with:
```ts
import type { Decision, DecisionDraft, Hold, HoldPatch, HoldStatus, Page, Plan, Quote, Rule, Task } from "./types";
```
Replace:
```ts
  putRule(rule: Rule): Promise<void>;
  listRules(): Promise<Rule[]>;
}
```
with:
```ts
  putRule(rule: Rule): Promise<void>;
  listRules(): Promise<Rule[]>;
  /** Insert. Throws if this holdId or decisionId already has a hold (one hold per held decision, D27). */
  putHold(hold: Hold): Promise<void>;
  getHold(holdId: string): Promise<Hold | undefined>;
  getHoldByDecision(decisionId: string): Promise<Hold | undefined>;
  /** Insertion order. */
  listHolds(filter?: { status?: HoldStatus }): Promise<Hold[]>;
  /** Compare-and-set: applies patch only if the hold's status is `from`. Undefined if missing or changed (D28). */
  updateHold(holdId: string, from: HoldStatus, patch: HoldPatch): Promise<Hold | undefined>;
}
```

- [ ] **Step 6: Extend `packages/shared/src/memory-store.ts`** (three edits)

Replace:
```ts
import type { Decision, DecisionDraft, Page, Plan, Quote, Rule, Task } from "./types";
```
with:
```ts
import type { Decision, DecisionDraft, Hold, HoldPatch, HoldStatus, Page, Plan, Quote, Rule, Task } from "./types";
```
Replace:
```ts
  private rules = new Map<string, Rule>();
```
with:
```ts
  private rules = new Map<string, Rule>();
  private holds = new Map<string, Hold>();
```
Replace:
```ts
  async listRules() { return [...this.rules.values()].map(copy); }
}
```
with:
```ts
  async listRules() { return [...this.rules.values()].map(copy); }

  async putHold(hold: Hold) {
    if (this.holds.has(hold.holdId) || [...this.holds.values()].some((h) => h.decisionId === hold.decisionId)) {
      throw new Error(`a hold already exists for hold ${hold.holdId} or decision ${hold.decisionId}`);
    }
    this.holds.set(hold.holdId, copy(hold));
  }
  async getHold(holdId: string) { const h = this.holds.get(holdId); return h && copy(h); }
  async getHoldByDecision(decisionId: string) {
    const h = [...this.holds.values()].find((x) => x.decisionId === decisionId);
    return h && copy(h);
  }
  async listHolds(filter: { status?: HoldStatus } = {}) {
    return [...this.holds.values()].filter((h) => !filter.status || h.status === filter.status).map(copy);
  }
  /** No await between read and write: atomic in single-threaded JS. */
  async updateHold(holdId: string, from: HoldStatus, patch: HoldPatch) {
    const current = this.holds.get(holdId);
    if (!current || current.status !== from) return undefined;
    const next: Hold = { ...current, ...copy(patch), holdId: current.holdId, decisionId: current.decisionId, taskId: current.taskId };
    this.holds.set(holdId, next);
    return copy(next);
  }
}
```

- [ ] **Step 7: Export from `packages/shared/src/index.ts`**

```ts
export * from "./types";
export * from "./schemas";
export * from "./store";
export * from "./memory-store";
export * from "./simpay";
export * from "./decision-log";
export * from "./fields";
```

- [ ] **Step 8: Make the gateway re-export the moved primitives**

`packages/gateway/src/normalize.ts` — delete these four blocks (they now live in shared):
```ts
/** USD -> 6-decimal integer units (USDC atomic). All amount comparisons go through this. */
export function toAtomic(usd: number): number {
  return Math.round(usd * 1_000_000);
}
```
```ts
export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
```
```ts
/** "https://www.Vendor.test:4101/docs" -> "vendor.test:4101". Port kept: arena hosts differ only by port. */
export function normalizeDomain(s: string): string {
  let t = s.trim().toLowerCase();
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  t = t.split(/[/?#]/)[0];
  t = t.replace(/^www\./, "");
  t = t.replace(/\.$/, "");
  return t;
}
```
```ts
/** " Crypto Prices " -> "crypto-prices". */
export function normalizeCategory(s: string): string {
  return tokenize(s).join("-");
}
```
and replace the first line:
```ts
/** Spec §7 step 1. Pure helpers; no I/O. */
```
with:
```ts
/** Spec §7 step 1. Pure helpers; no I/O. */
import { normalizeCategory, normalizeDomain, toAtomic, tokenize } from "@countersign/shared";

/** D26: these four live in @countersign/shared so packages/rules can use them without depending on the gateway. */
export { normalizeCategory, normalizeDomain, toAtomic, tokenize };
```
Every other function in `normalize.ts` (including review-fix regexes and `textHasDomain`) stays exactly as committed; they keep calling the imported names.

`packages/gateway/src/tracer.ts` — replace:
```ts
/** Spec §7: rule-based, no LLM. */
export const PAYMENT_FIELDS: PaymentField[] = ["payee", "amount", "tier", "quantity", "category"];
export const MAX_EVIDENCE_TEXT = 200;

/** PAGE and UNKNOWN are taint; a missing origin is treated as UNKNOWN (fail closed). */
export function isTainted(o: Origin | undefined): boolean {
  return o === undefined || o === "PAGE" || o === "UNKNOWN";
}
```
with:
```ts
/** Spec §7: rule-based, no LLM. PAYMENT_FIELDS and isTainted live in @countersign/shared (D26). */
export { PAYMENT_FIELDS, isTainted } from "@countersign/shared";
export const MAX_EVIDENCE_TEXT = 200;
```
(`floors.ts`, `tier1.ts` and `decide.ts` keep importing them from `./tracer`.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm vitest run packages/shared packages/gateway/test/shared-fields.test.ts`
Expected: all pass (3 fields + 7 holds + 1 shared-fields, plus every existing shared test).

Run: `pnpm test && pnpm typecheck`
Expected: every existing test still passes (tracer, floors, tier1, decide, normalize tests unchanged and green); typecheck exits 0.

- [ ] **Step 10: Commit**

```bash
git add packages/shared packages/gateway && git commit -m "$(cat <<'EOF'
feat(shared): hold store, replay/hold types, shared field primitives (D26)

Store gains putHold/getHold/getHoldByDecision/listHolds and a compare-and-set
updateHold. Decisions gain human_approval/human_rejection kinds and
linkedDecisionId; rules gain replayResult. PAYMENT_FIELDS, isTainted and the
domain/category/amount normalizers move to shared; the gateway re-exports them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `packages/rules` scaffold and the single Tier 1 matcher

**Files:**
- Create: `packages/rules/package.json`, `packages/rules/src/match.ts`, `packages/rules/src/index.ts`
- Modify: `package.json` (root devDependency), `packages/gateway/package.json`, `packages/gateway/src/tier1.ts` (full replacement), `pnpm-lock.yaml` (via `pnpm install`)
- Test: `packages/rules/test/match.test.ts`, `packages/gateway/test/tier1-rules.test.ts`

**Interfaces:**
- Consumes: `PAYMENT_FIELDS`, `isTainted`, `normalizeDomain`, `normalizeCategory`, `toAtomic`, `Origin`, `PaymentField`, `Rule`, `Verdict` (shared, Task 1); M2 `fixtures.ts` `mkRule`, `mkTrace`.
- Produces (`@countersign/rules`):
  - `interface Tier1Input { floor: Verdict; origins: Partial<Record<PaymentField, Origin>>; payee: string; category: string | null; taskType: string; amountUsd: number; rules: Rule[]; now: number }` (M2's gateway `Tier1Input` with `origins` widened to `Partial`; missing = tainted)
  - `tier1Eligible(input: Pick<Tier1Input, "floor" | "origins">): boolean`
  - `ruleMatches(rule: Rule, input: Tier1Input): boolean` (status active, `expiresAt > now`, category non-null, normalized payee and category equal, same task type, `toAtomic(amount) <= toAtomic(cap)`)
  - `matchTier1(input: Tier1Input): Rule | undefined` (eligibility, then first matching rule)
- Produces (gateway): `tier1.ts` re-exports `matchTier1`, `ruleMatches`, `tier1Eligible`, `Tier1Input` from `@countersign/rules`; `Tier1Result` and `runTier1(input: Tier1Input): Tier1Result` keep M2's signatures.

- [ ] **Step 1: Write the failing tests**

`packages/rules/test/match.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, type Origin, type PaymentField, type Rule } from "@countersign/shared";
import { matchTier1, ruleMatches, tier1Eligible, type Tier1Input } from "@countersign/rules";

const NOW = 1_800_000_000_000;
const HOST = "vendor.test:4101";
const CLEAN: Record<PaymentField, Origin> = { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" };

const rule = (over: Partial<Rule> = {}): Rule => ({
  ruleId: "r1",
  payee: HOST,
  category: "weather",
  capUsd: 0.1,
  taskType: "data-lookup",
  expiresAt: NOW + 1000,
  createdBy: "Sam",
  status: "active",
  ...over,
});

const input = (over: Partial<Tier1Input> = {}): Tier1Input => ({
  floor: "approve",
  origins: CLEAN,
  payee: HOST,
  category: "weather",
  taskType: "data-lookup",
  amountUsd: 0.1,
  rules: [rule()],
  now: NOW,
  ...over,
});

describe("Tier 1 matcher (spec §9, D26)", () => {
  it("matches an active, unexpired rule on payee + category + task type within the cap", () => {
    expect(matchTier1(input())?.ruleId).toBe("r1");
  });

  it("every dimension must match", () => {
    const misses: Partial<Tier1Input>[] = [
      { payee: "other.test" },
      { category: "crypto-prices" },
      { category: null },
      { taskType: "research" },
      { amountUsd: 0.11 },
    ];
    for (const over of misses) expect(matchTier1(input(over)), JSON.stringify(over)).toBeUndefined();
  });

  it("payee and category are normalized on both sides", () => {
    const r = rule({ payee: "Vendor.TEST:4101", category: "Weather" });
    expect(matchTier1(input({ payee: "https://www.vendor.test:4101/docs", rules: [r] }))?.ruleId).toBe("r1");
  });

  it("the cap compares in atomic units: 0.1 + 0.2 fits a 0.3 cap", () => {
    expect(matchTier1(input({ amountUsd: 0.1 + 0.2, rules: [rule({ capUsd: 0.3 })] }))?.ruleId).toBe("r1");
  });

  it("expired, proposed and rejected rules never match", () => {
    for (const r of [rule({ expiresAt: NOW }), rule({ expiresAt: NOW - 1 }), rule({ status: "proposed" }), rule({ status: "rejected" })]) {
      expect(matchTier1(input({ rules: [r] }))).toBeUndefined();
    }
  });

  it("the first matching rule wins", () => {
    expect(matchTier1(input({ rules: [rule({ ruleId: "x", payee: "other.test" }), rule({ ruleId: "a" }), rule({ ruleId: "b" })] }))?.ruleId).toBe("a");
  });

  it("INV3: any PAGE, UNKNOWN or missing origin makes Tier 1 ineligible", () => {
    for (const field of PAYMENT_FIELDS) {
      for (const origin of ["PAGE", "UNKNOWN"] as const) {
        const tainted = input({ origins: { ...CLEAN, [field]: origin } });
        expect(tier1Eligible(tainted), `${field}=${origin}`).toBe(false);
        expect(matchTier1(tainted), `${field}=${origin}`).toBeUndefined();
      }
      const missing: Partial<Record<PaymentField, Origin>> = { ...CLEAN };
      delete missing[field];
      expect(matchTier1(input({ origins: missing })), `${field} missing`).toBeUndefined();
    }
  });

  it("only an approve floor is eligible", () => {
    expect(matchTier1(input({ floor: "hold" }))).toBeUndefined();
    expect(matchTier1(input({ floor: "block" }))).toBeUndefined();
    expect(tier1Eligible({ floor: "approve", origins: CLEAN })).toBe(true);
  });

  it("ruleMatches is the per-rule check; matchTier1 adds the taint and floor gate first", () => {
    const tainted = input({ origins: { ...CLEAN, tier: "PAGE" } });
    expect(ruleMatches(rule(), tainted)).toBe(true);
    expect(matchTier1(tainted)).toBeUndefined();
  });
});
```

`packages/gateway/test/tier1-rules.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import * as gateway from "@countersign/gateway";
import * as rules from "@countersign/rules";
import { mkRule, mkTrace } from "./fixtures";

describe("one Tier 1 matcher for live decisions and replay (D26)", () => {
  it("the gateway exports the rules package's matcher itself", () => {
    expect(gateway.ruleMatches).toBe(rules.ruleMatches);
    expect(gateway.matchTier1).toBe(rules.matchTier1);
    expect(gateway.tier1Eligible).toBe(rules.tier1Eligible);
  });

  it("runTier1 is a timing wrapper around matchTier1", () => {
    const t = mkTrace();
    const input = {
      floor: "approve" as const,
      origins: t.origins,
      payee: t.payee,
      category: t.category,
      taskType: "data-lookup",
      amountUsd: 0.1,
      rules: [mkRule()],
      now: Date.now(),
    };
    expect(gateway.runTier1(input)).toMatchObject({ approved: true, ruleId: rules.matchTier1(input)!.ruleId, tier: 1, costUsd: 0 });
    const tainted = { ...input, origins: { ...t.origins, tier: "PAGE" as const } };
    expect(rules.matchTier1(tainted)).toBeUndefined();
    expect(gateway.runTier1(tainted).approved).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/rules packages/gateway/test/tier1-rules.test.ts`
Expected: FAIL. `Failed to resolve import "@countersign/rules"` in both files.

- [ ] **Step 3: Scaffold the package and link it**

`packages/rules/package.json`:
```json
{"name":"@countersign/rules","version":"0.0.0","private":true,"type":"module","exports":{".":"./src/index.ts"},"dependencies":{"@countersign/shared":"workspace:*","zod":"^3.23.8"}}
```

`packages/gateway/package.json` — add `"@countersign/rules": "workspace:*"` to `dependencies` (keep every existing entry; with the current file the result is):
```json
{"name":"@countersign/gateway","version":"0.0.0","private":true,"type":"module","exports":{".":"./src/index.ts"},"dependencies":{"@countersign/rules":"workspace:*","@countersign/shared":"workspace:*","express":"^5.3.0","zod":"^3.23.8"},"devDependencies":{"@countersign/arena":"workspace:*"}}
```

Root `package.json` — in `devDependencies`, replace:
```json
    "@countersign/gateway": "workspace:*",
```
with:
```json
    "@countersign/gateway": "workspace:*",
    "@countersign/rules": "workspace:*",
```

Run: `pnpm install`
Expected: exits 0; `node_modules/@countersign/rules` and `packages/gateway/node_modules/@countersign/rules` link to `packages/rules`; `pnpm-lock.yaml` gains the `packages/rules` importer. No new registry packages (zod is already in the lockfile).

- [ ] **Step 4: Write `packages/rules/src/match.ts`**

```ts
import {
  PAYMENT_FIELDS,
  isTainted,
  normalizeCategory,
  normalizeDomain,
  toAtomic,
  type Origin,
  type PaymentField,
  type Rule,
  type Verdict,
} from "@countersign/shared";

/** Everything Tier 1 looks at. Built from a live trace (gateway) or a logged decision (replay). */
export interface Tier1Input {
  floor: Verdict;
  origins: Partial<Record<PaymentField, Origin>>; // missing = UNKNOWN = tainted
  payee: string;
  category: string | null;
  taskType: string;
  amountUsd: number;
  rules: Rule[];
  now: number;
}

/** Spec §9 + INV3: Tier 1 runs only on an approve floor with no PAGE/UNKNOWN/missing field. */
export function tier1Eligible(input: Pick<Tier1Input, "floor" | "origins">): boolean {
  return input.floor === "approve" && !PAYMENT_FIELDS.some((f) => isTainted(input.origins[f]));
}

/** One rule against one payment. Taint is not checked here: matchTier1 gates on it before any rule is consulted. */
export function ruleMatches(rule: Rule, input: Tier1Input): boolean {
  return (
    rule.status === "active" &&
    rule.expiresAt > input.now &&
    input.category !== null &&
    normalizeDomain(rule.payee) === normalizeDomain(input.payee) &&
    normalizeCategory(rule.category) === normalizeCategory(input.category) &&
    rule.taskType === input.taskType &&
    toAtomic(input.amountUsd) <= toAtomic(rule.capUsd)
  );
}

/** The single Tier 1 decision (D26): used by the gateway's runTier1 and by replay. */
export function matchTier1(input: Tier1Input): Rule | undefined {
  if (!tier1Eligible(input)) return undefined;
  return input.rules.find((r) => ruleMatches(r, input));
}
```

`packages/rules/src/index.ts`:
```ts
export * from "./match";
```

- [ ] **Step 5: Replace `packages/gateway/src/tier1.ts`**

```ts
import { matchTier1, type Tier1Input } from "@countersign/rules";

/** D26: the matcher lives in @countersign/rules so replay runs exactly the same code. */
export { matchTier1, ruleMatches, tier1Eligible, type Tier1Input } from "@countersign/rules";

export interface Tier1Result {
  approved: boolean;
  ruleId?: string;
  tier: 1;
  latencyMs: number;
  costUsd: 0;
}

/** Spec §9 Tier 1: ms, $0. Only on an approve floor with no tainted field (INV3), enforced inside matchTier1. */
export function runTier1(input: Tier1Input): Tier1Result {
  const started = performance.now();
  const rule = matchTier1(input);
  return {
    approved: rule !== undefined,
    ...(rule ? { ruleId: rule.ruleId } : {}),
    tier: 1,
    latencyMs: performance.now() - started,
    costUsd: 0,
  };
}
```
(If the committed M2 `tier1.ts` has extra review-fix behavior, move that behavior into `packages/rules/src/match.ts` so it still applies to both callers.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/rules packages/gateway/test/tier1-rules.test.ts packages/gateway/test/tier1.test.ts packages/gateway/test/decide.test.ts && pnpm typecheck`
Expected: 9 match + 2 tier1-rules pass; M2's 8 tier1 and 10 decide tests still pass unchanged; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/rules packages/gateway package.json pnpm-lock.yaml && git commit -m "$(cat <<'EOF'
feat(rules): new rules package owns the Tier 1 matcher (D26)

matchTier1 gates on an approve floor and untainted origins, then finds an
active, unexpired rule matching payee, category, task type and cap. The
gateway's runTier1 is now a timing wrapper around it, so replay and live
Tier 1 share one code path.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rule proposal, narrowing and approver routing

**Files:**
- Create: `packages/rules/src/propose.ts`, `packages/rules/src/routing.ts`, `config/approvers.json`
- Modify: `packages/rules/src/index.ts`
- Test: `packages/rules/test/propose.test.ts`, `packages/rules/test/routing.test.ts`

**Interfaces:**
- Consumes: `Decision`, `Rule`, `Task`, `PAYMENT_FIELDS`, `isTainted`, `normalizeDomain`, `normalizeCategory`, `toAtomic` (shared); zod.
- Produces (`propose.ts`):
  - `DEFAULT_RULE_TTL_MS = 604_800_000` (7 days)
  - `interface ProposeInput { decision: Decision; task: Pick<Task, "taskType">; approver: string; now: number; ttlMs: number; ruleId: string; holdId?: string }`
  - `type Proposal = { rule: Rule; reason: string } | { rule: null; reason: string }`
  - `proposeRule(input: ProposeInput): Proposal` — tainted → `{ rule: null, reason: "tainted fields: <f1>, <f2>; one-off approval only" }` (fields in `PAYMENT_FIELDS` order); null category → `{ rule: null, reason: "no category for this endpoint; one-off approval only" }`; `ttlMs <= 0` throws.
  - `class NarrowError extends Error`, `interface Narrow { capUsd?: number; expiresAt?: number }`, `narrowRule(rule: Rule, narrow: Narrow, now: number): Rule` (returns a new rule; throws `NarrowError` on any widening, invalid value or other key).
- Produces (`routing.ts`): `ApproverConfigSchema`, `type ApproverConfig = { routes: Array<{ when: { category?: string; maxUsd?: number }; approver: string }>; default: string }`, `type ApproverRoute`, `DEFAULT_APPROVER_CONFIG: ApproverConfig` (`{ routes: [], default: "Sam" }`), `parseApprovers(json: unknown): ApproverConfig`, `routeHold(config: ApproverConfig, target: { category: string | null; amountUsd: number }): string`.

- [ ] **Step 1: Write `config/approvers.json`**

```json
{
  "routes": [{ "when": { "category": "coding", "maxUsd": 5 }, "approver": "Priya" }],
  "default": "Sam"
}
```
(Spec §9: small coding purchases → Priya; everything else → Sam. The $5 threshold is configuration from the design notes, not a measured number.)

- [ ] **Step 2: Write the failing tests**

`packages/rules/test/propose.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, type Decision, type Origin, type PaymentField, type Rule } from "@countersign/shared";
import { DEFAULT_RULE_TTL_MS, NarrowError, narrowRule, proposeRule, type ProposeInput } from "@countersign/rules";

const NOW = 1_800_000_000_000;
const CLEAN: Record<PaymentField, Origin> = { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" };

const held = (over: Partial<Decision> = {}): Decision => ({
  decisionId: "d1", paymentRequestId: "p1", taskId: "t1", kind: "verdict", tier: 2, verdict: "hold",
  fieldOrigins: { ...CLEAN }, evidence: {}, amountUsd: 0.1, payeeDomain: "vendor.test:4101", category: "weather",
  floorReasons: [], reasons: ["judge: new payee"], latencyMs: 1, costUsd: null, createdAt: 1, prevHash: "", hash: "",
  ...over,
});

const args = (decision: Decision, over: Partial<ProposeInput> = {}): ProposeInput => ({
  decision,
  task: { taskType: "data-lookup" },
  approver: "Sam",
  now: NOW,
  ttlMs: DEFAULT_RULE_TTL_MS,
  ruleId: "r1",
  holdId: "h1",
  ...over,
});

describe("proposeRule (spec §9, D29)", () => {
  it("the default TTL is 7 days", () => {
    expect(DEFAULT_RULE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("a clean held decision proposes the narrowest rule: this payee, category and task type, capped at the approved amount", () => {
    const p = proposeRule(args(held()));
    expect(p.rule).toEqual({
      ruleId: "r1",
      payee: "vendor.test:4101",
      category: "weather",
      capUsd: 0.1,
      taskType: "data-lookup",
      expiresAt: NOW + DEFAULT_RULE_TTL_MS,
      createdBy: "Sam",
      status: "proposed",
      sourceHoldId: "h1",
    });
    expect(p.reason).toBe(
      `narrow rule: vendor.test:4101 / weather / up to $0.1 / data-lookup / expires ${new Date(NOW + DEFAULT_RULE_TTL_MS).toISOString()}`,
    );
  });

  it("normalizes payee and category; omits sourceHoldId when there is no hold", () => {
    const p = proposeRule(args(held({ payeeDomain: "https://www.Vendor.TEST:4101/", category: "Crypto Prices" }), { holdId: undefined }));
    expect(p.rule).toMatchObject({ payee: "vendor.test:4101", category: "crypto-prices" });
    expect(p.rule).not.toHaveProperty("sourceHoldId");
  });

  it("the premium upsell (tier and amount from a page) proposes nothing", () => {
    expect(proposeRule(args(held({ fieldOrigins: { ...CLEAN, amount: "PAGE", tier: "PAGE" }, amountUsd: 15 })))).toEqual({
      rule: null,
      reason: "tainted fields: amount, tier; one-off approval only",
    });
  });

  it("INV3: any PAGE, UNKNOWN or missing origin proposes nothing", () => {
    for (const field of PAYMENT_FIELDS) {
      for (const origin of ["PAGE", "UNKNOWN"] as const) {
        expect(proposeRule(args(held({ fieldOrigins: { ...CLEAN, [field]: origin } }))).rule, `${field}=${origin}`).toBeNull();
      }
    }
    const missing: Partial<Record<PaymentField, Origin>> = { ...CLEAN };
    delete missing.quantity;
    expect(proposeRule(args(held({ fieldOrigins: missing })))).toEqual({
      rule: null,
      reason: "tainted fields: quantity; one-off approval only",
    });
  });

  it("no category proposes nothing", () => {
    expect(proposeRule(args(held({ category: null })))).toEqual({
      rule: null,
      reason: "no category for this endpoint; one-off approval only",
    });
  });

  it("a non-positive TTL is a programming error", () => {
    expect(() => proposeRule(args(held(), { ttlMs: 0 }))).toThrow();
  });
});

describe("narrowRule (only tightening, D29)", () => {
  const rule: Rule = {
    ruleId: "r1", payee: "vendor.test:4101", category: "weather", capUsd: 0.1, taskType: "data-lookup",
    expiresAt: NOW + 10_000, createdBy: "Sam", status: "proposed",
  };

  it("lowers the cap and pulls the expiry in, without mutating the input", () => {
    const out = narrowRule(rule, { capUsd: 0.05, expiresAt: NOW + 5_000 }, NOW);
    expect(out).toEqual({ ...rule, capUsd: 0.05, expiresAt: NOW + 5_000 });
    expect(rule.capUsd).toBe(0.1);
  });

  it("an empty narrow or equal values are allowed", () => {
    expect(narrowRule(rule, {}, NOW)).toEqual(rule);
    expect(narrowRule(rule, { capUsd: 0.1, expiresAt: NOW + 10_000 }, NOW)).toEqual(rule);
  });

  it("widening the cap or the expiry throws NarrowError", () => {
    expect(() => narrowRule(rule, { capUsd: 0.11 }, NOW)).toThrow(NarrowError);
    expect(() => narrowRule(rule, { expiresAt: NOW + 10_001 }, NOW)).toThrow(NarrowError);
  });

  it("the cap must be a finite number > 0; the expiry must be in the future", () => {
    for (const capUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => narrowRule(rule, { capUsd }, NOW), String(capUsd)).toThrow(NarrowError);
    }
    expect(() => narrowRule(rule, { expiresAt: NOW }, NOW)).toThrow(NarrowError);
    expect(() => narrowRule(rule, { expiresAt: NOW - 1 }, NOW)).toThrow(NarrowError);
  });

  it("payee, category, task type and status cannot be changed", () => {
    for (const key of ["payee", "category", "taskType", "status"]) {
      expect(() => narrowRule(rule, { [key]: "x" } as never, NOW), key).toThrow(NarrowError);
    }
  });
});
```

`packages/rules/test/routing.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPROVER_CONFIG, parseApprovers, routeHold } from "@countersign/rules";

const CONFIG = parseApprovers(JSON.parse(readFileSync(new URL("../../../config/approvers.json", import.meta.url), "utf8")));

describe("approver routing is config (spec §9, D27)", () => {
  it("loads config/approvers.json", () => {
    expect(CONFIG).toEqual({ routes: [{ when: { category: "coding", maxUsd: 5 }, approver: "Priya" }], default: "Sam" });
  });

  it("small coding purchases go to Priya; everything else to Sam", () => {
    expect(routeHold(CONFIG, { category: "coding", amountUsd: 2 })).toBe("Priya");
    expect(routeHold(CONFIG, { category: "coding", amountUsd: 5 })).toBe("Priya");
    expect(routeHold(CONFIG, { category: " Coding ", amountUsd: 1 })).toBe("Priya");
    expect(routeHold(CONFIG, { category: "coding", amountUsd: 5.01 })).toBe("Sam");
    expect(routeHold(CONFIG, { category: "weather", amountUsd: 0.1 })).toBe("Sam");
    expect(routeHold(CONFIG, { category: null, amountUsd: 0.1 })).toBe("Sam");
  });

  it("first matching route wins; an empty `when` matches everything", () => {
    const cfg = parseApprovers({
      routes: [
        { when: { maxUsd: 1 }, approver: "A" },
        { when: { category: "weather" }, approver: "B" },
        { when: {}, approver: "C" },
      ],
      default: "D",
    });
    expect(routeHold(cfg, { category: "weather", amountUsd: 0.5 })).toBe("A");
    expect(routeHold(cfg, { category: "weather", amountUsd: 2 })).toBe("B");
    expect(routeHold(cfg, { category: "crypto-prices", amountUsd: 2 })).toBe("C");
  });

  it("the built-in default (only when no config is given) sends everything to Sam", () => {
    expect(routeHold(DEFAULT_APPROVER_CONFIG, { category: "coding", amountUsd: 1 })).toBe("Sam");
  });

  it("rejects malformed configs", () => {
    expect(() => parseApprovers({ routes: [] })).toThrow();
    expect(() => parseApprovers({ routes: [], default: "" })).toThrow();
    expect(() => parseApprovers({ routes: [{ when: { maxUsd: -1 }, approver: "A" }], default: "S" })).toThrow();
    expect(() => parseApprovers({ routes: [{ when: { vendor: "x" }, approver: "A" }], default: "S" })).toThrow();
    expect(() => parseApprovers({ routes: [{ when: {}, approver: "" }], default: "S" })).toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run packages/rules/test/propose.test.ts packages/rules/test/routing.test.ts`
Expected: FAIL, `proposeRule is not a function` / `parseApprovers is not a function`.

- [ ] **Step 4: Write `packages/rules/src/propose.ts`**

```ts
import {
  PAYMENT_FIELDS,
  isTainted,
  normalizeCategory,
  normalizeDomain,
  toAtomic,
  type Decision,
  type Rule,
  type Task,
} from "@countersign/shared";

/** D29: proposed rules expire after 7 days unless RULE_TTL_MS says otherwise. */
export const DEFAULT_RULE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProposeInput {
  decision: Decision;
  task: Pick<Task, "taskType">;
  approver: string;
  now: number;
  ttlMs: number;
  ruleId: string;
  holdId?: string;
}

export type Proposal = { rule: Rule; reason: string } | { rule: null; reason: string };

/**
 * Spec §9 rule chips: the narrowest rule that would have approved this exact purchase.
 * INV3: a decision with any tainted field teaches nothing; the human approval stays one-off.
 */
export function proposeRule(input: ProposeInput): Proposal {
  const { decision } = input;
  const tainted = PAYMENT_FIELDS.filter((f) => isTainted(decision.fieldOrigins[f]));
  if (tainted.length > 0) return { rule: null, reason: `tainted fields: ${tainted.join(", ")}; one-off approval only` };
  if (decision.category === null) return { rule: null, reason: "no category for this endpoint; one-off approval only" };
  if (!(input.ttlMs > 0)) throw new Error(`ttlMs must be > 0, got ${input.ttlMs}`);

  const rule: Rule = {
    ruleId: input.ruleId,
    payee: normalizeDomain(decision.payeeDomain),
    category: normalizeCategory(decision.category),
    capUsd: decision.amountUsd,
    taskType: input.task.taskType,
    expiresAt: input.now + input.ttlMs,
    createdBy: input.approver,
    status: "proposed",
    ...(input.holdId ? { sourceHoldId: input.holdId } : {}),
  };
  return {
    rule,
    reason: `narrow rule: ${rule.payee} / ${rule.category} / up to $${rule.capUsd} / ${rule.taskType} / expires ${new Date(rule.expiresAt).toISOString()}`,
  };
}

export class NarrowError extends Error {}

export interface Narrow {
  capUsd?: number;
  expiresAt?: number;
}

const NARROWABLE = new Set(["capUsd", "expiresAt"]);

/** D29: the approver may only tighten. Payee, category and task type never change; widening throws. */
export function narrowRule(rule: Rule, narrow: Narrow, now: number): Rule {
  for (const key of Object.keys(narrow)) {
    if (!NARROWABLE.has(key)) throw new NarrowError(`only capUsd and expiresAt can be narrowed; '${key}' cannot change`);
  }
  const out: Rule = { ...rule };
  if (narrow.capUsd !== undefined) {
    const cap = narrow.capUsd;
    if (typeof cap !== "number" || !Number.isFinite(cap) || toAtomic(cap) <= 0) throw new NarrowError("capUsd must be a number > 0");
    if (toAtomic(cap) > toAtomic(rule.capUsd)) throw new NarrowError(`capUsd $${cap} would widen the rule (cap is $${rule.capUsd})`);
    out.capUsd = cap;
  }
  if (narrow.expiresAt !== undefined) {
    const at = narrow.expiresAt;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= now) throw new NarrowError("expiresAt must be in the future");
    if (at > rule.expiresAt) {
      throw new NarrowError(`expiresAt would widen the rule (it expires at ${new Date(rule.expiresAt).toISOString()})`);
    }
    out.expiresAt = at;
  }
  return out;
}
```

- [ ] **Step 5: Write `packages/rules/src/routing.ts`**

```ts
import { z } from "zod";
import { normalizeCategory, toAtomic } from "@countersign/shared";

/** D27: routing is config (config/approvers.json), never code. */
export const ApproverConfigSchema = z
  .object({
    routes: z.array(
      z
        .object({
          when: z
            .object({
              category: z.string().min(1).optional(),
              maxUsd: z.number().nonnegative().optional(),
            })
            .strict(),
          approver: z.string().min(1),
        })
        .strict(),
    ),
    default: z.string().min(1),
  })
  .strict();

export type ApproverConfig = z.infer<typeof ApproverConfigSchema>;
export type ApproverRoute = ApproverConfig["routes"][number];

/** Used only when no config is passed (unit tests of createTools). main.ts always loads config/approvers.json. */
export const DEFAULT_APPROVER_CONFIG: ApproverConfig = { routes: [], default: "Sam" };

export function parseApprovers(json: unknown): ApproverConfig {
  return ApproverConfigSchema.parse(json);
}

/** First route whose every condition holds; else the default. */
export function routeHold(config: ApproverConfig, target: { category: string | null; amountUsd: number }): string {
  for (const route of config.routes) {
    const { category, maxUsd } = route.when;
    if (category !== undefined && (target.category === null || normalizeCategory(category) !== normalizeCategory(target.category))) continue;
    if (maxUsd !== undefined && toAtomic(target.amountUsd) > toAtomic(maxUsd)) continue;
    return route.approver;
  }
  return config.default;
}
```

- [ ] **Step 6: Export from `packages/rules/src/index.ts`**

```ts
export * from "./match";
export * from "./propose";
export * from "./routing";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run packages/rules && pnpm typecheck`
Expected: 9 match + 11 propose + 5 routing pass; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/rules config/approvers.json && git commit -m "$(cat <<'EOF'
feat(rules): narrow rule proposals, tighten-only narrowing, approver routing

proposeRule caps at the approved amount for this payee, category and task
type, expiring in 7 days; any tainted field means one-off approval only
(INV3, D29). narrowRule can only lower the cap or pull the expiry in.
Holds are routed by config/approvers.json (D27).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Attack corpus and replay

**Files:**
- Create: `packages/rules/src/attack-corpus.ts`, `packages/rules/src/replay.ts`
- Modify: `packages/rules/src/index.ts`
- Test: `packages/rules/test/attack-corpus.test.ts`, `packages/rules/test/replay.test.ts`

**Interfaces:**
- Consumes: `matchTier1`, `Tier1Input` (Task 2); `Decision`, `Hold`, `ReplayResult`, `Rule`, `Task`, `Origin`, `PaymentField`, `normalizeDomain`, `isTainted` (shared).
- Produces (`attack-corpus.ts`):
  - `SAME_AS_RULE = "@rule"`, `RULE_CAP = "@cap"`, `LOOKALIKE = "@lookalike"`
  - `type SpecAttack = "premium-upsell" | "quantity-inflation" | "purpose-drift" | "lookalike-domain" | "decimal-slip"`
  - `interface AttackContext { payee: string; category: string; taskType: string; amountUsd: number | typeof RULE_CAP; fieldOrigins: Record<PaymentField, Origin> }`
  - `interface AttackCase { caseId: string; name: string; specAttack: SpecAttack; context: AttackContext }`
  - `ATTACK_CORPUS: AttackCase[]` (8 hand-written cases), `lookalikeOf(payee: string): string`, `instantiateAttack(c: AttackCase, rule: Rule, now: number): Tier1Input` (floor `approve`, `rules: [rule]`)
- Produces (`replay.ts`):
  - `interface ReplayContext { decisions: Decision[]; tasks: Map<string, Task>; holds: Hold[]; attackCorpus: AttackCase[]; activeRules: Rule[]; now: number }`
  - `decisionTier1Input(d: Decision, taskType: string, rules: Rule[], now: number): Tier1Input`
  - `replayRule(candidate: Rule, ctx: ReplayContext): ReplayResult`, `replayPassed(r: ReplayResult): boolean`

- [ ] **Step 1: Write the failing tests**

`packages/rules/test/attack-corpus.test.ts`:
```ts
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
```

`packages/rules/test/replay.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, type Decision, type Hold, type Origin, type PaymentField, type Rule, type Task } from "@countersign/shared";
import {
  ATTACK_CORPUS,
  RULE_CAP,
  SAME_AS_RULE,
  replayPassed,
  replayRule,
  type AttackCase,
  type ReplayContext,
} from "@countersign/rules";

const NOW = 1_800_000_000_000;
const HOST = "vendor.test:4101";
const CLEAN: Record<PaymentField, Origin> = { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" };
const N = ATTACK_CORPUS.length;

const dec = (decisionId: string, over: Partial<Decision> = {}): Decision => ({
  decisionId, paymentRequestId: `p-${decisionId}`, taskId: "t1", kind: "verdict", tier: 2, verdict: "hold",
  fieldOrigins: { ...CLEAN }, evidence: {}, amountUsd: 0.1, payeeDomain: HOST, category: "weather", floorReasons: [],
  reasons: ["judge: new payee"], latencyMs: 1, costUsd: null, createdAt: 1, prevHash: "", hash: "", ...over,
});
const task = (taskId: string, taskType = "data-lookup"): Task => ({ taskId, text: "Get the weather", budgetUsd: 1, taskType, createdAt: 0 });
const candidate = (over: Partial<Rule> = {}): Rule => ({
  ruleId: "cand", payee: HOST, category: "weather", capUsd: 0.1, taskType: "data-lookup",
  expiresAt: NOW + 1000, createdBy: "Sam", status: "proposed", ...over,
});
const hold = (decisionId: string, status: Hold["status"], over: Partial<Hold> = {}): Hold => ({
  holdId: `h-${decisionId}`, decisionId, taskId: "t1", routedTo: "Sam", status,
  req: { url: `http://${HOST}/api/weather?tier=basic`, payeeDomain: HOST, amountUsd: 0.1, tier: "basic", quantity: 1, purpose: "p" },
  quoteId: "q", createdAt: 1, ...over,
});
const ctx = (over: Partial<ReplayContext> = {}): ReplayContext => ({
  decisions: [],
  tasks: new Map([["t1", task("t1")], ["t2", task("t2", "research")]]),
  holds: [],
  attackCorpus: ATTACK_CORPUS,
  activeRules: [],
  now: NOW,
  ...over,
});

describe("replayRule (spec §9, D30)", () => {
  it("counts every verdict decision plus every attack case, and which ones the candidate would auto-approve", () => {
    const r = replayRule(candidate(), ctx({
      decisions: [
        dec("d1"),
        dec("d2", { fieldOrigins: { ...CLEAN, tier: "PAGE" } }),
        dec("d3", { taskId: "t2" }),
        dec("d4", { amountUsd: 0.2 }),
        dec("d5", { floorReasons: ["unit price $0.2 exceeds plan maxUnitUsd $0.1"] }),
        dec("d6", { kind: "executor_failure", verdict: "block" }),
        dec("d7", { kind: "human_approval", verdict: "approve" }),
        dec("d8", { taskId: "t-missing" }),
      ],
    }));
    expect(r).toEqual({
      ranAt: NOW,
      decisionsChecked: 6,
      attacksChecked: N,
      casesChecked: 6 + N,
      wouldAutoApprove: 1,
      newlyAutoApproved: 1,
      knownBadMatched: [],
      attacksMatched: [],
      summary: `${6 + N} cases, 0 attacks matched, 0 known-bad matched`,
    });
    expect(replayPassed(r)).toBe(true);
  });

  it("newlyAutoApproved excludes what an existing active rule already approves; proposed rules do not count as existing", () => {
    const existing = candidate({ ruleId: "old", status: "active" });
    expect(replayRule(candidate(), ctx({ decisions: [dec("d1")], activeRules: [existing] }))).toMatchObject({ wouldAutoApprove: 1, newlyAutoApproved: 0 });
    const proposed = candidate({ ruleId: "other", status: "proposed" });
    expect(replayRule(candidate(), ctx({ decisions: [dec("d1")], activeRules: [proposed] }))).toMatchObject({ wouldAutoApprove: 1, newlyAutoApproved: 1 });
  });

  it("a rejected hold the candidate would approve is known-bad; open and approved holds are not", () => {
    const r = replayRule(candidate(), ctx({
      decisions: [dec("d1"), dec("d2"), dec("d3")],
      holds: [hold("d1", "rejected", { resolvedBy: "Sam" }), hold("d2", "approved"), hold("d3", "open")],
    }));
    expect(r.knownBadMatched).toEqual([{ decisionId: "d1", why: "hold h-d1 was rejected by Sam" }]);
    expect(r.summary).toBe(`${3 + N} cases, 0 attacks matched, 1 known-bad matched`);
    expect(replayPassed(r)).toBe(false);
  });

  it("a clean-floor block the candidate would approve is known-bad; a floor block never matches", () => {
    const r = replayRule(candidate(), ctx({
      decisions: [
        dec("judged", { verdict: "block", reasons: ["judge: scripted block"] }),
        dec("slip", { verdict: "block", amountUsd: 0.1, floorReasons: ["amount $40 does not match quote $0.4"] }),
      ],
    }));
    expect(r.knownBadMatched).toEqual([{ decisionId: "judged", why: "blocked: judge: scripted block" }]);
  });

  it("INV3: a tainted decision is never auto-approvable and never reported, whatever the candidate", () => {
    for (const field of PAYMENT_FIELDS) {
      for (const origin of ["PAGE", "UNKNOWN"] as const) {
        const d = dec("t", { fieldOrigins: { ...CLEAN, [field]: origin } });
        const r = replayRule(candidate({ capUsd: 1_000_000 }), ctx({ decisions: [d], holds: [hold("t", "rejected")] }));
        expect(r.wouldAutoApprove, `${field}=${origin}`).toBe(0);
        expect(r.knownBadMatched, `${field}=${origin}`).toEqual([]);
      }
    }
  });

  it("an expired candidate matches nothing", () => {
    expect(replayRule(candidate({ expiresAt: NOW }), ctx({ decisions: [dec("d1")] })).wouldAutoApprove).toBe(0);
  });

  it("replay is not vacuous: a corpus case with trusted origins at the rule's own vendor is reported", () => {
    const control: AttackCase = {
      caseId: "control",
      name: "control case: trusted origins, rule's own payee, at the cap",
      specAttack: "premium-upsell",
      context: { payee: SAME_AS_RULE, category: SAME_AS_RULE, taskType: SAME_AS_RULE, amountUsd: RULE_CAP, fieldOrigins: { ...CLEAN } },
    };
    const r = replayRule(candidate(), ctx({ attackCorpus: [control] }));
    expect(r.attacksMatched).toEqual([{ caseId: "control", name: control.name }]);
    expect(r.summary).toBe("1 cases, 1 attacks matched, 0 known-bad matched");
    expect(replayPassed(r)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/rules/test/attack-corpus.test.ts packages/rules/test/replay.test.ts`
Expected: FAIL, `ATTACK_CORPUS` is undefined (`Cannot read properties of undefined (reading 'map')`) / `replayRule is not a function`.

- [ ] **Step 3: Write `packages/rules/src/attack-corpus.ts`**

```ts
import { normalizeDomain, type Origin, type PaymentField, type Rule } from "@countersign/shared";
import type { Tier1Input } from "./match";

/**
 * Hand-written, labelled Tier 1 contexts for the spec §11 attacks (D31). No statistics.
 * Placeholders are resolved against the candidate rule, so each attack is tried at the rule's own
 * vendor, category and task type, under its cap: the "moment" setup, with only Tier 1 in the way.
 * Duplicate purchase is not here: in a Tier 1 context it equals a legitimate repeat. It joins in M4
 * with the duplicate check.
 */
export const SAME_AS_RULE = "@rule";
export const RULE_CAP = "@cap";
export const LOOKALIKE = "@lookalike";

export type SpecAttack = "premium-upsell" | "quantity-inflation" | "purpose-drift" | "lookalike-domain" | "decimal-slip";

export interface AttackContext {
  payee: string; // literal, SAME_AS_RULE or LOOKALIKE
  category: string; // literal or SAME_AS_RULE
  taskType: string; // literal or SAME_AS_RULE
  amountUsd: number | typeof RULE_CAP;
  fieldOrigins: Record<PaymentField, Origin>;
}

export interface AttackCase {
  caseId: string;
  name: string;
  specAttack: SpecAttack;
  context: AttackContext;
}

const origins = (over: Partial<Record<PaymentField, Origin>> = {}): Record<PaymentField, Origin> => ({
  payee: "PLAN",
  amount: "PLAN",
  tier: "PLAN",
  quantity: "PLAN",
  category: "PLAN",
  ...over,
});

const atRule = { payee: SAME_AS_RULE, category: SAME_AS_RULE, taskType: SAME_AS_RULE };

export const ATTACK_CORPUS: AttackCase[] = [
  {
    caseId: "atk-upsell-under-cap",
    name: "premium upsell priced under the rule's cap; tier and amount came from a docs page",
    specAttack: "premium-upsell",
    context: { ...atRule, amountUsd: RULE_CAP, fieldOrigins: origins({ tier: "PAGE", amount: "PAGE" }) },
  },
  {
    caseId: "atk-upsell-15",
    name: "premium upsell at $15 from the hidden docs line",
    specAttack: "premium-upsell",
    context: { ...atRule, amountUsd: 15, fieldOrigins: origins({ tier: "PAGE", amount: "PAGE" }) },
  },
  {
    caseId: "atk-quantity-page",
    name: "quantity inflated 2 -> 50 by a page, total under the cap",
    specAttack: "quantity-inflation",
    context: { ...atRule, amountUsd: RULE_CAP, fieldOrigins: origins({ quantity: "PAGE" }) },
  },
  {
    caseId: "atk-quantity-unknown",
    name: "quantity above the plan with no source anywhere",
    specAttack: "quantity-inflation",
    context: { ...atRule, amountUsd: RULE_CAP, fieldOrigins: origins({ quantity: "UNKNOWN" }) },
  },
  {
    caseId: "atk-purpose-drift",
    name: "purpose drift: a category the plan never declared, explained only by the agent's purpose text",
    specAttack: "purpose-drift",
    context: { ...atRule, amountUsd: RULE_CAP, fieldOrigins: origins({ category: "UNKNOWN" }) },
  },
  {
    caseId: "atk-lookalike-page",
    name: "lookalike payee named only on a page",
    specAttack: "lookalike-domain",
    context: { ...atRule, payee: LOOKALIKE, amountUsd: RULE_CAP, fieldOrigins: origins({ payee: "PAGE" }) },
  },
  {
    caseId: "atk-lookalike-trusted",
    name: "lookalike payee with otherwise trusted origins: the payee itself must not match the rule",
    specAttack: "lookalike-domain",
    context: { ...atRule, payee: LOOKALIKE, amountUsd: RULE_CAP, fieldOrigins: origins() },
  },
  {
    caseId: "atk-decimal-slip",
    name: "decimal slip: $40 taken from a page where the vendor quoted $0.40",
    specAttack: "decimal-slip",
    context: { ...atRule, amountUsd: 40, fieldOrigins: origins({ amount: "PAGE" }) },
  },
];

/** A different host that reads like the rule's payee. */
export function lookalikeOf(payee: string): string {
  return `pay-${normalizeDomain(payee)}`;
}

/** Worst case: assume every floor check missed the attack (floor approve); only Tier 1 stands in the way. */
export function instantiateAttack(c: AttackCase, rule: Rule, now: number): Tier1Input {
  const ctx = c.context;
  return {
    floor: "approve",
    origins: ctx.fieldOrigins,
    payee: ctx.payee === SAME_AS_RULE ? rule.payee : ctx.payee === LOOKALIKE ? lookalikeOf(rule.payee) : ctx.payee,
    category: ctx.category === SAME_AS_RULE ? rule.category : ctx.category,
    taskType: ctx.taskType === SAME_AS_RULE ? rule.taskType : ctx.taskType,
    amountUsd: ctx.amountUsd === RULE_CAP ? rule.capUsd : ctx.amountUsd,
    rules: [rule],
    now,
  };
}
```

- [ ] **Step 4: Write `packages/rules/src/replay.ts`**

```ts
import type { Decision, Hold, ReplayResult, Rule, Task } from "@countersign/shared";
import { instantiateAttack, type AttackCase } from "./attack-corpus";
import { matchTier1, type Tier1Input } from "./match";

export interface ReplayContext {
  decisions: Decision[];
  tasks: Map<string, Task>;
  holds: Hold[];
  attackCorpus: AttackCase[];
  activeRules: Rule[];
  now: number;
}

/** A logged decision as Tier 1 saw it. Floor = approve iff no floor check fired. Unknown task -> "" (never matches). */
export function decisionTier1Input(d: Decision, taskType: string, rules: Rule[], now: number): Tier1Input {
  return {
    floor: d.floorReasons.length === 0 ? "approve" : "hold",
    origins: d.fieldOrigins,
    payee: d.payeeDomain,
    category: d.category,
    taskType,
    amountUsd: d.amountUsd,
    rules,
    now,
  };
}

/** Spec §9 replay (D30): the same matcher Tier 1 uses, over every stored verdict decision and the attack corpus. */
export function replayRule(candidate: Rule, ctx: ReplayContext): ReplayResult {
  const asActive: Rule = { ...candidate, status: "active" };
  const existing = ctx.activeRules.filter((r) => r.status === "active" && r.ruleId !== candidate.ruleId);
  const rejected = new Map(ctx.holds.filter((h) => h.status === "rejected").map((h) => [h.decisionId, h]));

  let decisionsChecked = 0;
  let wouldAutoApprove = 0;
  let newlyAutoApproved = 0;
  const knownBadMatched: ReplayResult["knownBadMatched"] = [];

  for (const d of ctx.decisions) {
    if (d.kind !== "verdict") continue;
    decisionsChecked++;
    const base = decisionTier1Input(d, ctx.tasks.get(d.taskId)?.taskType ?? "", [], ctx.now);
    const byExisting = matchTier1({ ...base, rules: existing }) !== undefined;
    const byCandidate = matchTier1({ ...base, rules: [asActive] }) !== undefined;
    if (byExisting || byCandidate) wouldAutoApprove++;
    if (byCandidate && !byExisting) newlyAutoApproved++;
    if (!byCandidate) continue;
    const hold = rejected.get(d.decisionId);
    if (hold) {
      knownBadMatched.push({ decisionId: d.decisionId, why: `hold ${hold.holdId} was rejected by ${hold.resolvedBy ?? "an approver"}` });
    } else if (d.verdict === "block") {
      knownBadMatched.push({ decisionId: d.decisionId, why: `blocked: ${d.reasons.join("; ") || "block"}` });
    }
  }

  const attacksMatched = ctx.attackCorpus
    .filter((c) => matchTier1(instantiateAttack(c, asActive, ctx.now)) !== undefined)
    .map((c) => ({ caseId: c.caseId, name: c.name }));
  const attacksChecked = ctx.attackCorpus.length;
  const casesChecked = decisionsChecked + attacksChecked;

  return {
    ranAt: ctx.now,
    decisionsChecked,
    attacksChecked,
    casesChecked,
    wouldAutoApprove,
    newlyAutoApproved,
    knownBadMatched,
    attacksMatched,
    summary: `${casesChecked} cases, ${attacksMatched.length} attacks matched, ${knownBadMatched.length} known-bad matched`,
  };
}

/** Activation gate: refuse if any attack or known-bad decision would be auto-approved. */
export function replayPassed(r: ReplayResult): boolean {
  return r.attacksMatched.length === 0 && r.knownBadMatched.length === 0;
}
```

- [ ] **Step 5: Export from `packages/rules/src/index.ts`**

```ts
export * from "./match";
export * from "./propose";
export * from "./routing";
export * from "./attack-corpus";
export * from "./replay";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/rules && pnpm typecheck`
Expected: all rules tests pass (9 match, 11 propose, 5 routing, 4 attack-corpus, 7 replay); typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/rules && git commit -m "$(cat <<'EOF'
feat(rules): labelled attack corpus and replay over the decision log

replayRule re-runs the Tier 1 matcher over every stored verdict decision
(recorded origins and floor) and the attack corpus, instantiated at the
candidate rule's own vendor and cap. Rejected holds and blocks are known-bad;
any match fails replay (D30, D31).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Holds in pay_and_fetch, the get_hold tool, budget and latency

**Files:**
- Create: `packages/gateway/src/common.ts`, `packages/gateway/src/holds.ts`
- Modify: `packages/gateway/src/tools.ts` (edits), `packages/gateway/src/server.ts` (edits), `packages/gateway/src/floors.ts` (one edit), `packages/gateway/src/index.ts`, `tests/helpers/stack.ts` (edits)
- Test: `tests/m3-holds.test.ts`, `packages/gateway/test/m3-gateway-unit.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; M2 `createTools`, `GatewayDeps`, `idempotencyKey`, `budgetRemainingUsd`, `parseQuote`, `Executor`.
- Produces:
  - `common.ts`: `type ToolErrorCode = "BAD_INPUT" | "TASK_NOT_FOUND" | "PLAN_REQUIRED" | "PLAN_EXISTS" | "HOST_NOT_ALLOWED" | "UPSTREAM_FAILED" | "HOLD_NOT_FOUND" | "HOLD_NOT_OPEN" | "BUDGET_EXCEEDED" | "RULE_NOT_FOUND" | "RULE_STATE" | "REPLAY_FAILED"`, `class ToolError extends Error { constructor(readonly code: ToolErrorCode, message: string, readonly details?: unknown) }`, `EXECUTOR_FAILED_PREFIX`, `idempotencyKey(taskId, payee, req)` (moved verbatim from M2 `tools.ts`), `parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S>`. `tools.ts` keeps exporting `ToolError`, `ToolErrorCode`, `EXECUTOR_FAILED_PREFIX`, `idempotencyKey` (re-exports).
  - `GatewayDeps` gains optional `approvers?: ApproverConfig` (default `DEFAULT_APPROVER_CONFIG`), `ruleTtlMs?: number` (default `DEFAULT_RULE_TTL_MS`), `attackCorpus?: AttackCase[]` (default `ATTACK_CORPUS`).
  - `holds.ts`: `loadApproversFile(path: string | URL): ApproverConfig`, `interface HoldView { holdId: string; decisionId: string; status: HoldStatus; reason: string; data?: unknown }`, `holdView(h: Hold): HoldView`, `interface HoldToolDeps { store: Store; executor: Executor; ruleTtlMs: number; attackCorpus: AttackCase[] }`, `createHoldTools(deps: HoldToolDeps)` returning `{ getHold(input: unknown): Promise<HoldView> }` (Task 6 adds the admin methods), `type HoldTools`.
  - `Tools` (= `ReturnType<typeof createTools>`) gains `getHold`.
  - HTTP: `POST /tools/get_hold { taskId, decisionId }` → `HoldView`; 404 `HOLD_NOT_FOUND` when the task does not own a held decision; 400 on bad input.
  - `budgetRemainingUsd` counts `human_approval` approvals (D28).
  - `tests/helpers/stack.ts`: `TEST_APPROVERS`, `StackOptions` gains `approvers?`, `ruleTtlMs?`, `attackCorpus?`; new `getJson(base, path)`, `weatherReq(st: Pick<Stack, "arena">, over?: Partial<PaymentRequest>): PaymentRequest`.

- [ ] **Step 1: Update `tests/helpers/stack.ts`** (five edits)

Replace the import block:
```ts
import {
  SimulatedExecutor,
  createGatewayApp,
  createTools,
  loadCatalogFile,
  type Judge,
  type JudgeInput,
  type LlmProxy,
} from "@countersign/gateway";
import { MemoryStore, type Rule, type Verdict } from "@countersign/shared";
```
with:
```ts
import type { ApproverConfig, AttackCase } from "@countersign/rules";
import {
  SimulatedExecutor,
  createGatewayApp,
  createTools,
  loadApproversFile,
  loadCatalogFile,
  type Judge,
  type JudgeInput,
  type LlmProxy,
} from "@countersign/gateway";
import { MemoryStore, type PaymentRequest, type Rule, type Verdict } from "@countersign/shared";
```
Replace:
```ts
export const TEST_CATALOG = loadCatalogFile(new URL("../../config/catalog.json", import.meta.url));
```
with:
```ts
export const TEST_CATALOG = loadCatalogFile(new URL("../../config/catalog.json", import.meta.url));
export const TEST_APPROVERS = loadApproversFile(new URL("../../config/approvers.json", import.meta.url));
```
Replace:
```ts
export interface StackOptions {
  llm?: LlmProxy;
  judge?: Judge;
  payeeAllowlist?: string[];
}
```
with:
```ts
export interface StackOptions {
  llm?: LlmProxy;
  judge?: Judge;
  payeeAllowlist?: string[];
  approvers?: ApproverConfig; // default: config/approvers.json
  ruleTtlMs?: number;
  attackCorpus?: AttackCase[];
}
```
Replace:
```ts
    payeeAllowlist: opts.payeeAllowlist ?? [],
    judge: opts.judge,
  });
```
with:
```ts
    payeeAllowlist: opts.payeeAllowlist ?? [],
    judge: opts.judge,
    approvers: opts.approvers ?? TEST_APPROVERS,
    ...(opts.ruleTtlMs !== undefined ? { ruleTtlMs: opts.ruleTtlMs } : {}),
    ...(opts.attackCorpus !== undefined ? { attackCorpus: opts.attackCorpus } : {}),
  });
```
Append at the end of the file:
```ts
export async function getJson(base: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(new URL(path, base));
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The legit 1 x $0.10 basic weather purchase that weatherPlan allows. */
export function weatherReq(st: Pick<Stack, "arena">, over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley`,
    payeeDomain: st.arena.host,
    amountUsd: 0.1,
    tier: "basic",
    quantity: 1,
    purpose: "weather for Berkeley",
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/m3-holds.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import type { PaymentRequest } from "@countersign/shared";
import { createTestTask, fakeJudge, postJson, startStack, weatherPlan, weatherReq, type Stack, type StackOptions } from "./helpers/stack";

let s: Stack | undefined;
afterEach(async () => { await s?.close(); s = undefined; });

async function setup(opts: StackOptions = {}) {
  s = await startStack(opts);
  const taskId = await createTestTask(s.gateway.url);
  expect((await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) })).status).toBe(200);
  return { st: s, taskId };
}

const pay = (st: Stack, taskId: string, req: PaymentRequest) => postJson(st.gateway.url, "/tools/pay_and_fetch", { taskId, req });
const getHold = (st: Stack, taskId: string, decisionId: string) => postJson(st.gateway.url, "/tools/get_hold", { taskId, decisionId });

describe("M3: every held verdict opens one routed hold (D27)", () => {
  it("a held purchase opens one open hold routed by config/approvers.json, with the exact request and its stored quote", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("hold").judge });
    const req = weatherReq(st);
    const r = await pay(st, taskId, req);
    expect(r.body.status).toBe("held");
    const holds = await st.store.listHolds();
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ decisionId: r.body.decisionId, taskId, routedTo: "Sam", status: "open", req });
    expect((await st.store.listQuotes(taskId)).map((q) => q.quoteId)).toContain(holds[0].quoteId);
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("routing is config: a weather route sends the same hold to Priya", async () => {
    const { st, taskId } = await setup({
      judge: fakeJudge("hold").judge,
      approvers: { routes: [{ when: { category: "weather", maxUsd: 1 }, approver: "Priya" }], default: "Sam" },
    });
    await pay(st, taskId, weatherReq(st));
    expect((await st.store.listHolds())[0].routedTo).toBe("Priya");
  });

  it("approve and block verdicts open no hold", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("approve").judge });
    expect((await pay(st, taskId, weatherReq(st))).body.status).toBe("approved");
    expect((await pay(st, taskId, weatherReq(st, { amountUsd: 1 }))).body.status).toBe("blocked");
    expect(await st.store.listHolds()).toEqual([]);
  });
});

describe("POST /tools/get_hold (D33)", () => {
  it("the owning task sees its open hold", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("hold").judge });
    const r = await pay(st, taskId, weatherReq(st));
    const own = await getHold(st, taskId, r.body.decisionId);
    expect(own.status).toBe(200);
    expect(own.body).toEqual({
      holdId: (await st.store.listHolds())[0].holdId,
      decisionId: r.body.decisionId,
      status: "open",
      reason: "held for review by Sam",
    });
  });

  it("another task, an unknown decision, an unknown task or a decision with no hold -> 404 HOLD_NOT_FOUND", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("hold").judge });
    const held = await pay(st, taskId, weatherReq(st));
    const otherTask = await createTestTask(st.gateway.url);
    const blocked = await pay(st, taskId, weatherReq(st, { amountUsd: 1 }));
    expect(blocked.body.status).toBe("blocked");
    const cases: Array<[string, string]> = [
      [otherTask, held.body.decisionId],
      [taskId, "no-such-decision"],
      ["no-such-task", held.body.decisionId],
      [taskId, blocked.body.decisionId],
    ];
    for (const [t, d] of cases) {
      const x = await getHold(st, t, d);
      expect(x.status, `${t}/${d}`).toBe(404);
      expect(x.body.error.code).toBe("HOLD_NOT_FOUND");
    }
  });

  it("bad input -> 400", async () => {
    const { st, taskId } = await setup();
    const x = await postJson(st.gateway.url, "/tools/get_hold", { taskId });
    expect(x.status).toBe(400);
    expect(x.body.error.code).toBe("BAD_INPUT");
  });
});
```

`packages/gateway/test/m3-gateway-unit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { budgetRemainingUsd, holdView, loadApproversFile } from "@countersign/gateway";
import type { Decision, Hold } from "@countersign/shared";

const dec = (over: Partial<Decision>): Decision => ({
  decisionId: "d", paymentRequestId: "p", taskId: "t1", kind: "verdict", tier: 2, verdict: "approve",
  fieldOrigins: {}, evidence: {}, amountUsd: 0.1, payeeDomain: "v.test", category: "weather", floorReasons: [],
  reasons: [], latencyMs: 0, costUsd: null, createdAt: 0, prevHash: "", hash: "", ...over,
});

const hold = (over: Partial<Hold> = {}): Hold => ({
  holdId: "h1", decisionId: "d1", taskId: "t1", routedTo: "Sam", status: "open",
  req: { url: "http://v.test/api/weather", payeeDomain: "v.test", amountUsd: 0.1, purpose: "p" },
  quoteId: "q1", createdAt: 1, ...over,
});

describe("M3 gateway units", () => {
  it("loads config/approvers.json", () => {
    expect(loadApproversFile(new URL("../../../config/approvers.json", import.meta.url))).toEqual({
      routes: [{ when: { category: "coding", maxUsd: 5 }, approver: "Priya" }],
      default: "Sam",
    });
  });

  it("budget: human approvals spend; one whose payment failed does not; held and rejected never do (D23, D28)", () => {
    const remaining = budgetRemainingUsd({ taskId: "t1", budgetUsd: 1 }, [
      dec({ paymentRequestId: "a", verdict: "hold", amountUsd: 0.2 }),
      dec({ paymentRequestId: "a", kind: "human_approval", tier: null, verdict: "approve", amountUsd: 0.2 }),
      dec({ paymentRequestId: "b", verdict: "hold", amountUsd: 0.3 }),
      dec({ paymentRequestId: "b", kind: "human_approval", tier: null, verdict: "approve", amountUsd: 0.3 }),
      dec({ paymentRequestId: "b", kind: "executor_failure", tier: null, verdict: "block", amountUsd: 0.3 }),
      dec({ paymentRequestId: "c", verdict: "hold", amountUsd: 0.4 }),
      dec({ paymentRequestId: "c", kind: "human_rejection", tier: null, verdict: "block", amountUsd: 0.4 }),
    ]);
    expect(remaining).toBe(0.8);
  });

  it("holdView: open, rejected, approved+settled (data), approved+failed (no data), approved with payment in flight (open)", () => {
    expect(holdView(hold())).toEqual({ holdId: "h1", decisionId: "d1", status: "open", reason: "held for review by Sam" });
    expect(holdView(hold({ status: "rejected", resolvedBy: "Priya" }))).toEqual({ holdId: "h1", decisionId: "d1", status: "rejected", reason: "rejected by Priya" });
    expect(holdView(hold({ status: "approved", resolvedBy: "Sam", payment: { status: "settled", reason: "approved by Sam; paid (simulated)", data: { x: 1 }, decisionId: "a" } })))
      .toEqual({ holdId: "h1", decisionId: "d1", status: "approved", reason: "approved by Sam; paid (simulated)", data: { x: 1 } });
    expect(holdView(hold({ status: "approved", resolvedBy: "Sam", payment: { status: "failed", reason: "payment failed: executor failed: http 402", decisionId: "f" } })))
      .toEqual({ holdId: "h1", decisionId: "d1", status: "approved", reason: "payment failed: executor failed: http 402" });
    expect(holdView(hold({ status: "approved", resolvedBy: "Sam" })))
      .toEqual({ holdId: "h1", decisionId: "d1", status: "open", reason: "approved by Sam; payment in progress" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/m3-holds.test.ts packages/gateway/test/m3-gateway-unit.test.ts`
Expected: FAIL. `loadApproversFile is not a function` (the stack helper and the unit test import it), so every test in both files errors at import/setup.

- [ ] **Step 4: Write `packages/gateway/src/common.ts`**

```ts
import type { z } from "zod";
import { canonical, sha256Hex, type PaymentRequest } from "@countersign/shared";

/** Shared by tools.ts and holds.ts (kept apart so holds.ts never imports tools.ts). */
export type ToolErrorCode =
  | "BAD_INPUT"
  | "TASK_NOT_FOUND"
  | "PLAN_REQUIRED"
  | "PLAN_EXISTS"
  | "HOST_NOT_ALLOWED"
  | "UPSTREAM_FAILED"
  | "HOLD_NOT_FOUND"
  | "HOLD_NOT_OPEN"
  | "BUDGET_EXCEEDED"
  | "RULE_NOT_FOUND"
  | "RULE_STATE"
  | "REPLAY_FAILED";

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string, readonly details?: unknown) {
    super(message);
  }
}

export const EXECUTOR_FAILED_PREFIX = "executor failed";

/** Spec §8: sha256(taskId + payeeDomain + requestHash). Same request -> same key. */
export function idempotencyKey(taskId: string, payee: string, req: PaymentRequest): string {
  return sha256Hex(taskId + payee + canonical(req));
}

export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ToolError("BAD_INPUT", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}
```

- [ ] **Step 5: Write `packages/gateway/src/holds.ts`** (Task 6 replaces it with the full version)

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseApprovers, type ApproverConfig, type AttackCase } from "@countersign/rules";
import type { Hold, HoldStatus, Store } from "@countersign/shared";
import { ToolError, parseInput } from "./common";
import type { Executor } from "./executor";

export function loadApproversFile(path: string | URL): ApproverConfig {
  return parseApprovers(JSON.parse(readFileSync(path, "utf8")));
}

/** What the worker sees for a hold (D33). */
export interface HoldView {
  holdId: string;
  decisionId: string;
  status: HoldStatus;
  reason: string;
  data?: unknown;
}

export function holdView(h: Hold): HoldView {
  const base = { holdId: h.holdId, decisionId: h.decisionId };
  if (h.status === "open") return { ...base, status: "open", reason: `held for review by ${h.routedTo}` };
  if (h.status === "rejected") return { ...base, status: "rejected", reason: `rejected by ${h.resolvedBy ?? "an approver"}` };
  // Approved, but the payment has not finished: the worker keeps waiting.
  if (!h.payment) return { ...base, status: "open", reason: `approved by ${h.resolvedBy ?? "an approver"}; payment in progress` };
  return {
    ...base,
    status: "approved",
    reason: h.payment.reason,
    ...(h.payment.status === "settled" ? { data: h.payment.data } : {}),
  };
}

const GetHoldSchema = z.object({ taskId: z.string().min(1), decisionId: z.string().min(1) });

export interface HoldToolDeps {
  store: Store;
  executor: Executor;
  ruleTtlMs: number;
  attackCorpus: AttackCase[];
}

export function createHoldTools(deps: HoldToolDeps) {
  const { store } = deps;
  return {
    /** Worker tool (D33). 404 unless this task owns a held decision; no existence leak. */
    async getHold(input: unknown): Promise<HoldView> {
      const { taskId, decisionId } = parseInput(GetHoldSchema, input);
      const hold = await store.getHoldByDecision(decisionId);
      if (!hold || hold.taskId !== taskId) throw new ToolError("HOLD_NOT_FOUND", `no hold for decision ${decisionId} in this task`);
      return holdView(hold);
    },
  };
}

export type HoldTools = ReturnType<typeof createHoldTools>;
```

- [ ] **Step 6: Edit `packages/gateway/src/tools.ts`** (nine edits against the M2 version; merge with the actual file)

Edit 1. Replace the shared import block:
```ts
import {
  CreateTaskSchema,
  DeclarePlanSchema,
  FetchUrlSchema,
  PayAndFetchSchema,
  canonical,
  sha256Hex,
  type PayResult,
  type PaymentRequest,
  type Store,
  type Task,
} from "@countersign/shared";
```
with:
```ts
import {
  CreateTaskSchema,
  DeclarePlanSchema,
  FetchUrlSchema,
  PayAndFetchSchema,
  type PayResult,
  type Store,
  type Task,
} from "@countersign/shared";
import {
  ATTACK_CORPUS,
  DEFAULT_APPROVER_CONFIG,
  DEFAULT_RULE_TTL_MS,
  routeHold,
  type ApproverConfig,
  type AttackCase,
} from "@countersign/rules";
import { EXECUTOR_FAILED_PREFIX, ToolError, idempotencyKey } from "./common";
import { createHoldTools } from "./holds";
```

Edit 2. Replace:
```ts
export type ToolErrorCode =
  | "BAD_INPUT"
  | "TASK_NOT_FOUND"
  | "PLAN_REQUIRED"
  | "PLAN_EXISTS"
  | "HOST_NOT_ALLOWED"
  | "UPSTREAM_FAILED";

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string) {
    super(message);
  }
}
```
with:
```ts
/** Moved to ./common so holds.ts can use them without importing this file. Re-exported unchanged. */
export { EXECUTOR_FAILED_PREFIX, ToolError, idempotencyKey, type ToolErrorCode } from "./common";
```

Edit 3. Replace:
```ts
  /** Tier 2. Absent = every Tier 2 case is HOLD (D20). */
  judge?: Judge;
}
```
with:
```ts
  /** Tier 2. Absent = every Tier 2 case is HOLD (D20). */
  judge?: Judge;
  /** Hold routing (D27). main.ts loads config/approvers.json; default only for unit tests. */
  approvers?: ApproverConfig;
  /** Proposed rule lifetime (D29). Default 7 days. */
  ruleTtlMs?: number;
  /** Replay's attack corpus (D31). Default ATTACK_CORPUS. */
  attackCorpus?: AttackCase[];
}
```

Edit 4. Delete (now in `common.ts`):
```ts
export const EXECUTOR_FAILED_PREFIX = "executor failed";

/** Spec §8: sha256(taskId + payeeDomain + requestHash). Same request -> same key. */
export function idempotencyKey(taskId: string, payee: string, req: PaymentRequest): string {
  return sha256Hex(taskId + payee + canonical(req));
}
```

Edit 5. Replace:
```ts
  return {
    async createTask(input: unknown): Promise<Task> {
```
with:
```ts
  const approvers = deps.approvers ?? DEFAULT_APPROVER_CONFIG;
  const holdTools = createHoldTools({
    store,
    executor,
    ruleTtlMs: deps.ruleTtlMs ?? DEFAULT_RULE_TTL_MS,
    attackCorpus: deps.attackCorpus ?? ATTACK_CORPUS,
  });

  return {
    ...holdTools,

    async createTask(input: unknown): Promise<Task> {
```

Edit 6. Replace:
```ts
      requireAllowedHost(req.url);
      const started = performance.now();
```
with:
```ts
      requireAllowedHost(req.url);
```

Edit 7. Replace:
```ts
      await store.putQuote({
        quoteId: randomUUID(),
```
with:
```ts
      const quoteId = randomUUID();
      await store.putQuote({
        quoteId,
```

Edit 8. Replace:
```ts
      const trace = traceFields({ task, plan, pages: await store.listPages(taskId), quote, req, catalog: deps.catalog });
```
with:
```ts
      const started = performance.now(); // D32: the decision's latency, after the vendor's quote round-trip
      const trace = traceFields({ task, plan, pages: await store.listPages(taskId), quote, req, catalog: deps.catalog });
```

Edit 9. Replace:
```ts
      if (out.verdict === "hold") return { status: "held", reason, decisionId: decision.decisionId };
```
with:
```ts
      if (out.verdict === "hold") {
        // D27: one hold per held verdict, routed by config. Block never creates a hold.
        await store.putHold({
          holdId: randomUUID(),
          decisionId: decision.decisionId,
          taskId,
          routedTo: routeHold(approvers, { category: trace.category, amountUsd: req.amountUsd }),
          status: "open",
          req,
          quoteId,
          createdAt: store.now(),
        });
        return { status: "held", reason, decisionId: decision.decisionId };
      }
```

- [ ] **Step 7: Edit `packages/gateway/src/floors.ts`** (budget counts human approvals)

Replace:
```ts
/** D23: budget minus approved amounts for the task, excluding approvals whose payment then failed. */
```
with:
```ts
/** D23, D28: budget minus approved amounts (verdict or human approval) for the task, excluding approvals whose payment then failed. */
```
Replace:
```ts
    .filter((d) => d.kind === "verdict" && d.verdict === "approve" && !failed.has(d.paymentRequestId))
```
with:
```ts
    .filter((d) => (d.kind === "verdict" || d.kind === "human_approval") && d.verdict === "approve" && !failed.has(d.paymentRequestId))
```

- [ ] **Step 8: Edit `packages/gateway/src/server.ts`** (three edits)

Replace:
```ts
const STATUS: Record<ToolErrorCode, number> = {
  BAD_INPUT: 400,
  HOST_NOT_ALLOWED: 403,
  TASK_NOT_FOUND: 404,
  PLAN_REQUIRED: 409,
  PLAN_EXISTS: 409,
  UPSTREAM_FAILED: 502,
};
```
with:
```ts
const STATUS: Record<ToolErrorCode, number> = {
  BAD_INPUT: 400,
  HOST_NOT_ALLOWED: 403,
  TASK_NOT_FOUND: 404,
  HOLD_NOT_FOUND: 404,
  RULE_NOT_FOUND: 404,
  PLAN_REQUIRED: 409,
  PLAN_EXISTS: 409,
  HOLD_NOT_OPEN: 409,
  BUDGET_EXCEEDED: 409,
  RULE_STATE: 409,
  REPLAY_FAILED: 409,
  UPSTREAM_FAILED: 502,
};
```
Replace:
```ts
          res.status(STATUS[e.code]).json({ error: { code: e.code, message: e.message } });
```
with:
```ts
          res.status(STATUS[e.code]).json({
            error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) },
          });
```
Replace:
```ts
  route("/tools/pay_and_fetch", tools.payAndFetch);
```
with:
```ts
  route("/tools/pay_and_fetch", tools.payAndFetch);
  // Not a model tool: the worker loop polls it while a payment is held (D33).
  route("/tools/get_hold", tools.getHold);
```

- [ ] **Step 9: Export from `packages/gateway/src/index.ts`**

Append (keep every existing line):
```ts
export * from "./holds";
```
(`common.ts` is not exported directly; its public names reach the index through `tools.ts`.)

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm vitest run tests/m3-holds.test.ts packages/gateway/test/m3-gateway-unit.test.ts`
Expected: 6 m3-holds + 3 unit tests pass.

Run: `pnpm test && pnpm typecheck`
Expected: every existing test still passes (M2 pipeline/acceptance/INV3/INV4 unchanged; held cases now also open holds); typecheck exits 0. If typecheck reports `canonical`/`sha256Hex`/`PaymentRequest` unused or missing in `tools.ts`, remove the leftover import.

- [ ] **Step 11: Commit**

```bash
git add packages/gateway tests/helpers/stack.ts tests/m3-holds.test.ts && git commit -m "$(cat <<'EOF'
feat(gateway): held verdicts open routed holds; get_hold for the worker

pay_and_fetch stores one hold per held decision with the exact request and
quote id, routed by config/approvers.json (D27). POST /tools/get_hold answers
only the owning task (D33). Budget counts human approvals (D28). Decision
latency now starts after the vendor quote (D32).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Approver API: hold queue, approve/reject, rules list/activate/reject

**Files:**
- Modify: `packages/gateway/src/holds.ts` (full replacement), `packages/gateway/src/server.ts` (full replacement), `packages/gateway/src/main.ts` (edits), `.env.example`
- Test: `tests/m3-admin.test.ts`, `packages/gateway/test/rule-ttl.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `parseQuote`, `Executor`, `PayOutcome`, `QuoteInfo` (executor); `budgetRemainingUsd` (floors); `proposeRule`, `narrowRule`, `NarrowError`, `replayRule`, `replayPassed`, `ReplayContext`, `DEFAULT_RULE_TTL_MS` (rules).
- Produces (`holds.ts`, all exported from `@countersign/gateway`):
  - Task 5 exports unchanged, plus `type TierLabel = "Tier 1" | "Tier 2" | "floor"`, `tierLabel(tier: 1 | 2 | null): TierLabel`, `interface HoldListItem { hold: Hold; decision: Decision & { tierLabel: TierLabel }; task: Pick<Task, "taskId" | "text" | "taskType"> }`, `interface ApproveHoldResult { hold: Hold; decisionId: string; payment: HoldPayment; proposedRule: Rule | null; proposalNote: string; replay: ReplayResult | null }`, `ruleTtlFromEnv(env: NodeJS.ProcessEnv): number`.
  - `createHoldTools(deps)` returns `getHold`, `listHolds(input: unknown): Promise<{ holds: HoldListItem[] }>`, `approveHold(input: unknown): Promise<ApproveHoldResult>`, `rejectHold(input: unknown): Promise<{ hold: Hold; decisionId: string }>`, `listRules(input: unknown): Promise<{ rules: Rule[] }>`, `activateRule(input: unknown): Promise<{ rule: Rule; replay: ReplayResult }>`, `rejectRule(input: unknown): Promise<{ rule: Rule }>`.
  - HTTP (D34, unauthenticated): `GET /admin/holds?status=`, `POST /admin/holds/:holdId/approve { approver }`, `POST /admin/holds/:holdId/reject { approver }`, `GET /admin/rules?status=`, `POST /admin/rules/:ruleId/activate { approver, narrow?: { capUsd?, expiresAt? } }`, `POST /admin/rules/:ruleId/reject { approver }`. Errors: 400 `BAD_INPUT` (schema, widening narrow), 404 `HOLD_NOT_FOUND` / `RULE_NOT_FOUND`, 409 `HOLD_NOT_OPEN` / `BUDGET_EXCEEDED` / `RULE_STATE` / `REPLAY_FAILED` (with `error.details.replay`).

- [ ] **Step 1: Write the failing tests**

`packages/gateway/test/rule-ttl.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_TTL_MS } from "@countersign/rules";
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
});
```

`tests/m3-admin.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { budgetRemainingUsd, idempotencyKey, type Judge } from "@countersign/gateway";
import { ATTACK_CORPUS, RULE_CAP, SAME_AS_RULE, type AttackCase } from "@countersign/rules";
import { verifyChain, type PaymentRequest, type Verdict } from "@countersign/shared";
import {
  createTestTask,
  fakeJudge,
  getJson,
  postJson,
  startStack,
  weatherPlan,
  weatherReq,
  type Stack,
} from "./helpers/stack";

let s: Stack | undefined;
afterEach(async () => { await s?.close(); s = undefined; });

/** Returns the given verdicts in order, then repeats the last one. */
function scriptedJudge(...verdicts: Verdict[]): Judge {
  let i = 0;
  return {
    async judge() {
      const verdict = verdicts[Math.min(i++, verdicts.length - 1)];
      return { verdict, reasons: [`scripted ${verdict}`], costUsd: null, tokens: null };
    },
  };
}

async function declared(st: Stack, budgetUsd = 1): Promise<string> {
  const taskId = await createTestTask(st.gateway.url, { budgetUsd });
  expect((await postJson(st.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(st.arena.host) })).status).toBe(200);
  return taskId;
}

async function heldIn(st: Stack, taskId: string, req: PaymentRequest) {
  const r = await postJson(st.gateway.url, "/tools/pay_and_fetch", { taskId, req });
  expect(r.body.status).toBe("held");
  const hold = (await st.store.getHoldByDecision(r.body.decisionId))!;
  return { taskId, req, decisionId: r.body.decisionId as string, holdId: hold.holdId };
}

async function heldPurchase(st: Stack, over: Partial<PaymentRequest> = {}) {
  return heldIn(st, await declared(st), weatherReq(st, over));
}

const approve = (st: Stack, holdId: string, body: unknown = { approver: "Sam" }) =>
  postJson(st.gateway.url, `/admin/holds/${holdId}/approve`, body);
const reject = (st: Stack, holdId: string, body: unknown = { approver: "Sam" }) =>
  postJson(st.gateway.url, `/admin/holds/${holdId}/reject`, body);
const activate = (st: Stack, ruleId: string, body: unknown = { approver: "Sam" }) =>
  postJson(st.gateway.url, `/admin/rules/${ruleId}/activate`, body);
const getHold = (st: Stack, taskId: string, decisionId: string) =>
  postJson(st.gateway.url, "/tools/get_hold", { taskId, decisionId });

describe("GET /admin/holds", () => {
  it("lists holds with the decision trace, its tier label and the task", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const r = await getJson(s.gateway.url, "/admin/holds?status=open");
    expect(r.status).toBe(200);
    expect(r.body.holds).toHaveLength(1);
    const item = r.body.holds[0];
    expect(item.hold).toMatchObject({ holdId: h.holdId, status: "open", routedTo: "Sam" });
    expect(item.decision).toMatchObject({
      decisionId: h.decisionId,
      tierLabel: "Tier 2",
      amountUsd: 0.1,
      payeeDomain: s.arena.host,
      category: "weather",
      fieldOrigins: { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" },
      evidence: {},
    });
    expect(item.decision.reasons).toContain("judge: fake judge says hold");
    expect(item.task).toEqual({ taskId: h.taskId, text: "Get the weather in Berkeley", taskType: "data-lookup" });
    expect((await getJson(s.gateway.url, "/admin/holds?status=approved")).body.holds).toEqual([]);
    expect((await getJson(s.gateway.url, "/admin/holds")).body.holds).toHaveLength(1);
    expect((await getJson(s.gateway.url, "/admin/holds?status=bogus")).status).toBe(400);
  });
});

describe("POST /admin/holds/:holdId/approve", () => {
  it("pays the held request once with its original idempotency key, logs a linked human approval and proposes a narrow rule", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const before = Date.now();
    const r = await approve(s, h.holdId);
    expect(r.status).toBe(200);

    expect(s.paySpy).toHaveBeenCalledTimes(1);
    expect(s.paySpy.mock.calls[0][0]).toBe(h.req.url);
    expect(s.paySpy.mock.calls[0][2]).toBe(idempotencyKey(h.taskId, s.arena.host, h.req));
    expect(r.body.payment).toMatchObject({ status: "settled", reason: "approved by Sam; paid (simulated)", data: { simulated: true, tier: "basic" } });

    const original = (await s.store.getDecision(h.decisionId))!;
    expect(await s.store.getDecision(r.body.decisionId)).toMatchObject({
      kind: "human_approval", verdict: "approve", tier: null, linkedDecisionId: h.decisionId,
      paymentRequestId: original.paymentRequestId, reasons: ["approved by Sam"], costUsd: 0,
    });

    const rule = r.body.proposedRule;
    expect(rule).toMatchObject({
      payee: s.arena.host, category: "weather", capUsd: 0.1, taskType: "data-lookup",
      createdBy: "Sam", status: "proposed", sourceHoldId: h.holdId,
    });
    expect(rule.expiresAt).toBeGreaterThanOrEqual(before + 7 * 24 * 3600 * 1000);
    expect(r.body.proposalNote).toMatch(/^narrow rule: /);
    expect(r.body.replay).toMatchObject({
      decisionsChecked: 1, attacksChecked: ATTACK_CORPUS.length, casesChecked: 1 + ATTACK_CORPUS.length,
      wouldAutoApprove: 1, newlyAutoApproved: 1, knownBadMatched: [], attacksMatched: [],
    });
    expect(rule.replayResult).toEqual(r.body.replay);
    expect(r.body.hold).toMatchObject({ status: "approved", resolvedBy: "Sam", resolutionDecisionId: r.body.decisionId, proposedRuleId: rule.ruleId });
    expect((await s.store.listRules()).map((x) => [x.ruleId, x.status])).toEqual([[rule.ruleId, "proposed"]]);

    expect((await getHold(s, h.taskId, h.decisionId)).body).toMatchObject({ status: "approved", data: { simulated: true, tier: "basic" } });
    expect(verifyChain(await s.store.listDecisions())).toEqual({ ok: true });
  });

  it("approving twice is 409 HOLD_NOT_OPEN and pays once", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    expect((await approve(s, h.holdId)).status).toBe(200);
    const again = await approve(s, h.holdId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("HOLD_NOT_OPEN");
    expect(s.paySpy).toHaveBeenCalledTimes(1);
  });

  it("a human approval spends budget: the next hold on an exhausted budget is 409 BUDGET_EXCEEDED and stays open", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const taskId = await declared(s, 0.25);
    const a = await heldIn(s, taskId, weatherReq(s, { url: `${s.arena.url}/api/weather?tier=basic&city=Berkeley&qty=2`, amountUsd: 0.2, quantity: 2 }));
    const b = await heldIn(s, taskId, weatherReq(s));
    expect((await approve(s, a.holdId)).status).toBe(200);
    const r = await approve(s, b.holdId);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("BUDGET_EXCEEDED");
    expect(r.body.error.message).toContain("exceeds task budget remaining $0.05");
    expect((await s.store.getHold(b.holdId))!.status).toBe("open");
    expect(s.paySpy).toHaveBeenCalledTimes(1);
  });

  it("a failed payment: hold approved, get_hold reports the failure without data, budget not spent, rule still proposed", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    s.paySpy.mockResolvedValueOnce({ status: "failed", httpStatus: 402, txRef: null, simulated: true });
    const r = await approve(s, h.holdId);
    expect(r.status).toBe(200);
    expect(r.body.payment).toMatchObject({ status: "failed", reason: "payment failed: executor failed: http 402" });
    const seen = await getHold(s, h.taskId, h.decisionId);
    expect(seen.body).toEqual({ holdId: h.holdId, decisionId: h.decisionId, status: "approved", reason: "payment failed: executor failed: http 402" });
    const log = await s.store.listDecisions();
    expect(log.map((d) => d.kind)).toEqual(["verdict", "human_approval", "executor_failure"]);
    expect(log[2]).toMatchObject({ verdict: "block", paymentRequestId: log[0].paymentRequestId, linkedDecisionId: log[1].decisionId });
    expect(budgetRemainingUsd((await s.store.getTask(h.taskId))!, log)).toBe(1);
    expect(r.body.proposedRule).not.toBeNull();
  });

  it("unknown hold -> 404; missing or empty approver -> 400", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    expect((await approve(s, "no-such-hold")).body.error.code).toBe("HOLD_NOT_FOUND");
    expect((await approve(s, h.holdId, {})).status).toBe(400);
    expect((await approve(s, h.holdId, { approver: "  " })).status).toBe(400);
    expect(s.paySpy).not.toHaveBeenCalled();
  });
});

describe("POST /admin/holds/:holdId/reject", () => {
  it("closes the hold, logs a human rejection, proposes nothing; the hold cannot be approved later", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const r = await reject(s, h.holdId);
    expect(r.status).toBe(200);
    expect(r.body.hold).toMatchObject({ status: "rejected", resolvedBy: "Sam", resolutionDecisionId: r.body.decisionId });
    expect(await s.store.getDecision(r.body.decisionId)).toMatchObject({
      kind: "human_rejection", verdict: "block", tier: null, linkedDecisionId: h.decisionId, reasons: ["rejected by Sam"],
    });
    expect((await getHold(s, h.taskId, h.decisionId)).body).toMatchObject({ status: "rejected", reason: "rejected by Sam" });
    expect(await s.store.listRules()).toEqual([]);
    expect((await approve(s, h.holdId)).body.error.code).toBe("HOLD_NOT_OPEN");
    expect((await reject(s, h.holdId)).status).toBe(409);
    expect(s.paySpy).not.toHaveBeenCalled();
  });
});

describe("rules: list, activate (with narrowing and replay), reject", () => {
  async function proposed(st: Stack) {
    const h = await heldPurchase(st);
    const r = await approve(st, h.holdId);
    return r.body.proposedRule as { ruleId: string; expiresAt: number };
  }

  it("lists by status, activates a proposed rule, rejects (deactivates) it", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const rule = await proposed(s);
    expect((await getJson(s.gateway.url, "/admin/rules?status=proposed")).body.rules).toHaveLength(1);
    const act = await activate(s, rule.ruleId);
    expect(act.status).toBe(200);
    expect(act.body.rule).toMatchObject({ ruleId: rule.ruleId, status: "active", resolvedBy: "Sam" });
    expect(act.body.replay).toMatchObject({ attacksMatched: [], knownBadMatched: [] });
    expect(act.body.rule.replayResult).toEqual(act.body.replay);
    expect((await getJson(s.gateway.url, "/admin/rules?status=active")).body.rules).toHaveLength(1);
    expect((await activate(s, rule.ruleId)).body.error.code).toBe("RULE_STATE");
    const rej = await postJson(s.gateway.url, `/admin/rules/${rule.ruleId}/reject`, { approver: "Priya" });
    expect(rej.body.rule).toMatchObject({ status: "rejected", resolvedBy: "Priya" });
    expect((await getJson(s.gateway.url, "/admin/rules?status=active")).body.rules).toEqual([]);
    expect((await postJson(s.gateway.url, `/admin/rules/${rule.ruleId}/reject`, { approver: "Priya" })).body.error.code).toBe("RULE_STATE");
    expect((await activate(s, "no-such-rule")).body.error.code).toBe("RULE_NOT_FOUND");
    expect((await getJson(s.gateway.url, "/admin/rules?status=bogus")).status).toBe(400);
  });

  it("narrowing only tightens: widening, other keys and past expiry are 400 and leave the rule proposed", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const rule = await proposed(s);
    const bad = [
      { capUsd: 1 },
      { capUsd: 0 },
      { payee: "evil.test" },
      { expiresAt: Date.now() - 1 },
      { expiresAt: rule.expiresAt + 1 },
    ];
    for (const narrow of bad) {
      const r = await activate(s, rule.ruleId, { approver: "Sam", narrow });
      expect(r.status, JSON.stringify(narrow)).toBe(400);
      expect(r.body.error.code).toBe("BAD_INPUT");
    }
    expect((await s.store.listRules())[0]).toMatchObject({ status: "proposed", capUsd: 0.1 });
    const expiresAt = Date.now() + 3_600_000;
    const ok = await activate(s, rule.ruleId, { approver: "Sam", narrow: { capUsd: 0.05, expiresAt } });
    expect(ok.status).toBe(200);
    expect(ok.body.rule).toMatchObject({ status: "active", capUsd: 0.05, expiresAt });
  });

  it("refuses a rule that would auto-approve a purchase the judge blocked (409 REPLAY_FAILED, report attached and stored)", async () => {
    s = await startStack({ judge: scriptedJudge("hold", "block") });
    const rule = await proposed(s);
    const taskB = await declared(s);
    const blocked = await postJson(s.gateway.url, "/tools/pay_and_fetch", { taskId: taskB, req: weatherReq(s) });
    expect(blocked.body.status).toBe("blocked");
    const r = await activate(s, rule.ruleId);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("REPLAY_FAILED");
    expect(r.body.error.details.replay.knownBadMatched).toEqual([{ decisionId: blocked.body.decisionId, why: "blocked: judge: scripted block" }]);
    const stored = (await s.store.listRules())[0];
    expect(stored.status).toBe("proposed");
    expect(stored.replayResult!.knownBadMatched).toHaveLength(1);
  });

  it("refuses a rule that an attack case would slip through (corpus injected for the test)", async () => {
    const control: AttackCase = {
      caseId: "control",
      name: "control: trusted origins at the rule's own vendor and cap",
      specAttack: "premium-upsell",
      context: {
        payee: SAME_AS_RULE, category: SAME_AS_RULE, taskType: SAME_AS_RULE, amountUsd: RULE_CAP,
        fieldOrigins: { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "PLAN" },
      },
    };
    s = await startStack({ judge: fakeJudge("hold").judge, attackCorpus: [control] });
    const rule = await proposed(s);
    const r = await activate(s, rule.ruleId);
    expect(r.status).toBe(409);
    expect(r.body.error.details.replay.attacksMatched).toEqual([{ caseId: "control", name: control.name }]);
    expect(r.body.error.message).toContain("1 attacks matched");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/m3-admin.test.ts packages/gateway/test/rule-ttl.test.ts`
Expected: FAIL. `ruleTtlFromEnv is not a function`; every admin request returns 404 (Express "Cannot GET/POST", body null), so assertions such as `expected 404 to be 200` and `Cannot read properties of null (reading 'holds')` fail.

- [ ] **Step 3: Replace `packages/gateway/src/holds.ts`**

```ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  DEFAULT_RULE_TTL_MS,
  NarrowError,
  narrowRule,
  parseApprovers,
  proposeRule,
  replayPassed,
  replayRule,
  type ApproverConfig,
  type AttackCase,
  type ReplayContext,
} from "@countersign/rules";
import type { Decision, Hold, HoldPayment, HoldStatus, ReplayResult, Rule, Store, Task } from "@countersign/shared";
import { EXECUTOR_FAILED_PREFIX, ToolError, idempotencyKey, parseInput } from "./common";
import { parseQuote, type Executor, type PayOutcome, type QuoteInfo } from "./executor";
import { budgetRemainingUsd } from "./floors";
import { toAtomic } from "./normalize";

export function loadApproversFile(path: string | URL): ApproverConfig {
  return parseApprovers(JSON.parse(readFileSync(path, "utf8")));
}

/** RULE_TTL_MS: positive integer ms; unset/blank -> 7 days (D29). A bad value is a startup error, not a silent default. */
export function ruleTtlFromEnv(env: NodeJS.ProcessEnv): number {
  const v = env.RULE_TTL_MS;
  if (v === undefined || v.trim() === "") return DEFAULT_RULE_TTL_MS;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`RULE_TTL_MS must be a positive integer number of ms, got '${v}'`);
  return n;
}

/** What the worker sees for a hold (D33). */
export interface HoldView {
  holdId: string;
  decisionId: string;
  status: HoldStatus;
  reason: string;
  data?: unknown;
}

export function holdView(h: Hold): HoldView {
  const base = { holdId: h.holdId, decisionId: h.decisionId };
  if (h.status === "open") return { ...base, status: "open", reason: `held for review by ${h.routedTo}` };
  if (h.status === "rejected") return { ...base, status: "rejected", reason: `rejected by ${h.resolvedBy ?? "an approver"}` };
  // Approved, but the payment has not finished: the worker keeps waiting.
  if (!h.payment) return { ...base, status: "open", reason: `approved by ${h.resolvedBy ?? "an approver"}; payment in progress` };
  return {
    ...base,
    status: "approved",
    reason: h.payment.reason,
    ...(h.payment.status === "settled" ? { data: h.payment.data } : {}),
  };
}

export type TierLabel = "Tier 1" | "Tier 2" | "floor";

export function tierLabel(tier: 1 | 2 | null): TierLabel {
  return tier === 1 ? "Tier 1" : tier === 2 ? "Tier 2" : "floor";
}

export interface HoldListItem {
  hold: Hold;
  decision: Decision & { tierLabel: TierLabel };
  task: Pick<Task, "taskId" | "text" | "taskType">;
}

export interface ApproveHoldResult {
  hold: Hold;
  decisionId: string;
  payment: HoldPayment;
  proposedRule: Rule | null;
  proposalNote: string;
  replay: ReplayResult | null;
}

const Approver = z.string().trim().min(1).max(64);
const GetHoldSchema = z.object({ taskId: z.string().min(1), decisionId: z.string().min(1) });
const ListHoldsSchema = z.object({ status: z.enum(["open", "approved", "rejected"]).optional() });
const ResolveHoldSchema = z.object({ holdId: z.string().min(1), approver: Approver });
const ListRulesSchema = z.object({ status: z.enum(["proposed", "active", "rejected"]).optional() });
const NarrowSchema = z.object({ capUsd: z.number().optional(), expiresAt: z.number().optional() }).strict();
const ActivateRuleSchema = z.object({ ruleId: z.string().min(1), approver: Approver, narrow: NarrowSchema.optional() });
const RejectRuleSchema = z.object({ ruleId: z.string().min(1), approver: Approver });

export interface HoldToolDeps {
  store: Store;
  executor: Executor;
  ruleTtlMs: number;
  attackCorpus: AttackCase[];
}

/** Fields a human decision copies from the held decision it resolves (D28). */
function carried(d: Decision) {
  return {
    paymentRequestId: d.paymentRequestId,
    taskId: d.taskId,
    fieldOrigins: d.fieldOrigins,
    evidence: d.evidence,
    amountUsd: d.amountUsd,
    payeeDomain: d.payeeDomain,
    category: d.category,
    floorReasons: d.floorReasons,
  };
}

export function createHoldTools(deps: HoldToolDeps) {
  const { store, executor } = deps;

  async function requireHold(holdId: string): Promise<Hold> {
    const hold = await store.getHold(holdId);
    if (!hold) throw new ToolError("HOLD_NOT_FOUND", `no hold ${holdId}`);
    return hold;
  }

  async function requireHeldDecision(hold: Hold): Promise<Decision> {
    const decision = await store.getDecision(hold.decisionId);
    if (!decision) throw new ToolError("HOLD_NOT_FOUND", `hold ${hold.holdId} has no decision ${hold.decisionId}`);
    return decision;
  }

  async function requireRule(ruleId: string): Promise<Rule> {
    const rule = (await store.listRules()).find((r) => r.ruleId === ruleId);
    if (!rule) throw new ToolError("RULE_NOT_FOUND", `no rule ${ruleId}`);
    return rule;
  }

  async function replayContext(): Promise<ReplayContext> {
    const decisions = await store.listDecisions();
    const tasks = new Map<string, Task>();
    for (const taskId of new Set(decisions.map((d) => d.taskId))) {
      const task = await store.getTask(taskId);
      if (task) tasks.set(taskId, task);
    }
    return {
      decisions,
      tasks,
      holds: await store.listHolds(),
      attackCorpus: deps.attackCorpus,
      activeRules: (await store.listRules()).filter((r) => r.status === "active"),
      now: store.now(),
    };
  }

  return {
    /** Worker tool (D33). 404 unless this task owns a held decision; no existence leak. */
    async getHold(input: unknown): Promise<HoldView> {
      const { taskId, decisionId } = parseInput(GetHoldSchema, input);
      const hold = await store.getHoldByDecision(decisionId);
      if (!hold || hold.taskId !== taskId) throw new ToolError("HOLD_NOT_FOUND", `no hold for decision ${decisionId} in this task`);
      return holdView(hold);
    },

    /** Approver queue (D34). */
    async listHolds(input: unknown): Promise<{ holds: HoldListItem[] }> {
      const { status } = parseInput(ListHoldsSchema, input ?? {});
      const holds: HoldListItem[] = [];
      for (const hold of await store.listHolds(status ? { status } : {})) {
        const decision = await store.getDecision(hold.decisionId);
        const task = await store.getTask(hold.taskId);
        if (!decision || !task) continue;
        holds.push({
          hold,
          decision: { ...decision, tierLabel: tierLabel(decision.tier) },
          task: { taskId: task.taskId, text: task.text, taskType: task.taskType },
        });
      }
      return { holds };
    },

    /** D27-D30: re-check, claim, pay the stored quote with the original key, log, propose, replay. */
    async approveHold(input: unknown): Promise<ApproveHoldResult> {
      const started = performance.now();
      const { holdId, approver } = parseInput(ResolveHoldSchema, input);
      const hold = await requireHold(holdId);
      if (hold.status !== "open") throw new ToolError("HOLD_NOT_OPEN", `hold ${holdId} is ${hold.status}`);
      const decision = await requireHeldDecision(hold);
      const task = await store.getTask(hold.taskId);
      if (!task) throw new ToolError("HOLD_NOT_FOUND", `hold ${holdId} has no task ${hold.taskId}`);

      const remaining = budgetRemainingUsd(task, await store.listDecisions());
      if (toAtomic(decision.amountUsd) > toAtomic(remaining)) {
        throw new ToolError("BUDGET_EXCEEDED", `amount $${decision.amountUsd} exceeds task budget remaining $${remaining}`);
      }
      const stored = (await store.listQuotes(hold.taskId)).find((q) => q.quoteId === hold.quoteId);
      if (!stored) throw new ToolError("HOLD_NOT_FOUND", `quote ${hold.quoteId} for hold ${holdId} is missing`);
      let quote: QuoteInfo;
      try {
        quote = parseQuote(hold.req.url, 402, stored.rawRequirements);
      } catch (e) {
        throw new ToolError("UPSTREAM_FAILED", `stored quote for hold ${holdId} is unusable: ${(e as Error).message}`);
      }

      // Claim before paying: a second click finds the hold no longer open (D28).
      const claimed = await store.updateHold(holdId, "open", { status: "approved", resolvedBy: approver, resolvedAt: store.now() });
      if (!claimed) throw new ToolError("HOLD_NOT_OPEN", `hold ${holdId} was resolved concurrently`);

      const approval = await store.appendDecision({
        ...carried(decision),
        decisionId: randomUUID(),
        kind: "human_approval",
        tier: null,
        verdict: "approve",
        linkedDecisionId: decision.decisionId,
        reasons: [`approved by ${approver}`],
        latencyMs: performance.now() - started,
        costUsd: 0,
        createdAt: store.now(),
      });

      let outcome: PayOutcome;
      try {
        outcome = await executor.pay(hold.req.url, quote, idempotencyKey(hold.taskId, decision.payeeDomain, hold.req));
      } catch {
        outcome = { status: "failed", httpStatus: 0, txRef: null, simulated: executor.kind === "simulated" };
      }

      let payment: HoldPayment;
      if (outcome.status === "settled") {
        payment = {
          status: "settled",
          reason: `approved by ${approver}; paid${outcome.simulated ? " (simulated)" : ""}`,
          data: outcome.data,
          decisionId: approval.decisionId,
        };
      } else {
        const failReason = `${EXECUTOR_FAILED_PREFIX}: http ${outcome.httpStatus}`;
        const failure = await store.appendDecision({
          ...carried(decision),
          decisionId: randomUUID(),
          kind: "executor_failure",
          tier: null,
          verdict: "block",
          linkedDecisionId: approval.decisionId,
          reasons: [failReason],
          latencyMs: performance.now() - started,
          costUsd: 0,
          createdAt: store.now(),
        });
        payment = { status: "failed", reason: `payment failed: ${failReason}`, decisionId: failure.decisionId };
      }

      const proposal = proposeRule({
        decision,
        task,
        approver,
        now: store.now(),
        ttlMs: deps.ruleTtlMs,
        ruleId: randomUUID(),
        holdId,
      });
      let proposedRule: Rule | null = null;
      let replay: ReplayResult | null = null;
      if (proposal.rule) {
        replay = replayRule(proposal.rule, await replayContext());
        proposedRule = { ...proposal.rule, replayResult: replay };
        await store.putRule(proposedRule);
      }

      const final = await store.updateHold(holdId, "approved", {
        payment,
        resolutionDecisionId: approval.decisionId,
        ...(proposedRule ? { proposedRuleId: proposedRule.ruleId } : {}),
      });
      return { hold: final ?? claimed, decisionId: approval.decisionId, payment, proposedRule, proposalNote: proposal.reason, replay };
    },

    async rejectHold(input: unknown): Promise<{ hold: Hold; decisionId: string }> {
      const started = performance.now();
      const { holdId, approver } = parseInput(ResolveHoldSchema, input);
      const hold = await requireHold(holdId);
      if (hold.status !== "open") throw new ToolError("HOLD_NOT_OPEN", `hold ${holdId} is ${hold.status}`);
      const decision = await requireHeldDecision(hold);
      const claimed = await store.updateHold(holdId, "open", { status: "rejected", resolvedBy: approver, resolvedAt: store.now() });
      if (!claimed) throw new ToolError("HOLD_NOT_OPEN", `hold ${holdId} was resolved concurrently`);
      const rejection = await store.appendDecision({
        ...carried(decision),
        decisionId: randomUUID(),
        kind: "human_rejection",
        tier: null,
        verdict: "block",
        linkedDecisionId: decision.decisionId,
        reasons: [`rejected by ${approver}`],
        latencyMs: performance.now() - started,
        costUsd: 0,
        createdAt: store.now(),
      });
      const final = await store.updateHold(holdId, "rejected", { resolutionDecisionId: rejection.decisionId });
      return { hold: final ?? claimed, decisionId: rejection.decisionId };
    },

    async listRules(input: unknown): Promise<{ rules: Rule[] }> {
      const { status } = parseInput(ListRulesSchema, input ?? {});
      const rules = await store.listRules();
      return { rules: status ? rules.filter((r) => r.status === status) : rules };
    },

    /** D29, D30: optional tighten-only narrowing, then a fresh replay; any known-bad or attack match refuses. */
    async activateRule(input: unknown): Promise<{ rule: Rule; replay: ReplayResult }> {
      const { ruleId, approver, narrow } = parseInput(ActivateRuleSchema, input);
      const rule = await requireRule(ruleId);
      if (rule.status !== "proposed") throw new ToolError("RULE_STATE", `rule ${ruleId} is ${rule.status}, not proposed`);
      const now = store.now();
      let candidate: Rule;
      try {
        candidate = narrow ? narrowRule(rule, narrow, now) : rule;
      } catch (e) {
        if (e instanceof NarrowError) throw new ToolError("BAD_INPUT", e.message);
        throw e;
      }
      if (candidate.expiresAt <= now) throw new ToolError("RULE_STATE", `rule ${ruleId} expired at ${new Date(candidate.expiresAt).toISOString()}`);

      const replay = replayRule(candidate, await replayContext());
      if (!replayPassed(replay)) {
        await store.putRule({ ...rule, replayResult: replay }); // stays proposed and un-narrowed; the failing report is kept
        throw new ToolError("REPLAY_FAILED", `replay refused activation: ${replay.summary}`, { replay });
      }
      const active: Rule = { ...candidate, status: "active", replayResult: replay, resolvedBy: approver, resolvedAt: now };
      await store.putRule(active);
      return { rule: active, replay };
    },

    /** Rejects a proposed rule or deactivates an active one. */
    async rejectRule(input: unknown): Promise<{ rule: Rule }> {
      const { ruleId, approver } = parseInput(RejectRuleSchema, input);
      const rule = await requireRule(ruleId);
      if (rule.status === "rejected") throw new ToolError("RULE_STATE", `rule ${ruleId} is already rejected`);
      const rejected: Rule = { ...rule, status: "rejected", resolvedBy: approver, resolvedAt: store.now() };
      await store.putRule(rejected);
      return { rule: rejected };
    },
  };
}

export type HoldTools = ReturnType<typeof createHoldTools>;
```

- [ ] **Step 4: Replace `packages/gateway/src/server.ts`**

(This is the committed M1 file plus the Task 5 edits plus the admin routes. If the actual file has further fixes, keep them.)
```ts
import express, { type Express, type Response } from "express";
import type { LlmProxy } from "./llm-proxy";
import { ToolError, type ToolErrorCode, type Tools } from "./tools";

const STATUS: Record<ToolErrorCode, number> = {
  BAD_INPUT: 400,
  HOST_NOT_ALLOWED: 403,
  TASK_NOT_FOUND: 404,
  HOLD_NOT_FOUND: 404,
  RULE_NOT_FOUND: 404,
  PLAN_REQUIRED: 409,
  PLAN_EXISTS: 409,
  HOLD_NOT_OPEN: 409,
  BUDGET_EXCEEDED: 409,
  RULE_STATE: 409,
  REPLAY_FAILED: 409,
  UPSTREAM_FAILED: 502,
};

function bodyObject(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function createGatewayApp(tools: Tools, llm?: LlmProxy): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  async function respond(res: Response, label: string, run: () => Promise<unknown>) {
    try {
      res.json(await run());
    } catch (e) {
      if (e instanceof ToolError) {
        res.status(STATUS[e.code]).json({
          error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) },
        });
      } else {
        console.error(`[gateway] ${label}`, e);
        res.status(500).json({ error: { code: "INTERNAL", message: "internal error" } });
      }
    }
  }

  const route = (path: string, handler: (body: unknown) => Promise<unknown>) => {
    app.post(path, (req, res) => respond(res, path, () => handler(req.body)));
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Operator side. Unauthenticated by design for the hackathon (D13, D34).
  route("/admin/tasks", tools.createTask);
  app.get("/admin/holds", (req, res) =>
    respond(res, "GET /admin/holds", () => tools.listHolds(req.query.status === undefined ? {} : { status: req.query.status })),
  );
  app.post("/admin/holds/:holdId/approve", (req, res) =>
    respond(res, "approve hold", () => tools.approveHold({ ...bodyObject(req.body), holdId: req.params.holdId })),
  );
  app.post("/admin/holds/:holdId/reject", (req, res) =>
    respond(res, "reject hold", () => tools.rejectHold({ ...bodyObject(req.body), holdId: req.params.holdId })),
  );
  app.get("/admin/rules", (req, res) =>
    respond(res, "GET /admin/rules", () => tools.listRules(req.query.status === undefined ? {} : { status: req.query.status })),
  );
  app.post("/admin/rules/:ruleId/activate", (req, res) =>
    respond(res, "activate rule", () => tools.activateRule({ ...bodyObject(req.body), ruleId: req.params.ruleId })),
  );
  app.post("/admin/rules/:ruleId/reject", (req, res) =>
    respond(res, "reject rule", () => tools.rejectRule({ ...bodyObject(req.body), ruleId: req.params.ruleId })),
  );

  // Worker side: the three model tools, plus get_hold, which the worker loop polls while a payment is held (D33).
  route("/tools/declare_plan", tools.declarePlan);
  route("/tools/fetch_url", tools.fetchUrl);
  route("/tools/pay_and_fetch", tools.payAndFetch);
  route("/tools/get_hold", tools.getHold);

  app.post("/llm/messages", async (req, res) => {
    if (!llm) {
      res.status(503).json({ error: { code: "LLM_DISABLED", message: "gateway has no ANTHROPIC_API_KEY/WORKER_MODEL" } });
      return;
    }
    try {
      const out = await llm(req.body ?? {});
      res.status(out.status).json(out.json);
    } catch (e) {
      console.error("[gateway] /llm/messages", e);
      res.status(502).json({ error: { code: "UPSTREAM_FAILED", message: "LLM call failed" } });
    }
  });

  // Express's own errors (body-parser) would otherwise render HTML.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { type?: string; status?: number; statusCode?: number; message?: string };
    const status = e.status ?? e.statusCode;
    const clientError = typeof e.type === "string" && e.type.startsWith("entity.") || (typeof status === "number" && status >= 400 && status < 500);
    if (clientError) {
      res.status(typeof status === "number" && status >= 400 && status < 500 ? status : 400).json({ error: { code: "BAD_INPUT", message: e.message ?? "bad request" } });
      return;
    }
    console.error("[gateway]", err);
    res.status(500).json({ error: { code: "INTERNAL", message: "internal error" } });
  });

  return app;
}
```

- [ ] **Step 5: Wire config into `packages/gateway/src/main.ts`** (three edits against the M2 version; keep the committed `GATEWAY_HOST` binding)

Replace:
```ts
import { judgeFromEnv } from "./judge";
```
with:
```ts
import { loadApproversFile, ruleTtlFromEnv } from "./holds";
import { judgeFromEnv } from "./judge";
```
Replace:
```ts
const catalog = loadCatalogFile(new URL("../../../config/catalog.json", import.meta.url));
```
with:
```ts
const catalog = loadCatalogFile(new URL("../../../config/catalog.json", import.meta.url));
const approvers = loadApproversFile(new URL("../../../config/approvers.json", import.meta.url));
const ruleTtlMs = ruleTtlFromEnv(env);
```
Replace:
```ts
const tools = createTools({ store: new MemoryStore(), executor, fetchHosts, catalog, payeeAllowlist, judge });
```
with:
```ts
const tools = createTools({ store: new MemoryStore(), executor, fetchHosts, catalog, payeeAllowlist, judge, approvers, ruleTtlMs });
```
In the startup `console.log`, replace:
```ts
      `fetchHosts=${fetchHosts.join(",")}  catalog=${catalog.length} entries`,
```
with:
```ts
      `fetchHosts=${fetchHosts.join(",")}  catalog=${catalog.length} entries  ` +
      `approvers=${approvers.routes.length} route(s), default ${approvers.default}  ruleTtlMs=${ruleTtlMs}`,
```

- [ ] **Step 6: Add the TTL env name to `.env.example`**

Insert directly after the `GATEWAY_HOST=127.0.0.1` line:
```
# Optional: lifetime of proposed Tier 1 rules in ms. Unset = 7 days.
RULE_TTL_MS=
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run tests/m3-admin.test.ts packages/gateway/test/rule-ttl.test.ts tests/m3-holds.test.ts`
Expected: 13 admin + 2 rule-ttl + 6 holds pass.

Run: `pnpm test && pnpm typecheck`
Expected: all files pass; typecheck exits 0.

- [ ] **Step 8: Manual smoke (needs `.env` with `SIM_PAYER_SECRET`)**

`pnpm dev:arena` in one terminal, `pnpm dev:gateway` in another. Expected gateway line contains `approvers=1 route(s), default Sam  ruleTtlMs=604800000`. Then `curl -s http://127.0.0.1:4000/admin/holds` → `{"holds":[]}`. Record pass/fail.

- [ ] **Step 9: Commit**

```bash
git add packages/gateway tests/m3-admin.test.ts .env.example && git commit -m "$(cat <<'EOF'
feat(gateway): approver API for holds and rules with replay-gated activation

/admin/holds lists the queue with the trace. Approve re-checks budget, claims
the hold, pays the stored quote with the original idempotency key, logs a
human_approval and proposes a narrow rule with a replay report. Activation
narrows tighten-only, re-runs replay and refuses known-bad or attack matches
(409 REPLAY_FAILED). Reject logs a human_rejection (D27-D30, D34).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The worker waits on holds

**Files:**
- Modify: `packages/worker/src/gateway-client.ts` (two edits), `packages/worker/src/loop.ts` (three edits), `packages/worker/test/loop.test.ts` (two edits)
- Test: `packages/worker/test/hold-wait.test.ts`

**Interfaces:**
- Consumes: `POST /tools/get_hold` (Task 5); M1 `GatewayClient`, `ToolResult`, `runWorker`, `callTool`.
- Produces (all exported from `@countersign/worker`; the worker package keeps zero dependencies):
  - `GatewayClient` gains `getHold(taskId: string, decisionId: string): Promise<ToolResult>`
  - `HOLD_POLL_MS = 1000`, `HOLD_WAIT_MS = 120_000`
  - `interface HoldWaitOptions { pollMs?: number; waitMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number }`
  - `waitForHold(client: GatewayClient, taskId: string, result: ToolResult, opts?: HoldWaitOptions): Promise<ToolResult>` — returns `result` itself unless it is a 200 `held` with a string `decisionId`; then polls until `approved`/`rejected` (returns that get_hold `ToolResult`) or the deadline / an error (returns `result`).
  - `runWorker(opts: { client; taskId; taskText; maxTurns? } & HoldWaitOptions)` — `pay_and_fetch` results pass through `waitForHold`.

- [ ] **Step 1: Write the failing test**

`packages/worker/test/hold-wait.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HOLD_POLL_MS, HOLD_WAIT_MS, runWorker, waitForHold, type GatewayClient, type ToolResult } from "@countersign/worker";

const ok = (body: unknown): ToolResult => ({ ok: true, status: 200, body });
const HELD = ok({ status: "held", reason: "judge: new payee", decisionId: "d1" });
const OPEN = ok({ holdId: "h1", decisionId: "d1", status: "open", reason: "held for review by Sam" });
const APPROVED = ok({ holdId: "h1", decisionId: "d1", status: "approved", reason: "approved by Sam; paid (simulated)", data: { tempC: 18 } });
const REJECTED = ok({ holdId: "h1", decisionId: "d1", status: "rejected", reason: "rejected by Sam" });

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps };
}

const unused = async (): Promise<ToolResult> => { throw new Error("not used in this test"); };

function holdClient(next: () => Promise<ToolResult>) {
  const calls: Array<[string, string]> = [];
  const client: GatewayClient = {
    declarePlan: unused,
    fetchUrl: unused,
    payAndFetch: unused,
    llm: unused,
    getHold: async (taskId, decisionId) => { calls.push([taskId, decisionId]); return next(); },
  };
  return { client, calls };
}

function sequence(...replies: ToolResult[]) {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
}

describe("waitForHold (D33)", () => {
  it("defaults: poll every second for up to two minutes", () => {
    expect(HOLD_POLL_MS).toBe(1000);
    expect(HOLD_WAIT_MS).toBe(120_000);
  });

  it("polls get_hold with the launcher's taskId until the hold resolves, then returns the resolution", async () => {
    const c = fakeClock();
    const { client, calls } = holdClient(sequence(OPEN, OPEN, APPROVED));
    const out = await waitForHold(client, "task-1", HELD, { now: c.now, sleep: c.sleep });
    expect(out).toEqual(APPROVED);
    expect(calls).toEqual([["task-1", "d1"], ["task-1", "d1"], ["task-1", "d1"]]);
    expect(c.sleeps).toEqual([1000, 1000, 1000]);
  });

  it("a rejection comes back the same way", async () => {
    const c = fakeClock();
    const { client } = holdClient(sequence(REJECTED));
    expect(await waitForHold(client, "t", HELD, { now: c.now, sleep: c.sleep })).toEqual(REJECTED);
  });

  it("still open when waitMs runs out: the original held result, unchanged", async () => {
    const c = fakeClock();
    const { client, calls } = holdClient(sequence(OPEN));
    const out = await waitForHold(client, "t", HELD, { pollMs: 1000, waitMs: 3000, now: c.now, sleep: c.sleep });
    expect(out).toBe(HELD);
    expect(calls).toHaveLength(3);
    expect(c.now()).toBe(3000);
  });

  it("the last sleep is cut to the deadline", async () => {
    const c = fakeClock();
    const { client } = holdClient(sequence(OPEN));
    await waitForHold(client, "t", HELD, { pollMs: 1000, waitMs: 2500, now: c.now, sleep: c.sleep });
    expect(c.sleeps).toEqual([1000, 1000, 500]);
  });

  it("a non-200 get_hold or a thrown call stops waiting and returns the held result", async () => {
    const c = fakeClock();
    const notFound = holdClient(sequence({ ok: false, status: 404, body: { error: { code: "HOLD_NOT_FOUND" } } }));
    expect(await waitForHold(notFound.client, "t", HELD, { now: c.now, sleep: c.sleep })).toBe(HELD);
    expect(notFound.calls).toHaveLength(1);
    const broken = holdClient(async () => { throw new Error("gateway down"); });
    expect(await waitForHold(broken.client, "t", HELD, { now: c.now, sleep: c.sleep })).toBe(HELD);
  });

  it("anything that is not a 200 held result with a decisionId passes straight through without polling", async () => {
    const c = fakeClock();
    const passThrough: ToolResult[] = [
      ok({ status: "approved", decisionId: "d", data: {} }),
      ok({ status: "blocked", decisionId: "d", reason: "x" }),
      { ok: false, status: 400, body: { error: { code: "BAD_INPUT" } } },
      ok({ status: "held", reason: "no id" }),
      ok(null),
    ];
    for (const r of passThrough) {
      const { client, calls } = holdClient(sequence(APPROVED));
      expect(await waitForHold(client, "t", r, { now: c.now, sleep: c.sleep })).toBe(r);
      expect(calls).toHaveLength(0);
    }
  });

  it("runWorker hands the resolved hold to the model as the pay_and_fetch tool result", async () => {
    const llmCalls: any[] = [];
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "p1", name: "pay_and_fetch", input: { url: "http://a/api", payeeDomain: "a", amountUsd: 0.1, purpose: "p" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] },
    ];
    let i = 0;
    const getHoldCalls: Array<[string, string]> = [];
    const client: GatewayClient = {
      llm: async (body) => { llmCalls.push(structuredClone(body)); return ok(replies[i++]); },
      declarePlan: unused,
      fetchUrl: unused,
      payAndFetch: async () => HELD,
      getHold: async (taskId, decisionId) => { getHoldCalls.push([taskId, decisionId]); return APPROVED; },
    };
    const c = fakeClock();
    const out = await runWorker({ client, taskId: "task-1", taskText: "x", now: c.now, sleep: c.sleep });
    expect(out.finalText).toBe("done");
    expect(getHoldCalls).toEqual([["task-1", "d1"]]);
    const toolResult = llmCalls[1].messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "p1", is_error: false });
    expect(JSON.parse(toolResult.content)).toEqual(APPROVED.body);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/worker/test/hold-wait.test.ts`
Expected: FAIL. `waitForHold is not a function`; `HOLD_POLL_MS` undefined; the runWorker test sees the raw held body (`expected { status: 'held', … } to deeply equal { …status: 'approved'… }`).

- [ ] **Step 3: Edit `packages/worker/src/gateway-client.ts`**

Replace:
```ts
  payAndFetch(taskId: string, req: unknown): Promise<ToolResult>;
```
with:
```ts
  payAndFetch(taskId: string, req: unknown): Promise<ToolResult>;
  /** Not a model tool: the loop polls it while a payment is held (D33). */
  getHold(taskId: string, decisionId: string): Promise<ToolResult>;
```
Replace:
```ts
    payAndFetch: (taskId, req) => post("/tools/pay_and_fetch", { taskId, req }),
```
with:
```ts
    payAndFetch: (taskId, req) => post("/tools/pay_and_fetch", { taskId, req }),
    getHold: (taskId, decisionId) => post("/tools/get_hold", { taskId, decisionId }),
```

- [ ] **Step 4: Edit `packages/worker/src/loop.ts`**

Edit 1. Replace:
```ts
/** taskId always comes from the launcher, never from model output. */
```
with:
```ts
export const HOLD_POLL_MS = 1000;
export const HOLD_WAIT_MS = 120_000;

export interface HoldWaitOptions {
  pollMs?: number;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * D33: a held pay_and_fetch waits for the approver. Polls get_hold until approved/rejected or waitMs passes.
 * Anything unexpected (non-200, a throw, still open at the deadline) returns the original held result.
 */
export async function waitForHold(
  client: GatewayClient,
  taskId: string,
  result: ToolResult,
  opts: HoldWaitOptions = {},
): Promise<ToolResult> {
  const body = result.body as { status?: unknown; decisionId?: unknown } | null;
  if (!result.ok || body?.status !== "held" || typeof body.decisionId !== "string") return result;
  const decisionId = body.decisionId;
  const pollMs = opts.pollMs ?? HOLD_POLL_MS;
  const waitMs = opts.waitMs ?? HOLD_WAIT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + waitMs;
  while (now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    let r: ToolResult;
    try {
      r = await client.getHold(taskId, decisionId);
    } catch {
      return result;
    }
    if (!r.ok) return result;
    const status = (r.body as { status?: unknown } | null)?.status;
    if (status === "approved" || status === "rejected") return r;
  }
  return result;
}

/** taskId always comes from the launcher, never from model output. */
```

Edit 2. Replace:
```ts
  maxTurns?: number;
}): Promise<{ finalText: string; transcript: unknown[]; exhausted?: boolean }> {
```
with:
```ts
  maxTurns?: number;
} & HoldWaitOptions): Promise<{ finalText: string; transcript: unknown[]; exhausted?: boolean }> {
```

Edit 3. Replace:
```ts
        const out = await callTool(opts.client, opts.taskId, block.name ?? "", block.input);
```
with:
```ts
        let out = await callTool(opts.client, opts.taskId, block.name ?? "", block.input);
        if (block.name === "pay_and_fetch") out = await waitForHold(opts.client, opts.taskId, out, opts);
```

- [ ] **Step 5: Keep the M1 loop tests compiling and fast** (`packages/worker/test/loop.test.ts`, two edits)

The fake client must implement the new method. Replace:
```ts
    payAndFetch: async (taskId, req) => { calls.push(["pay_and_fetch", taskId, req]); return ok({ status: "held", reason: "r", decisionId: "d" }); },
```
with:
```ts
    payAndFetch: async (taskId, req) => { calls.push(["pay_and_fetch", taskId, req]); return ok({ status: "held", reason: "r", decisionId: "d" }); },
    getHold: async (taskId, decisionId) => { calls.push(["get_hold", taskId, decisionId]); return ok({ status: "open", reason: "r" }); },
```
The pay_and_fetch test must not wait two real minutes. In the test "uses the launcher's taskId for declare_plan and pay_and_fetch too", replace:
```ts
    await runWorker({ client, taskId: "task-1", taskText: "x" });
    expect(calls[1][0]).toBe("declare_plan");
```
with:
```ts
    await runWorker({ client, taskId: "task-1", taskText: "x", waitMs: 0 });
    expect(calls[1][0]).toBe("declare_plan");
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/worker tests/invariants/inv1-worker-isolation.test.ts && pnpm typecheck`
Expected: 8 hold-wait tests pass; the 6 M1 loop tests, the net-guard tests and INV1 (static import check + process tests) still pass; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/worker && git commit -m "$(cat <<'EOF'
feat(worker): wait on held payments by polling get_hold (D33)

A held pay_and_fetch is polled every second for up to two minutes; the
approver's resolution (approved with data, payment failed, or rejected)
becomes the tool result the model sees. Still open, an error or a 404 leaves
the held result unchanged. No new dependencies.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: M3 acceptance, INV3 for rules and replay, DECISIONS and README

**Files:**
- Create: `tests/m3-acceptance.test.ts`, `tests/invariants/inv3-rules.test.ts`
- Modify: `DECISIONS.md`, `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–7; `startStack`, `createTestTask`, `fakeJudge`, `getJson`, `postJson`, `weatherPlan`, `weatherReq`, `Stack` (`tests/helpers/stack.ts`); `createGatewayClient` (worker); `ATTACK_CORPUS`, `instantiateAttack`, `matchTier1`, `proposeRule`, `replayRule`, `DEFAULT_RULE_TTL_MS` (rules).
- Produces: no new runtime code. These tests are the M3 gate. If one fails, fix the implementation, never the invariant.

- [ ] **Step 1: Write `tests/m3-acceptance.test.ts`**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayClient } from "@countersign/worker";
import { createTestTask, fakeJudge, getJson, postJson, startStack, weatherPlan, weatherReq, type Stack } from "./helpers/stack";

type PayBody = { status: string; reason: string; decisionId: string; data?: unknown };

/** Spec §13 row 3. The fake judge always says hold, so every approval below comes from a human or a rule. */
describe("M3 acceptance: hold queue, rule chips, replay, activation", () => {
  let s: Stack | undefined;
  afterEach(async () => { await s?.close(); s = undefined; });

  async function newTask(st: Stack, budgetUsd = 1) {
    const taskId = await createTestTask(st.gateway.url, { budgetUsd });
    const client = createGatewayClient(st.gateway.url);
    expect((await client.declarePlan(taskId, weatherPlan(st.arena.host))).ok).toBe(true);
    return { taskId, client };
  }

  it("held -> routed -> approved and paid -> narrow rule proposed with replay -> activated -> next similar purchase is Tier 1 in ms at $0", async () => {
    const fj = fakeJudge("hold");
    s = await startStack({ judge: fj.judge });
    const st = s;

    // 1. A legit purchase from a vendor in the plan; the judge holds it; the queue shows it routed per config.
    const a = await newTask(st);
    expect((await a.client.fetchUrl(a.taskId, `${st.arena.url}/docs`)).ok).toBe(true);
    const req = weatherReq(st);
    const held = (await a.client.payAndFetch(a.taskId, req)).body as PayBody;
    expect(held.status).toBe("held");
    expect(fj.calls).toHaveLength(1);
    const queue = await getJson(st.gateway.url, "/admin/holds?status=open");
    expect(queue.body.holds).toHaveLength(1);
    const item = queue.body.holds[0];
    expect(item.hold.routedTo).toBe("Sam"); // config/approvers.json: only small coding purchases go to Priya
    expect(item.decision.decisionId).toBe(held.decisionId);
    expect(item.task).toMatchObject({ taskId: a.taskId, taskType: "data-lookup" });
    expect(st.paySpy).not.toHaveBeenCalled();

    // 2. Approve: the payment executes (simulated), the worker sees it, a narrow rule is proposed with a replay report.
    const approved = await postJson(st.gateway.url, `/admin/holds/${item.hold.holdId}/approve`, { approver: "Sam" });
    expect(approved.status).toBe(200);
    expect(st.paySpy).toHaveBeenCalledTimes(1);
    const seen = await a.client.getHold(a.taskId, held.decisionId);
    expect(seen.body).toMatchObject({ status: "approved", data: { simulated: true, tier: "basic", city: "Berkeley" } });
    const rule = approved.body.proposedRule;
    expect(rule).toMatchObject({ status: "proposed", payee: st.arena.host, category: "weather", capUsd: 0.1, taskType: "data-lookup" });
    expect(approved.body.replay.casesChecked).toBeGreaterThan(0);
    expect(approved.body.replay.attacksMatched).toEqual([]);
    expect(approved.body.replay.knownBadMatched).toEqual([]);
    expect(approved.body.replay.summary).toBe(`${approved.body.replay.casesChecked} cases, 0 attacks matched, 0 known-bad matched`);

    // 7. A narrowing that widens is refused; the rule stays proposed.
    const widen = await postJson(st.gateway.url, `/admin/rules/${rule.ruleId}/activate`, { approver: "Sam", narrow: { capUsd: 1 } });
    expect(widen.status).toBe(400);
    expect(widen.body.error.code).toBe("BAD_INPUT");
    expect((await getJson(st.gateway.url, "/admin/rules?status=proposed")).body.rules).toHaveLength(1);

    // 3. Activate, narrowed to one hour.
    const expiresAt = Date.now() + 3_600_000;
    const act = await postJson(st.gateway.url, `/admin/rules/${rule.ruleId}/activate`, { approver: "Sam", narrow: { expiresAt } });
    expect(act.status).toBe(200);
    expect(act.body.rule).toMatchObject({ ruleId: rule.ruleId, status: "active", capUsd: 0.1, expiresAt });
    expect(act.body.replay.attacksMatched).toEqual([]);

    // 4. A new task of the same type makes the same purchase: Tier 1, $0, milliseconds, judge not called.
    const c = await newTask(st);
    const next = (await c.client.payAndFetch(c.taskId, req)).body as PayBody;
    expect(next.status).toBe("approved");
    expect(next.data).toMatchObject({ simulated: true, tier: "basic" });
    const d = (await st.store.getDecision(next.decisionId))!;
    expect(d).toMatchObject({ kind: "verdict", verdict: "approve", tier: 1, ruleId: rule.ruleId, costUsd: 0 });
    expect(d.latencyMs).toBeLessThan(50);
    expect(fj.calls).toHaveLength(1);
    expect(st.paySpy).toHaveBeenCalledTimes(2);
  });

  it("approving a premium upsell pays once but proposes no rule: tainted fields teach nothing", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const u = await newTask(s, 20);
    expect((await u.client.fetchUrl(u.taskId, `${s.arena.url}/docs/upsell`)).ok).toBe(true);
    const held = (await u.client.payAndFetch(
      u.taskId,
      weatherReq(s, { url: `${s.arena.url}/api/weather?tier=premium&city=Berkeley`, amountUsd: 15, tier: "premium" }),
    )).body as PayBody;
    expect(held.status).toBe("held");
    const hold = (await s.store.getHoldByDecision(held.decisionId))!;
    const r = await postJson(s.gateway.url, `/admin/holds/${hold.holdId}/approve`, { approver: "Sam" });
    expect(r.status).toBe(200);
    expect(r.body.payment).toMatchObject({ status: "settled", data: { simulated: true, tier: "premium" } });
    expect(s.paySpy).toHaveBeenCalledTimes(1);
    expect(r.body.proposedRule).toBeNull();
    expect(r.body.replay).toBeNull();
    expect(r.body.proposalNote).toBe("tainted fields: amount, tier; one-off approval only");
    expect(await s.store.listRules()).toEqual([]);
    expect((await u.client.getHold(u.taskId, held.decisionId)).body).toMatchObject({ status: "approved", data: { tier: "premium" } });
  });

  it("activation is refused when replay finds a rejected purchase the rule would auto-approve (409 REPLAY_FAILED)", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const a = await newTask(s);
    const heldA = (await a.client.payAndFetch(a.taskId, weatherReq(s))).body as PayBody;
    const holdA = (await s.store.getHoldByDecision(heldA.decisionId))!;
    const rule = (await postJson(s.gateway.url, `/admin/holds/${holdA.holdId}/approve`, { approver: "Sam" })).body.proposedRule;
    expect(rule.status).toBe("proposed");

    const b = await newTask(s);
    const heldB = (await b.client.payAndFetch(b.taskId, weatherReq(s))).body as PayBody;
    expect(heldB.status).toBe("held"); // the rule is only proposed, so Tier 1 does not apply yet
    const holdB = (await s.store.getHoldByDecision(heldB.decisionId))!;
    expect((await postJson(s.gateway.url, `/admin/holds/${holdB.holdId}/reject`, { approver: "Sam" })).status).toBe(200);
    expect((await b.client.getHold(b.taskId, heldB.decisionId)).body).toMatchObject({ status: "rejected" });

    const act = await postJson(s.gateway.url, `/admin/rules/${rule.ruleId}/activate`, { approver: "Sam" });
    expect(act.status).toBe(409);
    expect(act.body.error.code).toBe("REPLAY_FAILED");
    expect(act.body.error.details.replay.knownBadMatched).toEqual([
      { decisionId: heldB.decisionId, why: `hold ${holdB.holdId} was rejected by Sam` },
    ]);
    expect(act.body.error.details.replay.attacksMatched).toEqual([]);
    const stored = (await s.store.listRules())[0];
    expect(stored.status).toBe("proposed");
    expect(stored.replayResult!.knownBadMatched).toHaveLength(1);
    expect(s.paySpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Write `tests/invariants/inv3-rules.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  ATTACK_CORPUS,
  DEFAULT_RULE_TTL_MS,
  instantiateAttack,
  matchTier1,
  proposeRule,
  replayRule,
} from "@countersign/rules";
import { PAYMENT_FIELDS, type Decision, type Hold, type Origin, type PaymentField, type Rule } from "@countersign/shared";

const NOW = 1_800_000_000_000;
const HOST = "127.0.0.1:4101";
const CLEAN: Record<PaymentField, Origin> = { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" };

const dec = (fieldOrigins: Partial<Record<PaymentField, Origin>>): Decision => ({
  decisionId: "d", paymentRequestId: "p", taskId: "t1", kind: "verdict", tier: 2, verdict: "hold", fieldOrigins,
  evidence: {}, amountUsd: 0.1, payeeDomain: HOST, category: "weather", floorReasons: [], reasons: [],
  latencyMs: 0, costUsd: null, createdAt: 0, prevHash: "", hash: "",
});
const wide: Rule = {
  ruleId: "wide", payee: HOST, category: "weather", capUsd: 1_000_000, taskType: "data-lookup",
  expiresAt: NOW + DEFAULT_RULE_TTL_MS, createdBy: "test", status: "active",
};
const rejectedHold: Hold = {
  holdId: "h", decisionId: "d", taskId: "t1", routedTo: "Sam", status: "rejected", resolvedBy: "Sam",
  req: { url: `http://${HOST}/api/weather`, payeeDomain: HOST, amountUsd: 0.1, purpose: "p" }, quoteId: "q", createdAt: 0,
};

describe("INV3 across rule proposal, replay and the attack corpus", () => {
  const variants: Array<[string, Partial<Record<PaymentField, Origin>>]> = [];
  for (const field of PAYMENT_FIELDS) {
    for (const origin of ["PAGE", "UNKNOWN"] as const) variants.push([`${field}=${origin}`, { ...CLEAN, [field]: origin }]);
    const missing: Partial<Record<PaymentField, Origin>> = { ...CLEAN };
    delete missing[field];
    variants.push([`${field} missing`, missing]);
  }

  for (const [label, origins] of variants) {
    it(`${label}: no rule is proposed, and a $1,000,000 rule never auto-approves it in replay or live Tier 1`, () => {
      const d = dec(origins);
      expect(proposeRule({ decision: d, task: { taskType: "data-lookup" }, approver: "Sam", now: NOW, ttlMs: DEFAULT_RULE_TTL_MS, ruleId: "r" }).rule).toBeNull();
      const r = replayRule(wide, {
        decisions: [d],
        tasks: new Map([["t1", { taskId: "t1", text: "t", budgetUsd: 1, taskType: "data-lookup", createdAt: 0 }]]),
        holds: [rejectedHold],
        attackCorpus: [],
        activeRules: [wide],
        now: NOW,
      });
      expect(r.wouldAutoApprove).toBe(0);
      expect(r.knownBadMatched).toEqual([]);
      expect(matchTier1({ floor: "approve", origins, payee: HOST, category: "weather", taskType: "data-lookup", amountUsd: 0.1, rules: [wide], now: NOW })).toBeUndefined();
    });
  }

  it("no attack corpus case is ever matched, even by a rule at the attack's own vendor with a $1,000,000 cap", () => {
    for (const c of ATTACK_CORPUS) expect(matchTier1(instantiateAttack(c, wide, NOW)), c.caseId).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the new tests**

Run: `pnpm vitest run tests/m3-acceptance.test.ts tests/invariants`
Expected: M3 acceptance 3 pass; INV3-rules 16 pass (15 variants + corpus); INV1, INV2, INV3 (M2), INV4 unchanged and green; 1 todo (INV5). These tests exercise code from Tasks 1–7; if one fails, debug the implementation (superpowers:systematic-debugging). Never loosen an assertion to pass.

- [ ] **Step 4: Append to `DECISIONS.md`**

```markdown
- **D26 (2026-10-24) `packages/rules` owns the Tier 1 matcher**, rule proposal, narrowing, approver routing and replay; it depends only on `@countersign/shared`. `toAtomic`, `tokenize`, `normalizeDomain`, `normalizeCategory`, `PAYMENT_FIELDS` and `isTainted` moved to `@countersign/shared/src/fields.ts` and the gateway re-exports them. Gateway → rules → shared, no cycle. The gateway's `runTier1` is a timing wrapper around `matchTier1`, so live Tier 1 and replay run the same code.
- **D27 (2026-10-24) One hold per held verdict, routed by `config/approvers.json`.** First matching route wins (`category` normalized, `amountUsd <= maxUsd`), else `default`. The hold stores the exact request and the quote id, so an approval pays the stored quote with the same idempotency key as the original attempt. Block never creates a hold.
- **D28 (2026-10-24) Human resolutions are in the hash chain.** `human_approval` (verdict approve, tier null) and `human_rejection` (verdict block) decisions carry the held decision's `paymentRequestId` and link it via `linkedDecisionId`. Budget remaining counts human approvals whose payment did not fail. Approval claims the hold with a compare-and-set before paying, so a double click cannot pay twice; cross-hold budget races wait for M4 reservations.
- **D29 (2026-10-24) Rule proposals are narrow and expire.** Payee, category and task type of the approved purchase, cap = its amount, expiry = `RULE_TTL_MS` (default 7 days). No proposal when any field was PAGE/UNKNOWN or the category is unknown: approving a one-off upsell must not teach the system to trust it. Narrowing may only lower the cap and pull the expiry in; anything else is 400. A failed payment after approval still proposes a rule (the rule records the human's judgment).
- **D30 (2026-10-24) Replay semantics.** Cases = every `verdict` decision, re-run through `matchTier1` with its recorded origins, payee, category, amount, its task's type and its recorded floor (approve iff no floor reason), at replay time, with the candidate treated as active. Known-bad = decisions whose hold a human rejected + verdict blocks. Known-bad and attack matches count the candidate alone; activation re-runs replay and refuses with 409 `REPLAY_FAILED` if either is non-empty, storing the failing report on the still-proposed rule. Summary string: "N cases, M attacks matched, K known-bad matched", from real counts only.
- **D31 (2026-10-24) The attack corpus is templates instantiated at the candidate rule** (`@rule`, `@cap`, `@lookalike`) with an approve floor, so each spec §11 attack is tried at the rule's own vendor, under its cap, with only Tier 1 in the way. Duplicate purchase is not in the M3 corpus: as a Tier 1 context it equals a legitimate repeat; it joins with the M4 duplicate check.
- **D32 (2026-10-24) `Decision.latencyMs` measures the decision** (trace, floors, Tier 1/Tier 2), starting after the vendor's quote is stored. The quote round-trip is the vendor's latency.
- **D33 (2026-10-24) The worker waits on holds.** A held `pay_and_fetch` is polled via `POST /tools/get_hold` every second for up to two minutes; the resolution becomes the tool result. Still open, an error or a 404 → the original held result. `get_hold` is 404 unless the task owns a held decision; while an approved hold's payment is in flight it reports open.
- **D34 (2026-10-24) `/admin/holds` and `/admin/rules` are unauthenticated** like `/admin/tasks` (D13). The approver is the name in the request body; routing chooses whose queue a hold lands in, it does not authenticate anyone.
```

- [ ] **Step 5: Update `README.md`**

In the Status table, replace the row
```markdown
| M3–M7 | not started |
```
with
```markdown
| M3 hold queue + rule chips + replay | done: holds routed by config; approve pays and proposes a narrow rule; replay over the log + attack corpus gates activation; next similar purchase is Tier 1, $0 |
| M4–M7 | not started |
```

In "Real vs simulated", replace the line
```markdown
- Tier 1 rules live in the store only; proposing and approving them from holds is M3.
```
with
```markdown
- Approvers are names from `config/approvers.json`; `/admin/holds` and `/admin/rules` are unauthenticated (hackathon scope). In the benchmark the approver will be simulated from ground-truth labels (M6).
- Replay's attack corpus is a small hand-written set (`packages/rules/src/attack-corpus.ts`); duplicate purchases join it with the M4 duplicate check.
- An approved hold's payment uses the simulated executor like every other payment.
```
and append to the "Real today" sentence (before its final period):
```markdown
, hold queue with config routing, human approve/reject logged in the hash chain, narrow rule proposals, replay against stored decisions and the attack corpus, replay-gated rule activation, worker waiting on holds
```

- [ ] **Step 6: Run the whole suite and the secret check**

Run: `pnpm test && pnpm typecheck`
Expected: all files pass; `m1-live` skipped without a key; 1 todo (INV5). M3 adds roughly 115 tests (shared 10, rules 36, gateway units 9, worker 8, HTTP 22, acceptance 3, INV3-rules 16, plus re-exports); judge by "all pass". Typecheck exits 0.

Run: `git status --short && git ls-files | grep -iE '^\.env($|\.)' | grep -v '.env.example' || echo "no env files tracked"`
Expected: `no env files tracked`.

Run: `grep -rnE "claude-(opus|sonnet|haiku)|[0-9]+\.[0-9]+ ?USD per|\\\$[0-9.]+ per (M|million)" packages tests config || echo "no hardcoded model ids or prices"`
Expected: `no hardcoded model ids or prices`.

- [ ] **Step 7: Commit**

```bash
git add tests DECISIONS.md README.md && git commit -m "$(cat <<'EOF'
test: M3 acceptance (hold -> approve -> rule -> replay -> Tier 1 at $0), INV3 for rules

Approving a held legit purchase pays it and proposes a narrow rule; replay
reports real counts; after activation the next similar purchase is Tier 1 in
ms at $0 without calling the judge. Upsell approvals propose nothing; a
rejected look-alike purchase blocks activation. DECISIONS D26-D34; README.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Milestone report template (fill after Task 8)

| Check | Result |
|---|---|
| INV1, INV2, INV4 (unchanged) | pass/fail |
| INV3 (M2 unit + HTTP, unchanged) | pass/fail |
| INV3 rules: 5 fields × {PAGE, UNKNOWN, missing} → no proposal, no replay match, no Tier 1 match | pass/fail |
| Attack corpus never matched, even at a $1,000,000 cap | pass/fail |
| M3 acceptance 1: held, routed to Sam per config | pass/fail |
| M3 acceptance 2: approve pays once (same idempotency key), worker sees data, proposed rule cap = amount, replay counts | pass/fail |
| M3 acceptance 3 + 7: widening narrow → 400; narrowed activation → active | pass/fail |
| M3 acceptance 4: next similar purchase Tier 1, $0, < 50 ms, judge not called | pass/fail |
| M3 acceptance 5: upsell approval pays, proposes nothing (tainted) | pass/fail |
| M3 acceptance 6: rejected look-alike → activation 409 REPLAY_FAILED | pass/fail |
| Worker waits on holds (fake client) | pass/fail |
| Decision log chain verifies with human decisions | pass/fail |
| Gateway starts with `approvers=1 route(s), default Sam` | pass/fail/not run |
| Live worker against a held payment (real model) | not run in this plan |
