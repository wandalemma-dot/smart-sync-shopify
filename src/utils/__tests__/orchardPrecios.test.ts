import { beforeEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { codigoOrchard, processFiles, type UpdateAction } from '../syncLogic';
import { aplicarPrecios } from '../updatePrices';
const { graphql } = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string, b: string) => a === b }));
beforeEach(() => { graphql.mockReset(); });
const modelos = { oc: { artType: 'buzo', descCod: 'oc' }, ocultism: { artType: 'buzo', descCod: 'ocultism' } };
it('OC no coincide dentro de OCULTISM y conserva tipo y colores', () => {
  expect(codigoOrchard('Buzo Orchard Ocultism', modelos)).toBe('ocultism');
  expect(codigoOrchard('Buzo Orchard OC', modelos)).toBe('oc');
  expect(codigoOrchard('Remera Orchard Ocultism', modelos)).toBeUndefined();
  expect(codigoOrchard('Buzo Otra Ocultism', modelos)).toBeUndefined();
  expect(codigoOrchard('Remera Orchard Model Negro', { model: { artType: 'remera', descCod: 'model-black' } })).toBe('model');
});
it('elige el nombre completo y detiene coincidencias contradictorias', () => {
  expect(codigoOrchard('Remera Orchard No More Tears Washed', { base: { artType: 'remera', descCod: 'no-more-tears' }, washed: { artType: 'remera', descCod: 'no-more-tears-washed' } })).toBe('washed');
  expect(() => codigoOrchard('Buzo Orchard OC Ocultism', modelos)).toThrow('varios modelos');
});
const update = (extra: Partial<UpdateAction> = {}): UpdateAction => ({ type: 'PRICE', productId: 'p', variantId: 'v', handle: 'h', sku: 'sku', newPrice: 95000, newCost: 41360, ...extra });
it('envía una sola vez cada variante repetida idéntica y cuenta variantes únicas', async () => {
  graphql.mockResolvedValue({ productVariantsBulkUpdate: { userErrors: [] } });
  expect(await aplicarPrecios([update(), update()])).toMatchObject({ actualizadas: 1, fallidas: 0 });
  expect(graphql.mock.calls[0][1].variants).toHaveLength(1);
});
it('no escribe precios ni costos contradictorios', async () => {
  expect(await aplicarPrecios([update(), update({ newCost: 100 })])).toMatchObject({ actualizadas: 0, fallidas: 1, errores: [expect.stringContaining('contradictorios')] });
  expect(graphql).not.toHaveBeenCalled();
});
it('solo compara los campos que se eligieron escribir', async () => {
  graphql.mockResolvedValue({ productVariantsBulkUpdate: { userErrors: [] } });
  expect(await aplicarPrecios([update(), update({ newCost: 100 })], { precio: true, costo: false })).toMatchObject({ actualizadas: 1, fallidas: 0 });
  expect(graphql.mock.calls[0][1].variants).toEqual([{ id: 'v', price: '95000' }]);
});
it('no informa éxito ante respuesta incompleta', async () => {
  graphql.mockResolvedValue({});
  expect(await aplicarPrecios([update()])).toMatchObject({ actualizadas: 0, fallidas: 1 });
});
async function comprobarArchivo(f: File) {
  graphql.mockResolvedValue({ locations: { edges: [{ node: { id: 'orchard', name: 'ORCHARD' } }] }, products: { edges: [{ node: { id: 'p', handle: 'buzo-orchard-ocultism', vendor: 'Orchard', title: 'Buzo Orchard Ocultism', tags: [], variants: { edges: ['M', 'L', 'XL'].map((title, i) => ({ node: { id: 'v' + i, title, sku: 'ocultism-' + title, price: '95000', inventoryItem: { id: 'i' + i, unitCost: { amount: '1' } } } })) } } }], pageInfo: { hasNextPage: false } } });
  const r = await processFiles(f, null, null, { brand: 'orchard', sheetName: 'Hoja1' });
  expect(r.updatesToApply).toHaveLength(3);
  expect(new Set(r.updatesToApply.map(u => u.variantId)).size).toBe(3);
  expect(r.updatesToApply.every(u => u.newCost === 41360 && u.newPrice === 95000)).toBe(true);
  expect(r.excelMap['buzo::oc'].foundInShopify).toBe(false);
  expect(r.excelMap['buzo::ocultism'].foundInShopify).toBe(true);
}
it('el cruce completo no duplica variantes entre OC y OCULTISM', async () => {
  const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
    ['ARTICULO', 'DESCRIPCCION', 'TALLE', 'COSTO NETO', 'PUBLICO', 'CANTIDAD'],
    ['BUZO', 'OC', 'M', 50000, 95000, 1], ['BUZO', 'OCULTISM', 'M', 51700, 95000, 2],
  ]), 'Hoja1');
  await comprobarArchivo({ name: 'orchard.xlsx', arrayBuffer: async () => XLSX.write(w, { type: 'array', bookType: 'xlsx' }) } as File);
});
it.skipIf(!process.env.ORCHARD_TEMPLATE)('reproduce la planilla real sin repetir variantes', async () => {
  const b = readFileSync(process.env.ORCHARD_TEMPLATE!);
  await comprobarArchivo({ name: 'Orchard stock.xlsx', arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } as File);
});
