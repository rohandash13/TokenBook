// OWNER: C — Jira REST helpers (as the app).
import api, { route } from '@forge/api';

/** Plain text from an Atlassian Document Format node. */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  const inner = (node.content || []).map(adfToText).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(node.type) ? `${inner}\n` : inner;
}

export const adfDoc = (paragraphs) => ({
  type: 'doc',
  version: 1,
  content: paragraphs.filter(Boolean).map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

async function jira(path, init = {}) {
  const res = await api.asApp().requestJira(path, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** The issue in the shape TrueUp's POST /api/integrations/jira/issues expects. */
export async function getIssueSnapshot(key) {
  const issue = await jira(
    route`/rest/api/3/issue/${key}?fields=summary,description,labels,components,duedate,project,created,updated&expand=changelog`,
  );
  const f = issue.fields;
  const site = issue.self.split('/rest/')[0];
  const dueDateHistory = (issue.changelog?.histories || [])
    .flatMap((h) => (h.items || [])
      .filter((it) => it.field === 'duedate')
      .map((it) => ({ at: h.created, from: (it.from || '').slice(0, 10) || null, to: (it.to || '').slice(0, 10) || null })))
    .sort((a, b) => a.at.localeCompare(b.at));
  return {
    key: issue.key,
    url: `${site}/browse/${issue.key}`,
    projectKey: f.project.key,
    summary: f.summary || '',
    description: adfToText(f.description).trim(),
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    dueDate: f.duedate || null,
    dueDateHistory,
    createdAt: f.created,
    updatedAt: f.updated,
  };
}

export const addComment = (key, paragraphs) =>
  jira(route`/rest/api/3/issue/${key}/comment`, { method: 'POST', body: JSON.stringify({ body: adfDoc(paragraphs) }) });

export async function createTask(projectKey, summary, paragraphs, labels) {
  const created = await jira(route`/rest/api/3/issue`, {
    method: 'POST',
    body: JSON.stringify({
      fields: { project: { key: projectKey }, issuetype: { name: 'Task' }, summary, labels, description: adfDoc(paragraphs) },
    }),
  });
  return created.key;
}

export const linkIssues = (fromKey, toKey) =>
  jira(route`/rest/api/3/issueLink`, {
    method: 'POST',
    body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: fromKey }, outwardIssue: { key: toKey } }),
  });
