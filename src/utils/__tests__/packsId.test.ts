import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { unidadesPorPackId } from '../packsId';
import { buildMatrixProducts, downloadMatrixCSV, processFiles } from '../syncLogic';

const { graphql, download } = vi.hoisted(() => ({ graphql: vi.fn(), download: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string, b: string) => a === b }));
vi.mock('../csv', async original => ({ ...await original<typeof import('../csv')>(), triggerDownload: download }));

function archivo(rows: unknown[][]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Plantilla');
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'PlantillaPedido.xlsx', arrayBuffer: async () => buffer } as File;
}
const plantilla = (nombre = 'PUMAS GYM SOCKS SIN ANTIDES X 6', precio = 41390) => archivo([
  ['UUID'], ['', 'Artículo', 'Color', 'Precio', '', 'TU', 'Unidades'],
  ['', 'LAN0226024P', 'NE', precio, 'Disponible', 9, 9],
  ['', nombre, 'NEGRO', '', 'Cantidad'],
]);

beforeEach(() => {
  download.mockReset();
  graphql.mockReset().mockImplementation(async (q: string) => q.includes('locations(')
    ? { locations: { edges: ['ID (Converse - Le Coq Sportif)', 'DEPOSITO MARTINEZ'].map(name => ({ node: { id: name, name } })) } }
    : { products: { edges: [], pageInfo: { hasNextPage: false } } });
});

describe('cantidad del pack en el nombre, nunca del código o talle', () => {
  it.each([['MEDIAS X6', 6], ['SOCKS x 12  ', 12], ['MEDIAS X2', 2], ['MEDIAS × 3', 3], ['PUMAS HOME SOCKS X 6 CON ANTIDES', 6], ['MEDIAS X12 CON ANTIDESLIZANTE', 12], ['MEDIAS X6 NEGRO', 6]])('%s', (nombre, pares) => {
    expect(unidadesPorPackId(nombre)).toBe(pares);
  });
  it.each(['A123X6', 'MEDIAS X2C', 'REMERA 3XL', 'MEDIAS X0', 'MEDIAS X-6', 'MEDIAS X1.5', 'MEDIAS X6.5', 'MEDIAS'])('no inventa packs: %s', nombre => {
    expect(unidadesPorPackId(nombre)).toBe(1);
  });
});

describe.each(['lecoq', 'converse'] as const)('precios por par: %s', brand => {
  const config = { brand, sheetName: 'Plantilla' };
  it('reconoce X 6 antes de CON ANTIDES', async () => {
    const res = await processFiles(plantilla('PUMAS HOME SOCKS X 6 CON ANTIDES'), null, null, config);
    expect(res.excelMap.lan0226024p.costFinal).toBe(6208.5);
    expect(res.excelMap.lan0226024p.publicPrice).toBe(15900);
  });
  it('divide el pack antes del descuento y del markup; alta y CSV coinciden', async () => {
    const res = await processFiles(plantilla(), null, null, config);
    const item = res.excelMap.lan0226024p;
    expect(item.wholesale).toBeCloseTo(6898.333333333333);
    expect(item.costFinal).toBe(6208.5);
    expect(item.publicPrice).toBe(15900);
    expect(item.title).toBe('PUMAS GYM SOCKS SIN ANTIDES X 6 NEGRO');
    expect(item.sizes).toEqual({ TU: 9 }); // Este cambio es de precios, no de stock.
    expect(res.alerts.some(a => a.title.includes('pack de 6'))).toBe(true);
    expect(buildMatrixProducts(res, config)[0].variants[0]).toMatchObject({ cost: 6208.5, price: 15900 });
    downloadMatrixCSV(res, config);
    const rows = Papa.parse<Record<string, string>>(download.mock.calls[0][0], { header: true, skipEmptyLines: true }).data;
    expect(rows[0]).toMatchObject({ 'Cost per item': '6208.5', Price: '15900' });
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  it('X12 usa doce y no divide dos veces cuando se aporta una sábana', async () => {
    const res = await processFiles(plantilla('SOCKS X12'), null, null, config, {
      items: { LAN0226024P: { whsl: 99999, retail: 99999, desc: 'SOCKS X12' } }, cantidad: 1, hojas: [],
    });
    expect(res.excelMap.lan0226024p.wholesale).toBeCloseTo(41390 / 12);
    expect(res.excelMap.lan0226024p.costFinal).toBe(3104.25);
    expect(res.excelMap.lan0226024p.publicPrice).toBe(7900);
  });
  it('conserva productos sin pack y archivos sin precio', async () => {
    const res = await processFiles(plantilla('SOCKS CLASSIC'), null, null, config);
    expect(res.excelMap.lan0226024p.wholesale).toBe(41390);
    expect(res.excelMap.lan0226024p.costFinal).toBe(37251);
    const sinPrecio = await processFiles(plantilla('SOCKS X6', 0), null, null, config);
    expect(buildMatrixProducts(sinPrecio, config)[0].variants[0]).toMatchObject({ price: 0, cost: 0 });
  });
  it('propone el costo unitario para un producto existente sin escribir en Shopify', async () => {
    graphql.mockImplementation(async (q: string) => q.includes('locations(')
      ? { locations: { edges: ['ID (Converse - Le Coq Sportif)', 'DEPOSITO MARTINEZ'].map(name => ({ node: { id: name, name } })) } }
      : { products: { edges: [{ node: { id: 'p', handle: 'medias', title: 'Medias', tags: ['LAN0226024P'], variants: { edges: [{ node: {
        id: 'v', title: 'TU', sku: 'LAN0226024P-TU', price: '89900', inventoryItem: { id: 'i', unitCost: { amount: '38492.70' } },
      } }] } } }], pageInfo: { hasNextPage: false } } });
    const res = await processFiles(plantilla(), null, null, config);
    expect(res.updatesToApply).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'PRICE', newCost: 6208.5, newPrice: 15900 })]));
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
});
