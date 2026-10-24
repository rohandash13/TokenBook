# Countersign: handoff to Codex

Paste the section "PROMPT FOR CODEX" into Codex with the repo at `C:\Users\rohid\Countersign` (branch `main`, last commit `b7c3876`, working tree clean, 345 tests passing, typecheck clean).

Cal Hacks 13.0 hard deadline: Devpost submission Sunday Oct 25 09:00 AM PT (aim for 08:30). Judging 10:30 AM to 12:30 PM. Feature freeze Saturday 10 PM.

---

## PROMPT FOR CODEX

You are taking over an in-progress hackathon build, "Countersign": a gateway that is the only door between a worker AI agent and its money. Read, in this order:

1. `docs/SPEC.md` (source of truth: scope, invariants, data model, acceptance tests, cut order in section 13)
2. `DECISIONS.md` (decisions D1 to D27 and D35; D28 to D34 are missing and must be added, see task A2)
3. `README.md` (status, real-vs-simulated)
4. `docs/handoff/HANDOFF_CODEX.md` (this file: state, remaining work, open decisions)
5. `docs/handoff/progress-ledger.md` (per-task log with every open Minor finding)
6. `docs/handoff/m4-design.md` (binding design notes for milestone 4)
7. `docs/superpowers/plans/2026-10-24-countersign-m3.md` (M3 plan; Task 8 was NOT done)
8. `docs/handoff/constraints.md` (global constraints) and `docs/handoff/reviewer-rules.md` (the review rubric used so far)

### Hard rules (from the project owner; do not break these)
- Testnet only (Base Sepolia). CRS: sandbox test businesses only. The attacker agent may only target pages/endpoints we host ourselves, never real services.
- Never commit secrets. `.env*` is gitignored except `.env.example` (names only). Tell the owner which keys to obtain; never ask them to paste keys into chat or files you commit.
- Never put page text, page summaries, task text or the agent's free-text `purpose` into the Tier 2 judge input. Final verdict must be at least HOLD if any payment field's origin is PAGE or UNKNOWN. Nothing may ever lower a verdict.
- Model IDs come from env vars (`JUDGE_MODEL`, `ATTACKER_MODEL`, `WORKER_MODEL`), never hardcoded. Prices come from env or are null; never invent them.
- Benchmark numbers must come from real runs. No invented or placeholder figures in anything user-facing (README, charts, video script). Flag any placeholder with `TODO`. Before submission run `grep -ri "412"` (see spec section 12).
- Never weaken an invariant to make a demo pass. The five invariants are in spec section 3 and are tested in `tests/invariants/`.
- All code is written fresh in this repo. Nothing is copied from the owner's earlier WalletOS repo.
- If an external dependency (x402 SDK, CDP, CRS, Droid) behaves differently from what the spec assumes, STOP and tell the owner what you found (with the doc or error). The `SimulatedExecutor` is the spec's labelled fallback; label it everywhere.
- Commit small and often. Commit messages end with the trailer line the owner's tool gives you (previous commits used `Co-Authored-By: Claude ...`; for your own commits use your own attribution).
- Environment: Windows 11, Git Bash. Node 24, pnpm 9.15.0 (installed globally with `npm i -g`; `corepack enable` needs admin and fails). Run all commands from the repo root. Tests: `pnpm test`; types: `pnpm typecheck`.
- Method used so far (keep it): TDD (failing test first); after each task a separate review pass with the rubric in `docs/handoff/reviewer-rules.md`; fix every Critical/Important finding before moving on; log Minor findings.

