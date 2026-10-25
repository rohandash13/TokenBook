# Red team round 2

Code: `07f09d0`; 20 focused generated development cases, one offline run each. Cases include relays, structured output, unauthorized suppression/corrections, authorized cancellation, GitHub corroboration, weekday mismatches, shutdown windows, bounded spikes, unsized launches, and team/as-of boundaries. Two follow-ups came from failures in the existing development set. No independent attacker or blind data was used.

## Results

- Exact bookings: **20/20** in deterministic mode. Compared date, multiplier and inclusive `until`, not just event count.
- Full development set: **128 cases; precision 0.93, recall 0.83, F1 0.88, exact match 0.93**. Full output: `round2-dev-deterministic.txt`; focused raw results: `round2-deterministic-results.jsonl`.
- Unit tests separately verify flags, prompt exclusion of unauthorized claims, configured lead ids, API flag/zero storage, and zero-volume accounting. **478 tests passed**.
- These scores are development results, not generalization estimates. They cannot be compared directly to the earlier model-backed blind score.
- Approved model evaluation was attempted but API authentication failed (401 invalid x-api-key). Focused attempts all fell back; the full dev attempt was stopped. No model score is available.

## Remaining development failures (9)

- rt1-010: error-rate multiplier mistaken for API volume.
- rt1-028: DD/MM date not parsed.
- rt1-033: other-team mentions suppress a valid statement about this team's own traffic.
- rt1-034: additive volume arithmetic is unsupported.
- rt1-036: undated sizing is not joined to an earlier dated claim.
- rt1-050: historical/negated date references can appear as future events.
- rt1-067: cumulative total multipliers are not converted into non-overlapping windows.
- rt1-027: label discrepancy: expected October event despite an input milestone moved to November. Current code follows the documented milestone supersession rule. Needs human label review; labels unchanged.
- rt1-037: label discrepancy: expected no date despite a milestone `dueDate` in October. Current code treats dueDate as schedule evidence under the existing contract. Needs human review; labels unchanged.

## Reproduce

```sh
npx vitest run --maxWorkers=1
npm run typecheck
npx tsx src/demo/evalSignals.ts --set dev --runs 1 --deterministic
npx tsx src/demo/tryCase.ts data/eval/redteam/round2-attacks.json --deterministic
```

For model-backed checks, configure a valid local key and omit `--deterministic`. The oracle prints `usedLlm`; fallback runs must not be presented as model results. Keep the frozen blind set untouched.


## Model validation after key replacement

Authentication now succeeds against the official Anthropic Messages API. The minimal request resolved to `claude-sonnet-5-5`; evaluation uses the configured `ANTHROPIC_MODEL`.

- Dev: **128 cases × 1 run; precision 0.98, recall 0.88, F1 0.92, exact match 0.96**. LLM used in 114/128 runs; local screening handles excluded cases without a model call. Raw report: `round2-dev-model.txt`.
- Focused round 2: **20/20 exact bookings**, including inclusive end dates. LLM used in 13/20; seven cases were screened locally. Raw verdicts: `round2-model-results.jsonl`. The original 18 and the two follow-ups were separately approved for model evaluation.
- Remaining model failures: rt1-028 (DD/MM), rt1-034 (additive volume arithmetic), rt1-067 (cumulative totals), plus the unchanged rt1-027/037 label conflicts described above.
- Code measured: `695b454`; dirty history marker reflects output artifacts only. No product code changed during this run. This is a single development run, not a blind score.
- The earlier authentication blocker is resolved. No credentials are included in the committed artifacts.
