import type { Payee, Store } from "@countersign/shared";
/** Approved-vendor fallback only. No CRS business identifiers or sandbox responses are invented. */
export function createPayeeChecker(store: Store, approvedVendors: string[]) {
  const approved = new Set(approvedVendors.map(v => v.toLowerCase()));
  const pending = new Map<string, Promise<Payee>>();
  return async (domain: string): Promise<Payee> => {
    const existing = await store.getPayee(domain);
    if (existing && existing.crsStatus !== "unchecked") return existing;
    const inFlight = pending.get(domain);
    if (inFlight) return inFlight;
    const run = (async () => {
      const prior = await store.getPayee(domain);
      const record: Payee = { payeeId: domain, domain, liens: 0, ofacHit: false, firstSeenAt: store.now(), deliveryFailures: 0, ...prior,
        crsStatus: approved.has(domain.toLowerCase()) ? "approved_vendor" : "failed",
        checkNote: "Approved-vendor list fallback. No CRS pull: verified sandbox credentials, documentation and test-business mapping are not configured. CRS would check business identity, liens/judgments and OFAC before first payment." };
      await store.putPayee(record);
      return record;
    })();
    pending.set(domain, run);
    try { return await run; } finally { pending.delete(domain); }
  };
}
