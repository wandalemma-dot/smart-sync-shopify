import { describe, it, expect, vi } from 'vitest';
import {
  agruparShopify, consultarShopifyFamily, controlarEntregaFamily, fechaFamily, leerEntregaFamily, leerTextoEntregaFamily, resumenFamily,
  skuEsDelCodigo, talleFamily, textoEntregaFamily, type EntregaFamily, type ProductoFamily,
} from '../controlFamily';
import type { Remito } from '../controlFacturas';
import { leerTextoRemito } from '../lectoresFacturas';

// La planilla real de Family del 30-oct-2026 (foto que mandó gax), como queda en Excel.
const PLANILLA: unknown[][] = [
  ['ENTREGA MERCADERIA', null, null, 'FAMILYARG', '30-Oct-26'],
  ['CODIGO', 'ARTICULO', 'MODELO', 'CORTE', 'COLOR', 'PRECIOXMAYOR', 'PRECIO PUBLICO', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'TOTAL'],
  ['SHBSPEC', 'SHORT', 'SPECTRUM', 'BASKET', 'NEGRO/MULTI', 34500, 69000, 2, 4, 4, 6, 4, null, 20],
  ['GSKPT23', 'PANTALON', 'GARAGE SKT PANT', 'LOOSE FIT', 'GRIS', '$49,000.00', '$98,000.00', 1, 2, 2, 2, 2, 1, 10],
];
const REMITO: Remito = { numero: '0001-00002715', fecha: '2026-11-10', renglones: [{ codigo: 'SHBSPEC', cantidad: 20, talles: [] }, { codigo: 'GSKPT23', cantidad: 10, talles: [] }] };
const prod = (titulo: string, precio: number, talles = ['S', 'M', 'L', 'XL', 'XXL']): ProductoFamily => ({ titulo, vendor: 'Familyarg', precios: [precio], costos: [precio * 0.425], talles });

function entrega(id: string, fecha: string, extra: Partial<EntregaFamily> = {}): EntregaFamily {
  const { entrega: e } = leerEntregaFamily(PLANILLA, 'Planilla', '2026-01-01');
  return { ...e, id, fecha, shopify: { fecha: '2026-11-11T12:00:00Z', codigos: { SHBSPEC: [], GSKPT23: [] } }, ...extra };
}

describe('Family: lectura de la planilla «ENTREGA MERCADERIA»', () => {
  it('lee códigos, descripción, precios (con $ y comas), talles, total y la fecha de arriba', () => {
    const { entrega: e, avisos } = leerEntregaFamily(PLANILLA, 'Planilla', '2026-01-01');
    expect(e.fecha).toBe('2026-10-30');
    expect(avisos).toEqual([]);
    expect(e.renglones).toEqual([
      { codigo: 'SHBSPEC', descripcion: 'SHORT SPECTRUM BASKET NEGRO/MULTI', precioMayor: 34500, precioPublico: 69000, cantidad: 20, totalImpreso: 20,
        talles: [{ talle: 'S', cantidad: 2 }, { talle: 'M', cantidad: 4 }, { talle: 'L', cantidad: 4 }, { talle: 'XL', cantidad: 6 }, { talle: '2XL', cantidad: 4 }] },
      { codigo: 'GSKPT23', descripcion: 'PANTALON GARAGE SKT PANT LOOSE FIT GRIS', precioMayor: 49000, precioPublico: 98000, cantidad: 10, totalImpreso: 10,
        talles: [{ talle: 'S', cantidad: 1 }, { talle: 'M', cantidad: 2 }, { talle: 'L', cantidad: 2 }, { talle: 'XL', cantidad: 2 }, { talle: '2XL', cantidad: 2 }, { talle: '3XL', cantidad: 1 }] },
    ]);
  });

  it('avisa si los talles no suman el TOTAL, y sin encabezado no adivina', () => {
    const mal = PLANILLA.map((f, i) => (i === 2 ? [...f.slice(0, 13), 21] : f));
    expect(leerEntregaFamily(mal, 'P', '2026-01-01').avisos.join(' ')).toMatch(/SHBSPEC: la suma de talles \(20\) no coincide con el TOTAL de la planilla \(21\)/);
    expect(() => leerEntregaFamily([['A', 'B'], ['x', 1]], 'P', '2026-01-01')).toThrow(/encabezado/);
  });

  it('fechas: 30-Oct-26, 10/11/2026, número de Excel; talles 2XL = XXL', () => {
    expect(fechaFamily('30-Oct-26')).toBe('2026-10-30');
    expect(fechaFamily('10/11/2026')).toBe('2026-11-10');
    expect(fechaFamily(46325)).toBe('2026-10-30');
    expect(fechaFamily('FAMILYARG')).toBe('');
    expect(talleFamily('2XL')).toBe('XXL');
    expect(talleFamily('3xl')).toBe('XXXL');
  });

  it('texto a mano: ida y vuelta, y errores claros', () => {
    const e = entrega('E1', '2026-10-30');
    const t = textoEntregaFamily(e);
    expect(t.split('\n')[1]).toBe('SHBSPEC S/2 M/4 L/4 XL/6 2XL/4 $34500 $69000 SHORT SPECTRUM BASKET NEGRO/MULTI');
    const back = leerTextoEntregaFamily(t);
    expect(back.errores).toEqual([]);
    expect(back.fecha).toBe('2026-10-30');
    const sinTotal = (rs: typeof e.renglones) => rs.map((r) => ({ ...r, totalImpreso: undefined }));
    expect(sinTotal(back.renglones)).toEqual(sinTotal(e.renglones));
    expect(leerTextoEntregaFamily('SHBSPEC XL6').errores.join(' ')).toMatch(/no entiendo «XL6»/);
    expect(leerTextoEntregaFamily('SHBSPEC $1 $2 $3 5').errores.join(' ')).toMatch(/más de dos precios/);
  });

  it('el remito escrito a mano acepta códigos sin números (solo para Family)', () => {
    expect(leerTextoRemito('Remito 0001-00002715\nSHBSPEC 20\nGSKPT23 10', { codigoSinNumeros: true }).remito.renglones.map((r) => r.cantidad)).toEqual([20, 10]);
    expect(leerTextoRemito('SHBSPEC 20').errores.length).toBe(1); // iD y Distrinando siguen pidiendo un número
  });
});

