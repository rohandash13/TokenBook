# Blind test set v1 (FROZEN)

- Written by an independent test-author agent (author tag `generated-test`) that saw only `docs/SPEC.md`, never the implementation, demo data, fixtures, signal plans, or other eval files.
- **Frozen. Do not use for tuning, prompt iteration, or few-shot examples.** Run it only to score a finished build; do not edit cases to match product output.
- `blind-v1.json`: 60 cases, month 2026-10, asOf 2026-10-25 (Sunday). Teams: support 16, growth 15, search 15, platform 14.
- Expected output: 25 cases book one or more drivers, 35 book nothing. Each case has its own `category` (60 distinct); they group as follows:
  - Book (25): plain/abbreviated/typos/month-end boundary 6, relative weekday dates 2, threads revising date/multiplier/scope 4, conflicting sources resolved by the newer one 2, GitHub-only 2, decreases 3, temporary spikes that end in-month 2, multiple drivers 1, range (book the floor) 1, vendor/customer traffic 2.
  - Book nothing (35): cancelled/slipped/reverted/postponed/frozen/next month 8, already started or past (before or on asOf) 6, unquantified/vague/non-API metric 5, hypothetical/contingent/tentative/unanswered/joke 5, other team, other key, or mock server 3, unresolved conflicts incl. weekday/date mismatch 3, no volume change/price only 2, routine or negligible 3.
- Conventions: multiplier is vs. normal daily volume, applying from its date onward. A temporary change is two drivers, e.g. `[{27,10},{28,1}]`. A stated range books the committed floor. Unresolved ambiguity books nothing.
