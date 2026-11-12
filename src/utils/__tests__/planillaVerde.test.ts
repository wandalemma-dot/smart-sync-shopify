// Planillas de pedido en verde (12-nov-2026, gax): «lo que está en verde ya entró» y «que la app
// devuelva las planillas de Excel marcadas; mi empleado las sube a Trello». Planillas armadas a mano.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import { celdasVerdes, esVerde, hojaVisible, marcarPlanilla } from '../planillaVerde';
import { leerPedidoAuto, type HojaMarcada } from '../lectoresFacturas';
import { analizarFacturas, type Factura, type Pedido, type Remito } from '../controlFacturas';
import { consejoNota, fusionarPlanilla, marcasDeNota, tipoArticulo } from '../marcasPlanilla';
import { listaDeParciales } from '../listasTrello';
import { FOTO, NOTA_1522, VERDES_1522, planillaFalsa } from './planillaFalsa';

/** Lee la planilla como la app: filas de la hoja visible y lo pintado en verde. */
function leer(buf: Uint8Array, fecha = '2026-10-23') {
  const wb = XLSX.read(buf, { type: 'array', cellStyles: true });
  const ws = wb.Sheets[hojaVisible(wb)];
  const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  const hoja: HojaMarcada = { verdes: celdasVerdes(ws), origen: { r: 0, c: 0 }, fecha };
  return { filas, hoja, ws };
}
const colorDe = (ws: XLSX.WorkSheet, ref: string) => (ws[ref] as { s?: { fgColor?: { rgb?: string } } } | undefined)?.s?.fgColor?.rgb;

describe('leer el verde de la planilla', () => {
  it('esVerde: los verdes de Excel sí; amarillo, blanco, celeste y gris no', () => {
    for (const v of ['92D050', 'FF92D050', '00B050', 'C6EFCE', 'E2EFDA', 'A9D08E', '70AD47']) expect(esVerde(v), v).toBe(true);
    for (const v of ['FFFF00', 'FFFFFF', '00FFFF', 'D3D3D3', 'FFC000', '000000', '', undefined, 'verde']) expect(esVerde(v), String(v)).toBe(false);
  });

  it('la ropa en verde de la nota 1522 cuenta como entregada; las zapatillas no', () => {
    const { filas, hoja } = leer(planillaFalsa(NOTA_1522, { verdes: VERDES_1522 }));
    expect([...hoja.verdes].sort()).toEqual([...VERDES_1522].sort());
    const r = leerPedidoAuto(filas, 'T-x', 'LE COQ 19/10', '2026-10-19', hoja);
    expect(r.nroProveedor).toBe('00001522');
    const ent = r.pedido.lineas.filter((l) => l.entregado);
    expect(ent.map((l) => `${l.codigo} ${l.talle} ${l.entregado} ${l.entregadoDesde}`)).toEqual([
      'LAO0126018 L 1 2026-10-23', 'LTN0226066 XL 1 2026-10-23',
    ]);
    const zap = r.pedido.lineas.find((l) => l.codigo === 'LFN9924069' && l.talle === '043')!;
    expect(zap).toMatchObject({ celda: 'H4', celdaTotal: 'L4', cantidad: 2 });
    expect(zap.entregado).toBeUndefined();
  });

  it('código o total en verde sin ningún talle en verde: llegó la fila entera', () => {
    const { filas, hoja } = leer(planillaFalsa(NOTA_1522, { verdes: ['B5'] }));
    const r = leerPedidoAuto(filas, 'T-x', 'n', '2026-10-19', hoja);
    expect(r.pedido.lineas.filter((l) => l.entregado).map((l) => `${l.codigo} ${l.talle}`)).toEqual(['LFO0125210 037', 'LFO0125210 038', 'LFO0125210 040']);
    // Con un talle en verde, solo ese talle (el total en verde no suma los demás).
    const t = leer(planillaFalsa(NOTA_1522, { verdes: ['E5', 'L5'] }));
    expect(leerPedidoAuto(t.filas, 'T-x', 'n', '2026-10-19', t.hoja).pedido.lineas.filter((l) => l.entregado).map((l) => l.talle)).toEqual(['037']);
  });

  it('sin colores (o sin pasar la hoja) no hay nada entregado', () => {
    const { filas } = leer(planillaFalsa(NOTA_1522));
    expect(leerPedidoAuto(filas, 'x', 'n', '2026-10-19').pedido.lineas.some((l) => l.entregado)).toBe(false);
  });

  it('Distrinando: la fila en verde (Pedido o SKU) ya entró', () => {
    const filas = [
      ['SKU', 'Modelo color', 'Descripción', 'UDM', 'Mayorista', 'Descuento', 'Pedido'],
      ['RBK1-8', 'RBK1', 'ZAPA 8', 'Unidad', 1000, 40, 2],
      ['RBK1-9', 'RBK1', 'ZAPA 9', 'Unidad', 1000, 40, 3],
    ];
    const r = leerPedidoAuto(filas, 'x', 'n', '2026-10-01', { verdes: new Set(['G3']), fecha: '2026-10-05' });
    expect(r.proveedor).toBe('distrinando');
    expect(r.pedido.lineas.map((l) => [l.celda, l.entregado ?? 0])).toEqual([['G2', 0], ['G3', 3]]);
  });
});

