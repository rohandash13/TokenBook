# Decisions

Running log. Newest at the bottom. Format: ID, date, decision, why.

- **D1 (2026-10-24) QUOTE is an origin for amount only.** Payee, tier, quantity and category are the agent's choices and must trace to TASK or PLAN, else PAGE/UNKNOWN. Why: a vendor quote echoes whatever tier the agent asked for, so trusting it for tier lets the premium-upsell attack through.
- **D2 (2026-10-24) `plan.expected[].tiers?: string[]`.** Why: without it a legitimate "basic" purchase traces to UNKNOWN and is held.
- **D3 (2026-10-24) Category comes from `config/catalog.json` keyed by endpoint URL**, compared to `plan.category`. Unknown URL = UNKNOWN. The agent's `purpose` text is UI only. Lands in M2.
- **D4 (2026-10-24) Checks set floors; final verdict = max severity.** Tainted field → hold; amount ≠ quote → block; quantity > maxQuantity → hold; payee not in plan/allowlist → hold; duplicate → block or reuse. Nothing can lower a verdict.
- **D5 (2026-10-24) `Store` interface with `MemoryStore` for M1 and tests.** Convex adapter behind the same interface in M2/M3.
- **D6 (2026-10-24) M1 fails closed.** Until the decision core exists, every `pay_and_fetch` is HOLD and the executor's `pay` is never called.
- **D7 (2026-10-24) The worker reaches Claude only via the gateway's `/llm/messages`.** The gateway holds `ANTHROPIC_API_KEY` and forces `WORKER_MODEL` (new env var, not in spec §16). Why: invariant 1 says no outbound network except the gateway.
- **D8 (2026-10-24) Worker isolation is process-level, not OS-level:** allowlisted env, a global `fetch` guard, and a static check that worker code imports no network/wallet modules. README states this limit.
- **D9 (2026-10-24) `fetch_url` and `pay_and_fetch` only reach hosts in `config/allowlist.json`** (our arena). Enforces the "only target what we host" rule and blocks SSRF.
- **D10 (2026-10-24) `SimulatedExecutor` pays with an HMAC-signed `x-sim-payment` header**, not the x402 wire format. The arena's 402 body mimics x402's `accepts` shape so the real executor is a drop-in. Labelled `simulated` everywhere.
- **D11 (2026-10-24) Added `packages/worker`** (not in spec §15): `src/` runs inside the worker process and has zero dependencies; `launch/` is operator-side.
- **D12 (2026-10-24) Tooling:** pnpm 9.15.0 installed with `npm i -g` because `corepack enable` needs admin on this machine. Express 5, zod 3.
- **D13 (2026-10-24) `/admin/tasks` is unauthenticated.** Production auth is a spec non-goal.
- **D14 (2026-10-24) `.gitattributes` forces LF line endings.** Why: Windows checkout; tests split text on newlines.

- **D15 (2026-10-24) Gateway and arena bind to 127.0.0.1 by default.** `GATEWAY_HOST` overrides for the gateway. Why: `/admin/tasks` is unauthenticated and `/llm/messages` spends the real API key.

- **D16 (2026-10-24) Quantity and amount semantics.** Vendor endpoints take `qty=N` (default 1); the 402 amount = unit price × N and `extra` carries `{ tier, unit, quantity }`. 2 × $0.10 is one $0.20 payment with quantity 2. Unit price = amount / quantity, compared to the matched plan item's `maxUnitUsd`.
- **D17 (2026-10-24) The traced tier is the quote's tier**, i.e. what the vendor will charge for, not `req.tier`. `req.tier`, `req.quantity`, `req.amountUsd` or `req.payeeDomain` that differ from the quote → block.
- **D18 (2026-10-24) Decision-log hashing lives in `@countersign/shared`.** `hash = sha256(prevHash + canonical(decision without prevHash/hash))`, genesis = 64 zeros, one global chain. Every `Store` computes it inside `appendDecision`, which replaces `putDecision`. Approve, hold and block are all appended.
- **D19 (2026-10-24) Unknown cost is `null`, never a guess.** `Decision.costUsd` is `null` when `JUDGE_INPUT_USD_PER_MTOK` / `JUDGE_OUTPUT_USD_PER_MTOK` are unset. `Rule.expiresAt` is epoch ms (spec says ISO) so expiry checks need no parsing.
- **D20 (2026-10-24) Tier 2 fails closed.** No judge configured (no `ANTHROPIC_API_KEY` or `JUDGE_MODEL`) → HOLD "no judge configured". HTTP error, network error, unparseable or schema-invalid output, or a non-verdict from any judge → HOLD "judge output invalid". The judge is skipped on a block floor. The vendor-supplied tier is normalized and cut to 32 characters before it reaches the judge.
- **D21 (2026-10-24) A quote with a non-integer or non-positive `extra.quantity` is rejected** (`UPSTREAM_FAILED`); a missing quantity means 1.
- **D22 (2026-10-24) No plan item for the endpoint's category → HOLD**, even if the category word appears in the task. Payee, tier and quantity then trace against the union of plan items.
- **D23 (2026-10-24) Executor failure after approve → `blocked`** plus a second decision (`kind: "executor_failure"`, same `paymentRequestId`). Budget remaining = task budget − approved amounts whose payment did not fail. Atomic reservations are M4.
- **D24 (2026-10-24) `config/allowlist.json` gains `payeeAllowlist`**, empty by default, so only plan vendors pass the payee floor.
- **D25 (2026-10-24) `decide()` re-checks taint after both tiers** and forces HOLD if a PAGE/UNKNOWN field would be approved. Defense in depth for INV3, independent of the floor code.
- **D26 (2026-10-24) Tracer review hardening.** Tier TASK origin requires "tier"/"plan" adjacency in the task text and no negation; quantity is trusted only within the plan item's `maxQuantity`; a req/quote mismatch keeps the field tainted and attaches page evidence for the requested value (so the $40 decimal slip points at its page line).
- **D27 (2026-10-24) Judge input sanitization.** Payee must be a plain host; category and taskType are cut to `[a-z0-9-]` and 32 characters; the judge call has a timeout; the response must have `stop_reason: "end_turn"`, otherwise HOLD "judge output invalid".
