import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/shopify.js';
import session from '../api/session.js';
import { COOKIE, makeSession } from './access.js';
import { inspectReadQuery } from './read-policy.js';

const appKey = 'app-test-only-'.padEnd(48, 'a');
const botKey = 'bot-test-only-'.padEnd(48, 'b');
const origin = 'https://smart-sync-shopify.vercel.app';
function response() {
  return { statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; } };
}
function request(query, headers = {}) {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: { query } };
}
beforeEach(() => {
  vi.stubEnv('APP_ACCESS_KEY', appKey);
  vi.stubEnv('AUTOMATION_READ_TOKEN', botKey);
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('SHOPIFY_CLIENT_ID', '');
  vi.stubEnv('SHOPIFY_CLIENT_SECRET', '');
  vi.stubEnv('SHOPIFY_ADMIN_TOKEN', 'test-only-shopify-token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { shop: { name: 'Test' } } }) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('authenticated read-only boundary', () => {
  it('rejects anonymous requests without calling Shopify', async () => {
    const res = response(); await handler(request('{ shop { name } }'), res);
    expect(res.statusCode).toBe(401); expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed if secrets are missing', async () => {
    vi.stubEnv('APP_ACCESS_KEY', ''); vi.stubEnv('AUTOMATION_READ_TOKEN', '');
    const res = response(); await handler(request('{ shop { name } }', { authorization: 'Bearer ' + botKey }), res);
    expect(res.statusCode).toBe(401); expect(fetch).not.toHaveBeenCalled();
  });
  it('allows a scoped authenticated read', async () => {
    const res = response(); await handler(request('{ shop { name } }', { authorization: 'Bearer ' + botKey }), res);
    expect(res.statusCode).toBe(200); expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    'mutation { inventorySetQuantities(input: {}) { userErrors { message } } }',
    'mutation { blocked: orderCreate(order: {}) { userErrors { message } } } # inventorySetQuantities',
    'query A { shop { name } } mutation B { inventoryActivate { id } }',
    'subscription { shop { name } }',
    '{ orders(first: 1) { nodes { id } } }',
    '{ ...Root } fragment Root on QueryRoot { hidden: orders(first: 1) { nodes { id } } }',
    '{ ...Loop } fragment Loop on QueryRoot { ...Loop }',
  ])('blocks forbidden query without any upstream request: %s', async query => {
    const res = response(); await handler(request(query, { authorization: 'Bearer ' + botKey }), res);
    expect(res.statusCode).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks mutations even with valid human session', async () => {
    const res = response();
    await handler(request('mutation { inventorySetQuantities(input: {}) { userErrors { message } } }', { origin, cookie: `${COOKIE}=${makeSession()}` }), res);
    expect(res.statusCode).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects cross-origin cookie requests', async () => {
    const res = response(); await handler(request('{ shop { name } }', { origin: 'https://example.invalid', cookie: `${COOKIE}=${makeSession()}` }), res);
    expect(res.statusCode).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects expired or forged sessions', async () => {
    for (const token of [makeSession(Date.now() - 9 * 3600000), makeSession() + 'x']) {
      const res = response(); await handler(request('{ shop { name } }', { origin, cookie: `${COOKIE}=${token}` }), res);
      expect(res.statusCode).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not return credential errors from Shopify', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('secret-sentinel'));
    const res = response(); await handler(request('{ shop { name } }', { authorization: 'Bearer ' + botKey }), res);
    expect(res.statusCode).toBe(502); expect(JSON.stringify(res.body)).not.toContain('secret-sentinel');
  });
  it('uses the GraphQL syntax, not words in comments and strings', () => {
    expect(inspectReadQuery('query { products(first: 1, query: "mutation") { nodes { id } } }', true)).toEqual({ reports: false });
  });
});

describe('session entry', () => {
  it('issues a secure HttpOnly cookie without returning the key', () => {
    const res = response(); session({ method: 'POST', headers: { origin }, body: { key: appKey } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toContain('HttpOnly; Secure; SameSite=Strict');
    expect(JSON.stringify(res)).not.toContain(appKey);
  });
  it('rejects wrong key and unexpected origin', () => {
    const a = response(); session({ method: 'POST', headers: { origin }, body: { key: 'wrong' } }, a);
    const b = response(); session({ method: 'POST', headers: { origin: 'https://example.invalid' }, body: { key: appKey } }, b);
    expect(a.statusCode).toBe(401); expect(b.statusCode).toBe(403);
  });
});
