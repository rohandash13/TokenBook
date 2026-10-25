// OWNER: C
import { describe, expect, it } from 'vitest';
import type { TeamContext } from '../shared/types';
import { withExternalEvents, type ExternalEvent } from './merge';

const jira = (team: ExternalEvent['team'], date: string, multiplier: number): ExternalEvent => ({
  team, date, multiplier, note: `launch (Jira NW-1)`, source: 'jira',
  evidence: [{ source: 'jira', id: 'NW-1', url: 'https://x.atlassian.net/browse/NW-1', text: 'Launch', date: '2026-10-20' }],
});

const replied: TeamContext = {
  team: 'growth', month: '2026-10', replied: true, leadName: 'Maya',
  events: [{ date: '2026-10-26', multiplier: 2, note: 'campaign' }],
};

describe('withExternalEvents', () => {
  it('appends to a lead reply and keeps it a reply', () => {
    const [ctx] = withExternalEvents([replied], [jira('growth', '2026-10-28', 1.3)]);
    expect(ctx.replied).toBe(true);
    expect(ctx.inferred).toBeUndefined();
    expect(ctx.events.map((e) => e.date)).toEqual(['2026-10-26', '2026-10-28']);
    expect(ctx.events[1]).toMatchObject({ source: 'jira', multiplier: 1.3 });
  });

  it('applies an event on a date the context already has once, attaching the evidence', () => {
    const [ctx] = withExternalEvents([replied], [jira('growth', '2026-10-26', 3)]);
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0]).toMatchObject({ multiplier: 2, note: 'campaign' });
    expect(ctx.events[0].evidence?.map((e) => e.id)).toEqual(['NW-1']);
    expect(withExternalEvents([ctx], [jira('growth', '2026-10-26', 3)])[0].events[0].evidence).toHaveLength(1);
    expect(replied.events[0].evidence).toBeUndefined();
  });

  it('adds to a context whose signals were checked', () => {
    const checked: TeamContext = { team: 'support', month: '2026-10', replied: false, inferred: true, events: [], leadName: 'Priya' };
    const [ctx] = withExternalEvents([checked], [jira('support', '2026-10-27', 3)]);
    expect(ctx).toMatchObject({ replied: false, inferred: true });
    expect(ctx.events[0]).toMatchObject({ date: '2026-10-27', multiplier: 3 });
  });

  it('leaves a not-yet-checked context alone until its signals are read', () => {
    const notChecked: TeamContext = { team: 'support', month: '2026-10', replied: false, events: [], leadName: 'Priya' };
    expect(withExternalEvents([notChecked], [jira('support', '2026-10-27', 3)])).toEqual([notChecked]);
  });

  it('creates an inferred context for a team with none, in the event month', () => {
    const out = withExternalEvents([], [jira('support', '2026-11-01', 0.9)]);
    expect(out).toEqual([expect.objectContaining({
      team: 'support', month: '2026-11', replied: false, inferred: true, leadName: 'Priya', inferredAt: '2026-10-20',
    })]);
  });

  it('does not mutate its input', () => {
    const input = [replied];
    withExternalEvents(input, [jira('growth', '2026-10-28', 1.3)]);
    expect(input[0].events).toHaveLength(1);
  });
});