### What is DONE (all committed)
- **M0 repo and decisions**: pnpm monorepo, config, DECISIONS, README skeleton. Droid-only-door test, the real x402 payment and Convex are NOT done (they need the owner's accounts; see section "Owner decisions").
- **M1 gateway skeleton**: `declare_plan`, `fetch_url`, `pay_and_fetch` over HTTP; the worker runs as a separate process with an allowlisted environment, a `fetch` guard that only allows the gateway origin, and a Claude tool loop that reaches the model only through the gateway's `/llm/messages` proxy. INV1 and INV2 tested (static import check, env allowlist, real child process).
- **M2 decision core**: field tracer (TASK > PLAN > QUOTE-for-amount-only > PAGE/UNKNOWN, page-line evidence), floors (taint to hold; amount/tier/quantity/payee mismatch to block; plan limits, unit price, budget), Tier 1 matcher, Tier 2 Claude judge on structured input only, hash-chained decision log. Acceptance passes: premium upsell is held with the trace pointing at the docs page line; 2 x $0.10 is approved; $40 vs $0.40 is blocked. INV3 and INV4 are real tests.
- **M3 (Tasks 1 to 7 of 8)**: holds with routing (`config/approvers.json`), `get_hold`, worker hold polling, `packages/rules` (single shared Tier 1 matcher, `proposeRule`, tighten-only `narrowRule`, routing, hand-written attack corpus, `replayRule`), approver API (`/admin/holds`, approve/reject, `/admin/rules`, replay-gated activation that refuses with 409 `REPLAY_FAILED`), rule CAS, settled-payment persistence before rule proposal.

### Current state of the in-flight review
- M3 Task 6 fix commit `b7c3876` has NOT had its re-review. Review it against `docs/handoff/reviewer-rules.md`: no window where a settled payment can be lost; no rule can be `active` after a successful reject response; rejecting an active rule is consistent.

### REMAINING WORK, in order

**A. Finish M3**
- A1. Re-review `b7c3876` (above).
- A2. M3 Task 8 (see the M3 plan, Task 8): `tests/m3-acceptance.test.ts` (approve a hold; payment executes; rule proposed; replay reports real counts; activate; the next similar purchase is Tier 1, cost 0, fast, and the judge is NOT called; upsell approval proposes NO rule; activation refused with 409 `REPLAY_FAILED` when a known-bad decision would match; widening narrow is a 400), an INV3-for-rules test, DECISIONS D28 to D34 (insert before D35; do not renumber D35), README status. README must state: the attack corpus and replay are a small hand-written set pinned to the demo vendor/category/task type; the Tier 2 judge and the Claude worker have not been run live yet.

**B. Final-wave fixes for M0 to M3 (open Minor findings, see the ledger)**
- B1. INV3 tests: assert the hold reason names the tainted field, and that a clean variant under the same rule and an approving judge IS approved (so the hold is caused by taint, not by an allowlist or mismatch).
- B2. Judge: send `payment.tier` only if it is an exact member of the matched plan item's tiers, else the constant `"unlisted-tier"`; the injection test should assert the exact sanitized category.
- B3. Normalize/host boundaries: use an ASCII whitelist of allowed boundary characters (combining marks, zero-width characters, fullwidth digits must not count as boundaries); `"$5abc"` should not be money; add NFD/ZWSP tests.
- B4. Floors: compare unit price in atomic units (`atomic(total) <= atomic(max) * quantity`), make the budget check fail closed on NaN (`!(charge <= remaining)`), add edge tests.
- B5. Simpay: framing of the MAC (length-prefix or JSON-encode the tuple; digits-only check on `amountAtomic`), `usdToAtomic` guard for NaN/negative/Infinity, return a rebuilt object from `verifySimPayment`.
- B6. Misc: `appendDecision` should strip `prevHash`/`hash` from the draft; expose the chain head hash; `Number.isSafeInteger` for quote quantity; `updateHold` ignore undefined patch keys; `decide` should record the judge error cause; revert `tracer.test.ts` to the package-index import; a comment on `TraceResult` that on a mismatch the origin describes the requested value while `amountUsd` is the quote's; boundary test cap 14.99 passes and 15 fails.
- B7. Run a whole-branch review at the end of everything (one pass over the full diff, most capable model available), then one fix pass.

**C. M4** (design is binding in `docs/handoff/m4-design.md`; the plan document was NOT written, write it first or just implement task by task): atomic budget reservations; idempotency key from payment-relevant fields only (url, quote payee, amount, tier, quantity; NOT `purpose`); duplicate catch with "saved $5" (new arena `/api/report` priced $5.00, category research, add to `config/catalog.json`); timeout and ambiguous-outcome handling (`executor.confirm`, never a second payment, INV5 test becomes real); receipts and rule-based delivery check; `payees.deliveryFailures` feeding the judge's `payeeRecord` and a floor (default hold at 2 failures); read APIs for the dashboard (`/admin/decisions`, `/admin/receipts`, `/admin/budget/:taskId`, `/admin/chain/verify`, `/admin/payees`) and a `computeMetrics` helper built only from real stored data.

**D. M5 CRS payee check**: first payment to a new payee triggers one CRS sandbox pull; a failure or a lien above threshold forces HOLD; fallback is the approved-vendor list (`config/crs-map.json`, `config/allowlist.json`). Show a short on-screen note of what is pulled and why (the CRS rule). Use ONLY CRS test businesses. If CRS credentials/docs differ from the spec's assumptions, stop and tell the owner.

**E. M6 benchmark** (spec section 12): about 30 generated legitimate task templates, about 40 hand-checked attacks (weighted toward cases simple rules miss), a few cases adapted from public benchmarks labelled as adapted. Three setups on identical cases: (A) cap + allowlist + quote check, (B) Claude alone (sees agent reason + payment, no tracing), (C) Countersign. Metrics: attack success rate per attacker round, false-hold rate shown next to every attack number, autonomy rate across the task sequence, cost per check, money saved. The approver in the benchmark is simulated from ground-truth labels (say so in the README). Every number must come from real runs; say "0 of N in the final round", never "no attacks ever"; show the round the attacker won and what changed. Attacker agent: only against our own arena, model from `ATTACKER_MODEL`, with a hard cost cap for the overnight run. If time is short, use the spec's cut order: adaptive attacker becomes a fixed attack set.

**F. M7 dashboard** (`apps/dashboard`, Next.js + Tailwind + shadcn/ui): trace view first (a judge must read it from across a table: field, origin, page quote and line number), ledger with "Tier 1, 4 ms, $0" style rows, hold queue with rule chips (approve / narrow / reject in one click, replay line "N cases, M attacks matched"), results screen with autonomy and cost curves (data from the real benchmark run only). Reads the `/admin/*` endpoints.

**G. Demo, video, README**: 3-minute demo script per spec section 14 (the moment first: premium upsell passes cap, allowlist and Claude-alone; Countersign shows the tier came from docs-page line N). Backup video Saturday night. README with the honest "real vs simulated" section, benchmark table from real runs, limits (tracing can miss laundered text; false holds are measured and shown; admin routes are unauthenticated by design; worker isolation is process-level, not OS-level). Verify every claim about prior work (spec section 18) or drop it.

### Cut order if time runs short (spec section 13)
Nessie, extra controller numbers, extra delivery failure modes, public benchmark cases down to 5, adaptive attacker becomes a fixed attack set, Droid (use our own loop), CRS (approved-vendor list only). Never cut: Countersign as only door and key holder, field trace view, two tiers with rules, the premium-upsell moment, the three-setup benchmark table with false-hold rate, a stable live demo and a backup video.

---

## API keys and accounts the owner must obtain (names only; put values in a local `.env`, never commit)

| Env var(s) | Where to get it | Needed for | Required? |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | platform.claude.com, API keys. Set a monthly spend limit there. | Tier 2 judge, worker agent (via the gateway proxy), attacker, "Claude alone" baseline | Yes, for the live demo and the benchmark. Tests use fakes and run without it. |
| `JUDGE_MODEL`, `WORKER_MODEL`, `ATTACKER_MODEL` | Model IDs from Anthropic's model list | Which model each role uses | Yes (choose a cheaper model for the judge/worker; a stronger one for the attacker if budget allows) |
| `JUDGE_INPUT_USD_PER_MTOK`, `JUDGE_OUTPUT_USD_PER_MTOK` | Copy from Anthropic's pricing page for the chosen judge model | Cost per check shown in the ledger and results | Optional. If unset, cost is recorded as unknown (null), never invented. |
| `SIM_PAYER_SECRET` | Any random string you generate | Gateway and arena shared secret for the simulated executor | Yes (the simulated path) |
| `EXECUTOR` | `simulated` (default) or `x402` once the real executor exists | Payment path | `simulated` works today |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` | portal.cdp.coinbase.com | Real x402 payment on Base Sepolia | Only if the real testnet payment is attempted |
| `X402_NETWORK=base-sepolia` | Constant | x402 | With CDP |
| (no env var) testnet USDC | Base Sepolia faucet (Circle or CDP faucet) plus a second address as the arena vendor's `payTo` | Real testnet payment | With CDP |
| `CRS_USERNAME`, `CRS_PASSWORD` | Sponsor-provided CRS sandbox credentials and the list of test businesses | M5 payee check | Optional (fallback: approved-vendor list) |
| `CONVEX_URL` (+ `CONVEX_DEPLOY_KEY` if needed) | `npx convex dev` (log in) | Persistent store instead of in-memory | Optional. The in-memory `MemoryStore` works for the demo; Convex only matters if you want persistence across restarts. |
| `DROID_*` / `FACTORY_API_KEY` | Factory | Droid as the worker agent | Optional (cut-order item; the own Claude loop already works) |
| `GATEWAY_URL`, `GATEWAY_HOST`, `GATEWAY_PORT`, `ARENA_PORT`, `RULE_TTL_MS` | Defaults exist in `.env.example` | Local wiring | No |

Secrets hygiene: `.env` is gitignored; `.env.example` holds names only. Before the repo goes public run `git ls-files | grep -iE '(^|/)\.env'` (should show only `.env.example`) and search history for keys.

---

## Design decisions still OPEN (owner's call; recommended default in bold)

1. **Real x402 vs simulated payments.** **Keep `SimulatedExecutor` as the labelled default; add a real Base Sepolia executor only if B's M0 test (one real payment returns 200) passes.** If the x402 SDK or CDP behaves differently from the spec, stop and report.
2. **Persistence: Convex vs in-memory.** **In-memory `MemoryStore` for the demo** (a Convex adapter behind the same `Store` interface is optional and only needed for persistence across restarts or a shared hosted demo). Backend choice is owner "C" in the spec.
3. **Droid as the only door.** **Use our own Claude loop**; Droid is a cut-order item. If the owner's teammate (D) passes the "built-in web/shell off" test, swap Droid in behind the same three tools.
4. **CRS vs approved-vendor list.** **Approved-vendor list first**, add CRS sandbox pulls only if credentials and docs match the spec (M5). Which CRS test businesses stand in for demo vendors is owner "B".
5. **Hyphenate track fit.** Does "spending authority for AI agents" count for "The Hyphenated Enterprise: Autonomous Systems for Finance"? **Ask a Hyphenate rep / check the track brief before submitting; framing in the README should lead with "autonomous finance control: limits enforced in code, a record of every decision, knowing when to ask, honest real-vs-simulated proof".** Also: Coinbase one track or two.
6. **Idempotency key content (M4).** **Only payment-relevant, quote-charged fields (url, payee, amount, tier, quantity), never `purpose`.** (Already decided in `m4-design.md`.)
7. **Ambiguous payment outcome (M4).** **Keep the money reserved, confirm via executor status, never pay twice; if still unknown, return held "outcome unknown" for manual reconciliation.** (Already decided.)
8. **Held payments and the budget (M4).** **A held payment keeps no reservation while it waits; approval re-reserves atomically and fails 409 if the budget no longer fits.** (Already decided.)
9. **Replay corpus scope.** The corpus is pinned to the demo vendor/category/task type, so it cannot catch over-broadness on other vendors. **Accept for the hackathon and say so in the README; a follow-up could derive cap-only attacks from the candidate rule's own payee/task type.**
10. **Negation window in tier tracing.** Only two tokens before the tier mention count as negation, so "never, under any circumstances, use the premium tier" still counts as TASK. The unit-price floor bounds the impact. **Accept and document as a rule-based limitation, or add a sentence-level negation guard if time allows.**
11. **Admin routes are unauthenticated** (D13/D34). **Accept for the hackathon (production auth is a spec non-goal); keep the loopback bind default (`GATEWAY_HOST=127.0.0.1`).** Never expose the gateway on a public interface while `/llm/messages` holds a real API key.
12. **Rule lifetime.** Default 7 days (`RULE_TTL_MS`, max 365 days). **Keep; show expiry in the chips.**
13. **Benchmark attacker.** **Adaptive attacker with a hard cost cap if budget allows, else a fixed attack set** (spec cut order). Needs the owner's decision on the overnight API spend limit.
14. **Hold-routing config.** `config/approvers.json` currently has one route (small coding purchases to "Priya", everything else to "Sam"). **Keep as the spec states.**
15. **Dashboard stack.** **Next.js + Tailwind + shadcn/ui per spec; a minimal trace view first, then the ledger, hold queue and results screen.**

---

## Known limitations (must appear in the README, honestly)
- Tracing can miss laundered text (a value restated in different words on a page).
- False holds are measured and shown next to every attack number.
- The worker is isolated at process level (env allowlist, `fetch` guard, static import check), not by an OS sandbox.
- Payments are simulated unless the real x402 executor lands; the arena (vendors and pages) is ours; the approver in the benchmark is simulated from ground-truth labels.
- The Tier 2 judge and the live Claude worker have not been run against the real API yet (no key was available while building); all their tests use fakes.
- The decision log is in memory and its tail truncation is undetectable without an external head anchor.
