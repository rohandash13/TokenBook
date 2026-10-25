// OWNER: C (UI by Junghwan)
// Small stroke icons, 20px grid, inherit currentColor.
import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
});

export const IconWallet = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M16 6V4H5a2 2 0 0 0 0 4h12v8H5a2 2 0 0 1-2-2V6" /><path d="M17 10h-4v4h4" /><circle cx="14.5" cy="12" r=".5" fill="currentColor" stroke="none" /></svg>
);

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

/** The mark: a T-account (debit | credit) with a token on the credit side. */
export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <rect width="40" height="40" rx="9" fill="#2a221d" />
    <path d="M9 13.5h22M20 13.5v17.5" stroke="#f5f2ed" strokeWidth="2.75" strokeLinecap="round" />
    <circle cx="28" cy="24" r="3" fill="#c38a2c" />
  </svg>
);
export const IconArrowUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, strokeWidth: 2, ...p })}><path d="M10 15V5M5.5 9.5L10 5l4.5 4.5" /></svg>
);
export const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0zM10 15v2.5" /></svg>
);

// Brand marks stay local so source attribution works without a third-party image request.
export const SlackMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="source-mark">
    <rect x="1" y="8" width="10" height="4" rx="2" fill="#36C5F0" /><rect x="7" y="1" width="4" height="6" rx="2" fill="#36C5F0" />
    <rect x="12" y="1" width="4" height="10" rx="2" fill="#2EB67D" /><rect x="17" y="7" width="6" height="4" rx="2" fill="#2EB67D" />
    <rect x="13" y="12" width="10" height="4" rx="2" fill="#ECB22E" /><rect x="13" y="17" width="4" height="6" rx="2" fill="#ECB22E" />
    <rect x="8" y="13" width="4" height="10" rx="2" fill="#E01E5A" /><rect x="1" y="13" width="6" height="4" rx="2" fill="#E01E5A" />
  </svg>
);
export const GitHubMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="source-mark">
    <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.105.768-.244.768-.542 0-.267-.01-.975-.015-1.913-3.13.68-3.79-1.51-3.79-1.51-.512-1.3-1.25-1.647-1.25-1.647-1.023-.7.077-.686.077-.686 1.13.08 1.725 1.16 1.725 1.16 1.005 1.722 2.637 1.225 3.28.936.102-.728.393-1.225.714-1.507-2.5-.285-5.13-1.25-5.13-5.563 0-1.23.44-2.235 1.16-3.023-.117-.285-.503-1.43.11-2.98 0 0 .945-.302 3.094 1.155A10.8 10.8 0 0 1 12 6.174c.956.005 1.92.13 2.82.38 2.148-1.457 3.092-1.155 3.092-1.155.615 1.55.23 2.695.113 2.98.722.788 1.158 1.793 1.158 3.023 0 4.325-2.633 5.275-5.143 5.555.405.35.766 1.043.766 2.1 0 1.517-.014 2.742-.014 3.114 0 .3.203.652.774.541A11.252 11.252 0 0 0 12 .75Z" />
  </svg>
);
export const IconExternal = () => (
  <svg {...base({ width: 13, height: 13 })}><path d="M8 5H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3M11 3h6v6M9 11l8-8" /></svg>

);

export const IconTrend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 15l4.5-5 3.5 3.5L17 6" /><path d="M12.5 6H17v4.5" /></svg>
);

export const JiraMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="source-mark">
    <path d="M22.2 11.3 12.7 1.8 12 1.1 4.8 8.3 1.8 11.3a1 1 0 0 0 0 1.4l6.5 6.5L12 22.9l7.2-7.2.1-.1 2.9-2.9a1 1 0 0 0 0-1.4ZM12 15.1 8.9 12 12 8.9l3.1 3.1L12 15.1Z" fill="#2684FF" />
  </svg>
);
