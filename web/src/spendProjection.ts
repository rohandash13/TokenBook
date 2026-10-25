import type { ContextEvent } from '../../src/shared/types';

/** Allocate the existing month-end remainder; this does not produce a new estimate. */
export function allocateRemainingSpend(dates: string[], remaining: number, events: ContextEvent[]): number[] {
  const weights = dates.map((date) => events.reduce((weight, event) => date >= event.date && (!event.until || date <= event.until) ? weight * event.multiplier : weight, 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => totalWeight ? Math.max(0, remaining) * weight / totalWeight : 0);
}
