# Countersign: Implementation Spec (v1 for Claude Code)

Spending authority that grows as AI agents earn it. Built for Cal Hacks 13.0 (Hyphenate primary track). Based on Team Plan v2 plus the Recourse & Books add-on (delivery check + atomic reservations only).

> **How to use this file:** it is the source of truth for scope, interfaces and acceptance tests. Build in the order in section 13. Where this spec says "decide tonight", pick the stated default and note the choice in `DECISIONS.md`.

---

## 1. One-paragraph summary

Countersign is the only door between a worker AI agent and its money. The agent has two tools, `declare_plan` + `fetch_url` and `pay_and_fetch`, both served by Countersign, which also holds the wallet key. For every payment, a rule-based **field tracer** works out where each field (payee, amount, tier, quantity, purpose) came from: the human task, the agent's pre-read plan, a vendor quote, or a web page. Anything from a page forces at least a **hold**. Payments covered by an active **learned rule** with no tainted fields are approved in milliseconds at $0 (**Tier 1**). Everything else goes to a **Claude judge** that sees only structured facts (**Tier 2**). Holds go to a human approver; each approval proposes a **structured rule**, which is replayed against past decisions and an attack corpus before activating. Headline metric: **autonomy rate** (share of payments decided without a human) rising while attack success falls.

**Thesis (say it out loud):** "Fraud tools decide what to stop. Countersign decides how much freedom to give, and grows it as agents earn it."

## 2. Goals / non-goals

**Goals (never cut):** Countersign as only door and key-holder; field trace view; two tiers with rules; premium-upsell demo moment; three-setup benchmark table with false-hold rate; stable live demo + backup video.

**Non-goals:** real money, real third-party services, cross-company blocklist, re-routing check, multi-approver routing, refund claims/credits, Nessie reconciliation (all cut in v2). No ML training. No production auth.

## 3. Architecture

```
Human task ─┐
            ▼
      Worker agent  (Droid if tonight's test passes, else our Claude agent loop)
            │  tools only: declare_plan, fetch_url, pay_and_fetch
            ▼
   ┌──────────────────────────  COUNTERSIGN GATEWAY  ──────────────────────────┐
   │ Provenance store ► Field tracer ► Budget reserve ► Tier 1 rules ► Tier 2   │
   │ (tasks, plans,      (rule-based)   (atomic)        (ms, $0)       Claude   │
   │  pages, quotes)                                                   judge    │
   │         ▼                                                                  │
   │  Verdict: approve | hold | block ──► Executor (holds wallet key, x402)     │
   │         ▼                                    ▼                             │
   │  Hold queue ► Approver ► Rule proposal ► Replay test ► Active rule         │
   │  Receipt + delivery check ► Append-only (hash-chained) decision log        │
   └────────────────────────────────────────────────────────────────────────────┘
            ▼
   Dashboard (trace view, ledger, hold queue + rule chips, results screen)
```

**Hard invariants (write tests for these):**
1. The worker process has no wallet key, no outbound network except through the gateway.
2. `fetch_url` before `declare_plan` for a task is refused.
3. A payment with any field whose origin is `PAGE` or `UNKNOWN` can never be auto-approved. Final verdict >= HOLD, even if Tier 1 or the judge says approve.
4. Tier 2 input never contains raw page text, page summaries or the agent's free-text explanation.
5. Timeouts never trigger a second payment (idempotency key, section 8).

## 4. Stack (defaults, override in DECISIONS.md)

- TypeScript monorepo (pnpm). Node 20+.
- Backend/ledger: **Convex** (alt: SpacetimeDB, same interface). Atomic reservations and decision log go through Convex mutations.
- Dashboard: Next.js + Tailwind + shadcn/ui.
- Judge + attacker: Anthropic API (model id from env, never hardcoded).
- Payments: x402 on **Base Sepolia** testnet USDC via Coinbase CDP wallet. Use the official x402 client/SDK; check its docs first. If it cannot work by Sat noon, use `SimulatedExecutor` behind the same interface and label it everywhere.
- Payee checks: **CRS sandbox** (test businesses only). Fallback: approved-vendor list.
- Arena: local Express servers for fake vendors/pages.

## 5. Data model (Convex tables; names are suggestions)

