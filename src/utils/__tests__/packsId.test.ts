import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { aplicarPrecios } from '../updatePrices';
import { unidadesPorPackId } from '../packsId';
import { buildMatrixProducts, downloadMatrixCSV, downloadUpdateCSV, processFiles } from '../syncLogic';

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
  it('incluye agotados con stock negativo o compensado; ignora cero y Martínez', async () => {
    const product = (handle: string, cantidades: (number | null)[]) => ({ node: {
      handle, title: handle, tags: [], variants: { edges: cantidades.map((quantity, i) => ({ node: {
        title: String(i), sku: `${handle}-${i}`, price: '0', inventoryItem: {
          inventoryLevel: quantity === null ? null : { quantities: [{ name: 'available', quantity }] },
          mar: { quantities: [{ name: 'available', quantity: 8 }] },
        },
      } })) },
    } });
    graphql.mockImplementation(async (q: string) => q.includes('locations(')
      ? { locations: { edges: ['ID (Converse - Le Coq Sportif)', 'DEPOSITO MARTINEZ'].map(name => ({ node: { id: name, name } })) } }
      : { products: { edges: [product('negativo', [-1]), product('compensado', [-1, 1]), product('cero', [0]), product('sin-alta', [null])], pageInfo: { hasNextPage: false } } });
    const res = await processFiles(plantilla(), null, null, config);
    expect(res.enPeligro.map(p => p.handle).sort()).toEqual(['compensado', 'negativo']);
    expect(res.enPeligro.find(p => p.handle === 'compensado')?.talles).toEqual(['0', '1']);
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
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
  it.each([[89900, 89900], [15024.57, 15024.57], [15024.56, 15900], [0, 15900]])('precio actual %s: respeta margen con costo unitario nuevo', async (actual, esperado) => {
    graphql.mockImplementation(async (q: string) => q.includes('locations(')
      ? { locations: { edges: ['ID (Converse - Le Coq Sportif)', 'DEPOSITO MARTINEZ'].map(name => ({ node: { id: name, name } })) } }
      : { products: { edges: [{ node: { id: 'p', handle: 'medias', title: 'Medias', tags: ['LAN0226024P'], variants: { edges: [{ node: {
        id: 'v', title: 'TU', sku: 'LAN0226024P-TU', price: String(actual), inventoryItem: { id: 'i', unitCost: { amount: '38492.70' } },
      } }] } } }], pageInfo: { hasNextPage: false } } });
    const res = await processFiles(plantilla(), null, null, config);
    expect(res.updatesToApply).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'PRICE', newCost: 6208.5, newPrice: esperado })]));
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  it.each([3000, 9000, 0])('protege solo el talle en Martínez y calcula margen con costo guardado %s', async costo => {
    graphql.mockImplementation(async (q: string) => q.includes('locations(')
      ? { locations: { edges: ['ID (Converse - Le Coq Sportif)', 'DEPOSITO MARTINEZ'].map(name => ({ node: { id: name, name } })) } }
      : { products: { edges: [{ node: { id: 'p', handle: 'medias', title: 'Medias', tags: ['LAN0226024P'], variants: { edges: [2, 0].map((stock, i) => ({ node: {
        id: 'v' + i, title: String(i), sku: 'LAN0226024P-' + i, price: '12000', inventoryItem: { id: 'i' + i, unitCost: { amount: String(costo) }, mar: { quantities: [{ name: 'available', quantity: stock }] } },
      } })) } } }], pageInfo: { hasNextPage: false } } });
    const res = await processFiles(plantilla(), null, null, config);
    const protegida = res.updatesToApply.find(u => u.variantId === 'v0')!;
    const libre = res.updatesToApply.find(u => u.variantId === 'v1')!;
    expect(protegida).toMatchObject({ costoProtegido: true, stockMartinez: 2, oldCost: costo, newCost: costo, newPrice: costo === 9000 ? 15900 : 12000, sinCambios: costo !== 9000 });
    expect(protegida.margenId).toBe(costo === 0 ? null : (1 - costo / (12000 / 1.21)) * 100);
    expect(libre).toMatchObject({ costoProtegido: false, newCost: 6208.5, newPrice: 15900 });
    vi.stubGlobal('confirm', () => true);
    try { downloadUpdateCSV(res, config); } finally { vi.unstubAllGlobals(); }
    const csv = Papa.parse<Record<string, string>>(download.mock.calls[0][0], { header: true, skipEmptyLines: true }).data;
    const protegidaCsv = csv.find(row => row['Variant SKU'] === protegida.sku);
    if (protegidaCsv) expect(protegidaCsv['Cost per item']).toBe(String(costo));
    graphql.mockReset().mockResolvedValue({ productVariantsBulkUpdate: { userErrors: [] } });
    await aplicarPrecios([protegida, libre]); // Equivale a seleccionar ambas.
    const enviadas = graphql.mock.calls[0][1].variants;
    expect(enviadas.find((v: any) => v.id === 'v0')).not.toHaveProperty('inventoryItem');
    expect(enviadas.find((v: any) => v.id === 'v1')).toHaveProperty('inventoryItem.cost');
    graphql.mockClear();
    expect(await aplicarPrecios([protegida], { precio: false, costo: true })).toMatchObject({ actualizadas: 0, fallidas: 0 });
    expect(graphql).not.toHaveBeenCalled();
  });

});
