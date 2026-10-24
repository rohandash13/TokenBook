# TrueUp

Hackathon build (Cal Hacks 13.0) by a team of four. TrueUp closes the books on a company's AI API spend: it estimates each team's monthly accrual, prepares balanced journal entries, and explains variances with audit memos.

Read first:
- `docs/SPEC.md`: the build brief and source of truth for what to build, including the exact contracts.
- `docs/PLAN.md`: who owns which folders, the schedule and gates, fallbacks.

Note: this repo used to hold a different project (Countersign). That code is on the `archive/v1` branch; ignore it.

## Ground rules

- `src/shared/types.ts` and `src/shared/config.ts` are the only cross-module dependencies. Do not import another owner's module internals; go through the shared types or the REST API. Do not change `types.ts` without the whole team agreeing.
- Every module starts with `// OWNER: A|B|C|D`. Stay inside your owner's folders unless asked.
- All money math is deterministic TypeScript. The LLM is used only to turn Slack replies into drivers and to draft memo text, and never produces a number that gets booked.
- Validate every LLM JSON response with `zod`; on failure retry once, then fall back to something deterministic.
- Every journal entry balances, and a test enforces it.
- Every displayed estimate and memo carries its `basis` or `sources`.
- Everything works offline from fixtures with no API keys. No secrets in code; `.env` is gitignored and `.env.example` holds names only.
- Model ids come from `ANTHROPIC_MODEL`, never hardcoded.
- Prefer simple, readable code over over-building. Commit small and often to `main`.

## Stack

Node 22, TypeScript, ESM, npm (single repo). Express server with JSON files in `data/store/`. Vite + React in `web/`. `@slack/bolt` in Socket Mode. `@anthropic-ai/sdk`. `vitest` for tests.
