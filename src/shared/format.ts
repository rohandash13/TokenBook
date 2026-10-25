const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export const formatUsd = (usd: number, cents = false): string => (cents ? usd2 : usd0).format(usd);
export const formatCents = (c: number): string => usd2.format(c / 100);
export const formatPct = (p: number): string => `${p > 0 ? '+' : ''}${(p * 100).toFixed(1)}%`;
