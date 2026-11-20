// Ullua (19-nov-2026, gax): marketplace como Family. Remito con IVA o factura sin IVA, precio de la curva
// dividido por sus unidades, costo = c/u sin IVA − 15%. Shopify SIMULADO: ninguna escritura real.
import { describe, it, expect } from 'vitest';
import {
  altaUllua, baseUllua, busquedaUllua, costoUllua, entregaDeDocumentoUllua, esCodigoCurva, etiquetaEsDeUllua, leerCurva,
  precioUllua, sinCurva, skuEsDeUllua, skuUllua, tituloUllua, ULLUA, type DocumentoUllua,
} from '../ullua';
import { accionesElegidas, planCargaFamily, type EstadoCarga, type ProductoCarga } from '../cargaFamily';
import { agruparShopify, controlarEntregaFamily, type EntregaFamily } from '../controlFamily';
import { filaPlanillaFamily } from '../avisoAdmin';
import { nombreTarjetaFamily } from '../trelloFamily';

const LOC = 'gid://shopify/Location/1';
const doc = (o: Partial<DocumentoUllua>): DocumentoUllua => ({ tipo: 'remito', numero: '0001-00007680', fecha: '2026-11-18', remito: '', renglones: [], subtotal: 0, iva: 0, total: 0, dudas: [], ...o });

describe('Ullua: curvas', () => {
  it('lee la curva de la descripción, también al revés (1S 2M)', () => {
    expect(leerCurva('SP HOODIE OG CLASSIC MELANGE CURVA S1 M2 L3 XL2')).toMatchObject({ como: 'leida', talles: [{ talle: 'S', cantidad: 1 }, { talle: 'M', cantidad: 2 }, { talle: 'L', cantidad: 3 }, { talle: 'XL', cantidad: 2 }] });
    expect(leerCurva('TH T-SHIRT SKATE MAG CURVA 1S 2M 3L 2XL').talles.map((t) => `${t.talle}${t.cantidad}`)).toEqual(['S1', 'M2', 'L3', 'XL2']);
    expect(leerCurva('GOOD GOD T-SHIRT LOGO CURVA S1 M2 L2 XL1')).toMatchObject({ como: 'leida' });
  });
  it('curva cortada por el papel: se completa con la curva conocida que empieza igual (y se avisa)', () => {
    expect(leerCurva('SP LONG SLEEVE CLASSIC CURVA S1 M2 L3 X')).toMatchObject({ como: 'completada', leido: 'S1 M2 L3' });
    expect(leerCurva('TH HOODIE SKATE MAG CURVA S1 M2 L3').talles.map((t) => t.cantidad)).toEqual([1, 2, 3, 2]);
    expect(leerCurva('TH HOODIE CURVA').talles.map((t) => t.cantidad)).toEqual([1, 2, 3, 2]);
    // S1 M2 L2… puede ser la de Good (S1 M2 L2 XL1): una sola curva conocida empieza así.
    expect(leerCurva('GOOD T-SHIRT CURVA S1 M2 L2 X').talles.map((t) => `${t.talle}${t.cantidad}`)).toEqual(['S1', 'M2', 'L2', 'XL1']);
    // Lo que no empieza como ninguna conocida y está cortado no se adivina.
    expect(leerCurva('TH TEE CURVA S3 M4 L').como).toBe('desconocida');
  });
  it('sin curva escrita: la de siempre (mujer S2 M2 L2 XL2), y solo en remeras, buzos y parecidos', () => {
    expect(leerCurva('TH T-SHIRT WOMEN SKATEMAG NEGRO')).toMatchObject({ como: 'supuesta', talles: [{ talle: 'S', cantidad: 2 }, { talle: 'M', cantidad: 2 }, { talle: 'L', cantidad: 2 }, { talle: 'XL', cantidad: 2 }] });
    expect(leerCurva('SP HOODIE OG CLASSIC').talles.map((t) => t.cantidad)).toEqual([1, 2, 3, 2]);
    expect(leerCurva('DTS MEDIAS LOGO NEGRO').como).toBe('desconocida');
  });
  it('código de curva (termina en C después de un número) y descripción sin la curva', () => {
    expect(['364480C', '5108-A23C', '251451', 'ABC'].map(esCodigoCurva)).toEqual([true, true, false, false]);
    expect(sinCurva('SP HOODIE OG CLASSIC MELANGE CURVA S1 M2 L3')).toBe('SP HOODIE OG CLASSIC MELANGE');
  });
});

