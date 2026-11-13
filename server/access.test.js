import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/shopify.js';
import session from '../api/session.js';
import { COOKIE, makeSession } from './access.js';
import { inspectReadQuery, inspectUserQuery } from './read-policy.js';
import { readFileSync } from 'node:fs';

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

describe('human manual functions and separate bot scope', () => {
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
  const manualRoots = ['inventorySetQuantities', 'inventoryActivate', 'productSet', 'productVariantsBulkUpdate',
    'productVariantsBulkCreate', 'productOptionsReorder', 'tagsAdd', 'metafieldsSet', 'publishablePublish', 'fulfillmentOrderMove'];
  it.each(manualRoots)('allows the human app function %s, never a bot or anonymous caller', async root => {
    const query = `mutation { action: ${root}(input: {}) { userErrors { message } } }`;
    const cookie = `${COOKIE}=${makeSession()}`;
    const res = response();
    await handler(request(query, { origin, cookie }), res);
    expect(res.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toContain('/2026-07/graphql.json');
    expect(JSON.parse(fetch.mock.calls[0][1].body).query).toBe(query);
    vi.mocked(fetch).mockClear();
    for (const headers of [
      {}, { origin, authorization: 'Bearer ' + botKey },
      { origin, cookie, authorization: 'Bearer ' + botKey, 'x-github-oidc-token': 'not-a-human-session' },
      { origin: 'https://example.invalid', cookie }, { cookie },
    ]) {
      const denied = response(); await handler(request(query, headers), denied);
      expect([401, 403]).toContain(denied.statusCode);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    'mutation { inventorySetQuantities(input: {}) { userErrors { message } } orderCreate(order: {}) { userErrors { message } } }',
    'mutation { ...Root } fragment Root on Mutation { inventorySetQuantities: productDelete(input: {}) { userErrors { message } } }',
    'mutation { ... on Mutation { orders: orderCreate(order: {}) { userErrors { message } } } }',
    'query A { shop { name } } mutation B { inventoryActivate { id } }',
    'subscription { shop { name } }',
    'mutation { ...Loop } fragment Loop on Mutation { ...Loop }',
  ])('does not broaden manual functions to orders/deletion or ambiguous operations: %s', async query => {
    const res = response(); await handler(request(query, { origin, cookie: `${COOKIE}=${makeSession()}` }), res);
    expect(res.statusCode).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts allowed manual roots through aliases and fragments', () => {
    expect(inspectUserQuery('mutation { ...Root } fragment Root on Mutation { ... on Mutation { action: inventoryActivate { inventoryLevel { id } } } }')).toEqual({ reports: false, write: true });
  });
  it('permits every actual manual mutation used by the existing app', () => {
    let count = 0;
    for (const name of ['writeStock.ts', 'createProducts.ts', 'recrearProductos.ts']) {
      const code = readFileSync(new URL(`../src/utils/${name}`, import.meta.url), 'utf8');
      for (const [, query] of code.matchAll(/`\s*(mutation\b[^`]+)`/g)) {
        expect(inspectUserQuery(query)).toEqual({ reports: false, write: true });
        expect(() => inspectReadQuery(query, true)).toThrow();
        count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(9);
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
  it('sends the iD pending fulfillment orders read to the newer API version, still read only', () => {
    expect(inspectUserQuery('query($q: String!) { fulfillmentOrders(first: 20, query: $q) { nodes { id } } }')).toEqual({ reports: true });
    expect(inspectUserQuery('query { fulfillmentOrder(id: "x") { id } }')).toEqual({ reports: false });
    expect(() => inspectReadQuery('query { fulfillmentOrders(first: 1) { nodes { id } } }', true)).toThrow();
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

describe('clave del depósito (solo Control de entregas, sin escrituras)', () => {
  const depKey = 'dep-test-only-'.padEnd(48, 'd');
  const login = key => { const res = response(); session({ method: 'POST', headers: { origin }, body: { key } }, res); return res; };
  const cookieDe = res => res.headers['Set-Cookie'].split(';')[0];
  beforeEach(() => { vi.stubEnv('APP_ACCESS_KEY_DEPOSITO', depKey); });

  it('entra con su propia clave y queda como depósito; la principal sigue igual', () => {
    const dep = login(depKey);
    expect(dep.statusCode).toBe(200); expect(dep.body.rol).toBe('deposito');
    expect(JSON.stringify(dep)).not.toContain(depKey);
    const yo = login(appKey);
    expect(yo.body.rol).toBe('user');
    const g = response(); session({ method: 'GET', headers: { cookie: cookieDe(dep) } }, g);
    expect(g.body).toMatchObject({ authenticated: true, rol: 'deposito' });
  });
  it('sin la variable, o igual a la principal, no abre nada como depósito', () => {
    vi.stubEnv('APP_ACCESS_KEY_DEPOSITO', '');
    expect(login(depKey).statusCode).toBe(401);
    vi.stubEnv('APP_ACCESS_KEY_DEPOSITO', appKey);
    expect(login(appKey).body.rol).toBe('user');
  });
  it('lee Shopify pero nunca escribe', async () => {
    const cookie = `${COOKIE}=${makeSession(Date.now(), 'deposito')}`;
    const ok = response(); await handler(request('{ shop { name } }', { origin, cookie }), ok);
    expect(ok.statusCode).toBe(200);
    vi.mocked(fetch).mockClear();
    for (const root of ['inventorySetQuantities', 'productVariantsBulkUpdate', 'fulfillmentOrderMove']) {
      const res = response(); await handler(request(`mutation { ${root}(input: {}) { userErrors { message } } }`, { origin, cookie }), res);
      expect(res.statusCode).toBe(403);
    }
    const otro = response(); await handler(request('{ shop { name } }', { origin: 'https://example.invalid', cookie }), otro);
    expect(otro.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cambiar la clave del depósito lo deja afuera sin tocar la sesión principal', async () => {
    const dep = `${COOKIE}=${makeSession(Date.now(), 'deposito')}`;
    const yo = `${COOKIE}=${makeSession()}`;
    vi.stubEnv('APP_ACCESS_KEY_DEPOSITO', 'otra-clave-'.padEnd(48, 'x'));
    const a = response(); await handler(request('{ shop { name } }', { origin, cookie: dep }), a);
    const b = response(); await handler(request('{ shop { name } }', { origin, cookie: yo }), b);
    expect(a.statusCode).toBe(401); expect(b.statusCode).toBe(200);
  });
  it('una sesión del depósito no puede hacerse pasar por la principal', async () => {
    const [payload] = makeSession(Date.now(), 'deposito').split('.');
    const sinRol = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const firma = makeSession(Date.now(), 'deposito').split('.')[1];
    for (const token of [`${sinRol}.${firma}`, `${payload}.${makeSession().split('.')[1]}`]) {
      const res = response(); await handler(request('{ shop { name } }', { origin, cookie: `${COOKIE}=${token}` }), res);
      expect(res.statusCode).toBe(401);
    }
  });
  it('no entra a precios ni al asistente', async () => {
    const cookie = `${COOKIE}=${makeSession(Date.now(), 'deposito')}`;
    const { default: precios } = await import('../api/prices.js');
    const { default: asistente } = await import('../api/asistente.js');
    for (const h of [precios, asistente]) {
      const res = response(); await h({ method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: {} }, res);
      expect(res.statusCode).toBe(401);
    }
  });
});
