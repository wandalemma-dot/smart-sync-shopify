import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'graphql';
import handler from '../api/prices.js';
import { COOKIE, makeSession } from './access.js';
import { aplicarPrecios } from '../src/utils/updatePrices';

const origin = 'https://smart-sync-shopify.vercel.app';
const botKey = 'bot-test-only-'.padEnd(48, 'b');
const productId = 'gid://shopify/Product/1';
const id = 'gid://shopify/ProductVariant/2';
const locationId = 'gid://shopify/Location/3';
const selected = () => ({ productId, variants: [{ id, price: '84900', inventoryItem: { cost: '36082.5' } }] });
function response() {
  return { statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; } };
}
let upstream, quantity, owner, locations, level, returned;
const auth = () => ({ origin, cookie: `${COOKIE}=${makeSession()}` });
async function run(body = selected(), headers = auth(), method = 'POST') {
  const res = response();
  await handler({ method, headers: { 'content-type': 'application/json', ...headers }, body }, res);
  return res;
}
beforeEach(() => {
  vi.stubEnv('APP_ACCESS_KEY', 'user-test-only-'.padEnd(48, 'a'));
  vi.stubEnv('AUTOMATION_READ_TOKEN', botKey);
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('SHOPIFY_CLIENT_ID', ''); vi.stubEnv('SHOPIFY_CLIENT_SECRET', '');
  vi.stubEnv('SHOPIFY_ADMIN_TOKEN', 'test-only-token');
  quantity = 0; owner = productId; level = true; returned = undefined;
  locations = { nodes: [{ id: locationId, name: '📦 Depósito Martínez' }], pageInfo: { hasNextPage: false } };
  upstream = vi.fn(async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    parse(query);
    let data;
    if (query.startsWith('query Sucursal')) data = { locations };
    else if (query.startsWith('query Variantes')) data = { nodes: variables.ids.map(id => ({ id, product: { id: owner },
      inventoryItem: { inventoryLevel: level ? { quantities: [{ name: 'available', quantity }] } : null } })) };
    else if (query.startsWith('mutation PreciosManuales')) data = returned ?? {
      productVariantsBulkUpdate: { userErrors: [], productVariants: variables.variants.map(v => ({ id: v.id,
        price: v.price ?? '82990', inventoryItem: { unitCost: { amount: v.inventoryItem?.cost ?? '35270.75' } } })) } };
    else throw new Error('Unexpected operation');
    return { ok: true, json: async () => ({ data }) };
  });
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const mutations = () => upstream.mock.calls.map(([, options]) => JSON.parse(options.body)).filter(c => c.query.startsWith('mutation'));

describe('precios exclusivos de la usuaria', () => {
  it('rechaza anónimos, token del bot con OIDC y cookies inválidas antes de consultar Shopify', async () => {
    for (const headers of [{}, { authorization: 'Bearer ' + botKey, 'x-stock-workflow': 'oidc-token' },
      { ...auth(), authorization: 'Bearer ' + botKey },
      { origin, cookie: `${COOKIE}=${makeSession(Date.now() - 9 * 3600000)}` },
      { origin, cookie: `${COOKIE}=${makeSession()}x` }]) {
      expect((await run(selected(), headers)).statusCode).toBe(401);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('exige mismo origen, JSON y POST', async () => {
    expect((await run(selected(), { ...auth(), origin: 'https://otro.invalid' })).statusCode).toBe(403);
    expect((await run(selected(), { cookie: auth().cookie })).statusCode).toBe(403);
    expect((await run(selected(), { ...auth(), 'content-type': 'text/plain' })).statusCode).toBe(415);
    expect((await run(selected(), auth(), 'GET')).statusCode).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    {}, { productId, variants: [] }, { ...selected(), query: 'mutation { orderCreate }' },
    { ...selected(), productId: 'another-shop/product/1' },
    ...['inventoryQuantities', 'quantityAdjustments', 'barcode', 'sku', 'optionValues', 'metafields', 'compareAtPrice'].map(key =>
      ({ productId, variants: [{ id, price: '84900', [key]: [] }] })),
    { productId, variants: [{ id, inventoryItem: { cost: '36082.5', tracked: false } }] },
    ...['-1', 'NaN', 'Infinity', '3e4', '1.234', '', null, 84900].map(price => ({ productId, variants: [{ id, price }] })),
    { productId, variants: [{ id, inventoryItem: { cost: '0' } }] },
    { productId, variants: [{ id }] },
    { productId, variants: [{ id, price: '1' }, { id, price: '2' }] },
  ])('bloquea campos ajenos, importes inválidos y duplicados: %#', async body => {
    expect((await run(body)).statusCode).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('aplica únicamente precio/costo seleccionados conservando centavos', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0].variables).toEqual(selected());
    expect(mutations()[0].query).toContain('allowPartialUpdates: false');
    expect(upstream.mock.calls.every(([url]) => url === 'https://indy-com-ar.myshopify.com/admin/api/2026-07/graphql.json')).toBe(true);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain('test-only-token');
  });
  it('verifica todas las variantes en lotes antes de una única escritura', async () => {
    const variants = Array.from({ length: 77 }, (_, i) => ({ id: `gid://shopify/ProductVariant/${i + 1}`, price: '84900' }));
    expect((await run({ productId, variants })).statusCode).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(5);
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0].variables.variants).toHaveLength(77);
  });
  it('el costo con stock en Martínez bloquea antes de la mutación; el precio solo sigue permitido', async () => {
    quantity = 2;
    expect((await run()).statusCode).toBe(409);
    expect(mutations()).toHaveLength(0);
    expect((await run({ productId, variants: [{ id, price: '84900' }] })).statusCode).toBe(200);
    expect(mutations()[0].variables.variants).toEqual([{ id, price: '84900' }]);
  });
  it('permite costo solo y ausencia de nivel en Martínez sin tocar el precio', async () => {
    level = false;
    expect((await run({ productId, variants: [{ id, inventoryItem: { cost: '36082.5' } }] })).statusCode).toBe(200);
    expect(mutations()[0].variables.variants).toEqual([{ id, inventoryItem: { cost: '36082.5' } }]);
  });
  it('rechaza una variante de otro producto y stock desconocido', async () => {
    owner = 'gid://shopify/Product/9';
    expect((await run()).statusCode).toBe(409);
    owner = productId; quantity = undefined;
    expect((await run()).statusCode).toBe(409);
    expect(mutations()).toHaveLength(0);
  });
  it('no confunde lectura incompleta o sucursal ambigua con stock cero', async () => {
    for (const next of [{ nodes: [], pageInfo: { hasNextPage: false } },
      { ...locations, pageInfo: { hasNextPage: true } },
      { ...locations, nodes: [...locations.nodes, ...locations.nodes] }]) {
      locations = next;
      expect((await run()).statusCode).toBe(409);
    }
    expect(mutations()).toHaveLength(0);
  });
  it('no informa éxito ante respuesta parcial, valores diferentes o error del proveedor', async () => {
    for (const productVariants of [[], [{ id, price: '82990' }]]) {
      returned = { productVariantsBulkUpdate: { userErrors: [], productVariants } };
      expect((await run()).statusCode).toBe(502);
    }
    returned = { productVariantsBulkUpdate: { userErrors: [{ message: 'Precio inválido' }], productVariants: null } };
    expect((await run()).body.data.productVariantsBulkUpdate.userErrors).toHaveLength(1);
    upstream.mockRejectedValue(new Error('secret-sentinel'));
    const res = await run();
    expect(res.statusCode).toBe(502); expect(JSON.stringify(res.body)).not.toContain('secret-sentinel');
  });
  it('el botón usa /api/prices con la cookie y cuenta el rechazo como fallo, nunca como éxito', async () => {
    const browser = vi.fn(async (url, options) => {
      if (url !== '/api/prices') return upstream(url, options);
      const result = await run(JSON.parse(options.body));
      return { ok: result.statusCode === 200, json: async () => result.body };
    });
    vi.stubGlobal('fetch', browser);
    const row = { type: 'PRICE', productId, variantId: id, newPrice: 84900, newCost: 36082.5 };
    expect(await aplicarPrecios([row])).toMatchObject({ actualizadas: 1, fallidas: 0 });
    expect(browser.mock.calls[0][0]).toBe('/api/prices');
    expect(browser.mock.calls[0][1].credentials).toBe('same-origin');
    expect(mutations()[0].variables.variants[0].inventoryItem.cost).toBe('36082.5');
    quantity = 2;
    expect(await aplicarPrecios([row])).toMatchObject({ actualizadas: 0, fallidas: 1 });
    expect(mutations()).toHaveLength(1);
  });
});
