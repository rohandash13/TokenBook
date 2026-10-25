// OWNER: C (count-up by Junghwan)
// Counts numbers up when they first appear (and eases to new values when they change), for
// screens that don't animate their own figures. Imported once from main.tsx; touches no component.
// It only rewrites the text node it animates and always finishes on the exact original string.

const SELECTORS = ['.mi-stat-v', '.best-price', '.opt-save-v'];
const DURATION = 750;

type Run = { raf: number; written: string };
const runs = new WeakMap<Text, Run>();
const lastValue = new WeakMap<Text, number>();

function parse(s: string) {
  const m = s.match(/-?[\d,]*\.?\d+/);
  if (!m || m.index === undefined) return null;
  const raw = m[0];
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
  return {
    prefix: s.slice(0, m.index), suffix: s.slice(m.index + raw.length),
    value: Number(raw.replace(/,/g, '')), decimals, commas: raw.includes(','),
  };
}

function format(n: number, decimals: number, commas: boolean) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: commas });
}

function animate(node: Text, target: string) {
  const p = parse(target);
  if (!p) return;
  const prev = runs.get(node);
  if (prev) cancelAnimationFrame(prev.raf);
  const from = lastValue.get(node) ?? 0;
  lastValue.set(node, p.value);
  if (from === p.value || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.nodeValue = target;
    return;
  }
  const start = performance.now();
  const run: Run = { raf: 0, written: '' };
  const tick = (t: number) => {
    const k = Math.min(1, (t - start) / DURATION);
    const eased = 1 - Math.pow(1 - k, 3);
    const text = k < 1 ? p.prefix + format(from + (p.value - from) * eased, p.decimals, p.commas) + p.suffix : target;
    run.written = text;
    node.nodeValue = text;
    if (k < 1) run.raf = requestAnimationFrame(tick);
    else runs.delete(node);
  };
  runs.set(node, run);
  run.raf = requestAnimationFrame(tick);
}

function firstText(el: Element): Text | null {
  for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE && /\d/.test(n.nodeValue ?? '')) return n as Text;
  return null;
}

function scan(root: ParentNode) {
  const els: Element[] = [];
  if (root instanceof Element && root.matches(SELECTORS.join(','))) els.push(root);
  root.querySelectorAll(SELECTORS.join(',')).forEach((el) => els.push(el));
  for (const el of els) {
    const node = firstText(el);
    if (node && !lastValue.has(node)) animate(node, node.nodeValue ?? '');
  }
}

const observer = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'characterData') {
      const node = r.target as Text;
      if (!lastValue.has(node)) continue;
      const run = runs.get(node);
      if (run && node.nodeValue === run.written) continue; // our own write
      if (!run && parse(node.nodeValue ?? '')?.value === lastValue.get(node)) continue; // our final write
      animate(node, node.nodeValue ?? ''); // React changed the value
    } else {
      r.addedNodes.forEach((n) => { if (n.nodeType === Node.ELEMENT_NODE) scan(n as Element); });
    }
  }
});

function start() {
  scan(document);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
