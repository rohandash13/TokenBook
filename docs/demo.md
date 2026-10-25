# TrueUp: three-minute demo

**Promise:** TrueUp turns engineering activity into an evidence-backed AI-spend forecast and an approval-ready month-end close.

**User:** Dana, the controller. **Scenario:** Northwind Labs, October 2026, as of October 25. This is a staged synthetic company. See `docs/DEMO-PLAN.md` for every feature's placement and optional sponsor extensions.

## Timed core story

| Time | Screen / action | Presenter line |
| --- | --- | --- |
| 0:00–0:20 | Overview → Accrual; Support starts at **$7,590.28**, low confidence | “Finance needs to close the month before the AI bill arrives. The clue to next week's spend is already in engineering's Slack and GitHub—but finance usually has to chase it.” |
| 0:20–0:55 | Click **Refresh signals**; Support moves to **$10,040**, medium confidence | “Support is launching a new agent. TrueUp finds the launch and updates the forecast without waiting for the lead to fill in a form.” |
| 0:55–1:20 | Signals; show the Oct 27 / ~3x message and supporting GitHub milestone | “Here's the exact evidence. Claude extracts the date and usage change; deterministic code checks it and calculates the dollars.” |
| 1:20–1:35 | Show a rehearsed review flag or ignored non-volume signal; otherwise stay on evidence | “A launch without a stated size needs confirmation. A faster model is not automatically more API traffic.” Do not search for an example on stage. |
| 1:35–1:55 | Budgets; Support **$1,540 over its $8,500 limit** | “This is now a decision finance can act on before the invoice arrives.” Point at model caps only if time permits. |
| 1:55–2:20 | Accrual; approve and export CSV | “Dana reviews and approves a balanced $23,960 entry. We export an ERP-ready journal with its evidence.” Show download; do not claim it posts to an ERP. |
| 2:20–2:45 | Variances; load the simulated October bill, show Growth's memo | “Now we advance to the bill. Growth's campaign slipped, but its lead's earlier reply stayed in the forecast. TrueUp surfaces the $898.78 over-accrual and drafts a cited explanation for review.” |
| 2:45–3:00 | Stay on completed close or Overview | “From engineering context to a reviewed close—with evidence behind the forecast and an explanation when reality differs.” |

Use a timer. If a step exceeds its window, skip the noise segment or model-cap explanation; preserve evidence, approval/export, and the completed close.

## Preflight

- Start `npm run dev` once (API :8787, web :5173). If a Slack interaction is part of the rehearsed variant, start **one** `npm run slack` process (:8788).
- Reset the demo from the app or `npm run demo:reset`. **Support is deliberately unscanned after reset.** Do not run `npm run signals` before the opening shot.
- Open Overview, the Support Slack permalink, and the GitHub milestone ahead of time. Hide terminals and credential-bearing files.
- Verify the refresh, before/after numbers, budget alert, approval/export, actuals load and Growth memo on the actual presentation laptop. The default refresh may use live APIs; it is not guaranteed to reproduce fixture values if live evidence changes.
- Decide the source mode before recording: live APIs over seeded synthetic content, or explicitly offline fixtures. The existing `POST /api/signals/refresh?month=2026-10` accepts JSON `{ "offline": true }` for the latter. The UI refresh button requests the normal mode; do not assume reset makes later button refreshes offline.
- Record one clean take and keep it available locally. If a live call fails or stalls, switch to the recording; do not troubleshoot tokens on stage.

## Optional segments

- **Slack human confirmation:** before the timed run, prepare the overview DM via the Slack trigger. Show the summary and a lead confirmation, then the updated context. Replace the noise segment; do not add it on top of three minutes. Do not show a terminal command. A lead reply overrides inference.
- **Accuracy:** historical forecast error and team bias are supporting evidence in Q&A. Bias is a suggestion, not autonomous retraining. Do not equate those financial backtests with extraction precision/recall.
- **Atlassian / Apify:** use the separate extensions in `DEMO-PLAN.md` only after testing the real connector delivery. Cached fixture rows do not demonstrate live delivery.

## Claims to keep precise

- Usage and bills in this scenario are synthetic. Slack/GitHub are implemented live integrations with fixture fallback; label which mode is being shown.
- Claude proposes numerical usage drivers, not booked dollar amounts. Code validates supported evidence and performs accounting math; Dana approves the entry.
- Slack/GitHub unknown-size flags do not imply identical controls in Jira: the Jira integration currently supports label-based defaults. Do not claim every connector rejects all default sizes.
- Budget/model-cap alerts do not block provider API calls. CSV export is not a live ERP integration.
- Use the latest extraction score from `docs/EXTRACTION-STATUS.md`, identifying it as a single development run. Keep older blind-test results separate. Do not promise flawless generalization.
- The offline close smoke test and unit suite passed. Browser polish, live connector rehearsal, video recording, and submission are separate gates and remain to be completed.
