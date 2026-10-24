# Countersign

Spending authority that grows as AI agents earn it.

> Fraud tools decide what to stop. Countersign decides how much freedom to give, and grows it as agents earn it.

Countersign is the only door between a worker AI agent and its money. The agent's only tools are `declare_plan`, `fetch_url` and `pay_and_fetch`, all served by the Countersign gateway, which also holds the wallet key.

## Status

| Milestone | State |
|---|---|
| M0 repo + decisions | repo done; Droid test (D), real x402 payment (B), Convex (C) pending |
| M1 gateway skeleton | done: INV1 + INV2 green; all payments HOLD until M2 |
| M2–M7 | not started |

## Run it

```bash
pnpm install
cp .env.example .env   # fill SIM_PAYER_SECRET; ANTHROPIC_API_KEY + WORKER_MODEL for the live worker
pnpm test
pnpm dev:arena         # terminal 1
pnpm dev:gateway       # terminal 2
pnpm worker            # terminal 3, needs ANTHROPIC_API_KEY + WORKER_MODEL in .env
```

## Real vs simulated

**Real today:** gateway (declare_plan, fetch_url, pay_and_fetch tools, bound to 127.0.0.1), plan-first enforcement (INV2), page and quote storage, worker process isolation checks (INV1), Claude worker loop through the gateway's LLM proxy (runs only when `ANTHROPIC_API_KEY` and `WORKER_MODEL` are set; not yet run live).

**Simulated today:**
- Payments: `SimulatedExecutor` (HMAC-signed header, no chain). Every response says `simulated: true`. Real x402 on Base Sepolia: TODO (B, M0).
- Vendors and pages: the arena, which we host.
- Every payment is currently HOLD: the decision core is M2.

**Limits:** worker isolation is enforced at the process level (env allowlist, `fetch` guard, import check), not by an OS sandbox.

## Benchmark

TODO: filled only from real runs (M6). No numbers until then.

## Decisions

See [DECISIONS.md](DECISIONS.md).
