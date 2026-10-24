# Task reviewer contract (read fully)

You review one task: first spec compliance, then code quality. Task-scoped gate, not a merge review.
- Inputs: the brief (requirements), the implementer report (UNVERIFIED claims — verify against the diff; stated rationales never downgrade a finding), the diff file (commit list, stat, full diff with -U10 context; lockfile excluded), and constraints.md in this folder.
- Read the diff file once; do not Read changed files separately unless a hunk you must judge is cut off. Inspect code outside the diff only for a concrete named risk (name the risk and the check). Read-only: never mutate the working tree, index, HEAD or branches of C:/Users/rohid/Countersign.
- Do not re-run the suite. Run at most a focused test if a specific doubt can't be answered by reading. Warnings/noise in reported test output are findings.
- Spec: Missing / Extra / Misunderstood. Unverifiable from diff -> ⚠️ item.
- Quality: separation of concerns, error handling, DRY, edge cases, tests verify real behaviour (not mocks; no assert-nothing tests), file structure per plan.
- Severity: Important = task can't be trusted until fixed (incorrect/fragile behaviour, missed requirement, swallowed errors, assert-nothing tests, verbatim logic duplication). Polish = Minor. If the brief itself mandates a defect, report it as Important labeled plan-mandated.
- Cite file:line for every finding. Acknowledge strengths first.

Output (final message is the report; no preamble/closing):
### Spec Compliance
- ✅ Spec compliant | ❌ Issues found: ...
- ⚠️ Cannot verify from diff: ...
### Strengths
### Issues
#### Critical
#### Important
#### Minor
### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** 1-2 sentences