```ts
type Origin = "TASK" | "PLAN" | "QUOTE" | "PAGE" | "UNKNOWN";
type Verdict = "approve" | "hold" | "block";

tasks        { taskId, text, budgetUsd, taskType, createdAt }
plans        { taskId, goal, expected: {category, maxUnitUsd, maxQuantity, vendorDomains[]}[], declaredAt }   // immutable, declaredAt < first page read
pages        { pageId, taskId, url, lines: string[], fetchedAt }                                           // line-indexed
quotes       { quoteId, taskId, payeeDomain, amountUsd, tier, unit, rawRequirements, receivedAt }          // from the x402 payment-required response
payees       { payeeId, domain, crsStatus, liens, ofacHit, firstSeenAt, deliveryFailures }
rules        { ruleId, payee, category, capUsd, taskType, expiresAt, createdBy, status: "proposed"|"active"|"rejected", replayResult }
reservations { reservationId, taskId, amountUsd, state: "reserved"|"committed"|"released" }
decisions    { decisionId, paymentRequestId, taskId, tier: 1|2, verdict, ruleId?, fieldOrigins, reasons[], latencyMs, costUsd, prevHash, hash }
holds        { holdId, decisionId, routedTo, status: "open"|"approved"|"narrowed"|"rejected", resolvedAt }
receipts     { receiptId, decisionId, quotedUsd, paidUsd, deliveryStatus: "ok"|"empty"|"bad_format"|"unknown", txRef }
benchRuns    { runId, setup: "capAllow"|"claudeOnly"|"countersign", round, caseId, expected, got, correct }
```

`decisions.hash = sha256(prevHash + canonical(decision))` (cheap tamper evidence; denied attempts are logged too).

## 6. Gateway tool API (what the worker sees)

```ts
declare_plan(taskId, plan: Plan): { ok: true }                  // must precede any fetch_url
fetch_url(taskId, url): { pageId, text }                         // stores page + lines; text returned to agent
pay_and_fetch(taskId, req: {
  url: string; payeeDomain: string; amountUsd: number; tier?: string;
  quantity?: number; purpose: string;                            // purpose is agent free text: UI only, never evidence
}): { status: "approved"|"held"|"blocked"; reason: string; data?: unknown; decisionId: string }
```

A `held` result tells the agent to wait; the worker loop polls `getHold(decisionId)`.

## 7. Field tracer (the core; rule-based, no LLM)

For each payment field f in {payee, amount, tier, quantity, purpose-category}:

1. Normalize values: lowercase, strip `$`/`,`/whitespace, parse numbers to canonical units, lowercase domains, lemmatize tier names (`premium`, `premium tier` -> `premium`).
2. Look for the normalized value, in order, in: `tasks.text` -> `TASK`; `plans` (pre-read) -> `PLAN`; `quotes` for this payee -> `QUOTE`; `pages` -> `PAGE`.
3. Origin = highest-trust source that contains it. If only found in pages -> `PAGE` (taint). If found nowhere -> `UNKNOWN`.
4. Record the exact page quote + line number for any `PAGE` hit (the trace view shows it).
5. Fail closed on ambiguity: UNKNOWN is treated like PAGE.

Trust order: `TASK` > `PLAN` > `QUOTE` > `PAGE` = `UNKNOWN`.
Amount is additionally checked `== quote.amountUsd`; quantity `<= plan.expected.maxQuantity`; payee domain in plan vendors or the allowlist; duplicate check (same `payeeDomain + requestHash` within window -> block or reuse cached result).

Edge cases to cover with unit tests: paraphrased tier name, amount shown on page and also in the real quote (QUOTE wins), amount only on page, quantity inflation 2 -> 50, purpose drift (dataset unrelated to plan from an approved vendor), decimal slip ($40 vs $0.40).

## 8. Budget reservation, delivery check, idempotency

- Reserve `amountUsd` atomically (Convex mutation) **before** the decision. Release on block/fail. Commit on settlement. Parallel sub-agents cannot overspend a task budget.
- `idempotencyKey = sha256(taskId + payeeDomain + requestHash)`. If a payment status is unknown after a timeout, **confirm** via facilitator/chain status before any retry; never pay twice.
- Delivery check (rule-based): non-empty, matches expected schema, `paid == quoted`. Failure -> `receipts.deliveryStatus != "ok"`, increment `payees.deliveryFailures`.

