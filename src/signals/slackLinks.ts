// OWNER: D — verified live permalinks for synthetic demo evidence. Never fabricate message ids.
import { existsSync, readFileSync } from 'node:fs';
import type { Signal } from './types.js';

export const SLACK_LINKS_PATH = 'data/demo/slack-links.json';
export type SlackLinks = Record<string, string>;

export function loadSlackLinks(path = SLACK_LINKS_PATH): SlackLinks {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as SlackLinks : {};
}

export function applySlackLinks(signals: Signal[], links = loadSlackLinks()): Signal[] {
  return signals.map((s) => {
    const url = links[s.id];
    // Manifest values must be Slack HTTPS message permalinks, never arbitrary URLs.
    return s.source === 'slack' && url && /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+(?:\?[^<>\s|]*)?$/.test(url)
      ? { ...s, url } : s;
  });
}
