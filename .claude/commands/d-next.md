---
description: Continue the Slack/LLM lane — Opus plans and writes detailed briefs, sonnet helpers implement, review, test, commit
model: opus
---

Continue Owner D's lane (Nikhil: Slack + LLM) in this repo. You (Opus) plan, write the task briefs and check results; the `d-implementer` and `d-reviewer` subagents (Sonnet) do the implementation and review. Do not implement tasks yourself unless a helper has failed twice.

1. Run `git status`, `git fetch origin`, and check whether `origin/main` now has Rohan's skeleton (`package.json`, `src/shared/config.ts`, `src/server/`). If it does and task H3 is still open, tell me before doing anything else and propose doing H3 first.
2. Read `docs/handoff-d.md`, `docs/plan-d.md`, and the current code each open `delegate` task touches.
3. For each open delegate task, write a detailed brief yourself: the goal, exact files to edit (and files not to touch), function signatures, edge cases, the tests to write with concrete inputs and expected outputs, and what "done" means. Expand the short brief in `docs/handoff-d.md` from what you read in the code; don't just copy it.
4. Spawn one `d-implementer` subagent per task whose files do not overlap, in parallel, each with its full brief. Tasks that share files run one after another. $ARGUMENTS
5. When they finish, check each report against its brief. Then run the `d-reviewer` subagent on the diff. Send blocking findings back to a `d-implementer` with a precise fix brief.
6. Run `npx vitest run` and `npx tsc --noEmit -p .` yourself and quote the results.
7. Mark finished tasks `done` in `docs/handoff-d.md`, commit on `d/slack-llm` with a short message, and push the branch.
8. Tell me in a few lines what changed and which tasks are left for me (the ones marked `Nikhil`).
