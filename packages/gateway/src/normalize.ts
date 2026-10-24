/** Spec §7 step 1. Pure helpers; no I/O. */

// Numbers are tokenized as maximal runs of [\d.,] and each WHOLE run is validated; a run that is not a
// well-formed number (commas only as thousands separators, ".50" fraction) yields nothing - never a prefix.
const RUN_SRC = String.raw`[\d.,]+`;
const MONEY_RE = new RegExp(String.raw`\$\s*(${RUN_SRC})`, "g");
const RUN_RE = new RegExp(RUN_SRC, "g");
const STRICT_NUM_RE = /^(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)$/;
const TIER_NOISE = new Set(["tier", "plan"]);

/** USD -> 6-decimal integer units (USDC atomic). All amount comparisons go through this. */
export function toAtomic(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function amountsEqual(a: number, b: number): boolean {
  return toAtomic(a) === toAtomic(b);
}

/** "$1,000.50" -> 1000.5. Anything that is not a plain non-negative number -> null. */
export function parseAmount(s: string): number | null {
  const m = /^\s*\$?(\S+)\s*$/.exec(s);
  if (!m || !STRICT_NUM_RE.test(m[1])) return null;
  const n = toNumber(m[1]);
  return Number.isFinite(n) ? n : null;
}

const toNumber = (raw: string): number => Number(raw.replace(/,/g, ""));

/** Validate a whole run (trailing sentence punctuation stripped first); invalid -> null. */
function runValue(run: string): number | null {
  const t = run.replace(/[.,]+$/, "");
  if (!STRICT_NUM_RE.test(t)) return null;
  const n = toNumber(t);
  return Number.isFinite(n) ? n : null;
}

const valid = (vals: (number | null)[]): number[] => vals.filter((v): v is number => v !== null);

/** Only $-prefixed tokens. */
export function extractMoney(text: string): number[] {
  return valid([...text.matchAll(MONEY_RE)].map((m) => runValue(m[1])));
}

/** Every number-looking token, $ or not. */
export function extractNumbers(text: string): number[] {
  return valid([...text.matchAll(RUN_RE)].map((m) => runValue(m[0])));
}

/** Integer tokens that are not part of a money token. */
export function extractQuantities(text: string): number[] {
  return extractNumbers(text.replace(MONEY_RE, " ")).filter(Number.isInteger);
}

export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** "Premium Tier", "Premium-Tier", "PREMIUM", "premium plan" -> "premium". */
export function normalizeTier(s: string): string {
  return tokenize(s).filter((w) => !TIER_NOISE.has(w)).join(" ");
}

/** "https://www.Vendor.test:4101/docs" -> "vendor.test:4101". Port kept: arena hosts differ only by port. */
export function normalizeDomain(s: string): string {
  let t = s.trim().toLowerCase();
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  t = t.split(/[/?#]/)[0];
  t = t.replace(/^www\./, "");
  t = t.replace(/\.$/, "");
  return t;
}

/** " Crypto Prices " -> "crypto-prices". */
export function normalizeCategory(s: string): string {
  return tokenize(s).join("-");
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

export function lineHasTier(line: string, tier: string): boolean {
  const want = normalizeTier(tier).split(" ").filter(Boolean);
  const have = tokenize(line).filter((w) => !TIER_NOISE.has(w));
  return containsSequence(have, want);
}

export function textHasWords(text: string, phrase: string): boolean {
  return containsSequence(tokenize(text), tokenize(phrase));
}

// Unicode-aware: any adjacent letter/number/underscore/@ invalidates the token; a port must be consumed whole;
// a token cut short before ".label" or ":digits" (by backtracking) is rejected too.
const HOST_TOKEN_RE =
  /(?<![\p{L}\p{N}._@-])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d+)?(?![\p{L}\p{N}_@-]|:\d|\.[\p{L}\p{N}_-])/gu;

export function textHasDomain(text: string, domain: string): boolean {
  const d = normalizeDomain(domain);
  if (d.length === 0) return false;
  const tokens = text.toLowerCase().match(HOST_TOKEN_RE) ?? [];
  return tokens.some((t) => normalizeDomain(t) === d);
}

export function textHasMoney(text: string, usd: number): boolean {
  return extractMoney(text).some((v) => amountsEqual(v, usd));
}

export function textHasNumber(text: string, value: number): boolean {
  return extractNumbers(text).some((v) => amountsEqual(v, value));
}

export function textHasQuantity(text: string, q: number): boolean {
  return extractQuantities(text).includes(q);
}
