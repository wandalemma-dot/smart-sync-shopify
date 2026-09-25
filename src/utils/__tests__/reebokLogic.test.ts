import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync, existsSync } from 'node:fs';
import { parseReebok, precioReebok, REEBOK_LOCATION } from '../reebokLogic';
import { buildMatrixProducts, processFiles, downloadMatrixCSV } from '../syncLogic';
import { planStockWrite } from '../writeStock';
import { createProducts } from '../createProducts';
const { graphql, download } = vi.hoisted(() => ({ graphql: vi.fn(), download: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string, b: string) => a === b }));
vi.mock('../csv', async original => ({ ...await original<typeof import('../csv')>(), triggerDownload: download }));
const config = { brand: 'reebok', sheetName: 'Ropa' } as const;
const headers = ['SKU', 'Modelo color', 'Descripción del artículo', 'GRUPO', 'Stock x SKU', 'Mayorista', 'Mayorista con descuento'];
const row = (size = 'S', qty = 3) => [`RBK2100-${size}`, 'RBK2100--', `GRAPHIC TEE - BLACK - ${size}`, 'T-SHIRT', qty, 82644.09, 49586.454];
const file = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Ropa');
  return { name: 'Ropa.xlsx', arrayBuffer: async () => XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) } as File;
};
beforeEach(() => { graphql.mockReset().mockImplementation(async (q: string) => q.includes('locations(')
  ? { locations: { edges: [{ node: { id: 'loc', name: REEBOK_LOCATION } }] } }
  : { products: { edges: [], pageInfo: { hasNextPage: false } } }); });
describe('Reebok indumentaria', () => {
  it('agrupa modelo/color y conserva SKU, talle, costo descontado y cantidades', () => {
    const p = parseReebok([headers, row(), row('M', 0)]).productos.RBK2100;
    expect(p).toMatchObject({ costo: 49586.45, precio: 119900, sizes: { S: 3, M: 0 }, skuPorTalle: { S: 'RBK2100-S', M: 'RBK2100-M' } });
    expect(1 - p.costo * 1.21 / p.precio).toBeCloseTo(.4996, 4);
  });
  it('no duplica, no inventa talles y no procesa calzado', () => {
    expect(() => parseReebok([headers, row(), row()])).toThrow('repetido');
    const shoe = ['RBK1-10', 'RBK1', 'SHOE AR43', 'FOOTWEAR', 2, 10, 6];
    expect(() => parseReebok([headers, shoe])).toThrow('calzado');
    expect(parseReebok([headers, row(), shoe]).avisos).toHaveLength(1);
    const invalid = row(); invalid[4] = -1;
    expect(() => parseReebok([headers, invalid])).toThrow('revisá');
  });
  it('alta y CSV comparten variantes y marca; análisis no escribe', async () => {
    const res = await processFiles(file([headers, row(), row('M')]), null, null, config);
    const p = buildMatrixProducts(res, config)[0];
    expect(p).toMatchObject({ vendor: 'Reebok', tags: ['RBK2100'], productType: 'Remera' });
    expect(p.variants).toHaveLength(2);
    expect(p.variants[0]).toMatchObject({ cost: 49586.45, price: 119900 });
    downloadMatrixCSV(res, config);
    expect(download.mock.calls.at(-1)?.[0]).toContain('RBK2100-S');
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  it('solo actualiza el SKU incluido y simula stock por SKU, conservando otros talles', async () => {
    const product = { id: 'p', handle: 'r', title: 'Remera Reebok', tags: ['RBK2100'], options: [{name: 'Talle'}], variants: { edges: ['S', 'M'].map(s => ({ node: {
      id: s, title: s === 'S' ? 'Small' : 'Medium', sku: `RBK2100-${s}`, price: '100',
      inventoryItem: { id: `i-${s}`, unitCost: { amount: '50' }, inventoryLevel: { quantities: [{ name: 'available', quantity: 10 }] } },
    } })) } };
    graphql.mockImplementation(async (q: string) => q.includes('locations(')
      ? { locations: { edges: [{ node: { id: 'loc', name: REEBOK_LOCATION } }] } }
      : { products: { edges: [{ node: product }], pageInfo: { hasNextPage: false } } });
    const res = await processFiles(file([headers, row()]), null, null, config);
    expect(res.updatesToApply).toHaveLength(1);
    expect(res.updatesToApply[0].sku).toBe('RBK2100-S');
    const plan = await planStockWrite(res, config);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ sku: 'RBK2100-S', desired: 3 });
  });
  it('no crea en otra sucursal ni sin stock cuando falta la sucursal Reebok', async () => {
    const res = await processFiles(file([headers, row()]), null, null, config);
    graphql.mockReset().mockResolvedValue({ locations: { edges: [{ node: { id: 'martinez', name: 'DEPOSITO MARTINEZ' } }] } });
    await expect(createProducts(res, config)).rejects.toThrow('No encontré la sucursal');
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  const real = 'C:/Users/Wanda/Downloads/RBK Indumentaria 001 40%  - 25-09.xlsx';
  it.skipIf(!existsSync(real))('archivo real: 57 modelos / 211 variantes / 8233 unidades', () => {
    const wb = XLSX.read(readFileSync(real));
    const result = parseReebok(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1}));
    const ps = Object.values(result.productos);
    expect(ps).toHaveLength(57);
    expect(ps.reduce((n,p) => n + Object.keys(p.sizes).length, 0)).toBe(211);
    expect(ps.reduce((n,p) => n + Object.values(p.sizes).reduce((a,b) => a+b,0), 0)).toBe(8233);
    expect(result.avisos).toEqual([]);
    for (const p of ps) {
      expect(p.precio % 1000).toBe(900);
      expect(1 - p.costo * 1.21 / precioReebok(p.costo)).toBeGreaterThanOrEqual(.49);
      expect(1 - p.costo * 1.21 / precioReebok(p.costo)).toBeLessThanOrEqual(.51);
    }
  });
});
