// ============================================================================
// RED DE SEGURIDAD — TODA MARCA TIENE QUE TENER SU NOMBRE Y SU SUCURSAL
// ----------------------------------------------------------------------------
// Qué pasó (31-ago-2026): el nombre de la marca (el campo "Proveedor" de
// Shopify) estaba escrito a mano y DUPLICADO en dos lugares. Cuando se sumó
// Vart nadie se acordó de agregarla, y los productos de Vart se crearon en la
// tienda SIN marca. El CSV de inventario tenía el mismo agujero con la sucursal.
//
// ⚠ TypeScript NO avisa de esto: el proyecto no usa `strict`, así que a un
//   Record<marca, string> le pueden faltar marcas y compila igual.
//   POR ESO ESTE ARCHIVO EXISTE. Es lo único que lo cuida.
//
// Si agregás una marca nueva y este archivo falla, no toques el test:
// agregá la marca en VENDOR_POR_MARCA / STOCK_LOCATION / BRAND_PRICING.
//
//   Correr con: npm test
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  VENDOR_POR_MARCA, STOCK_LOCATION, BRAND_PRICING, buildMatrixProducts,
} from '../syncLogic';
import type { SyncConfig } from '../syncLogic';

// TODAS las marcas que ofrece el selector de la app.
const MARCAS: SyncConfig['brand'][] = ['converse', 'lecoq', 'orchard', 'bloque', 'luxo', 'vart'];

describe('cada marca está completa en las tablas', () => {
  it.each(MARCAS)('%s tiene nombre de marca (vendor)', (marca) => {
    expect(VENDOR_POR_MARCA[marca]).toBeTruthy();
  });

  it.each(MARCAS)('%s tiene sucursal de stock', (marca) => {
    expect(STOCK_LOCATION[marca]).toBeTruthy();
  });

  it.each(MARCAS)('%s tiene reglas de precio', (marca) => {
    expect(BRAND_PRICING[marca]).toBeDefined();
  });
});

// Producto mínimo para pasarle a buildMatrixProducts.
const producto = (extra: Record<string, unknown> = {}) => ({
  missingProducts: [{
    coditm: 'AA1111', title: 'Un producto', wholesale: 100, publicPrice: 200,
    costFinal: 93, sizes: { S: 1 }, ...extra,
  }],
} as any);

describe('el producto que se crea sale con marca', () => {
  it.each(MARCAS)('%s: nunca se crea sin marca', (marca) => {
    // Sin `vendor` en el dato: tiene que caer en el valor por defecto de la marca.
    const out = buildMatrixProducts(producto(), { brand: marca, sheetName: '' } as any);
    expect(out).toHaveLength(1);
    expect(out[0].vendor).toBe(VENDOR_POR_MARCA[marca]);
  });

  it('si el archivo trae la marca, esa manda', () => {
    const out = buildMatrixProducts(producto({ vendor: 'Vart' }), { brand: 'vart', sheetName: '' } as any);
    expect(out[0].vendor).toBe('Vart');
  });

  it('Vart en concreto: el caso que se rompió', () => {
    // Es el producto real de la captura de Wanda (VA0152-1258, Buzo Invernadero).
    const out = buildMatrixProducts(
      producto({ coditm: 'VA0152-1258', title: 'Buzo Invernadero', sizes: { S: 1, M: 4, L: 6, XL: 2 } }),
      { brand: 'vart', sheetName: '' } as any,
    );
    expect(out[0].vendor).toBe('Vart');
  });
});
