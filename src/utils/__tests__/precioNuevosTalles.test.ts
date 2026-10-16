import { expect, it, vi } from 'vitest';
import { crearTallesFaltantes, precioComunVariantes } from '../writeStock';
const { graphql } = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql }));
it('precio común exige todas las variantes y conserva centavos', () => {
  expect(precioComunVariantes([{ price: '89900.50' }, { price: '89900.5' }])).toBe(89900.5);
  for (const values of [[], [{price: 0}], [{}], [{price: 10}, {price: 11}], Array(100).fill({price: 10})]) expect(precioComunVariantes(values)).toBeNull();
});
it('Converse sin SKU proveedor relee precio y conserva costo nuevo', async () => {
  graphql.mockReset().mockImplementation(async (q: string) => q.includes('products(') ? { products: { edges: [{ node: { id: 'p', options: [{ name: 'Talle' }], variants: { edges: [{ node: { title: 'S', price: '89900.5' } }] } } }] } } : { productVariantsBulkCreate: { productVariants: [{ id: 'n' }], userErrors: [] } });
  const row = { productId: 'p', handle: 'h', title: 'Medias', talle: 'TU', precio: 89900.5, costo: 12345.67, desired: 4 };
  expect(await crearTallesFaltantes({ locationId: 'id' } as any, [row] as any)).toMatchObject({ written: 1, failed: 0 });
  expect(graphql.mock.calls[1][1].variants[0]).toMatchObject({ price: '89900.5', inventoryItem: { cost: '12345.67' } });
});
