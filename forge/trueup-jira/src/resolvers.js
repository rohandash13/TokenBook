// OWNER: C — backend for the issue panel.
import Resolver from '@forge/resolver';
import { trueup } from './trueup';

const resolver = new Resolver();

resolver.define('getImpact', async ({ context }) => {
  const key = context?.extension?.issue?.key;
  if (!key) return { error: 'No issue in context.' };
  try {
    return await trueup(`/api/integrations/jira/impact?issue=${encodeURIComponent(key)}`);
  } catch (err) {
    return { error: err.message };
  }
});

export const handler = resolver.getDefinitions();
