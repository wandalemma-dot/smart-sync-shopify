import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { buildMatrixProducts, lecoqCategoryWord, talleShopifyLeCoq } from '../syncLogic';
import type { MissingProduct, SyncResult } from '../syncLogic';
import { parsePlantillaPedido, tituloPedido } from '../plantillaPedido';

const casos = [
  ['2020941', 'N°2 TRAINING GLOVES', 'Guantes'],
  ['LTO0224030', 'LCS TS WINDBREAKER', 'Campera'],
  ['LTO0225113', 'PUMAS TRAINING CREWNECK 2025', 'Buzo'],
  ['LTO0226012', 'PUMAS TRAINING JOGGER 2026', 'Pantalón'],
  ['LTO0325071', 'WOMEN PUFFER VEST', 'Chaleco'],
  ['LTO0325107', 'TRAINING PRO LEGGINGS', 'Calzas'],
];

function alta(p: MissingProduct) {
  const r: SyncResult = { updatesToApply: [], enPeligro: [], alerts: [], excelMap: {}, missingProducts: [p] };
  return buildMatrixProducts(r, { brand: 'lecoq', sheetName: 'Plantilla' })[0];
}

describe('nombres Le Coq confirmados por la usuaria', () => {
  it.each(casos)('%s: %s se clasifica como %s sin convertir talles de ropa', (codigo, nombre, categoria) => {
    expect(lecoqCategoryWord(nombre, '3XL')).toBe(categoria);
    expect(talleShopifyLeCoq('38', nombre)).toBe('38');
    const p = alta({ coditm: codigo, title: nombre, wholesale: 10000, costFinal: 9000,
      publicPrice: 22900, usaListaPrecios: true, sizes: { XL: 3, '38': 2 } });
    expect(p.productType).toBe(categoria);
    expect(p.title.startsWith(`${categoria} Le Coq Sportif `)).toBe(true);
    expect(p.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: `${codigo}-XL`, optionValue: 'XL', qty: 3, cost: 9000, price: 22900 }),
      expect.objectContaining({ sku: `${codigo}-38`, optionValue: '38', qty: 2, cost: 9000, price: 22900 }),
    ]));
  });

  it.each(['WOMEN PUFFER VEST CAMEL', 'women puffer jacket BLACK'])('WOMEN aparece como Mujer sin perder modelo ni color: %s', title => {
    const p = alta({ coditm: 'LTO0325071', title, wholesale: 10000, sizes: { S: 1 } });
    expect(p.title).toContain('Mujer Puffer');
    expect(p.title).not.toMatch(/\bWomen\b/i);
    expect(p.title).toBe(title.includes('VEST')
      ? 'Chaleco Le Coq Sportif Mujer Puffer Vest Camel'
      : 'Campera Le Coq Sportif Mujer Puffer Jacket Negro');
  });

  it('mantiene Ojotas con conversión de calzado', () => {
    expect(lecoqCategoryWord('CARC SLIDES 2026', '40')).toBe('Ojotas');
    expect(talleShopifyLeCoq('40', 'CARC SLIDES 2026')).toBe('39');
  });

  it.skipIf(!process.env.LECOQ_NOMBRES_TEMPLATE)('verifica cada código confirmado contra la plantilla real', () => {
    const wb = XLSX.read(readFileSync(process.env.LECOQ_NOMBRES_TEMPLATE!));
    const p = parsePlantillaPedido(XLSX.utils.sheet_to_json(wb.Sheets.Plantilla, { header: 1 }), 'lecoq');
    for (const [codigo, , categoria] of casos) {
      const a = Object.values(p.items).find(a => a.codigo === codigo)!;
      expect(a).toBeDefined();
      const created = alta({ coditm: a.codigo, title: tituloPedido(a), wholesale: a.precioLista, sizes: a.sizes });
      expect(created.productType).toBe(categoria);
      expect(created.title.startsWith(`${categoria} Le Coq Sportif `)).toBe(true);
      for (const [size, qty] of Object.entries(a.sizes)) {
        expect(created.variants.find(v => v.optionValue === size)).toMatchObject({ qty, sku: `${a.codigo}-${size}` });
      }
      if (/\bWOMEN\b/i.test(a.nombre)) expect(created.title).toContain('Mujer');
    }
  });
});
