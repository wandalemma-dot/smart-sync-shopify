import { beforeEach, describe, expect, it, vi } from 'vitest';
import Papa from 'papaparse';
import maestro from '../tallesConverseLecoq.json';
import { CONVERSE_CODE_TABLE } from '../converseCurvas';
import { convertirConverse, curvaDesdeEtiqueta } from '../conversorTalles';
import {
  autoConverseTable, buildMatrixProducts, converseTablaInfo, convTable6,
  downloadInventoryCSV, downloadMatrixCSV, problemaTablaConverse,
} from '../syncLogic';
import type { MissingProduct, SyncResult } from '../syncLogic';
import { createProducts } from '../createProducts';
import { planStockWrite } from '../writeStock';

const { graphql, download } = vi.hoisted(() => ({ graphql: vi.fn(), download: vi.fn() }));
vi.mock('../shopify', () => ({
  shopifyGraphQL: graphql,
  mismaSucursal: (a: string, b: string) => a === b,
}));
vi.mock('../csv', async importOriginal => ({
  ...await importOriginal<typeof import('../csv')>(), triggerDownload: download,
}));

const TAG = 'TABLA DE TALLE CONVERSE MUJER 2';
const config = { brand: 'converse' as const, sheetName: '' };
const producto = (coditm = 'A13016C', sizes: Record<string, number> = { '8': 12 }): MissingProduct => ({
  coditm, title: 'Converse Mujer', sizes, wholesale: 100, publicPrice: 227, costFinal: 93,
});
const resultado = (prod = producto()): SyncResult => ({
  missingProducts: [prod], excelMap: {}, enPeligro: [], alerts: [], updatesToApply: [],
});
const csvRows = () => Papa.parse<Record<string, string>>(download.mock.calls[0][0], { header: true, skipEmptyLines: true }).data;

beforeEach(() => { graphql.mockReset(); download.mockReset(); });

describe('Mujer 2 es la curva 7, distinta de Mujer 8A', () => {
  it('conserva todas las equivalencias de la curva 7 y las invierte al pedir', () => {
    expect(convTable6).toEqual(maestro.curvas['7'].us_a_ar);
    for (const [us, ar] of Object.entries(convTable6)) {
      expect(convertirConverse('A13016C', ar, TAG)).toMatchObject({ ok: true, tallePedido: us, curva: '7' });
    }
  });

  it('reconoce Mujer 2 antes que Mujer o Tabla 2', () => {
    expect(curvaDesdeEtiqueta(`converse mujer, ${TAG}`)).toBe('7');
    expect(converseTablaInfo('157197C', TAG)).toMatchObject({ origen: 'etiqueta', tabla: convTable6 });
    expect(converseTablaInfo('A13016C', TAG).tabla['8']).toBe('38');
    expect(converseTablaInfo('A13016C', 'TABLA DE TALLE CONVERSE MUJER').tabla['8']).toBe('39');
    expect(converseTablaInfo('A13016C', 'TABLA DE TALLE CONVERSE 2').tabla['8']).toBe('41.5');
  });

  it.each(['A13016C', 'A13014C', 'A15435C', 'A14160C'])('%s propone Mujer 2 y guarda su etiqueta al crear', codigo => {
    expect(autoConverseTable(codigo, { '8': 12 })).toBe(6);
    const [prod] = buildMatrixProducts(resultado(producto(codigo)), config);
    expect(prod.tags).toContain(TAG);
    expect(prod.variants[0]).toMatchObject({ sku: `${codigo}-38`, optionValue: '38', qty: 12 });
    expect(converseTablaInfo(codigo, '').tabla['8']).toBe('38');
  });

  it('todos los códigos del maestro conservan la asignación correspondiente a su curva', () => {
    const numero: Record<string, number> = { '2': 1, '8': 2, '8A': 3, '4': 4, '5': 5, '7': 6, '9': 1 };
    for (const [codigo, curva] of Object.entries(maestro.sku_a_curva)) {
      expect(CONVERSE_CODE_TABLE[codigo], codigo).toBe(numero[curva]);
    }
  });
});

