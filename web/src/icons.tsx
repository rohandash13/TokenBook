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

/** The mark: an open ledger book, a token on the left page, ruled lines on the right. */
export const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
    <rect width="26" height="26" rx="7" fill="var(--accent)" />
    <path d="M13 8.6C11 7.4 8.6 7.2 6 7.9v10.2c2.6-.7 5-.5 7 .7 2-1.2 4.4-1.4 7-.7V7.9c-2.6-.7-5-.5-7 .7z" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M13 8.6v10.2" stroke="#fff" strokeWidth="1.5" />
    <circle cx="9.5" cy="13.2" r="1.9" fill="#fff" />
    <path d="M15.3 11.6h2.7M15.3 14.6h2.7" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, strokeWidth: 2, ...p })}><path d="M10 15V5M5.5 9.5L10 5l4.5 4.5" /></svg>
);
export const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0zM10 15v2.5" /></svg>
);
