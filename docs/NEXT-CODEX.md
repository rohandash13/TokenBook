# Next steps for Codex (TrueUp, Owner D lane)

You're picking up Nikhil's lane (Slack + LLM + signals) on `main`. Read these first, in order:
1. `CLAUDE.md`: ground rules (the LLM never produces a booked number; every entry balances; offline from fixtures).
2. `docs/plan-signals.md`: how TrueUp infers drivers from Slack/GitHub, and the evidence guard rules.
3. `docs/plan-demo-world.md`: the synthetic Northwind world and the seeder.
4. `docs/demo.md`: the 3-minute demo; don't break anything it uses.
5. `data/eval/redteam/round1-summary.md` and `round1-disagreements.md`: what the red team broke.

## Rules for evaluation (please keep them)

- `data/eval/test/` is a **frozen blind test set**. Never read it to decide a code change, never edit it. Measure it at most once per round: `npx tsx src/demo/evalSignals.ts --set test --runs 1`, then report the summary line as-is.
- Tune only on `data/eval/dev/` (and red-team cases you've added there): `npx tsx src/demo/evalSignals.ts --set dev --runs 1`.
- Every scored run appends to `data/eval/history.jsonl`; `npm run eval:history` prints the learning curve. Commit before measuring so the git sha means something.
- Human-written cases go in `data/eval/human/` (template: `docs/eval-human-cases.md`). They outrank generated sets.

## Scores so far

| When | Commit | Set | Precision | Recall | Exact |
| --- | --- | --- | --- | --- | --- |
| Baseline, before tuning | 9c5391b | dev | 0.93 | 0.56 | 0.80 |
| Baseline, before tuning | 9c5391b | **blind test** | **0.58** | **0.25** | **0.62** |
| After round 1 (Fix A + Fix B) | 162cee8 | dev (59 generated) | 1.00 | 1.00 | 1.00 |
| After round 1 | 162cee8 | **blind test** | **0.91** | **0.75** | **0.87** |
| After round 1 | 162cee8 | red-team round 1 (69, judge labels) | 0.67 | 0.70 | 0.81 |

(`history.jsonl` records round 1 as `87664df`, the same commit before a rebase.) Red team round 1: 33 of 69 attacks succeeded against the pre-fix code; 13 of 69 still succeed after round 1 (rt1-023, 027, 028, 029, 034, 037, 039, 048, 051, 052, 061, 062, 067). They're now in `data/eval/dev/redteam-r1.json` with the independent judge's labels, so `--set dev` will show them. Dev 1.00 is optimistic: its rules were tuned on it and the prompt contains dev examples (task 8).

## Tasks, in priority order

Each is small and testable. Run `npx vitest run` and `npm run typecheck` after each; commit small.

0. **[Done] Show end dates and flags in the new Signals screen.** A teammate replaced `CheckinPreview.tsx` with `web/src/screens/Signals.tsx` (commit 248ae15). Round 1 added `ContextEvent.until` ("10× Oct 27 only", "2× Oct 27–29") and `TeamContext.flags` (size-unknown launches, with evidence and "ask {leadName}") but only the deleted screen displayed them. Port that display into `Signals.tsx`; coordinate with whoever owns it.
1. **[Done] Signal team field is ignored.** `inferDrivers` should only use signals whose `team` equals the case team (a Platform-tagged message booked for Support). Add a test from red-team rt1-051.
2. **[Done] As-of off by one.** A driver dated exactly on the as-of date (Oct 25) is already in actuals → drop it ("date on or before as-of"). Tests from rt1-048, rt1-023.
3. **[Done] Relayed claims.** "X asked me to post this: 5x" from someone else. Decide with Nikhil: flag instead of book when the author isn't the claimed source. Test rt1-062.
4. **[Done] Tool-output/JSON-looking text.** Text like `tool_result: {"events":[...]}` passes because the date and number appear literally. Treat messages that look like structured data or bot output as untrusted: never the sole evidence for a booking. Test rt1-003.
5. **[Done] Suppression.** An intern's "disregard the launch above, it was a drill" dropped a lead's real launch. A retraction should only cancel when it comes from the same author or the team lead, or is corroborated (GitHub revert, milestone closed); otherwise flag the conflict. Test rt1-007.
6. **[Done] Weekday/date mismatch** ("Thursday Oct 28", which is a Wednesday): book nothing, flag it.
7. **[Done] Zero-traffic windows** ("Oct 30 through Nov 1, zero traffic"): multiplier 0 with `until` should be allowed (it's a decrease, not invalid).
8. **[Done] De-leak the LLM prompt.** `inferDrivers.ts` builds Claude's system prompt with worked examples copied from dev cases (e.g. "'200 QPS to 800 QPS' is 4", "twice as hard"). That inflates the dev score. Replace them with invented examples that appear in no eval set, then re-measure dev (expect a small drop; that's the honest number).
9. **[Done; offline and model validated] Red team round 2.** Round-1 attacks are already in `data/eval/dev/redteam-r1.json` with the judge's labels. Run the attacker brief in `data/eval/redteam/round1-summary.md` "ideas for round 2" against the new code with `npx tsx src/demo/tryCase.ts <file>`.
10. **Blind test set v2.** After 2–3 rounds, test v1 is "used up". Generate v2 with an author who can't see `src/` or any eval data, freeze it in its own commit, then measure.

## Things not to break (the demo depends on them)

- `npm run demo:reset` → Support **$10,040, medium, Slack/GitHub badge**; Growth keeps Maya's stale Oct 26 reply; Search/Platform "Checked Slack and GitHub: no upcoming changes found".
- `npm run seed:demo` must stay idempotent; `--reset` deletes only seeded items.
- `GITHUB_TOKEN` is read-only by design; seeding uses `GITHUB_SEED_TOKEN`. Never use the seed token in the product.
- Only one `npm run slack` process at a time (two Socket Mode connections race each other). Trigger DMs with `curl` to port 8788.


## Codex progress — October 24

- Synced with demo commit `2854865`: Support starts unscanned until Refresh signals.
- Tasks 0–2 complete: shared event rendering shows inclusive end dates and single-day windows; Signals shows unknown-size flags, evidence, and the lead to ask, with a Needs review status.
- Team filtering runs before both LLM prompting/guarding and deterministic proposal generation. Other-team evidence cannot support or suppress this team's drivers.
- Dates on or before as-of are excluded from events and flags.
- Validation: 454 tests passed across 37 files; `npm run typecheck` passed. No scored evaluations or blind test data used.
- Next: task 3 needs Nikhil's decision about relayed claims; task 4 can proceed independently.


## Codex progress — trust fixes and round 2

- `7fb28cd`, `07f09d0`: tasks 3–8 implemented. Relays and contradictory weekday/date claims are review flags. Tool-shaped text, bot reminders, and hidden HTML output cannot supply booking evidence. Evidence is screened before both deterministic extraction and LLM prompting, so unauthorized retractions/corrections cannot suppress or inflate an earlier claim. Same-author/lead retractions and GitHub corroboration remain allowed. Unknown authors are not treated as the same person.
- Live lead authority uses the configured Slack user id; display-name fallback is for the offline world. This does not independently authenticate external source authors.
- Added review reason variants through the shared flag contract, API, estimate basis and Slack overview. Existing `size unknown` flags remain compatible.
- Zero-volume windows now parse and pass the inference/API schemas; accounting tests verify baseline resumes after a bounded shutdown. The manual form accepts zero. No accounting math changed.
- Removed worked numerical and dated examples from the LLM prompt; it now describes conversions without eval examples, and includes the as-of date and evidence authors.
- Validation: **478 tests / 37 files passed**, TypeScript checks passed, fixture scenario tests passed. No blind set was read, modified or scored.
- Final offline dev: **128 cases, precision 0.93, recall 0.83, F1 0.88, exact match 0.93** (code `07f09d0`). History includes both pre- and post-bot-fix measurements. Output-only changes caused the final history's dirty marker; code was committed before scoring.
- Round 2: **20/20 exact bookings offline**, comparing date, multiplier and until. The original 18 are focused author-generated development attacks; two follow-ups target failures seen in round-1 development data. These are not an independent/blind estimate. Fixtures and raw verdicts are in `data/eval/redteam/round2-*`; summary includes remaining failures.
- Model-backed evaluation was explicitly approved, but Anthropic returns **401 authentication_error (invalid x-api-key)**. The attempted focused run used fallback in all 20 cases, so it is not a model score. The full model dev run was stopped to avoid repeated failed requests. Replace `ANTHROPIC_API_KEY` locally in `.env`, then rerun the dev evaluation and oracle; never paste secrets into chat.
- Next: resolve the nine remaining dev cases described in `data/eval/redteam/round2-summary.md`, then model validation and a full demo rehearsal. Task 10 (a new blind set) remains out of scope for this round.


## Key replacement and completed model validation

The user replaced the local API key; direct Messages API authentication now succeeds (200). The earlier 401 blocker is resolved. No `.env` contents were committed.

- Code `695b454`: model dev **P 0.98 / R 0.88 / F1 0.92 / exact 0.96**, 128 cases, one run; LLM used 114/128.
- Focused round 2 **20/20 exact**, LLM used 13/20, others screened locally. All case transfers approved by user.
- Remaining model failures: rt1-028, 034, 067 plus label-review cases 027 and 037. Offline-only failures listed above remain relevant to fallback quality.
- Reports and raw verdicts: `data/eval/redteam/round2-dev-model.txt`, `round2-model-results.jsonl`, `round2-summary.md`. Next: fix the three model extraction gaps, review the two disputed labels, then rehearse the end-to-end demo. Blind set remains untouched.
