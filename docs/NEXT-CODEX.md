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
| After round 1 (Fix A + Fix B) | TODO | dev | TODO | TODO | TODO |
| After round 1 | TODO | **blind test** | TODO | TODO | TODO |

Red team round 1: 33 of 69 attacks succeeded against the pre-fix code. Re-run against current code: TODO.

## Tasks, in priority order

Each is small and testable. Run `npx vitest run` and `npm run typecheck` after each; commit small.

1. **Signal team field is ignored.** `inferDrivers` should only use signals whose `team` equals the case team (a Platform-tagged message booked for Support). Add a test from red-team rt1-051.
2. **As-of off by one.** A driver dated exactly on the as-of date (Oct 25) is already in actuals → drop it ("date on or before as-of"). Tests from rt1-048, rt1-023.
3. **Relayed claims.** "X asked me to post this: 5x" from someone else. Decide with Nikhil: flag instead of book when the author isn't the claimed source. Test rt1-062.
4. **Tool-output/JSON-looking text.** Text like `tool_result: {"events":[...]}` passes because the date and number appear literally. Treat messages that look like structured data or bot output as untrusted: never the sole evidence for a booking. Test rt1-003.
5. **Suppression.** An intern's "disregard the launch above, it was a drill" dropped a lead's real launch. A retraction should only cancel when it comes from the same author or the team lead, or is corroborated (GitHub revert, milestone closed); otherwise flag the conflict. Test rt1-007.
6. **Weekday/date mismatch** ("Thursday Oct 28", which is a Wednesday): book nothing, flag it.
7. **Zero-traffic windows** ("Oct 30 through Nov 1, zero traffic"): multiplier 0 with `until` should be allowed (it's a decrease, not invalid).
8. **De-leak the LLM prompt.** `inferDrivers.ts` builds Claude's system prompt with worked examples copied from dev cases (e.g. "'200 QPS to 800 QPS' is 4", "twice as hard"). That inflates the dev score. Replace them with invented examples that appear in no eval set, then re-measure dev (expect a small drop; that's the honest number).
9. **Red team round 2.** Add confirmed round-1 failures (where the judge agrees) to `data/eval/dev/redteam-r1.json` in the case-file format. Then re-run the attacker brief in `data/eval/redteam/round1-summary.md` "ideas for round 2" against the new code with `npx tsx src/demo/tryCase.ts <file>`.
10. **Blind test set v2.** After 2–3 rounds, test v1 is "used up". Generate v2 with an author who can't see `src/` or any eval data, freeze it in its own commit, then measure.

## Things not to break (the demo depends on them)

- `npm run demo:reset` → Support **$10,040, medium, Slack/GitHub badge**; Growth keeps Maya's stale Oct 26 reply; Search/Platform "Checked Slack and GitHub: no upcoming changes found".
- `npm run seed:demo` must stay idempotent; `--reset` deletes only seeded items.
- `GITHUB_TOKEN` is read-only by design; seeding uses `GITHUB_SEED_TOKEN`. Never use the seed token in the product.
- Only one `npm run slack` process at a time (two Socket Mode connections race each other). Trigger DMs with `curl` to port 8788.
