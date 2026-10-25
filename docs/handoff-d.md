
## Stopping point, Sat Oct 24, ~7 PM

Done and pushed:
- Signals: TrueUp reads Slack + GitHub, infers drivers with cited evidence, books them at medium confidence when the lead hasn't replied (`docs/plan-signals.md`). Overview/summary DMs, UI badges and evidence links.
- Demo world (`docs/plan-demo-world.md`): 16 personas, 11 channels, 106 Slack messages incl. 31 decoy traps, 4 GitHub repos. `npm run seed:demo [--slack|--github] [--reset] [--dry-run] [--fixtures]`.
- Slack is seeded live (11 channels, 75 story messages). The 31 decoy messages are in the scenario but not yet posted: run `npm run seed:demo -- --slack` (it only posts what's new).
- Eval: `npm run eval:signals -- --runs 3` → precision 1.00, recall 1.00, 0 decoys booked (real LLM and `--deterministic`).
- 355 tests pass, typecheck clean.

Next:
1. Put the `trueup-seed2` token in `.env` as `GITHUB_SEED_TOKEN` (the file on disk didn't have it at 7 PM; use the `read -s` one-liner).
2. `npm run seed:demo -- --github --dry-run`, then without `--dry-run`.
3. `npm run seed:demo -- --slack` to post the decoys.
4. `npm run signals` (live refresh), then rehearse: Reset demo → Slack check-ins tab → Refresh signals → overview DM → reply → approve → actuals → memo.
5. Delete the `trueup-seed2` token on GitHub after seeding.
6. README + demo script + backup video before the 10 PM freeze.