describe('Ullua: remito (con IVA) y factura (sin IVA) → precio c/u, costo y talles', () => {
  it('remito: 484.000 la curva de 8 con IVA → 50.000 c/u sin IVA, costo 42.500, precio 99.999', () => {
    const { entrega, avisos } = entregaDeDocumentoUllua(doc({
      renglones: [{ codigo: '580580C', descripcion: 'SP HOODIE OG CLASSIC MELANGE CURVA S1 M2 L3 XL2', cantidad: 2, precio: 484000, total: 968000 }],
      total: 968000,
    }), '2026-11-19');
    const r = entrega.renglones[0];
    expect(r).toMatchObject({ codigo: '580580C', descripcion: 'SP HOODIE OG CLASSIC MELANGE', precioMayor: 50000, precioPublico: 0, cantidad: 16 });
    expect(r.talles).toEqual([{ talle: 'S', cantidad: 2 }, { talle: 'M', cantidad: 4 }, { talle: 'L', cantidad: 6 }, { talle: 'XL', cantidad: 4 }]);
    expect(costoUllua(r.precioMayor)).toBe(42500);
    expect(precioUllua(r.precioMayor)).toBe(99999);
    expect(entrega.documento).toEqual({ tipo: 'remito', numero: '0001-00007680', remito: '0001-00007680', total: 968000 });
    expect(entrega.dudas).toEqual([]);
    expect(avisos.join(' ')).toMatch(/1,21/);
  });
  it('factura: 160.000 la curva de 8 sin IVA → 20.000 c/u, costo 17.000, precio 39.999; controla subtotal e IVA', () => {
    const { entrega } = entregaDeDocumentoUllua(doc({
      tipo: 'factura', numero: '0002-00001234', remito: '7680',
      renglones: [
        { codigo: '364480C', descripcion: 'TH T-SHIRT SKATE MAG NEGRO CURVA S1 M2 L3 XL2', cantidad: 1, precio: 160000, total: 160000 },
        { codigo: '251451', descripcion: 'TH MEDIAS LOGO', cantidad: 6, precio: 9000, total: 54000 },
      ],
      subtotal: 214000, iva: 44940, total: 258940,
    }), '2026-11-19');
    expect(entrega.renglones.map((r) => [r.codigo, r.precioMayor, r.cantidad, r.talles.length])).toEqual([['364480C', 20000, 8, 4], ['251451', 9000, 6, 0]]);
    expect(costoUllua(20000)).toBe(17000);
    expect(precioUllua(20000)).toBe(39999);
    expect(entrega.documento).toEqual({ tipo: 'factura', numero: '0002-00001234', remito: '7680', total: 258940 });
    expect(entrega.dudas).toEqual([]);
  });
  it('avisa lo que no cierra: total del renglón, IVA, curva cortada o sin escribir', () => {
    const { entrega } = entregaDeDocumentoUllua(doc({
      tipo: 'factura',
      renglones: [
        { codigo: '364480C', descripcion: 'TH T-SHIRT CURVA S1 M2 L3', cantidad: 2, precio: 160000, total: 300000 },
        { codigo: '364481C', descripcion: 'TH T-SHIRT WOMEN LOGO', cantidad: 1, precio: 160000, total: 160000 },
        { codigo: '364482C', descripcion: 'TH TEE CURVA S3 M4 L', cantidad: 1, precio: 160000, total: 160000 },
      ],
      subtotal: 620000, iva: 100000, total: 720000,
    }), '2026-11-19');
    const dudas = entrega.dudas!.join('\n');
    expect(dudas).toMatch(/364480C: 2 × .* no da el total/);
    expect(dudas).toMatch(/364480C: la curva está cortada/);
    expect(dudas).toMatch(/364481C: la descripción no trae la curva: usé la de siempre de mujer/);
    expect(dudas).toMatch(/364482C: no pude saber la curva/);
    expect(dudas).toMatch(/IVA/);
    // Sin curva conocida no hay talles: la carga queda bloqueada hasta escribirlos.
    const r = entrega.renglones.find((x) => x.codigo === '364482C')!;
    expect(r.talles).toEqual([]);
    expect(altaUllua(r).bloqueo).toMatch(/curva/);
  });
});

