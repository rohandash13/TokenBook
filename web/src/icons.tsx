// OWNER: C (UI by Junghwan)
// Small stroke icons, 20px grid, inherit currentColor.
import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
});

export const IconOverview = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="11" width="6" height="6" rx="1.5" /></svg>
);
export const IconChat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 11.5z" /></svg>
);
export const IconLedger = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3.5" y="3" width="13" height="14" rx="2" /><path d="M7 7h6M7 10h6M7 13h3.5" /></svg>
);
export const IconScale = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M10 3v14M6 17h8M4 6h12" /><path d="M4 6l-2 5a2.5 2.5 0 0 0 4 0zM16 6l-2 5a2.5 2.5 0 0 0 4 0z" /></svg>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="10" cy="10" r="7" /><path d="M10 6.5V10l2.5 1.5" /></svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, strokeWidth: 2, ...p })}><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
);
export const IconReset = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 16, height: 16, ...p })}><path d="M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3h3" /></svg>
);
export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 16, height: 16, ...p })}><path d="M5 10h10M11 6l4 4-4 4" /></svg>
);

/** The mark: a ledger column with its total ruled off. */
export const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
    <rect width="26" height="26" rx="7" fill="var(--accent)" />
    <path d="M8 8h10M8 12h10M8 16.5h10M8 18.5h10" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.95" />
  </svg>
);
export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, strokeWidth: 2, ...p })}><path d="M10 15V5M5.5 9.5L10 5l4.5 4.5" /></svg>
);
