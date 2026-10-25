// OWNER: C
import { describe, expect, it } from 'vitest';
import { defaultDeps } from './deps';

describe('defaultDeps.sendCheckIn', () => {
  it('rejects with the Slack app command for the team', async () => {
    await expect(defaultDeps.sendCheckIn('support', '2026-10')).rejects.toThrow(
      'Check-ins are sent by the Slack app — run: npm run slack -- --checkin support',
    );
  });
});
