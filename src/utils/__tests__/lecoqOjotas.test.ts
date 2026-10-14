import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { buildMatrixProducts, esCalzadoLeCoq, lecoqCategoryWord, talleShopifyLeCoq } from '../syncLogic';
import type { SyncResult } from '../syncLogic';
import { parsePlantillaPedido, tituloPedido } from '../plantillaPedido';
import { cruzarPedido, leerPlantillaId } from '../pedidoId';

describe('Slides Le Coq: título Ojotas con conversión de calzado', () => {
  it.each(['CARC SLIDES 2026 CELESTE', 'LCS SLIDES', 'LE COQ SPORTIF LOGO SLIDE', 'Ojotas Le Coq Sportif Carc Slides'])('%s', nombre => {
    expect(lecoqCategoryWord(nombre, '40')).toBe('Ojotas');
    expect(esCalzadoLeCoq(nombre, '40')).toBe(true);
    expect(talleShopifyLeCoq('40', nombre)).toBe('39');
  });

  it('las nuevas altas y CSV comparten nombre/tipo Ojotas y conservan SKU, precio y talle', () => {
    const result: SyncResult = { updatesToApply: [], enPeligro: [], alerts: [], excelMap: {},
      missingProducts: [{ coditm: 'LFO0126066', title: 'CARC SLIDES 2026 CELESTE',
      wholesale: 10000, costFinal: 9000, publicPrice: 22900, usaListaPrecios: true, sizes: { '40': 50 } }] };
    const p = buildMatrixProducts(result, { brand: 'lecoq', sheetName: 'Plantilla' })[0];
    expect(p).toMatchObject({ title: 'Ojotas Le Coq Sportif Carc Slides 2026 Celeste', productType: 'Ojotas',
      tags: ['LFO0126066'], variants: [{ sku: 'LFO0126066-39', optionValue: '39', qty: 50, cost: 9000, price: 22900 }] });
  });

  it.skipIf(!process.env.LECOQ_NOMBRES_TEMPLATE)('todas las Slides reales se titulan Ojotas y pueden pedirse con +1', () => {
    const bytes = new Uint8Array(readFileSync(process.env.LECOQ_NOMBRES_TEMPLATE!));
    const wb = XLSX.read(bytes);
    const parsed = parsePlantillaPedido(XLSX.utils.sheet_to_json(wb.Sheets.Plantilla, { header: 1 }), 'lecoq');
    const slides = Object.values(parsed.items).filter(a => /\bSLIDES?\b/i.test(a.nombre));
    expect(slides).toHaveLength(7);
    const p = leerPlantillaId(bytes);
    for (const a of slides) {
      const result: SyncResult = { updatesToApply: [], enPeligro: [], alerts: [], excelMap: {},
        missingProducts: [{ coditm: a.codigo, title: tituloPedido(a), wholesale: a.precioLista, sizes: a.sizes }] };
      const created = buildMatrixProducts(result, { brand: 'lecoq', sheetName: 'Plantilla' })[0];
      expect(created.title.startsWith('Ojotas Le Coq Sportif ')).toBe(true);
      expect(created.productType).toBe('Ojotas');
      for (const [raw, qty] of Object.entries(a.sizes)) {
        const ar = String(Number(raw) - 1);
        expect(created.variants.find(v => v.optionValue === ar)).toMatchObject({ sku: `${a.codigo}-${ar}`, qty });
        const pedido = cruzarPedido([{ id: 'test', orden: 'PRUEBA', titulo: created.title, sku: `${a.codigo}-${ar}`,
          talle: ar, cantidad: 1, vendor: 'Le Coq Sportif', tags: [a.codigo] }], p);
        expect(pedido.filas[0]).toMatchObject({ pedir: Math.min(qty, 1), disponible: qty });
        expect(Number(pedido.filas[0].talleProveedor)).toBe(Number(raw));
      }
    }
  });
});