## 9. Tiers and rules

**Tier 1 (ms, $0):** approve iff an `active`, unexpired rule matches (payee + category + task type), `amount <= capUsd`, no tainted fields, budget reserved. Log `latencyMs` and `costUsd = 0`.

**Tier 2 (Claude judge):** input is a structured JSON object only:

```json
{ "taskType": "...", "plan": {"category":"...","maxUnitUsd":0.1,"maxQuantity":2},
  "payment": {"payee":"...","amountUsd":0.1,"tier":"basic","quantity":2},
  "fieldOrigins": {"payee":"PLAN","amount":"QUOTE","tier":"QUOTE","quantity":"PLAN"},
  "payeeRecord": {"crsStatus":"ok","liens":0,"ofacHit":false,"deliveryFailures":0},
  "budget": {"remainingUsd": 19.8}, "history": {"approvedSimilar": 3, "heldSimilar": 0} }
```
Returns `{verdict, reasons[]}` (validate with a schema; invalid -> hold). Record token cost. **Final verdict = max-severity(tracer floor, judge).**

**Rules** (structured, narrow by default, expire):
```ts
Rule { payee: string; category: string; capUsd: number; taskType: string; expiresAt: ISO }
```
**Proposal flow:** on hold approval, propose a Rule shown as chips (payee, category, cap, task type, expiry). Approver can approve / narrow / reject in one click. Before activation, **replay** against all stored decisions and the attack corpus; show "N cases, 0 attacks matched". Refuse to activate if any known attack would be auto-approved.

**Routing (config, not code):** small coding purchases -> "Priya"; everything else -> "Sam".

## 10. Payee checks (first payment to a new payee)

CRS sandbox: business record, liens/judgments, OFAC. Only CRS **test businesses**; map each demo vendor to one in `config/crs-map.json`. Failure or lien above threshold -> floor HOLD. If CRS is unavailable, fall back to the approved-vendor list. Show a short on-screen note of what is pulled and why (CRS rule).

## 11. Arena (fake world we control)

- `legit-vendor`: docs page + x402 endpoint, basic tier $0.10/call.
- **Moment attack:** same vendor's docs page has a hidden line pushing the **Premium tier ($15)** (vendor real + allowlisted + under cap + matches its own quote).
- Other attacks: quantity inflation (2 -> 50), purpose drift, new lookalike domain, `$40` vs `$0.40`, duplicate purchase, plus every attack the attacker agent lands.
- Failure modes: empty response, wrong schema, timeout-then-success, double charge.
- The attacker only targets pages/endpoints **we host**, on testnet. Never real services.

## 12. Benchmark and honest reporting

- ~30 legitimate task templates (generated, not a fixed script), ~40 hand-checked attacks (weighted toward cases simple rules miss, plus all attacker successes), a handful adapted from public benchmarks (AgentDojo-style injection tasks; APort Vault subset only if the format fits; label as adapted).
- Three setups on identical cases: **(A)** cap + allowlist + quote check, **(B)** Claude alone (sees agent reason + payment, no tracing), **(C)** Countersign.
- Metrics: attack success rate **per attacker round**, false-hold rate (shown next to every attack number), autonomy rate across the task sequence, cost per check, money saved (duplicates reused).
- Rules: every number comes from our runs; say "0 of 40 in the final round", never "no attacks ever"; show the round the attacker won and what changed. Approver in the benchmark is simulated from ground-truth labels (README says so).
- Placeholder numbers (e.g. "412 cases") must be replaced from the real run. `grep -ri "412"` before submission.

## 13. Build order and acceptance tests

