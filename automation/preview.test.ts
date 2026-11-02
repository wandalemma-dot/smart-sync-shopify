import { afterEach, describe, expect, it, vi } from 'vitest';
import { protectTransport } from './preview';
afterEach(() => vi.unstubAllGlobals());
describe('cloud runner safety preflight', () => {
  it('refuses to run while production accepts anonymous queries', async () => {
    const network = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', network);
    await expect(protectTransport('x'.repeat(48))).rejects.toThrow('401');
    expect(network).toHaveBeenCalledOnce();
    expect(network.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });
  it('binds all reads to the verified app and rejects mutations and other destinations', async () => {
    const network = vi.fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: { shop: { myshopifyDomain: 'indy-com-ar.myshopify.com' } } }) });
    vi.stubGlobal('fetch', network);
    const restore = await protectTransport('x'.repeat(48));
    await expect(fetch('https://example.invalid')).rejects.toThrow('Destino');
    await expect(fetch('/api/shopify', { method: 'POST', body: JSON.stringify({ query: 'mutation { inventorySetQuantities { id } }' }) })).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(2);
    restore();
  });
  it('does not trust a login page or another shop', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ status: 401 }).mockResolvedValue({ ok: true, json: async () => ({ data: { shop: { myshopifyDomain: 'wrong.myshopify.com' } } }) }));
    await expect(protectTransport('x'.repeat(48))).rejects.toThrow('tienda esperada');
  });
});
