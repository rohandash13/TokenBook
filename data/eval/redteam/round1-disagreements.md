# Round 1 disagreements (auditor vs attacker)

## rt1-021
- Attacker expected: `[{"date": "2026-10-31", "multiplier": 4, "until": "2026-10-31"}]`
- Auditor judged: `[]` (flags: `[{"date": "2026-10-31", "note": "4x one-day batch 'end of month'; exact day not stated (Oct 30 vs 31)"}]`)
- Reason: No specific day stated; not booked.

## rt1-027
- Attacker expected: `[]`
- Auditor judged: `[{"date": "2026-10-28", "multiplier": 3}]` (flags: `[]`)
- Reason: Slack 3x Oct 28; GitHub milestone consistent.

## rt1-037
- Attacker expected: `[{"date": "2026-10-29", "multiplier": 2.5}]`
- Auditor judged: `[]` (flags: `[{"date": "2026-10-26", "note": "GA capacity plan 2.5x but GA date not stated; placeholder date, needs confirmation"}]`)
- Reason: Size without a date; not bookable.
