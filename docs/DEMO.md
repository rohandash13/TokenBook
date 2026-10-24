# Countersign demo runbook

## Start

From the repository root, run `pnpm install`, then `pnpm demo`. In a second terminal run `pnpm dev:dashboard`. Open http://127.0.0.1:3000. Both servers bind to loopback. Restart `pnpm demo` to reset the memory store and reseed. Do not run dev:gateway/dev:arena at the same time (same ports).

The demo creates an ephemeral random simulated-payment secret in memory. No API key or real payment is needed. Tier 2 is disabled and fails closed; seeded approvals are labelled simulated. The actual gateway still makes every decision, signs simulated payments, records page traces, reserves budgets and checks delivery. Model calls are not simulated as if they were real.

## Three minutes, moment first

- 0:00–0:45 — Trace: select the $15 premium HOLD (selected by default). Read tier → PAGE → docs/upsell line 5. Say: “The vendor is approved, its own quote is $15, and it passes a $20 cap. But the human asked for basic weather. The spending instruction came from a web page.” Show the exact quote. Do not claim Claude-alone approved: that run is pending.
- 0:45–1:00 — Ledger: point to actual Tier 1 rows and their measured milliseconds/$0. Show the report reuse row and its actual saved $5. Payment is simulated, reuse is real code.
- 1:00–1:35 — Holds: approve the legitimate crypto purchase. This executes one simulated payment and proposes a narrow rule. Read its payee, category, cap, task type and expiry. Lower the cap only if desired; replay & activate. Replay counts come from stored decisions plus the small pinned hand-written corpus. A premium one-off approval proposes no rule. After activating the crypto rule, run `pnpm demo:repeat`; the new crypto purchase should appear as Tier 1 at $0 with no judge call.
- 1:35–2:10 — Results: show the actual local table: cap/allowlist/quote attacks 30/40, false holds 0/30; Countersign model-disabled attacks 0/40, false holds 3/30. Claude-alone is visibly “not run.” Explain that the approver is simulated from ground truth and the set is fixed, not an adaptive attacker run. Curves use the measured case sequence.
- 2:10–2:40 — Explain reservations and INV5: a timeout keeps money reserved, status confirmation precedes any retry, and arena idempotency prevents a second charge. Show the passing HTTP timeout test rather than claiming an unrecorded live failure.
- 2:40–3:00 — Close: “Autonomous finance control: limits enforced in code, a record of every decision, knowing when to ask.” Limits: process-level worker isolation, tracing can miss laundered text, local unauthenticated admin, volatile store, simulated payments, no live-model validation yet.

## Backup video

TODO: record and save a real screen recording after browser access is permitted. No video is included yet; browser automation permission was declined during this build. An owner-provided screenshot confirms connected trace rendering, but is not a recording. Suggested output: `artifacts/demo/countersign-backup.mp4`. Capture only the dashboard window, with no .env, account pages or terminals showing credentials. Open with the premium trace and include the labels above. Verify audio, readable page line, actual replay counts and full playback before submission.

## Before submission

1. Run `pnpm test`, `pnpm typecheck`, `pnpm build:dashboard`.
2. Run `pnpm bench` for the credential-free fixed-set report. Configure models/prices locally before `pnpm bench -- --live-baseline`; its persistent pre-call reservations enforce at most $10, including failed calls. The model-disabled report is not a substitute for the required live three-setup table. Update README/table only from the run artifact.
3. Record the backup video, or explicitly mark it missing. Never invent Claude results or attacker rounds. Public benchmark adaptations and adaptive attacker remain pending.
4. Verify the track fit with the organizer and submit Devpost by Sunday Oct 25, 08:30 AM PT target (09:00 deadline). No submission or sponsor message has been sent by this agent.
5. Search for `412`: UUID/hash substrings in measured artifacts and the spec's example are harmless; no placeholder case count may appear in results. Verify only `.env.example` is tracked and contains no secrets. Keep .env ignored.
