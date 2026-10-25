# Extraction status

The final date, additive-volume, and cumulative-total fixes are committed in `3f215c2`; the offline own-team-volume correction is in `f2888ea`.

- 491 tests pass across 39 files; TypeScript checks pass.
- Model development evaluation at `3f215c2`: 128 cases, one run; precision 0.98, recall 0.98, F1 0.98, exact match 0.98. LLM used in 114/128; others screened locally. Raw output: `data/eval/redteam/final-dev-model.txt`.
- Offline development evaluation at `f2888ea`: precision 0.98, recall 0.98, exact match 0.98. Raw output: `final-dev-offline.txt` in the same directory. The later correction affects only deterministic fallback; the model run was not repeated for it.
- Focused model-backed red team at `3f215c2`: 20/20 exact bookings; 13 called the model, seven were screened locally. Raw output: `final-redteam-model.jsonl`.
- These are development scores, not blind generalization estimates or financial forecast accuracy. Blind test data was not accessed.

## Reviewed label conflicts — original labels retained

- **rt1-027:** expected an October event, but the input milestone explicitly moved October 28 to November 3. Code follows the documented milestone supersession rule and books nothing. This is a label/contract conflict, not a reason to revive a slipped event.
- **rt1-037:** expected no event for lack of a date, but the input has milestone `dueDate: 2026-10-29` and a stated 2.5x volume. Code follows the rule that the milestone dueDate is its schedule evidence. This is also a label/contract conflict.

No labels were changed and no adjusted perfect score is claimed. Human adjudication remains appropriate.

## Demo readiness

The default offline dependencies were smoke-tested in an isolated temporary store: reset, refresh, estimate, budget checks, journal preparation/approval/CSV export, actuals, reversal and cited Growth memo all completed. Support changed $7,590.28 → $10,040; journal debits/credits each $23,960; Growth variance $898.78 (19.32%). Browser/live-connector rehearsal remains a separate task. Feature inventory and timed story: `DEMO-PLAN.md` and `demo.md`.