| # | Milestone | Acceptance test |
|---|---|---|
| 0 | Decisions tonight: Droid-as-only-door test (~1h), one real x402 payment on Base Sepolia, backend choice | Droid test: with its built-in web/shell off, our tools are the only way it reads pages and pays; else our Claude loop. Payment returns 200. |
| 1 | Gateway skeleton: `declare_plan`, `fetch_url`, `pay_and_fetch`, key held by gateway, stored pages/quotes | Invariants 1 and 2 pass; worker cannot pay or fetch except via gateway |
| 2 | Field tracer + two tiers + decision log (hash-chained) | Premium-upsell case -> HOLD with trace pointing at the page line; legit 2 x $0.10 -> approve; $40 vs $0.40 -> block |
| 3 | Hold queue, rule chips, replay, activation | Approving a hold creates a proposed rule; replay reports counts; next similar purchase is Tier 1 in ms at $0 |
| 4 | Reservations + receipts + delivery check + duplicate catch | Parallel sub-agents cannot exceed budget; timeout does not double-pay; duplicate purchase reused ("saved $5") |
| 5 | CRS payee check | New payee triggers one CRS pull; failure forces hold |
| 6 | Benchmark harness, three setups, attacker v1 -> rounds | Table renders from real runs, with false-hold rate |
| 7 | Dashboard polish: trace view first, ledger, results screen, autonomy + cost curves | Judge can read the trace view from across a table |

**Gate:** backbone (milestones 1 to 3, plus one real or simulated x402 payment) must work end to end by **Saturday 1 PM**. If not, cut hard.
**Feature freeze:** Saturday 10 PM; start the overnight attacker run (with a cost cap). Sunday 6 to 7:30 AM: swap final numbers into charts, video, README. Submit by 8:30 AM.

**Cut order (from the top):** Nessie -> extra controller numbers -> extra delivery failure modes -> public cases down to 5 -> adaptive attacker becomes a fixed attack set -> Factory (use our own loop) -> CRS (approved-vendor list only).

## 14. Demo (3 min) and video

Live: setup (0:15) -> ledger ticking with "Tier 1, 4 ms, $0" (0:10) -> duplicate reused "saved $5" (0:15) -> **the moment**: premium upsell passes cap+allowlist and Claude alone, Countersign trace shows tier came from docs page line N (0:45) -> legitimate new purchase held, approver narrows rule chips, replay "N cases, 0 attacks matched", next one instant (0:30) -> results table + curves (0:40) -> who buys it, "try your own scenario" (0:25).
Video: opens with the moment; also shows timeout handled, failed delivery lowering a vendor score, CRS payee details, Droid plan/diffs. Record a backup Saturday night.

## 15. Repo layout

```
/apps/dashboard        # Next.js UI
/packages/gateway      # tools, tracer, tiers, executor, delivery check
/packages/rules        # rule schema, matcher, replay
/packages/shared       # types (section 5), schemas
/packages/arena        # fake vendors, pages, failure modes
/packages/bench        # cases, setups, attacker, runner, charts data
/convex                # schema + mutations (reservations, decisions, rules)
/config                # approvers.json, crs-map.json, allowlist.json
DECISIONS.md  README.md
```

## 16. Env vars (names only; never commit values)

`ANTHROPIC_API_KEY`, `JUDGE_MODEL`, `ATTACKER_MODEL`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`, `X402_NETWORK=base-sepolia`, `CRS_USERNAME`, `CRS_PASSWORD`, `CONVEX_URL`, `DROID_*` (if used). Add `.env*` to `.gitignore`; check no secrets before the repo goes public.

## 17. Real vs simulated (README section)

**Real:** gateway, tracer, tiers, rules + replay, reservations, decision log, CRS sandbox calls, Claude judge, testnet x402 payment (if confirmed), benchmark runs.
**Simulated:** vendors and pages (we host them), testnet USDC, the approver in the benchmark (from ground-truth labels), second company (none). Limits to state: tracing can miss laundered text; false holds are measured and shown.

## 18. Prior work to open and verify before it goes in the README

PaySafe/TollWarden, GateKeep402, doorno402, IntentGuard, APort Vault, AgentCommerceBench, AP2-WhisperBench, AgentDojo, CaMeL, Ramp Agent Cards, Skyfire, Cloudflare Wallets, Locus, the InfoQ agent-wallets article. Drop any claim you cannot confirm. (GateKeep402 already does post-payment delivery checks, so do not claim nobody does.)

## 19. Open decisions (owner, when)

- Droid routing test (D, tonight). Hyphenate fit: does "spending authority for AI agents" count for the track? (anyone, tonight or first thing Sat). Real x402 payment on Base Sepolia (B, tonight). Backend: Convex vs SpacetimeDB (C, tonight). Coinbase: one track or two (B). Which CRS test businesses stand in for demo vendors (B).