describe('productos nuevos con tabla pendiente', () => {
  it('no asigna Tabla 1 a un código desconocido con talles numéricos', async () => {
    const res = resultado(producto('ZZ9999Z'));
    expect(autoConverseTable('ZZ9999Z', { '8': 12 })).toBe(-2);
    expect(problemaTablaConverse(res.missingProducts[0])).toContain('Sin tabla');
    expect(() => buildMatrixProducts(res, config)).toThrow('Sin tabla');
    await expect(createProducts(res, config)).rejects.toThrow('Sin tabla');
    expect(graphql).not.toHaveBeenCalled();
    expect(() => downloadMatrixCSV(res, config)).toThrow('Sin tabla');
    expect(download).not.toHaveBeenCalled();
  });

  it('permite elegir Mujer 2 manualmente para un código nuevo', () => {
    const [prod] = buildMatrixProducts(resultado(producto('ZZ9999Z')), config, { ZZ9999Z: 6 });
    expect(prod.tags).toContain(TAG);
    expect(prod.variants[0].optionValue).toBe('38');
  });

  it('no crea ni exporta un talle sin equivalencia aunque el código sea conocido', async () => {
    const res = resultado(producto('A13016C', { '8': 12, '99': 1 }));
    expect(() => buildMatrixProducts(res, config)).toThrow('99');
    await expect(createProducts(res, config)).rejects.toThrow('99');
    expect(graphql).not.toHaveBeenCalled();
    expect(() => downloadMatrixCSV(res, config)).toThrow('99');
    expect(download).not.toHaveBeenCalled();
  });

  it.each([{ S: 1, '3XL': 2 }, { TU: 3 }])('conserva ropa y accesorios sin pedir curva de calzado', sizes => {
    expect(problemaTablaConverse(producto('ZZ9999Z', sizes as any))).toBeNull();
    expect(buildMatrixProducts(resultado(producto('ZZ9999Z', sizes as any)), config)).toHaveLength(1);
  });

  it('exporta los mismos talles, SKU y etiqueta que el alta directa, incluyendo selección manual', () => {
    downloadMatrixCSV(resultado(producto('ZZ9999Z')), config, { ZZ9999Z: 6 });
    expect(csvRows()[0]).toMatchObject({ 'Option1 value': '38', SKU: 'ZZ9999Z-38', Tags: `ZZ9999Z, ${TAG}` });
  });
});

describe('stock con Mujer 2', () => {
  const variante = (talle: string) => ({
    title: talle, sku: `A13016C-${talle}`,
    inventoryItem: { id: `inv-${talle}`, inventoryLevel: { quantities: [{ name: 'available', quantity: 0 }] } },
  });
  const resStock = () => ({
    ...resultado(), missingProducts: [],
    excelMap: { A13016C: { foundInShopify: true, shopifyHandle: 'modelo', shopifyTags: TAG,
      title: 'Modelo', sizes: { '8': 12 }, shopifyVariants: [variante('39'), variante('38')] } },
  });

  it('la simulación ubica US 8 en AR 38 aunque exista AR 39', async () => {
    graphql.mockImplementation(async query => query.includes('locations')
      ? { locations: { edges: [{ node: { id: 'loc', name: 'ID (Converse - Le Coq Sportif)' } }] } }
      : { products: { edges: [{ node: { id: 'prod', handle: 'modelo', title: 'Modelo', tags: [TAG], options: [{ name: 'Talle' }],
        variants: { edges: [variante('39'), variante('38')].map(node => ({ node })) } } }] } });
    const plan = await planStockWrite(resStock(), config);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ talle: '38', inventoryItemId: 'inv-38', desired: 12 });
  });

  it('el CSV respeta la etiqueta y elige la variante correcta aunque otra comparta el código', () => {
    downloadInventoryCSV(resStock(), config);
    expect(csvRows()[0]).toMatchObject({ 'Option1 Value': '38', SKU: 'A13016C-38', 'On hand (new)': '12' });
  });

  it('corrige el stock de A13016C del archivo del 12-sep sin crear ni renombrar variantes', async () => {
    const res = resStock();
    res.excelMap.A13016C.sizes = { '7': 3, '8': 17, '8.5': 12 } as any;
    const variantes = ['37', '38', '39', '37.5', '39.5'].map(talle => {
      const v = variante(talle);
      v.inventoryItem.inventoryLevel.quantities[0].quantity = talle === '37.5' ? 3 : talle === '39.5' ? 12 : 0;
      return v;
    });
    graphql.mockImplementation(async query => query.includes('locations')
      ? { locations: { edges: [{ node: { id: 'loc', name: 'ID (Converse - Le Coq Sportif)' } }] } }
      : { products: { edges: [{ node: { id: 'prod', handle: 'modelo', title: 'Modelo', tags: [TAG], options: [{ name: 'Talle' }],
        variants: { edges: variantes.map(node => ({ node })) } } }] } });
    const plan = await planStockWrite(res, config);
    expect(Object.fromEntries(plan.changes.map(c => [c.talle, c.desired])))
      .toEqual({ '37': 3, '38': 17, '39': 12, '37.5': 0, '39.5': 0 });
    expect(plan.notFound).toHaveLength(0);
    expect(graphql.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
});
