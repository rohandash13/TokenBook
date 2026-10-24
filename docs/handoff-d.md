# Owner D handoff (Nikhil: Slack + LLM)

Branch `d/slack-llm`. State at handoff: 41 tests pass, typecheck clean, pushed. Interfaces and rules are in `docs/plan-d.md`.

In Claude Code, run `/d-next` to have Opus write detailed briefs for the open `delegate` tasks and hand them to sonnet helpers (`.claude/agents/d-implementer.md`), review them (`d-reviewer`), test, commit and push.

## Done

- `src/llm/client.ts`: `getLlm`, `completeJson` (zod, retry once, null = fall back)
- `src/llm/extractDrivers.ts` + tests: Slack reply → `TeamContext`; button fallback (higher 1.3x, much higher 2x, lower 0.8x)
- `src/llm/draftMemo.ts` + tests: memo with a guard that rejects any number not in `MemoInput`; deterministic placeholder
- `src/slack/` + tests: check-in blocks, per-button action ids, pending answers in memory, `api.ts` client for Rohan's routes, `buildConfirmation`, Bolt Socket Mode app, `npm run slack -- --checkin <team> [--month YYYY-MM]`; exits 0 without tokens

## Open tasks

| # | Task | Who | Files |
| --- | --- | --- | --- |
| H1 | Short event notes so the confirmation reads well | delegate | `src/llm/extractDrivers.ts`, its test, `src/slack/confirm.ts`, `src/slack/checkin.test.ts` |
| H2 | Check-in trigger the server can call | delegate | `src/slack/trigger.ts` (new), `src/slack/app.ts`, a new test |
| H3 | Rebase onto Rohan's skeleton once it is on `main` | delegate, with Nikhil watching | `package.json`, `tsconfig.json`, `src/shared/types.ts` |
| H4 | Create the Slack app and fill `.env` | Nikhil | browser, `.env` |
| H5 | Live test: DM yourself, click, reply, see `/api/contexts` update | Nikhil | needs H4 and Rohan's server |
| H6 | README sections (Slack setup, real vs simulated for LLM/Slack), demo script, Devpost text, backup video | Nikhil (+ helper drafts) | `README.md`, `docs/demo.md` |
| H7 | Optional: persist pending check-ins to `data/store/` so a restart keeps them | delegate, only if time | `src/slack/extractDrivers.ts` |

### H1 brief
The confirmation renders each event as "{note} {Mon D}, about {N}x", but the fallback notes are full sentences, so it reads "Volume expected higher than last week Oct 24, about 1.3x". Make every event note a 2–5 word lowercase phrase: fallback notes become "higher volume", "much higher volume", "lower volume", "launch planned"; the LLM system prompt asks for a 2–5 word note (e.g. "support launch") and the zod schema caps notes at 40 characters. Keep `buildConfirmation` output like "Got it: support launch Oct 27, about 3x. That moves your estimate from $7,590 to $10,040. Dana will review it." Multiple events join with "; ". Update both test files.

### H2 brief
The spec has `POST /api/demo/checkin` on Rohan's server, but the Slack app is a separate process (`npm run slack`). Add `src/slack/trigger.ts`: a tiny `node:http` listener started by `app.ts` on `SLACK_TRIGGER_PORT` (default 8788, bound to 127.0.0.1) that accepts `POST /checkin` with JSON `{team, month?}` and calls `sendCheckIn`; 400 on a bad team, 503 when Slack is not connected. Export a pure request handler so it can be tested without a socket. Then tell Nikhil to send Rohan one line: "`/api/demo/checkin` should forward `{team, month}` to `http://127.0.0.1:8788/checkin`".

### H3 brief
When `origin/main` has Rohan's skeleton: `git fetch && git rebase origin/main`. On conflicts, keep `main`'s `package.json`, `tsconfig.json` and `src/shared/types.ts`, then add D's dependencies (`npm i @anthropic-ai/sdk @slack/bolt zod`) and make sure `npm run slack` still points at `src/slack/app.ts`. If `src/shared/config.ts` has team → Slack lead ids, switch `checkin.ts` to read them from config instead of env. Run all tests and the typecheck; push with `--force-with-lease` (this is Nikhil's own branch). Then open a PR to `main`.