describe('Ullua: productos de Shopify y altas', () => {
  it('reconoce los SKU (código sin la C + talle) y la etiqueta con el código', () => {
    expect(baseUllua('5101-A80C')).toBe('5101A80');
    expect(skuEsDeUllua('580580S', '580580C')).toBe(true);
    expect(skuEsDeUllua('5101a80s', '5101-A80C')).toBe(true);
    expect(skuEsDeUllua("5104'A80XL", '5104-A80C')).toBe(true);
    expect(skuEsDeUllua('910280C.NEG.36', '910280C')).toBe(true);
    expect(skuEsDeUllua('251451', '251451')).toBe(true);
    expect(skuEsDeUllua('510101S', '5101C')).toBe(false);
    expect(skuEsDeUllua('580580CX', '580580C')).toBe(false);
    expect(skuEsDeUllua('7791234567890', '779123C')).toBe(false);
    expect(etiquetaEsDeUllua(['remeras', '5162a01c'], '5162-A01C')).toBe(true);
    expect(etiquetaEsDeUllua(['5162'], '5162-A01C')).toBe(false);
    expect(busquedaUllua(['580580C', '5101-A80C'])).toBe('sku:580580* OR tag:"580580C" OR sku:5101* OR tag:"5101-A80C" OR tag:"5101A80C"');
  });
  it('títulos como los cargados a mano: Tipo Marca Modelo [Mujer] Color', () => {
    expect(tituloUllua('SP HOODIE OG CLASSIC MELANGE CURVA S1 M2 L3')).toBe('Buzo Spitfire OG Classic Gris Melange');
    expect(tituloUllua('TH T-SHIRT WOMEN SKATEMAG NEGRO')).toBe('Remera Thrasher Skatemag Mujer Negro');
    expect(tituloUllua('GOOD GOD T-SHIRT LOGO BLANCA')).toBe('Remera Good Logo Blanco');
    expect(tituloUllua('SP LONG SLEEVE CLASSIC 87 SWIRL NEGRO')).toBe('Remera Manga Larga Spitfire Classic 87 Swirl Negro');
    expect(tituloUllua('TH CREW NECK FLAME MARINO')).toBe('Buzo Thrasher Crew Neck Flame Azul Marino');
  });
  it('alta: SKU sin la C + talle, etiqueta con el código, marca de la descripción, precio editable', () => {
    const { entrega } = entregaDeDocumentoUllua(doc({ renglones: [{ codigo: '5101-A80C', descripcion: 'TH HOODIE FLAME NEGRO CURVA S1 M2 L3 XL2', cantidad: 1, precio: 484000, total: 484000 }] }), '2026-11-19');
    const a = altaUllua(entrega.renglones[0]).accion!;
    expect(a).toMatchObject({
      tipo: 'alta', titulo: 'Buzo Thrasher Flame Negro', productType: 'Buzos', vendor: 'THRASHER', precio: 99999, costo: 42500, precioEditable: true, precioBase: 50000,
      variantes: [{ talle: 'S', sku: '5101A80S', cantidad: 1 }, { talle: 'M', sku: '5101A80M', cantidad: 2 }, { talle: 'L', sku: '5101A80L', cantidad: 3 }, { talle: 'XL', sku: '5101A80XL', cantidad: 2 }],
    });
    expect(a.tipo === 'alta' && a.etiquetas).toEqual(['5101-A80C', 'Indumentaria', 'Ropa', 'Buzos', 'buzo canguro', 'thrasher']);
    expect(skuUllua('580580C', 'XXL')).toBe('580580XXL');
    // Sin talles (código sin C): una sola variante «Default Title».
    const medias = altaUllua({ codigo: '251451', descripcion: 'TH MEDIAS LOGO', precioMayor: 9000, precioPublico: 0, cantidad: 6, talles: [] }).accion!;
    expect(medias).toMatchObject({ opcion: 'Title', variantes: [{ talle: 'Default Title', sku: '251451', cantidad: 6 }], productType: 'Medias', precio: 17999, costo: 7650 });
  });
  it('vista previa en la sucursal ULLUA y precio escrito a mano para el nuevo', () => {
    const { entrega } = entregaDeDocumentoUllua(doc({ renglones: [{ codigo: '580580C', descripcion: 'SP HOODIE OG CLASSIC MELANGE CURVA S1 M2 L3 XL2', cantidad: 1, precio: 484000, total: 484000 }] }), '2026-11-19');
    const e: EntregaFamily = { ...entrega, id: 'U1', shopify: { fecha: 'x', codigos: { '580580C': [] } } };
    const r = controlarEntregaFamily(e, null, [e], { nombre: 'Ullua', sinRemito: true, costoEsperado: ULLUA.costoEsperado });
    expect(r.semaforo).toBe('ok');
    const estado: EstadoCarga = { locationId: LOC, posId: null, porCodigo: { '580580C': [] }, familia: [], productos: {} };
    const plan = planCargaFamily(r, estado, {}, ULLUA);
    expect(plan.sucursal).toBe('ULLUA (Thrasher - Spitfire - DTS)');
    expect(plan.items[0].estado).toBe('listo');
    expect(accionesElegidas(plan, {})[0].accion).toMatchObject({ precio: 99999 });
    expect(accionesElegidas(plan, { '580580C': { clave: 'alta', precio: 94999 } })[0].accion).toMatchObject({ precio: 94999 });
    expect(accionesElegidas(plan, { '580580C': { clave: 'alta', precio: NaN } })[0].accion).toMatchObject({ precio: 99999 });
  });
  it('reposición: suma en el producto que ya existe y avisa si el costo de Shopify es otro', () => {
    const { entrega } = entregaDeDocumentoUllua(doc({ renglones: [{ codigo: '580580C', descripcion: 'SP HOODIE OG CLASSIC MELANGE CURVA S1 M2 L3 XL2', cantidad: 1, precio: 484000, total: 484000 }] }), '2026-11-19');
    const productos = agruparShopify(['580580C'], [
      { sku: '580580S', talle: 'S', precio: 99999, costo: 38250, producto: 'Buzo Spitfire OG Classic Gris Melange', vendor: 'Spitfire' },
      { sku: '580580M', talle: 'M', precio: 99999, costo: 38250, producto: 'Buzo Spitfire OG Classic Gris Melange', vendor: 'Spitfire' },
      { sku: '5805801S', talle: 'S', precio: 1, costo: 1, producto: 'Otro', vendor: 'Otro' },
    ], ULLUA);
    expect(productos['580580C'].map((p) => p.titulo)).toEqual(['Buzo Spitfire OG Classic Gris Melange']);
    const e: EntregaFamily = { ...entrega, id: 'U2', shopify: { fecha: 'x', codigos: productos } };
    const r = controlarEntregaFamily(e, null, [e], { nombre: 'Ullua', sinRemito: true, costoEsperado: ULLUA.costoEsperado });
    expect(r.filas[0].tipo).toBe('reposicion');
    expect(r.motivos.join('\n')).toMatch(/Costo: con este precio da \$\s?42\.500.* Shopify está a \$\s?38\.250/);
    const p: ProductoCarga = {
      id: 'P1', titulo: 'Buzo Spitfire OG Classic Gris Melange', estado: 'ACTIVE', etiquetas: ['580580C'],
      variantes: ['S', 'M', 'L', 'XL'].map((t, i) => ({ id: `v${i}`, talle: t, sku: `580580${t}`, inventoryItemId: `inv${i}`, seguimiento: true, disponible: i ? 1 : null })),
    };
    const plan = planCargaFamily(r, { locationId: LOC, posId: null, porCodigo: { '580580C': ['P1'] }, familia: [], productos: { P1: p } }, {}, ULLUA);
    expect(plan.items[0].estado).toBe('listo');
    const op = plan.items[0].opciones[0];
    expect(op.accion).toMatchObject({ tipo: 'reposicion', lineas: [{ talle: 'S', actual: null, suma: 1 }, { talle: 'M', actual: 1, suma: 2 }, { talle: 'L', actual: 1, suma: 3 }, { talle: 'XL', actual: 1, suma: 2 }] });
    expect(op.avisos.join(' ')).toMatch(/no está dado de alta en ULLUA \(Thrasher - Spitfire - DTS\)/);
    expect(op.avisos.join(' ')).toMatch(/Ullua cambió el precio/);
  });
});

