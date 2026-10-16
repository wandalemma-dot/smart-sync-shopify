import { beforeEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { processFiles } from '../syncLogic';
import { planStockWrite, crearTallesFaltantes } from '../writeStock';
const { graphql } = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string, b: string) => a === b }));
const code = 'K2321H4MW-K005';
const ean = '07799087201358';
const cfg = { brand: 'kappa', kappaCalzado: false, sheetName: 'INDUMENTARIA 30%' } as const;
const variant = (sku: string, title: string) => ({ node: { id: sku, sku, title, price: '100', inventoryItem: { id: 'inv-' + sku, inventoryLevel: { quantities: [{ name: 'available', quantity: 2 }] } } } });
const makeProduct = () => ({ id: code, handle: code.toLowerCase(), title: 'Calzas Cortas Kappa Negro', vendor: 'Kappa', tags: [code], options: [{ name: 'Talle' }], variants: { edges: [variant(code + '-S', 'S')] } });
let product: ReturnType<typeof makeProduct>;
function file(barcode = ean) {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
    ['SKU', 'Modelo Color', 'Descripción del artículo', 'EAN', 'UDM', 'DISPONIBLE', 'Mayorista con descuento', 'Público', 'Mayorista Unitario', 'Descuento', 'GÉNERO'],
    [code + '-XL', code, 'CALZAS BLACK XL', barcode, 'Unidades', 1, 600, 29999, 1000, 40, 'WOMEN'],
  ]), cfg.sheetName);
  return { name: 'kappa.xlsx', arrayBuffer: async () => XLSX.write(w, { type: 'array', bookType: 'xlsx' }) } as File;
}
async function plan(barcode = ean) { return planStockWrite(await processFiles(file(barcode), null, null, cfg), cfg); }
beforeEach(() => {
  product = makeProduct();
  graphql.mockReset().mockImplementation(async (q: string) => {
    if (q.includes('locations(')) return { locations: { edges: [{ node: { id: 'distri', name: 'DISTRINANDO SA (Reebok - Kappa)' } }] } };
    if (q.includes('tagsAdd')) return { tagsAdd: { node: { id: code }, userErrors: [] } };
    if (q.includes('productVariantsBulkCreate')) return { productVariantsBulkCreate: { productVariants: [{ id: 'new', title: 'XL' }], userErrors: [] } };
    return { products: { edges: [{ node: product }], pageInfo: { hasNextPage: false } } };
  });
});
it.each([ean, ''])('crea XL con código exacto, costo, precio, sucursal y etiquetas: %s', async barcode => {
  const p = await plan(barcode); const row = p.notFound[0];
  expect(row).toMatchObject({ productId: code, motivoNoCrear: '', talle: 'XL', sku: barcode || code + '-XL', skuProveedor: code + '-XL', barcode, desired: 1, costo: 600, precio: 29999 });
  expect(graphql.mock.calls.some(([q]) => q.includes('mutation'))).toBe(false);
  expect(await crearTallesFaltantes(p, [row])).toMatchObject({ written: 1, failed: 0 });
  const input = graphql.mock.calls.find(([q]) => q.includes('productVariantsBulkCreate'))![1];
  expect(input.variants[0]).toEqual({ optionValues: [{ name: 'XL', optionName: 'Talle' }], inventoryItem: { tracked: true, sku: barcode || code + '-XL', cost: '600' }, inventoryQuantities: [{ locationId: 'distri', availableQuantity: 1 }], price: '29999', ...(barcode ? { barcode } : {}) });
  expect(graphql.mock.calls.find(([q]) => q.includes('tagsAdd'))![1]).toEqual({ id: code, tags: [code, code + '-XL'] });
});
it('encuentra XL por etiqueta aunque cambie el SKU', async () => {
  product.variants.edges.push(variant('otro', 'XL'));
  const p = await plan(); expect(p.notFound).toEqual([]); expect(p.changes).toEqual(expect.arrayContaining([expect.objectContaining({ talle: 'XL', desired: 1 })]));
});
it('no crea si alguien agregó XL después de simular', async () => {
  const p = await plan(); product.variants.edges.push(variant('otro', 'XL'));
  expect(await crearTallesFaltantes(p, p.notFound)).toMatchObject({ written: 0, failed: 1 });
  expect(graphql.mock.calls.some(([q]) => q.includes('mutation'))).toBe(false);
});
it('bloquea productos con varias opciones', async () => {
  product.options.push({ name: 'Color' });
  await expect(plan()).rejects.toThrow('revisar opciones');
});
it('no crea sin guardar primero los códigos del proveedor', async () => {
  const p = await plan(); const read = graphql.getMockImplementation()!;
  graphql.mockImplementation(async (q, v) => q.includes('tagsAdd') ? { tagsAdd: { node: null, userErrors: [{ message: 'Sin permiso' }] } } : read(q, v));
  expect(await crearTallesFaltantes(p, p.notFound)).toMatchObject({ written: 0, failed: 1 });
  expect(graphql.mock.calls.some(([q]) => q.includes('productVariantsBulkCreate'))).toBe(false);
});

it('rechaza duplicados antes de proponer precios o crear talles', async () => {
  product.variants.edges.push(variant('fisico1', 'XL'), variant('fisico2', 'xl'));
  await expect(plan()).rejects.toThrow('ambiguos');
  expect(graphql.mock.calls.some(([q]) => q.includes('mutation'))).toBe(false);
});
it('revalida la etiqueta al volver a leer stock', async () => {
  const result = await processFiles(file(), null, null, cfg);
  product.tags = ['OTRO'];
  await expect(planStockWrite(result, cfg)).rejects.toThrow('cambió la etiqueta');
});
it('precios y stock reconocen XL con código físico distinto', async () => {
  product.variants.edges.push(variant('fisico', 'XL'));
  const result = await processFiles(file(), null, null, cfg);
  expect(result.updatesToApply).toEqual([expect.objectContaining({ variantId: 'fisico', newPrice: 29999 })]);
  expect((await planStockWrite(result, cfg)).notFound).toEqual([]);
});
