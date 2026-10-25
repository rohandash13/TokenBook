// OWNER: C — Jira issue created/updated → TokenBook → a reply on the ticket with its spend impact.
import { kvs } from '@forge/kvs';
import { addComment, getIssueSnapshot, hasComment } from './jira';
import { trueup, usd } from './trueup';

const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The reply for this outcome, or null when the issue isn't tracked (no team label). */
export function replyFor(result, dueDate) {
  if (!result?.team || !result.before || !result.after) return null;
  const before = Math.round(result.before.estimate);
  const after = Math.round(result.after.estimate);
  const ev = result.event;
  const closed = result.accrualStatus && result.accrualStatus !== 'prepared'
    ? `The accrual is already ${result.accrualStatus}, so finance will see this as a variance at close.`
    : 'Finance will use this in the month-end accrual. No reply needed.';
  const outcome = result.outcome ?? (before !== after ? 'moved' : ev ? 'corroborated' : 'none');
  if (ev && outcome === 'other-month') {
    return {
      sig: `other:${ev.date}`,
      lines: [
        `TokenBook: tracked for ${result.teamLabel}: ${ev.multiplier}x from ${shortDate(ev.date)}.`,
        `That is outside ${result.monthLabel}, so it does not change this month's estimate (${usd(after)}); it counts in the month it lands.`,
      ],
    };
  }
  if (ev && outcome === 'pending') {
    return {
      sig: `pending:${ev.date}:${ev.multiplier}`,
      lines: [
        `TokenBook: noted ${ev.multiplier}x from ${shortDate(ev.date)} for ${result.teamLabel}.`,
        `It counts toward ${result.teamLabel}'s ${result.monthLabel} estimate once the team's signals are checked in TokenBook (Signals → Refresh). The estimate is ${usd(after)} until then.`,
      ],
    };
  }
  if (outcome === 'moved') {
    return {
      sig: `moved:${after}`,
      lines: [
        `TokenBook: this moves ${result.teamLabel}'s ${result.monthLabel} AI API spend estimate from ${usd(before)} to ${usd(after)}.`,
        ev ? `Driver: ${ev.multiplier}x from ${shortDate(ev.date)} (${ev.note}).` : 'This issue no longer adds a driver this month.',
        closed,
      ],
    };
  }
  if (ev) {
    return {
      sig: `counted:${ev.date}:${ev.multiplier}`,
      lines: [
        `TokenBook: counted in ${result.teamLabel}'s ${result.monthLabel} AI API spend estimate (${usd(after)}): ${ev.multiplier}x from ${shortDate(ev.date)}.`,
        'This driver was already known from other sources (Slack, GitHub or the team lead), so the estimate does not change.',
      ],
    };
  }
  return {
    sig: `none:${dueDate ?? 'no-date'}`,
    lines: [
      `TokenBook: tracked for ${result.teamLabel}, but not a spend driver for ${result.monthLabel}` +
        (dueDate ? ` (due ${shortDate(dueDate)}).` : ' (no due date).'),
      `${result.teamLabel}'s estimate stays at ${usd(after)}. Add a launch, campaign or load-test label and an in-month due date if this changes AI usage.`,
    ],
  };
}

export const onIssueEvent = async (event) => {
  if (event?.selfGenerated) return; // our own comments and tasks
  const key = event?.issue?.key;
  if (!key) return;
  const project = process.env.JIRA_PROJECT_KEY;
  if (project && !key.startsWith(`${project}-`)) return;

  const snapshot = await getIssueSnapshot(key);
  const result = await trueup('/api/integrations/jira/issues', { method: 'POST', body: JSON.stringify(snapshot) });
  const reply = replyFor(result, snapshot.dueDate);
  if (!reply) return;

  // One reply per issue and outcome, even if Jira delivers the event twice or the issue is edited again.
  const seen = `replied:${key}:${reply.sig}`;
  if (await kvs.get(seen)) return;
  await kvs.set(seen, true);
  // Two events can arrive together and both pass the check above; the ticket itself is the final check.
  if (await hasComment(key, reply.lines[0])) return;
  await addComment(key, reply.lines);
};
