// OWNER: C — TrueUp (month-end close) → a Jira task for each variance memo, linked to its cause.
// URL: `forge webtrigger create` → put it in TrueUp's .env as FORGE_WEBTRIGGER_URL.
import { createTask, findOpenTask, linkIssues } from './jira';

const header = (req, name) => {
  const v = (req?.headers || {})[name];
  return Array.isArray(v) ? v[0] : v;
};
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(body) });

export const onVariance = async (request) => {
  const secret = process.env.TRUEUP_SECRET;
  if (!secret || header(request, 'x-trueup-secret') !== secret) return reply(401, { error: 'bad secret' });
  const project = process.env.JIRA_PROJECT_KEY;
  if (!project) return reply(500, { error: 'JIRA_PROJECT_KEY is not set' });
  let p;
  try {
    p = JSON.parse(request.body || '{}');
  } catch {
    return reply(400, { error: 'body is not JSON' });
  }
  const summary = `Review ${p.monthLabel} AI spend variance: ${p.teamLabel}`;
  // Re-running the close (e.g. after a demo reset) reuses the open task instead of opening another.
  const existing = await findOpenTask(project, summary);
  if (existing) return reply(200, { key: existing, reused: true });
  const key = await createTask(
    project,
    summary,
    [
      ...String(p.memoText || '').split(/\n+/),
      `Sources: ${(p.sources || []).join(', ')}`,
      'Opened by TrueUp at month-end close. Review the memo, then attach it to the close in TrueUp.',
    ],
    ['trueup', 'variance', `team-${p.team}`],
  );
  for (const related of p.relatedIssueKeys || []) {
    try {
      await linkIssues(key, related);
    } catch (err) {
      console.warn(`could not link ${key} to ${related}: ${err.message}`);
    }
  }
  return reply(200, { key });
};