describe('Family: nuevo o reposición según Shopify (solo lectura)', () => {
  it('el SKU es del código: igual, con separador o con talle pegado; nunca un prefijo numérico', () => {
    expect(skuEsDelCodigo('HPRST01XXL', 'HPRST01')).toBe(true);
    expect(skuEsDelCodigo('RMCGA01.NEG.S', 'RMCGA01')).toBe(true);
    expect(skuEsDelCodigo('WORPT01', 'WORPT01')).toBe(true);
    expect(skuEsDelCodigo('HPRST01S', 'HPRST0')).toBe(false);
    expect(skuEsDelCodigo('WORPT01', 'WORPT0')).toBe(false);
  });

  it('consulta por prefijo de SKU, agrupa por producto y no confunde códigos parecidos', async () => {
    const gql = vi.fn<(q: string, v: Record<string, unknown>) => Promise<unknown>>(async () => ({
      productVariants: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          { sku: 'HPRST01S', title: 'S', price: '79200.00', inventoryItem: { unitCost: { amount: '33660.0' } }, product: { title: 'Buzo Familyarg Stickers Negro', vendor: 'Familyarg' } },
          { sku: 'HPRST01XXL', title: 'XXL', price: '79200.00', inventoryItem: { unitCost: { amount: '33660.0' } }, product: { title: 'Buzo Familyarg Stickers Negro', vendor: 'Familyarg' } },
          { sku: 'HPRST015S', title: 'S', price: '1.00', inventoryItem: null, product: { title: 'Otro', vendor: 'Familyarg' } },
        ],
      },
    }));
    const c = await consultarShopifyFamily(['HPRST01', 'SHBSPEC', 'NO VALE'], gql);
    expect(gql.mock.calls[0][1]).toEqual({ q: 'sku:HPRST01* OR sku:SHBSPEC*', cursor: null });
    expect(c.codigos.HPRST01).toEqual([{ titulo: 'Buzo Familyarg Stickers Negro', vendor: 'Familyarg', precios: [79200], costos: [33660], talles: ['S', 'XXL'] }]);
    expect(c.codigos.SHBSPEC).toEqual([]);
    expect('NO VALE' in c.codigos).toBe(false);
    const falla = await consultarShopifyFamily(['A1'], async () => { throw new Error('sin conexión'); });
    expect(falla.error).toMatch(/sin conexión/);
    expect(agruparShopify(['X1'], [])).toEqual({ X1: [] });
  });
});

