// OWNER: C
// Money helpers. Amounts are dollar numbers; balance is always checked in integer cents.
export const roundCents = (usd: number): number => Math.round(usd * 100) / 100;
export const toCents = (usd: number): number => Math.round(usd * 100);
export const fromCents = (cents: number): number => cents / 100;
// Sum dollar amounts exactly: add integer cents, convert back once.
export const sumUsd = (xs: number[]): number => fromCents(xs.reduce((a, x) => a + toCents(x), 0));
