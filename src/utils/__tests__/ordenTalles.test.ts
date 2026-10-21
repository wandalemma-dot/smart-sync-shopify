import { expect, it, vi } from 'vitest';
import { crearTallesFaltantes, ordenarTalles } from '../writeStock';
const { graphql } = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string, b: string) => a === b }));

it('ordena talles numéricos con medios y letras; no adivina mezclas', () => {
  expect(ordenarTalles(['35', '37', '39', '40', '41', '36.5', '38'])).toEqual(['35', '36.5', '37', '38', '39', '40', '41']);
  expect(ordenarTalles(['XL', 'S', '2XL', 'M'])).toEqual(['S', 'M', 'XL', '2XL']);
  for (const t of [['S', '38'], ['C6/7', 'C8'], ['TU', 'M'], ['40'], ['XXL', '2XL']]) expect(ordenarTalles(t)).toBeNull();
});

const producto = { products: { edges: [{ node: { id: 'p', options: [{ name: 'Talle' }], variants: { edges:
  ['35', '37', '39', '40', '41'].map(title => ({ node: { title, price: '149900' } })) } } }] } };

it('después de crear, ubica los talles nuevos en su lugar', async () => {
  graphql.mockReset().mockImplementation(async (q: string) =>
    q.includes('products(') ? producto
      : q.includes('productOptionsReorder') ? { productOptionsReorder: { userErrors: [] } }
      : { productVariantsBulkCreate: { productVariants: [{ id: 'a' }, { id: 'b' }], userErrors: [] } });
  const rows = ['36.5', '38'].map(talle => ({ productId: 'p', handle: 'h', title: 'Zapatilla', talle, precio: 149900, desired: 2 }));
  expect(await crearTallesFaltantes({ locationId: 'id' } as any, rows as any)).toMatchObject({ written: 2, failed: 0, avisos: [] });
  const [q, vars] = graphql.mock.calls[2];
  expect(q).toContain('productOptionsReorder');
  expect(vars).toEqual({ productId: 'p', options: [{ name: 'Talle', values: ['35', '36.5', '37', '38', '39', '40', '41'].map(name => ({ name })) }] });
});

it('si no se puede ordenar, el talle queda creado y solo avisa', async () => {
  graphql.mockReset().mockImplementation(async (q: string) =>
    q.includes('products(') ? producto
      : q.includes('productOptionsReorder') ? { productOptionsReorder: { userErrors: [{ message: 'Sin permiso' }] } }
      : { productVariantsBulkCreate: { productVariants: [{ id: 'a' }], userErrors: [] } });
  const row = { productId: 'p', handle: 'h', title: 'Zapatilla', talle: '38', precio: 149900, desired: 2 };
  expect(await crearTallesFaltantes({ locationId: 'id' } as any, [row] as any)).toMatchObject({
    written: 1, failed: 0, errors: [], avisos: [expect.stringContaining('no se pudieron ordenar')] });
});
