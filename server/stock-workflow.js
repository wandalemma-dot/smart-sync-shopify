import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = 'https://token.actions.githubusercontent.com';
const keys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'));
const repository = 'wandalemma-dot/indy-stock-automation';
const ref = 'refs/heads/main';
export const audience = 'https://smart-sync-shopify.vercel.app/api/id-stock';

// The existing inventory reader alone can never authorize an update.
// GitHub also has to attest that the private scheduled workflow is running.
export async function workflowActor(token, keySet = keys) {
  if (typeof token !== 'string' || token.length > 24000) return null;
  try {
    const { payload } = await jwtVerify(token, keySet, {
      algorithms: ['RS256'], issuer, audience, maxTokenAge: '10m',
      requiredClaims: ['exp', 'iat', 'nbf', 'run_id', 'repository_id'],
    });
    if (payload.repository !== repository || payload.repository_owner_id !== '279773105' ||
        payload.repository_visibility !== 'private' || payload.ref !== ref ||
        payload.workflow_ref !== repository + '/.github/workflows/stock-preview.yml@' + ref ||
        !['schedule', 'workflow_dispatch'].includes(payload.event_name) ||
        payload.runner_environment !== 'github-hosted') return null;
    return 'bot:' + payload.run_id + ':' + payload.run_attempt;
  } catch {
    return null;
  }
}
