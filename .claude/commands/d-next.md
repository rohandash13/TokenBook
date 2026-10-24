---
description: Continue the Slack/LLM lane — delegate open tasks from docs/handoff-d.md to sonnet helpers, review, test, commit
---

Continue Owner D's lane (Nikhil: Slack + LLM) in this repo.

1. Run `git status`, `git fetch origin`, and check whether `origin/main` now has Rohan's skeleton (`package.json`, `src/shared/config.ts`, `src/server/`). If it does and task H3 is still open, tell me before doing anything else and propose doing H3 first.
2. Read `docs/handoff-d.md`. List the open tasks marked `delegate` and which files each touches.
3. Spawn one `d-implementer` subagent per open delegate task whose files do not overlap, in parallel, each with that task's brief copied in full. Tasks that share files run one after another. $ARGUMENTS
4. When they finish, run the `d-reviewer` subagent on the diff. Fix blocking findings with another `d-implementer` call.
5. Run `npx vitest run` and `npx tsc --noEmit -p .` yourself and quote the results.
6. Mark finished tasks `done` in `docs/handoff-d.md`, commit on `d/slack-llm` with a short message, and push the branch.
7. Tell me in a few lines what changed and which tasks are left for me (the ones marked `Nikhil`).
