# SDD progress
Task 1 (M1 plan): implemented 608cde8..5832b1b (review pending)
Task 1 (M1): complete (commits 608cde8..5832b1b, review clean)
MINOR (M1 T1): README "Real today" lists unbuilt items; manifests minified by pnpm; TS7/vitest5 very new.
Task 2 (M1): implemented 5832b1b..9466586 (review pending)
Task 2 (M1): complete (commits 5832b1b..9466586, review clean)
MINOR (M1 T2): simpay MAC uses unescaped '|' framing + no digit check on amountAtomic; usdToAtomic no finite/neg guard; verify returns extra keys; amountUsd schema lacks .finite(); types duplicate zod schemas; putPage/putQuote append vs upsert; test gaps (schemas, other tamper cases).
Task 3 (M1): implemented 9466586..4b82ff9 (review pending)
Task 3 (M1): review NEEDS FIX — Object.hasOwn tier lookup (+test constructor/__proto__); also bind arena main to 127.0.0.1. Queue after Task 4. MINOR: docs page no simulated label; ARENA_PORT NaN; payment-header garbage/resource-mismatch tests missing; payTo constant.
Task 4 (M1): implemented 4b82ff9..195931a (review pending)
Task 4 (M1): review NEEDS FIX — strict /^\d+$/ maxAmountRequired (+NaN/neg/empty tests), redirect:'manual'/'error' in getQuote+pay (+test), arena devDep in gateway. Note for T6: fetchPage must not follow redirects. MINOR: pay no timeout (M4), quote.resource vs url unchecked, txRef prefix collision, new URL TypeError not QuoteError.
Task 3 (M1): complete (commits 9466586..4b82ff9 + fix 0297921, re-review clean)
NOTE for T8: run.ts arena docs URL must use 127.0.0.1 not localhost (arena now binds IPv4 loopback). Also .env.example GATEWAY_URL localhost ok (gateway binds all).
Task 4 (M1): complete (commits 4b82ff9..195931a + fix 9cbf991, re-review clean)
MINOR (M1 T4): amountUsd precision for huge atomic strings (policy should compare atomic); zero/leading-zero amounts accepted.
Task 5 (M1): implemented 9cbf991..ec6a13e (review pending). MINOR: T5 trailer says Sonnet 5.5.
Task 5 (M1): complete (commits 9cbf991..ec6a13e, review clean)
MINOR (M1 T5): proxy forwards stream/max_tokens unrestricted (force stream:false, cap max_tokens); no timeout; non-JSON upstream throws (server route maps to 502).
Task 6 (M1): implemented ec6a13e..5bd31bb (review pending)
Task 6 (M1): implemented ec6a13e..5bd31bb, review approved w/ Important: gateway main binds 0.0.0.0. QUEUED FIX (after T7): bind 127.0.0.1 (GATEWAY_HOST override), .env.example GATEWAY_URL->127.0.0.1; fetchPage network error -> UPSTREAM_FAILED; express JSON-parse/413 error middleware -> {error:{code:"BAD_INPUT"}} envelope; tests.
MINOR (M1 T6): no scheme check in requireAllowedHost; no fetchPage timeout/size cap.
Task 7 (M1): implemented 5bd31bb..3bcf60e (review pending)
NOTE: D15 now = loopback bind (T6 fix). M2 plan's D15/D16 must be renumbered to next free IDs when executing M2.
Task 6 (M1): fix 6e3df51 (re-review pending)
Task 7 (M1): implemented 5bd31bb..3bcf60e, review NEEDS FIX. QUEUED FIX (after T8): net-guard unit test (allowed/blocked/URL/Request); sync throw on bad URL -> reject NET_GUARD; force redirect:"manual" in guard; callTool rejection -> is_error tool_result not crash; maxTurns -> nonzero exit/flag; denylist add http2,dns,worker_threads,cluster,inspector, require(...)/import(...) of net modules; taskId tests for declare_plan/pay_and_fetch.
Task 6 (M1): complete (commits ec6a13e..5bd31bb + fix 6e3df51, re-review clean). MINOR: DECISIONS D15 blank-line formatting.
Task 8 (M1): implemented 6e3df51..d89aff5 (review pending)
Task 8 (M1): complete (commits 6e3df51..d89aff5, review clean)
MINOR (M1 T8) -> fold into T9: INV1 process test assert envKeys ⊆ allowlist (case-insens.); spawnWorker explicit cwd (repo root) so tsx resolves; runToExit no kill on hang.
Task 7 (M1): fix fd740a7+98b52c6 (re-review pending)
Task 7 (M1): complete (commits 5bd31bb..3bcf60e + fixes fd740a7,98b52c6, re-review clean)
MINOR (M1 T7): no positive test that FORBIDDEN regexes catch bad snippets; non-ok LLM response crashes worker (untested).
Task 9 (M1): implemented 98b52c6..197cf71 (review pending). Accepted: win32-only explicit allowance for 8 OS-injected env keys in INV1 test.
Task 9 (M1): complete (commits 98b52c6..197cf71, review clean)
MINOR (M1 T9): live test doesn't assert a held decision was recorded; console.log noise; page.lines[1] index-brittle.
== M1 COMPLETE ==
M2 plan committed cbbc14f; decisions renumbered D16-D25; briefs m2-task-N-brief.md; context m2-context.md
M2 Task 1: implemented cbbc14f..295592c (review pending)
M2 Task 1: review NEEDS FIX (queued after M2 T2): textHasDomain host-boundary match (+lookalike negatives); empty normalization never equal / categoryFor "" -> null / schema refine; strict number parsing (thousands groups only, leading-dot .50, strict parseAmount) + negative tests.
MINOR (M2 T1): lineHasTier prefix match ("basic plus"); units/signs ignored; toAtomic sub-micro; categoryFor ignores host; catalog dup prefixes.
M2 Task 2: implemented 295592c..9fe057d (review pending)
M2 Task 2: complete (commits 295592c..9fe057d, review clean)
MINOR (M2 T2): appendDecision should strip prevHash/hash from draft; tail truncation undetectable (expose head hash); quantity use isSafeInteger; no pinned hash vector; hold decision logs req amount/payee not quote (check in T8).
M2 Task 1: fix a1bacd4 (re-review pending)
M2 Task 3: implemented a1bacd4..146ee69 (review pending); qty 1..100 strict
M2 Task 1: fix1 re-review NEEDS FIX round 2 (queued after T4): number regex backtracks to prefix ('$12.50,3'->12, '1.23,4'->1) — tokenize [\d.,]+ runs and validate whole run; non-ASCII adjacency as host boundary (use u-flag \p{L}\p{N}); port-suffix 'vendor.test:4101x' tokenization. Tests for each.
M2 Task 4: implemented 146ee69..f595dd4 (review pending)
M2 Task 3: fix 7fb4ec0 (re-review pending)
M2 Task 3: complete (commits a1bacd4..146ee69 + fix 7fb4ec0, re-review clean)
M2 Task 1: fix2 3f8c7ee (re-review pending)
M2 Task 4: review NEEDS FIX -> tracer fix dispatched (tier TASK needs tier/plan context; quantity capped by maxQuantity; trace quote amount/payee; budget phrase; page taskId filter; evidence cap). 
M2 Task 5: implemented 0698254 (review pending)
M2 Task 1: complete (295592c + fixes a1bacd4, 3f8c7ee). Round-3 reviewer "Important" (combining marks/ZWSP/emoji as host boundary) ADJUDICATED -> MINOR: only reachable via human task text (pages only yield PAGE=tainted). Fix in final wave: ASCII-whitelist host boundaries + NFD/ZWSP tests; fullwidth port digits; "$5abc" money suffix.
M2 Task 5: complete (0698254, review clean). MINOR: unit-price float division (use atomic*qty compare); NaN budget fail-open (use !(charge<=remaining)); edge tests.
M2 Task 6: implemented a3be6dd (review pending)
M2 Task 4: fix f6a7c4e (re-review pending). NOTE: decimal-slip amount now UNKNOWN (no page evidence); still blocked by D17 floor.
M3 planner: hit opus session limit mid-way; needs resume/redo.
M3 plan committed; briefs m3-task-N-brief.md
M2 Task 7: implemented 43f329d (review pending)
M2 Task 7: complete (43f329d, review clean). MINOR: judge error swallowed in decide catch; dup taint predicate; toAtomic throw on NaN would reject decide (check).
M2 Task 6: review NEEDS FIX -> judge fix dispatched (sanitize payee/category/taskType, timeout, stop_reason, private key).
MODEL SWITCH: session now Sonnet 5.5 -> commit trailer is 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>' (constraints.md + implementer-rules.md updated). Earlier commits keep Opus trailer.
M2 Task 6: fix ad83d87 (re-review pending)
M2 Task 4: round-2 fix dispatched (restore page evidence for req/quote mismatch; negation guard; plan only after tier)
M2 Task 4: round-2 fix 013e93a (re-review pending)
M2 Task 8: implemented 0baab29 (review pending)
M2 Task 6: complete (a3be6dd + fix ad83d87, re-review clean). MINOR -> final wave: payment.tier to judge should be sent only if exact member of matchedItem.tiers else constant "unlisted-tier" (+test); injection test should assert lowercase survivors/exact category.
M2 Task 4: complete (f595dd4 + fixes f6a7c4e, 013e93a, re-reviews clean). MINOR: negation window only 2 tokens (sentence-level guard would be stronger; documented limitation); tracer.test.ts imports ../src/* (revert to index); comment on TraceResult req-vs-quote.
M2 Task 9: implemented ea711a3 (review pending)
M2 Task 8: complete (0baab29, review approved). M4 REQUIREMENTS from T8 review: (1) executor.pay throw/timeout = AMBIGUOUS outcome: log error cause, keep spend counted, confirm via status before any retry (INV5); (2) idempotencyKey must hash only payment-relevant fields (url,payee,amount,tier,quantity) NOT purpose; identical retry must dedupe (same key -> reuse result, no second approve/pay); (3) tests: thrown path, identical-request same key, mixed-sequence paySpy count. MINOR: record 'logged amount/payee are quote-charged' in DECISIONS.
M2 Task 9: complete (ea711a3, review approved). == M2 COMPLETE (acceptance: upsell held w/ page-line evidence, 2x$0.10 approved, $40 slip blocked; INV3+INV4 real) ==
FINAL-WAVE TEST FIXES (from M2 T9 review): INV3 HTTP/unit tests should assert hold reason names the tainted field AND a clean variant under same rule/judge is approved (so hold is caused by taint, not allowlist/mismatch); $40 acceptance assert evidence text; README must caveat Tier-2 judge 'not yet run live'; INV4 vendor tier/payee marker test.
M3 Task 1 dispatched (abe8e192); M4 planner dispatched (a92c3126).
M3 Task 1: implemented bb0fa03 (review pending)
M3 Task 1: complete (bb0fa03, review clean). MINOR: updateHold patch with undefined overwrites; write-side clone test; O(n) decision index.
M3 Task 2: implemented 259b3f6 (review pending)
M3 Task 2: complete (259b3f6, review clean). MINOR: rules pkg declares unused zod.
M3 Task 3: implemented 52e298d (review pending)
M3 Task 4: implemented c9014c2 (review pending)
M3 Task 3: review NEEDS FIX (routing.test.ts was a copy of propose.test.ts) -> fix 4e49505 (re-review pending)
M3 Task 4: review NEEDS FIX (corpus vacuous: tainted/self-derived) -> corpus fix a9906542 dispatched
M3 Task 5 dispatched next.
M3 Task 3: complete (52e298d + fix 4e49505, re-review clean)
M3 Task 4: fix 4af0be8 (re-review pending). MINOR: '1 attacks matched' pluralization
M3 Task 4: complete (c9014c2 + fix 4af0be8, re-review clean). MINOR/limitation: corpus pinned to demo vendor/category/taskType (README must say so); derive cap-only attacks from candidate's payee/taskType as follow-up; boundary test 14.99/15.
M3 Task 5: implemented 09c9af8 (review pending)
M3 Task 5: review NEEDS FIX (hold routing used claimed amount) -> fix dispatched (a5c1b447)
M3 Task 7: implemented 09c39f4 (review pending)
M3 Task 7: review approved w/ Important (plan-mandated): getHold fetch has no timeout -> worker can hang; pollMs floor. Fix dispatched.
M3 Task 5: fix d06b70b (re-review pending). NOTE: D35 already in DECISIONS.md; M3 Task 8 must add D26-D34 (missing) without renumbering D35.
M3 Task 5: complete (09c9af8 + fix d06b70b, re-review clean)
M3 Task 7: complete (09c39f4 + fix c69b4a7; fix covered by tests, folded into final whole-branch review). MINOR: final poll may overrun waitMs by <=100ms.
M3 Task 6: implemented e243239 (review pending)
M3 Task 6: review NEEDS FIX (stranded payment on TTL; rule CAS) -> fix b7c3876 (re-review pending)

A1 re-review (Codex): b7c3876 reviewed against reviewer-rules.md. Spec compliant for the named fix: settled outcomes are persisted before proposal/replay, activation CAS cannot overwrite successful rejection, active rules may be rejected. No Critical/Important findings in the task diff. Existing M4 ambiguous-outcome requirement remains open. Minor: expected proposal-failure test logs console.error without capturing/asserting it; fix in B wave.
A2 M3 Task 8: added planned HTTP acceptance and all-field rule INV3 tests; 19 focused tests pass. DECISIONS D28-D34 inserted before unchanged D35; README scope and live-model limits corrected. Review: test flow verifies actual simulated arena payment, replay counts, 409 refusal, narrowing, and judge bypass at Tier 1; no Critical/Important findings. The tests close existing behavior and pass on first executable run (no implementation change needed).
