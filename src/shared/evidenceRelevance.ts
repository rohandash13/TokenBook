import type { Evidence } from './types';

/** Display filter, not an approval rule: financial emails can still require review. */
export function isRelevantEmail(evidence: Pick<Evidence, 'source' | 'text'>): boolean {
  if (evidence.source !== 'gmail') return true;
  return /\b(?:API\s+(?:usage|traffic|calls|requests|costs?|spend)|token\s+(?:usage|volume|costs?|pricing)|inference\s+(?:usage|volume|costs?)|run[- ]rate|(?:vendor|model|API)\s+(?:pricing|rates?|credits?)|invoice|billing\s+(?:adjustment|credit|notice)|contract\s+renewal)\b/i.test(evidence.text);
}
