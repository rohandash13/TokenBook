// OWNER: C — Jira issue created/updated → TrueUp → comment with the spend impact.
import { kvs } from '@forge/kvs';
import { addComment, getIssueSnapshot } from './jira';
import { trueup, usd } from './trueup';

export const onIssueEvent = async (event) => {
  if (event?.selfGenerated) return; // our own comments and tasks
  const key = event?.issue?.key;
  if (!key) return;
  const project = process.env.JIRA_PROJECT_KEY;
  if (project && !key.startsWith(`${project}-`)) return;

  const snapshot = await getIssueSnapshot(key);
  const result = await trueup('/api/integrations/jira/issues', { method: 'POST', body: JSON.stringify(snapshot) });
  if (!result?.team || !result.before || !result.after) return;
  const before = Math.round(result.before.estimate);
  const after = Math.round(result.after.estimate);
  if (before === after) return;

  // One comment per resulting estimate, even if Jira delivers the event twice.
  const seen = `commented:${key}:${after}`;
  if (await kvs.get(seen)) return;
  await kvs.set(seen, true);

  const ev = result.event;
  await addComment(key, [
    `TrueUp: this moves ${result.teamLabel}'s ${result.monthLabel} AI API spend estimate from ${usd(before)} to ${usd(after)}.`,
    ev ? `Driver: ${ev.multiplier}x from ${ev.date} (${ev.note}).` : 'This issue no longer adds a driver this month.',
    result.accrualStatus && result.accrualStatus !== 'prepared'
      ? `The accrual is already ${result.accrualStatus}, so finance will see this as a variance at close.`
      : 'Finance will use this in the month-end accrual. No reply needed.',
  ]);
};