describe('Ullua: planilla de ingreso y Trello', () => {
  it('remito: «ULLUA», número y monto del remito; factura: «FAC.OK - número» con el remito que menciona', () => {
    expect(filaPlanillaFamily({ fecha: '2026-11-18', remito: '0001-00007680', hoy: '2026-11-19', proveedor: 'ULLUA', monto: 968000 }))
      .toMatchObject({ proveedor: 'ULLUA', numero: '0001-00007680', factura: '', remito: '0001-00007680', monto: 968000, fecha: '18/11/26' });
    expect(filaPlanillaFamily({ fecha: '2026-11-18', remito: '7680', hoy: '2026-11-19', proveedor: 'ULLUA', factura: '0002-00001234', monto: 258940 }))
      .toMatchObject({ numero: '0002-00001234', factura: 'FAC.OK - 0002-00001234', remito: '7680', monto: 258940 });
    // Family sigue igual.
    expect(filaPlanillaFamily({ fecha: '2026-11-11', remito: '0001-00002716', hoy: '2026-11-16' })).toMatchObject({ proveedor: 'Familyarg', numero: '0001-00002716', factura: '', monto: null });
  });
  it('tarjeta «Ullua - Factura … - fecha»', () => {
    const { entrega } = entregaDeDocumentoUllua(doc({ tipo: 'factura', numero: '0002-00001234', renglones: [{ codigo: '251451', descripcion: 'TH MEDIAS', cantidad: 1, precio: 1, total: 1 }] }), '2026-11-19');
    const e: EntregaFamily = { ...entrega, id: 'U3' };
    const r = controlarEntregaFamily(e, null, [e], { sinRemito: true });
    expect(nombreTarjetaFamily(r, 'Ullua')).toBe('Ullua - Factura 0002-00001234 - 18/11/26');
  });
});
