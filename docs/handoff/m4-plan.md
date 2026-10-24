# M4 implementation plan

Binding input: m4-design.md. Keep simulated payments labelled. Each task gets tests first and a separate review.

1. Atomic reservation state machine and payment claims in Store/MemoryStore, receipts and payees collections. Tests: concurrent reserve, invalid amounts, transitions, immutable identifiers and copies.
2. Payment identity excludes purpose and uses quote-charged fields; arena report endpoint, idempotent settlement/status and delivery modes; executor confirmation and bounded requests.
3. Shared settlement coordinator for automatic and human approvals. Reserve before decide; release holds/blocks; re-reserve on human approval. Unknown outcome retains reservation; status confirmation precedes the sole allowed retry. Concurrent duplicate claims cannot pay twice.
4. Delivery schema checks, receipts, payee failure floor/judge context, dashboard read APIs and metrics from stored data.
5. HTTP acceptance: parallel budget, timeout recovered, unknown retained, duplicate report saves $5, changed purpose same identity, delivery failure history, hold approval races. Replace INV5 todo. Whole-suite/typecheck and review before commit.

Live model budget authorized by owner: at most $10 total for this session; do not print or commit credentials. Read only availability from local environment until live harness enforces cost accounting.
