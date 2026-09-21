import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { costoNtf, parseNtf, tituloNtf } from '../ntfLogic';
import { buildMatrixProducts, downloadInventoryCSV, downloadMatrixCSV, processFiles } from '../syncLogic';

const { graphql, download } = vi.hoisted(() => ({ graphql: vi.fn(), download: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string, b: string) => a === b }));
vi.mock('../csv', async original => ({ ...await original<typeof import('../csv')>(), triggerDownload: download }));
const config = { brand: 'ntf', sheetName: 'Carga Productos' } as const;
const row = (size: string | number = 36, qty = 3, code = '18231', price = 72900) => [code, 'Bemurda Jean Over Negra NTF', '', 999, price, size, qty, '', 0.99];
const rows = (...items: unknown[][]) => [[], [], [], [], ['Código SKU', 'Nombre', '', 'Costo', 'Precio / Markup', 'Talle', 'Cantidad'], ...items];
function file(data: unknown[][]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), config.sheetName);
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'NTF.xlsx', arrayBuffer: async () => buffer } as File;
}
const csv = () => Papa.parse<Record<string, string>>(download.mock.calls.at(-1)![0], { header: true, skipEmptyLines: true }).data;
beforeEach(() => {
  download.mockReset();
  graphql.mockReset().mockImplementation(async (q: string) => q.includes('locations(')
    ? { locations: { edges: [{ node: { id: 'ntf-location', name: 'NTF' } }] } }
    : { products: { edges: [], pageInfo: { hasNextPage: false } } });
});

describe('contrato NTF', () => {
  it('costo fijo con 15%, margen 57,5%, independiente de D e I', () => {
    const p = parseNtf(rows(row())).productos['18231'];
    expect(p).toMatchObject({ precio: 72900, costoLista: 36450, costoFinal: 30982.5 });
    expect((p.precio - p.costoFinal) / p.precio).toBeCloseTo(0.575);
    expect(costoNtf(72900.01)).toBe(30982.5);
  });
  it.each(['Bemurda Jean Over Negra NTF', 'Bermuda NTF Jean Over Negra', 'BERMUDA JEAN OVER NEGRA'])('ubica NTF una sola vez: %s', title => {
    expect(tituloNtf(title)).toBe('Bermuda NTF Jean Over Negra');
  });
  it('agrupa por código, conserva talles y cantidades y avisa códigos distintos con igual título', () => {
    const r = parseNtf(rows(row(36, 3), row(38, 0), row('XL', 2, '18232')));
    expect(r.productos['18231'].sizes).toEqual({ 36: 3, 38: 0 });
    expect(r.productos['18232'].sizes).toEqual({ XL: 2 });
    expect(r.avisos).toHaveLength(1);
  });
  it('omite una fila de referencia sin precio, talle ni cantidad con aviso', () => {
    const r = parseNtf(rows(['19453', 'Bermuda Jean NTF'], row()));
    expect(Object.keys(r.productos)).toEqual(['18231']);
    expect(r.avisos[0]).toContain('19453');
  });
  it('rechaza talles duplicados y precios incompatibles', () => {
    expect(() => parseNtf(rows(row(), row()))).toThrow('repetido');
    expect(() => parseNtf(rows(row(), row(38, 1, '18231', 80000)))).toThrow('precios distintos');
  });
  it.each([row(36, -1), row(36, 1.5), row(36, 1, '18231', 0), row('', 1)])('rechaza datos inválidos %j', (...r) => {
    expect(() => parseNtf(rows(r))).toThrow('obligatorios');
  });
  it('alta y CSV conservan marca, nombre, costo, precio, talles y stock', async () => {
    const res = await processFiles(file(rows(row(36, 3), row(38, 2))), null, null, config);
    const p = buildMatrixProducts(res, config)[0];
    expect(p).toMatchObject({ title: 'Bermuda NTF Jean Over Negra', vendor: 'NTF', productType: 'Bermuda' });
    expect(p.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: '18231-36', optionValue: '36', price: 72900, cost: 30982.5, qty: 3 }),
      expect.objectContaining({ sku: '18231-38', optionValue: '38', price: 72900, cost: 30982.5, qty: 2 }),
    ]));
    downloadMatrixCSV(res, config);
    expect(csv()[0]).toMatchObject({ Vendor: 'NTF', Title: 'Bermuda NTF Jean Over Negra', Price: '72900', 'Cost per item': '30982.5', SKU: '18231-36' });
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  it('no confunde prefijos de código; exporta cada talle a la sucursal NTF', async () => {
    const product = (code: string) => ({ node: { id: code, handle: code, title: 'Bermuda NTF', tags: [code], variants: { edges: [38, 36].map(size => ({ node: {
      id: `${code}-${size}`, title: String(size), sku: `${code}-${size}`, price: '70000', inventoryItem: { id: `i-${size}`, unitCost: { amount: '36000' } },
    } })) } } });
    graphql.mockImplementation(async (q: string) => q.includes('locations(')
      ? { locations: { edges: [{ node: { id: 'ntf-location', name: 'NTF' } }] } }
      : { products: { edges: [product('182310'), product('18231')], pageInfo: { hasNextPage: false } } });
    const res = await processFiles(file(rows(row(36, 3), row(38, 2))), null, null, config);
    expect(res.excelMap['18231'].shopifyHandle).toBe('18231');
    expect(res.updatesToApply).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'PRICE', newCost: 30982.5, newPrice: 72900 })]));
    downloadInventoryCSV(res, config);
    expect(csv()).toEqual(expect.arrayContaining([
      expect.objectContaining({ Location: 'NTF', SKU: '18231-36', 'On hand (new)': '3' }),
      expect.objectContaining({ Location: 'NTF', SKU: '18231-38', 'On hand (new)': '2' }),
    ]));
    expect(csv()).toHaveLength(2);
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
});
