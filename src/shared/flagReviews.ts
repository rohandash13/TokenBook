import type { ContextEvent, DriverFlag, Estimate, Month, Team, TeamContext } from './types';

export type FlagReview = { id: string; team: Team; month: Month; flagKey: string; action: 'confirm' | 'dismiss'; reason: string; reviewedBy: string; reviewedAt: string; flag: DriverFlag; event?: ContextEvent };
export const flagKey = (flag: DriverFlag) => JSON.stringify([flag.date, flag.note, flag.reason, [...(flag.evidence?.map((e) => e.id) ?? [])].sort()]);
export const sameWindow = (a: ContextEvent, b: ContextEvent) => a.date === b.date && a.until === b.until && a.multiplier === b.multiplier;
export const overlaps = (a: ContextEvent, b: ContextEvent) => a.date <= (b.until ?? '9999-12-31') && b.date <= (a.until ?? '9999-12-31');

/** Human decisions survive automatic refresh, without multiplying conflicting drivers. */
export function applyFlagReviews(events: ContextEvent[], flags: DriverFlag[], reviews: FlagReview[]) {
  const nextEvents: ContextEvent[] = events.map((e) => ({ ...e, evidence: e.evidence ? [...e.evidence] : undefined }));
  let nextFlags = [...flags];
  for (const review of reviews) {
    if (review.action === 'confirm' && review.event) {
      const matching = nextEvents.find((e) => sameWindow(e, review.event!));
      if (matching) {
        matching.evidence = [...(matching.evidence ?? []), ...(review.event.evidence ?? []).filter((e) => !matching.evidence?.some((old) => old.id === e.id))];
      } else if (nextEvents.some((e) => overlaps(e, review.event!))) {
        const note = 'Previously reviewed change conflicts with refreshed evidence';
        if (!nextFlags.some((f) => f.note === note && f.date === review.event!.date)) nextFlags.push({ ...review.flag, date: review.event.date, note, reason: 'size unknown' });
      } else nextEvents.push(review.event);
    }
    nextFlags = nextFlags.filter((f) => flagKey(f) !== review.flagKey);
  }
  return { events: nextEvents, flags: nextFlags };
}

export type FlagReviewResult = { review: FlagReview; context: TeamContext; before: Estimate | null; after: Estimate | null };
export type FlagReviewBody = { month: string; flagKey: string; action: 'confirm' | 'dismiss'; reason: string; date?: string; until?: string; multiplier?: number };
