import type { Store } from "@countersign/shared";
/** Denominator: original verdicts only; human, duplicate and execution follow-ups are excluded. */
export async function computeMetrics(store: Store) {
  const log = await store.listDecisions();
  const ds = log.filter(d => d.kind === "verdict");
  const t1 = ds.filter(d => d.tier === 1), t2 = ds.filter(d => d.tier === 2);
  const costs = log.filter(d => d.costUsd !== null);
  return { paymentCount: ds.length, autonomyRate: ds.length ? ds.filter(d => d.verdict === "approve" && d.tier !== null).length / ds.length : null,
    tier1Count: t1.length, tier2Count: t2.length, holds: ds.filter(d => d.verdict === "hold").length, blocks: ds.filter(d => d.verdict === "block").length,
    avgTier1LatencyMs: t1.length ? t1.reduce((n,d) => n + d.latencyMs, 0) / t1.length : null,
    totalCostUsd: costs.reduce((n,d) => n + d.costUsd!, 0), unknownCostCount: log.length - costs.length,
    moneySavedUsd: log.filter(d => d.kind === "duplicate_reused").reduce((n,d) => n + (d.savedUsd ?? 0), 0) };
}