describe('devolver la planilla marcada', () => {
  it('pinta solo esas celdas: valores, fotos y el resto del archivo quedan iguales', () => {
    const orig = planillaFalsa(NOTA_1522, { verdes: VERDES_1522 });
    const out = marcarPlanilla(orig, [{ ref: 'H4', color: 'verde' }, { ref: 'I4', color: 'amarillo' }, { ref: 'B2', color: 'verde' }], { nro: '1522', cantidades: ['H4', 'I4'] });
    const { ws } = leer(out);
    expect(colorDe(ws, 'H4')).toBe('92D050');
    expect(colorDe(ws, 'I4')).toBe('FFFF00');
    expect(colorDe(ws, 'J3')).toBe('92D050'); // lo que ya estaba en verde sigue
    expect(colorDe(ws, 'H5')).toBeUndefined();
    expect(ws.H4.v).toBe(2);
    // El encabezado conserva su negrita y su alineación al pintarlo.
    const estilos = new TextDecoder().decode(unzipSync(out)['xl/styles.xml']);
    expect(estilos).toMatch(/<xf applyFill="1" numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1"><alignment horizontal="center"\/><\/xf>/);
    const a = unzipSync(orig), b = unzipSync(out);
    expect(b['xl/media/image1.png']).toEqual(FOTO);
    for (const k of Object.keys(a)) if (!['xl/styles.xml', 'xl/worksheets/sheet1.xml'].includes(k)) expect(b[k], k).toEqual(a[k]);
    // Las celdas no tocadas quedan escritas igual.
    const h1 = new TextDecoder().decode(a['xl/worksheets/sheet1.xml']), h2 = new TextDecoder().decode(b['xl/worksheets/sheet1.xml']);
    expect(h2.replace(/ s="\d+"/g, '')).toBe(h1.replace(/ s="\d+"/g, ''));
  });

  it('planillas con prefijo x: y con una hoja oculta antes', () => {
    const orig = planillaFalsa(NOTA_1522, { prefijo: 'x:', oculta: true });
    const out = marcarPlanilla(orig, [{ ref: 'J3', color: 'verde' }], { nro: '00001522', cantidades: ['J3'] });
    const wb = XLSX.read(out, { type: 'array', cellStyles: true });
    expect(hojaVisible(wb)).toBe('Pedido');
    expect([...celdasVerdes(wb.Sheets.Pedido)]).toEqual(['J3']);
  });

  it('no pinta otra planilla ni una que cambió', () => {
    const orig = planillaFalsa(NOTA_1522);
    expect(() => marcarPlanilla(orig, [{ ref: 'H4', color: 'verde' }], { nro: '1523' })).toThrow(/no es la nota N° 1523/);
    expect(() => marcarPlanilla(orig, [{ ref: 'H5', color: 'verde' }], { cantidades: ['H5'] })).toThrow(/ya no tiene la cantidad/);
    expect(() => marcarPlanilla(orig, [{ ref: 'Z99', color: 'verde' }])).toThrow(/no encontré las celdas Z99/);
    expect(() => marcarPlanilla(orig, [])).toThrow(/nada para marcar/);
  });
});

// ---------------------------------------------------------------------------
const linea = (codigo: string, talle: string, cantidad: number, extra: Partial<Pedido['lineas'][number]> = {}) =>
  ({ sku: `${codigo}-${talle}`, codigo, descripcion: codigo, talle, unidadesPorUdm: 1, precioLista: 1000, descuento: 10, cantidad, ...extra });
const factura = (id: string, fecha: string, renglones: [string, number][]): Factura => ({
  id, numero: id, fecha, renglones: renglones.map(([codigo, cantidad]) => ({ codigo, descripcion: codigo, precioUnitario: 1000, bonificacion: 10, cantidad, total: 900 * cantidad })),
  subtotal: 900 * renglones.reduce((s, [, c]) => s + c, 0), iva: 0, percepcionCaba: 0, percepcionBsAs: 0, total: 0,
});
const remito = (renglones: [string, [string, number][]][]): Remito => ({
  numero: '', fecha: '', renglones: renglones.map(([codigo, ts]) => ({ codigo, cantidad: ts.reduce((s, [, c]) => s + c, 0), talles: ts.map(([talle, cantidad]) => ({ talle, cantidad })) })),
});

describe('lo que está en verde ya entró: la factura nueva va a la nota que lo tiene pendiente', () => {
  // La 1522 (19/10): la camiseta ya llegó (verde desde el 23/10). La 1600 (3/11) la vuelve a pedir.
  const vieja: Pedido = { id: 'N1522', nombre: '1522', fecha: '2026-10-19', lineas: [
    linea('LTN0226066', 'XL', 1, { entregado: 1, entregadoDesde: '2026-10-23', celda: 'K6', celdaTotal: 'L6' }),
    linea('LFO0125210', '037', 1, { celda: 'E5', celdaTotal: 'L5' }), linea('LFO0125210', '038', 1, { celda: 'F5', celdaTotal: 'L5' }), linea('LFO0125210', '040', 2, { celda: 'G5', celdaTotal: 'L5' }),
  ] };
  const nueva: Pedido = { id: 'N1600', nombre: '1600', fecha: '2026-11-03', lineas: [linea('LTN0226066', 'XL', 1)] };

  it('sin el verde se la quedaba la nota vieja; con el verde, la nueva', () => {
    const f = factura('F1', '2026-11-06', [['LTN0226066', 1]]);
    const sinVerde = { ...vieja, lineas: vieja.lineas.map((l) => ({ ...l, entregado: undefined, entregadoDesde: undefined })) };
    expect(analizarFacturas([sinVerde, nueva], [f]).facturas[0].pedidoPrincipal).toBe('N1522');
    const r = analizarFacturas([vieja, nueva], [f]).facturas[0];
    expect(r.pedidoPrincipal).toBe('N1600');
    expect(r.renglones[0].sinPedir).toBe(0);
  });

  it('solo con la nota vieja: lo que ya entró y se vuelve a facturar es facturado sin pedir', () => {
    const r = analizarFacturas([vieja], [factura('F1', '2026-11-06', [['LTN0226066', 1]])]).facturas[0];
    expect(r.renglones[0].sinPedir).toBe(1);
  });

  it('el verde pintado desde la fecha de la factura puede ser de esa factura (la planilla que devolvió la app)', () => {
    const marcada = { ...vieja, lineas: vieja.lineas.map((l) => (l.codigo === 'LFO0125210' ? { ...l, entregado: l.cantidad, entregadoDesde: '2026-11-12' } : l)) };
    const res = analizarFacturas([marcada], [factura('F1', '2026-11-06', [['LFO0125210', 4]]), factura('F2', '2026-11-20', [['LFO0125210', 1]])]);
    expect(res.facturas[0].renglones[0].sinPedir).toBe(0);
    expect(res.facturas[0].pedidosCompletos).toBe(true);
    expect(res.facturas[1].renglones[0].sinPedir).toBe(1); // ya no queda nada de esa nota
  });

  it('lo que llegó antes de la app más lo que se factura ahora completa la nota', () => {
    // De las R1100 ya habían llegado 037 y 038 (verde de octubre): la factura trae las 2 del 040.
    const parcial = { ...vieja, lineas: vieja.lineas.map((l) => (['037', '038'].includes(l.talle) ? { ...l, entregado: 1, entregadoDesde: '2026-10-23' } : l)) };
    const res = analizarFacturas([parcial], [factura('F1', '2026-11-06', [['LFO0125210', 2]])]);
    const r = res.facturas[0];
    expect(r.renglones[0].sinPedir).toBe(0);
    expect(r.renglones[0].faltante).toBe(0);
    // El checklist sabe que son los talles que no estaban en verde.
    expect(r.checklist[0].talles).toEqual([{ talle: '040', cantidad: 2 }]);
    expect(res.pendientes.filter((x) => x.codigo === 'LFO0125210').map((x) => x.pendiente)).toEqual([0, 0, 0]);
    expect(analizarFacturas([parcial], [factura('F1', '2026-11-06', [['LFO0125210', 3]])]).facturas[0].renglones[0].sinPedir).toBe(1);
  });

  it('pendientes por talle sin facturas: lo pintado en verde ya no está pendiente', () => {
    const res = analizarFacturas([vieja], []);
    const p = res.pendientes.filter((x) => x.pedidoId === 'N1522').map((x) => [x.talle, x.pendiente]);
    expect(p).toEqual([['XL', 0], ['037', 1], ['038', 1], ['040', 2]]);
    expect(res.consumidoPorPedido?.N1522).toBe(1);
  });
});

describe('qué se pinta en la planilla de la nota', () => {
  const nota: Pedido = { id: 'N1522', nombre: '1522', fecha: '2026-10-19', lineas: [
    linea('LAO0126018', 'L', 1, { celda: 'J3', celdaTotal: 'L3', entregado: 1, entregadoDesde: '2026-10-23' }),
    linea('LFN9924069', '043', 2, { celda: 'H4', celdaTotal: 'L4' }), linea('LFN9924069', '044', 2, { celda: 'I4', celdaTotal: 'L4' }),
    linea('LFO0125210', '037', 1, { celda: 'E5', celdaTotal: 'L5' }), linea('LFO0125210', '038', 1, { celda: 'F5', celdaTotal: 'L5' }), linea('LFO0125210', '040', 2, { celda: 'G5', celdaTotal: 'L5' }),
  ] };

  it('con los talles del remito: verde lo completo, amarillo lo que llegó en parte, el total si llegó la fila', () => {
    const f = factura('F1', '2026-11-06', [['LFN9924069', 3], ['LFO0125210', 4]]);
    const res = analizarFacturas([nota], [f], {}, { F1: remito([['LFN9924069', [['43', 2], ['44', 1]]], ['LFO0125210', [['37', 1], ['38', 1], ['40', 2]]]]) });
    const m = marcasDeNota(res, 'F1', [nota], 'N1522');
    expect(m.celdas.map((c) => `${c.ref} ${c.color}`)).toEqual(['J3 verde', 'H4 verde', 'I4 amarillo', 'E5 verde', 'F5 verde', 'G5 verde', 'L3 verde', 'L5 verde']);
    expect(m.estaEntrega).toEqual([
      { codigo: 'LFN9924069', talle: '043', cantidad: 2 }, { codigo: 'LFN9924069', talle: '044', cantidad: 1 },
      { codigo: 'LFO0125210', talle: '037', cantidad: 1 }, { codigo: 'LFO0125210', talle: '038', cantidad: 1 }, { codigo: 'LFO0125210', talle: '040', cantidad: 2 },
    ]);
    expect(m.pendiente).toEqual([{ codigo: 'LFN9924069', talle: '044', unidades: 1 }]);
    expect(m.completa).toBe(false);
    expect(m.cantidades).not.toContain('L5');
  });

  it('suma las entregas anteriores aunque la planilla marcada anterior no se haya subido', () => {
    const f1 = factura('F1', '2026-11-06', [['LFN9924069', 2]]);
    const f2 = factura('F2', '2026-11-10', [['LFN9924069', 2], ['LFO0125210', 4]]);
    const res = analizarFacturas([nota], [f1, f2], {}, {
      F1: remito([['LFN9924069', [['43', 2]]]]),
      F2: remito([['LFN9924069', [['44', 2]]], ['LFO0125210', [['37', 1], ['38', 1], ['40', 2]]]]),
    });
    const m = marcasDeNota(res, 'F2', [nota], 'N1522');
    expect(m.completa).toBe(true);
    expect(m.facturas).toEqual(['F1', 'F2']);
    expect(m.celdas.filter((c) => c.color === 'amarillo')).toEqual([]);
    expect(m.estaEntrega.map((x) => x.talle)).toEqual(['044', '037', '038', '040']);
    // Para la primera entrega, solo lo de esa entrega.
    expect(marcasDeNota(res, 'F1', [nota], 'N1522').celdas.map((c) => c.ref)).toEqual(['J3', 'H4', 'L3']);
  });

  it('sin talles en el remito: solo si llegó justo todo lo que faltaba; si no, se avisa', () => {
    const res = analizarFacturas([nota], [factura('F1', '2026-11-06', [['LFO0125210', 4], ['LFN9924069', 3]])], {}, { F1: remito([['LFO0125210', []], ['LFN9924069', []]]) });
    const m = marcasDeNota(res, 'F1', [nota], 'N1522');
    expect(m.celdas.map((c) => c.ref)).toEqual(['J3', 'E5', 'F5', 'G5', 'L3', 'L5']);
    expect(m.sinTalle).toEqual([{ codigo: 'LFN9924069', unidades: 3 }]);
  });

  it('la planilla devuelta, leída de nuevo, deja la factura igual (no se descuenta dos veces)', () => {
    const f = factura('F1', '2026-11-06', [['LFO0125210', 4]]);
    const rem = { F1: remito([['LFO0125210', [['37', 1], ['38', 1], ['40', 2]]]]) };
    const res = analizarFacturas([nota], [f], {}, rem);
    const m = marcasDeNota(res, 'F1', [nota], 'N1522');
    const filas = [
      [null, 'Pedido N° 00001522', '', '19/10/2026'],
      ['Imagen', 'Código', 'Descripción', 'Color', '037', '038', '040', '043', '044', 'L', 'XL', 'Total', 'Precio unit.', 'Subtotal', 'Bonif. %'],
      [null, 'LAO0126018', 'X', '1', null, null, null, null, null, 1, null, 1, 1000, 1000, 10],
      [null, 'LFN9924069', 'X', '1', null, null, null, 2, 2, null, null, 4, 1000, 4000, 10],
      [null, 'LFO0125210', 'X', '1', 1, 1, 2, null, null, null, null, 4, 1000, 4000, 10],
    ] as (string | number | null)[][];
    const marcada = marcarPlanilla(planillaFalsa(filas, { verdes: ['J3', 'L3'] }), m.celdas, { nro: '1522', cantidades: m.cantidades });
    const { filas: f2, hoja } = leer(marcada, '2026-11-12');
    const leida = leerPedidoAuto(f2, 'N1522', '1522', '2026-10-19', hoja);
    const fusion = fusionarPlanilla(nota, leida.pedido.lineas)!;
    expect(fusion.lineas.filter((l) => l.entregado).map((l) => `${l.codigo} ${l.talle} ${l.entregadoDesde}`)).toEqual([
      'LAO0126018 L 2026-10-23', 'LFO0125210 037 2026-11-12', 'LFO0125210 038 2026-11-12', 'LFO0125210 040 2026-11-12',
    ]);
    const otra = analizarFacturas([fusion], [f], {}, rem).facturas[0];
    expect(otra.renglones[0]).toMatchObject({ sinPedir: 0, faltante: 0 });
    expect(otra.pedidosCompletos).toBe(false); // faltan las BREAKPOINT
  });
});

describe('¿se cerró el pedido? qué hacer con la tarjeta', () => {
  const nota: Pedido = { id: 'N1522', nombre: '1522', fecha: '2026-10-19', lineas: [
    linea('LAO0126018', 'L', 1, { descripcion: 'CARC CHALECO PUFFER 2026', entregado: 1, entregadoDesde: '2026-10-23' }),
    linea('LFN9924069', '043', 2, { descripcion: 'BREAKPOINT CLASSIC' }), linea('LFN9924069', '044', 2, { descripcion: 'BREAKPOINT CLASSIC' }),
    linea('LFO0125210', '037', 1, { descripcion: 'R1100' }), linea('LFO0125210', '038', 1, { descripcion: 'R1100' }), linea('LFO0125210', '040', 2, { descripcion: 'R1100' }),
  ] };
  const listas = { listaActual: 'PEDIDOS PENDIENTES', listaParcial: 'PENDIENDE DE INDUMENTARIA/CALZADO' };

  it('calzado o indumentaria por talle y nombre', () => {
    expect(tipoArticulo('R1100', ['037', '038'])).toBe('calzado');
    expect(tipoArticulo('CHUCK 70 HI', ['095'])).toBe('calzado');
    expect(tipoArticulo('CARC SLIDES 2026', ['040'])).toBe('calzado');
    expect(tipoArticulo('PUMAS CAMISETA ENTR FAN', ['XL'])).toBe('indumentaria');
    expect(tipoArticulo('PUMAS HOME SOCKS X 6', ['1', '2'])).toBe('indumentaria');
    expect(tipoArticulo('ESSENTIALS PANT', ['38'])).toBe('indumentaria');
    expect(tipoArticulo('GORRA', ['TU'])).toBe('indumentaria');
  });

  it('solo entró la ropa (en verde): pasar la tarjeta a pendientes de indumentaria/calzado', () => {
    const c = consejoNota(marcasDeNota(analizarFacturas([nota], []), null, [nota], 'N1522'), listas);
    expect(c.tipo).toBe('parcial');
    expect(c.texto).toBe('Solo entró la indumentaria; falta todo el calzado (8 u.).');
    expect(c.corto).toBe('🟡 solo entró la indumentaria');
    expect(c.tarjeta).toBe('Pasá la tarjeta a «PENDIENDE DE INDUMENTARIA/CALZADO».');
    expect(c.falta.map((x) => [x.codigo, x.unidades])).toEqual([['LFN9924069', 4], ['LFO0125210', 4]]);
    // Si ya está en esa lista, se deja ahí.
    expect(consejoNota(marcasDeNota(analizarFacturas([nota], []), null, [nota], 'N1522'), { ...listas, listaActual: listas.listaParcial }).tarjeta).toMatch(/ya está en «PENDIENDE/);
  });

  it('solo entró el calzado (factura sin talles en el remito, ropa sin verde)', () => {
    const sinVerde = { ...nota, lineas: nota.lineas.map((l) => ({ ...l, entregado: undefined, entregadoDesde: undefined })) };
    const res = analizarFacturas([sinVerde], [factura('F1', '2026-11-06', [['LFN9924069', 4], ['LFO0125210', 4]])]);
    const c = consejoNota(marcasDeNota(res, null, [sinVerde], 'N1522'), listas);
    expect(c.texto).toBe('Solo entró el calzado; falta toda la indumentaria (1 u.).');
  });

  it('entró parte del calzado: dice cuánto falta', () => {
    const res = analizarFacturas([nota], [factura('F1', '2026-11-06', [['LFN9924069', 3], ['LFO0125210', 4]])], {},
      { F1: remito([['LFN9924069', [['43', 2], ['44', 1]]], ['LFO0125210', [['37', 1], ['38', 1], ['40', 2]]]]) });
    const c = consejoNota(marcasDeNota(res, null, [nota], 'N1522'), listas);
    expect(c.texto).toBe('Entró toda la indumentaria y parte del calzado; falta 1 u. del calzado.');
    expect(c.falta).toEqual([{ codigo: 'LFN9924069', descripcion: 'BREAKPOINT CLASSIC', unidades: 1 }]);
  });

  it('llegó todo (facturas + verde): pedido completo, darlo por finalizado', () => {
    const res = analizarFacturas([nota], [factura('F1', '2026-11-06', [['LFN9924069', 2]]), factura('F2', '2026-11-10', [['LFN9924069', 2], ['LFO0125210', 4]])]);
    const c = consejoNota(marcasDeNota(res, null, [nota], 'N1522'), listas);
    expect(c.tipo).toBe('finalizar');
    expect(c.texto).toBe('✅ Pedido completo: llegó todo (9 u.).');
    expect(c.tarjeta).toBe('Podés darlo por finalizado y sacar la tarjeta de «PEDIDOS PENDIENTES».');
    // Con solo la primera factura, todavía no.
    expect(consejoNota(marcasDeNota(res, 'F1', [nota], 'N1522')).tipo).toBe('parcial');
  });

  it('nada llegó todavía: no se aconseja mover la tarjeta', () => {
    const sinVerde = { ...nota, lineas: nota.lineas.map((l) => ({ ...l, entregado: undefined })) };
    const c = consejoNota(marcasDeNota(analizarFacturas([sinVerde], []), null, [sinVerde], 'N1522'), listas);
    expect(c).toMatchObject({ tipo: 'nada', tarjeta: '' });
  });

  it('la lista de parciales del tablero', () => {
    expect(listaDeParciales([{ id: '1', nombre: 'PEDIDOS PENDIENTES' }, { id: '2', nombre: 'PENDIENDE DE INDUMENTARIA/CALZADO' }, { id: '3', nombre: 'RECIBIDOS' }])).toBe('PENDIENDE DE INDUMENTARIA/CALZADO');
    expect(listaDeParciales([{ id: '1', nombre: 'PEDIDOS PENDIENTES' }])).toBe('');
  });
});

describe('fusionar otra copia de la planilla', () => {
  const nota: Pedido = { id: 'T-a', nombre: 'n', fecha: '2026-10-19', lineas: [linea('A', '40', 2), linea('A', '41', 1, { entregado: 1, entregadoDesde: '2026-10-20' })] };
  it('suma el verde nuevo y las celdas; no borra el verde que la copia no tiene', () => {
    const copia = { tarjeta: 'c'.repeat(24), adjunto: 'd'.repeat(24), fecha: '2026-11-01' };
    const x = fusionarPlanilla(nota, [linea('A', '40', 2, { celda: 'E3', entregado: 2, entregadoDesde: '2026-11-01' }), linea('A', '41', 1, { celda: 'F3' })], copia, 5)!;
    expect(x.lineas.map((l) => [l.celda, l.entregado, l.entregadoDesde])).toEqual([['E3', 2, '2026-11-01'], ['F3', 1, '2026-10-20']]);
    expect(x.copias).toEqual([copia]);
    expect(x.lector).toBe(5);
    expect(fusionarPlanilla(x, x.lineas, copia, 5)).toBeNull();
  });
  it('una línea con otra cantidad no se toca (no es la misma nota)', () => {
    expect(fusionarPlanilla(nota, [linea('A', '40', 3, { entregado: 3, entregadoDesde: '2026-11-01' })])).toBeNull();
  });
});
