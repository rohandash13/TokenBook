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
