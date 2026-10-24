# Global constraints (verbatim from the plan; bind every task)

- Testnet only: `X402_NETWORK=base-sepolia`. No real money, no real third-party services.
- `fetch_url` and `pay_and_fetch` may only reach hosts we host (arena), listed in `config/allowlist.json`.
- Never commit secrets. `.env*` is gitignored except `.env.example`, which holds names only.
- Model IDs come from env vars (`JUDGE_MODEL`, `ATTACKER_MODEL`, `WORKER_MODEL`), never hardcoded.
- Invariant 1: the worker process has no wallet key, no outbound network except through the gateway.
- Invariant 2: `fetch_url` before `declare_plan` for a task is refused.
- Invariant 3: a payment with any field of origin `PAGE` or `UNKNOWN` can never be auto-approved. Final verdict >= HOLD even if Tier 1 or the judge says approve.
- Invariant 4: Tier 2 judge input never contains raw page text, page summaries or the agent's free-text explanation (purpose).
- Invariant 5: timeouts never trigger a second payment (idempotency key).
- Never weaken an invariant to make a demo pass.
- Anything simulated is labelled `simulated` in API responses, logs and README.
- No invented numbers anywhere user-facing; placeholders carry `TODO`.
- All code is written fresh in this repo; nothing copied from WalletOS.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Shell: Git Bash on Windows. Run all commands from the repo root `C:\Users\rohid\Countersign`.
- Toolchain actually resolved: Node 24, pnpm 9.15.0, typescript 7.0.2, vitest 5.0.5, tsx 4.23.15, express 5.3.0, zod 3.x.