describe('Family: control de la entrega', () => {
  it('la entrega real: dos nuevos, remito igual a la planilla → todo coincide', () => {
    const r = controlarEntregaFamily(entrega('E1', '2026-10-30'), REMITO, []);
    expect(r.semaforo).toBe('ok');
    expect(r.nuevos).toBe(2);
    expect(r.filas.map((f) => [f.codigo, f.tipo, f.entrega, f.remito])).toEqual([['SHBSPEC', 'nuevo', 20, 20], ['GSKPT23', 'nuevo', 10, 10]]);
    expect(r.motivos).toEqual(['🆕 2 artículo(s) nuevo(s), hay que darlos de alta: SHBSPEC, GSKPT23.']);
    expect(resumenFamily(r)).toMatch(/NUEVOS \(dar de alta\):\n• SHBSPEC SHORT SPECTRUM BASKET NEGRO\/MULTI — 20 u\. \(S:2 M:4 L:4 XL:6 2XL:4\) — por mayor \$ 34\.500,00 — público \$ 69\.000,00/);
  });

  it('sin remito queda incompleta; remito distinto o con otro código, no coincide', () => {
    expect(controlarEntregaFamily(entrega('E1', '2026-10-30'), null, []).semaforo).toBe('incompleta');
    const distinto: Remito = { ...REMITO, renglones: [{ codigo: 'SHBSPEC', cantidad: 18, talles: [] }, { codigo: 'GSKPT23', cantidad: 10, talles: [] }, { codigo: 'XXX01', cantidad: 2, talles: [] }] };
    const r = controlarEntregaFamily(entrega('E1', '2026-10-30'), distinto, []);
    expect(r.semaforo).toBe('revisar');
    expect(r.motivos).toContain('❌ SHBSPEC: la planilla dice 20 y el remito 18.');
    expect(r.motivos).toContain('❌ XXX01: está en el remito (2) pero no en la planilla de entrega.');
  });

  it('reposición: avisa si el precio público no es el de Shopify y si falta un talle (2XL = XXL)', () => {
    const e = entrega('E2', '2026-11-20', { shopify: { fecha: 'x', codigos: { SHBSPEC: [prod('Short Familyarg Spectrum', 69000)], GSKPT23: [prod('Pantalon Familyarg Garage', 89000)] } } });
    const r = controlarEntregaFamily(e, REMITO, []);
    expect(r.reposiciones).toBe(2);
    expect(r.semaforo).toBe('observaciones');
    const short = r.filas.find((f) => f.codigo === 'SHBSPEC')!;
    expect(short.cambiosPrecio).toEqual([]);
    expect(short.tallesNuevos).toEqual([]); // 2XL ya existe como XXL
    const pant = r.filas.find((f) => f.codigo === 'GSKPT23')!;
    expect(pant.cambiosPrecio).toEqual(['Precio público: Family dice $ 98.000,00 y en Shopify está a $ 89.000,00.']);
    expect(pant.tallesNuevos).toEqual(['3XL']);
  });

  it('avisa si Family cambió el precio desde la entrega anterior del mismo código', () => {
    const vieja = entrega('E1', '2026-10-30');
    const nueva = entrega('E2', '2026-11-20');
    nueva.renglones = nueva.renglones.map((r) => (r.codigo === 'SHBSPEC' ? { ...r, precioMayor: 37000, precioPublico: 74000 } : r));
    const r = controlarEntregaFamily(nueva, REMITO, [vieja, nueva]);
    expect(r.filas[0].cambiosPrecio).toEqual(['Family cambió el precio desde la entrega del 30/10/2026: por mayor $ 34.500,00 → $ 37.000,00, público $ 69.000,00 → $ 74.000,00.']);
    expect(r.filas[1].cambiosPrecio).toEqual([]);
    // La entrega vieja no se compara con la nueva.
    expect(controlarEntregaFamily(vieja, REMITO, [vieja, nueva]).filas[0].cambiosPrecio).toEqual([]);
  });

  it('si no se pudo consultar Shopify no dice nuevo ni reposición', () => {
    const r = controlarEntregaFamily(entrega('E1', '2026-10-30', { shopify: { fecha: 'x', error: 'sin conexión', codigos: {} } }), REMITO, []);
    expect(r.filas.every((f) => f.tipo === 'sin-consultar')).toBe(true);
    expect(r.semaforo).toBe('observaciones');
  });
});
