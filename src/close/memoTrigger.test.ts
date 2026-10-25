// OWNER: C
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actual, Estimate, Memo, MemoInput, Team, TeamContext } from '../shared/types';
import { buildAccrual } from './journal';
import { buildMemoInputs, draftMemos, placeholderMemo } from './memoTrigger';
import { computeVariances } from './variance';

const est = (team: Team, estimate: number): Estimate => ({
  team, month: '2026-10', asOf: '2026-10-25', method: 'trueup', estimate, actualToDate: 0,
  basis: `${team}: campaign 2x from Oct 15 (Maya, Slack)`, confidence: 'medium',
});
const act = (team: Team, actualUsd: number): Actual => ({ team, month: '2026-10', actualUsd });

const growthCtx: TeamContext = {
  team: 'growth', month: '2026-10', replied: true, leadName: 'Maya',
  quote: 'Big campaign goes out mid-October',
  events: [{ date: '2026-10-15', multiplier: 2, note: 'October campaign' }],
};
const accrual = buildAccrual('2026-10', [est('support', 10040), est('growth', 9000)], [growthCtx], 'Dana');
const variances = computeVariances(accrual, [act('support', 10210), act('growth', 5600)]);

describe('buildMemoInputs', () => {
  it('creates inputs only for flagged variances, with the context and evidence attached', () => {
    const inputs = buildMemoInputs(variances, accrual, [growthCtx]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      team: 'growth', month: '2026-10', estimate: 9000, actual: 5600, approvedBy: 'Dana',
      quote: 'Big campaign goes out mid-October',
    });
    expect(inputs[0].variancePct).toBeCloseTo(0.6071, 4); // (9000 − 5600) / 5600
    expect(inputs[0].basis).toContain('campaign 2x from Oct 15');
    expect(inputs[0].basis).toContain('; usage:growth:2026-10');
    expect(inputs[0].sources).toEqual([
      'JE-2026-10-ACCRUAL', 'JE-2026-10-ACTUAL', 'actuals:growth:2026-10', 'slack:growth:2026-10',
    ]);
  });

  it('carries the reply time in the slack source when the context has repliedAt', () => {
    const [input] = buildMemoInputs(variances, accrual, [{ ...growthCtx, repliedAt: '2026-10-24T17:00:00Z' }]);
    expect(input.sources).toContain('slack:growth:2026-10@2026-10-24T17:00:00Z');
    expect(input.sources).not.toContain('slack:growth:2026-10');
    const memo = placeholderMemo(input);
    expect(memo.text).toContain('2026-10-24T17:00:00Z');
    expect(memo.text).toContain('approved by Dana');
  });

  it('has no quote, no slack source and defaults approvedBy when there is no context', () => {
    const bare = buildAccrual('2026-10', [est('support', 10040), est('growth', 9000)]);
    const [input] = buildMemoInputs(variances, bare, []);
    expect(input.quote).toBeUndefined();
    expect(input.approvedBy).toBe('Dana');
    expect(input.sources).toEqual(['JE-2026-10-ACCRUAL', 'JE-2026-10-ACTUAL', 'actuals:growth:2026-10']);
  });

  it('does not treat an unreplied context as a slack source', () => {
    const [input] = buildMemoInputs(variances, accrual, [{ ...growthCtx, replied: false, quote: undefined }]);
    expect(input.sources).not.toContain('slack:growth:2026-10');
    expect(input.quote).toBeUndefined();
  });
});

describe('draftMemos', () => {
  const [input] = buildMemoInputs(variances, accrual, [growthCtx]);
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it('passes LLM memos through but forces team, month and sources from the input', async () => {
    const llm = async (i: MemoInput): Promise<Memo> => ({
      ...placeholderMemo(i), team: 'search', month: '2020-01', sources: ['x'], text: 'LLM text',
    });
    const [memo] = await draftMemos([input], llm);
    expect(memo).toMatchObject({ team: 'growth', month: '2026-10', text: 'LLM text', sources: input.sources });
  });

  it('enforces the numbers: tampered estimate, actual, basis, approver, quote and sources are corrected', async () => {
    const llm = async (i: MemoInput): Promise<Memo> => ({
      ...i, estimate: 1, actual: 2, variancePct: 9, basis: 'made up', approvedBy: 'Mallory', quote: 'fake',
      sources: ['x'], text: 'LLM text', createdAt: '2026-10-26T00:00:00Z',
    });
    const [memo] = await draftMemos([input], llm);
    expect(memo).toEqual({ ...input, text: 'LLM text', createdAt: '2026-10-26T00:00:00Z' });
  });

  it('uses the placeholder when the LLM text is empty or whitespace', async () => {
    for (const text of ['', '   ', ' \n ']) {
      const [memo] = await draftMemos([input], async (i) => ({ ...placeholderMemo(i), text }));
      expect(memo.text).toContain('Placeholder');
      expect(memo.estimate).toBe(9000);
    }
  });

  it('falls back to a deterministic placeholder when the LLM throws', async () => {
    const [memo] = await draftMemos([input], async () => { throw new Error('rate limited'); });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(memo.text).toContain('$5,600');
    expect(memo.text).toContain('$9,000');
    expect(memo.text).toContain('over-accrued by $3,400');
    expect(memo.text).toContain('+60.7% of actual');
    expect(memo.text).toContain('Maya said: "Big campaign goes out mid-October"');
    expect(memo.text).toContain('Accrual approved by Dana');
    expect(memo.text).toContain('campaign 2x from Oct 15');
    expect(memo.text).toContain('Placeholder');
    expect(memo.sources).toEqual(input.sources);
  });

  it('describes an under-accrual with the same sign convention', () => {
    const memo = placeholderMemo({ ...input, estimate: 5000, actual: 6000, variancePct: -0.1667 });
    expect(memo.text).toContain('under-accrued by $1,000');
    expect(memo.text).toContain('-16.7% of actual');
  });

  it('says the drivers came from team signals when there is no lead reply', () => {
    const memo = placeholderMemo({ ...input, quote: undefined });
    expect(memo.text).toContain('Drivers came from team signals.');
  });
});

describe('placeholderMemo with contradicting signals', () => {
  it('says the signals contradicted the booked driver', () => {
    const memo = placeholderMemo({
      team: 'growth', month: '2026-10', estimate: 5550, actual: 4651.22, variancePct: 0.1932, basis: 'b', approvedBy: 'Dana',
      quote: 'Fall campaign goes live Oct 26', sources: ['contradicts: Slack, Oct 19, Maya Chen: "pushed to Nov 4" https://s/x'],
    });
    expect(memo.text).toContain('Team signals contradicted the booked driver before approval.');
  });
});
