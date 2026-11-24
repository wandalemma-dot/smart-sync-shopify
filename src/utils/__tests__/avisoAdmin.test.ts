// Aviso de carga a administración y comentario en Trello (16-nov-2026, gax).
import { describe, expect, it } from 'vitest';
import { comentarioTrello, diaArgentina, fechaCorta, fechaIngreso, filaPlanilla, filaPlanillaFamily, observacionesPlanilla, proveedorPlanilla, textoAvisoAdmin } from '../avisoAdmin';
import type { ResultadoCarga } from '../cargaFamily';
import type { ResultadoFactura } from '../controlFacturas';

const r = {
  factura: { id: 'F-1', numero: '0011-00139953', fecha: '2026-11-10', total: 1215508.21, renglones: [] },
  remito: { numero: '0013-00125274', fecha: '2026-11-10', renglones: [] },
  totalDifPrecio: 0, totalSinPedirNeto: 0, semaforo: 'ok', motivos: [],
} as unknown as ResultadoFactura;
const resultados: ResultadoCarga[] = [
  { codigo: 'LTO0224043', estado: 'cargada', mensaje: '', detalle: { titulo: 'Remera Le Coq Sportif Monochrome Tee', sumados: [{ talle: 'M', antes: 0, suma: 2 }, { talle: 'S', antes: null, suma: 2 }], costos: [], pasadas: [{ talle: 'S', cantidad: 1, orden: '#210837' }], notas: [] } },
  { codigo: 'LTO0226092', estado: 'parcial', mensaje: '', detalle: { titulo: 'Campera Le Coq Sportif', sumados: [{ talle: 'M', antes: 3, suma: 2 }], costos: [], pasadas: [], notas: ['No se pudo dar de alta: XXL; cargalo a mano.'] } },
];
const o = { prov: 'id' as const, r, resultados, sucursal: 'DEPOSITO MARTINEZ', hoy: '2026-11-16' };

describe('Aviso de carga a administración', () => {
  it('mail escrito, como el «Fac. OK ID» del depósito: factura, fecha de la factura, remito, monto y OK', () => {
    const { asunto, cuerpo } = textoAvisoAdmin(o);
    expect(asunto).toBe('Fac. OK ID - 0011-00139953');
    expect(cuerpo).toContain('Les informo que llegó y se cargó en stock la mercadería de la factura 0011-00139953 de ID LE COQ del 10/11/26 por $ 1.215.508,21 (remito 0013-00125274).');
    expect(cuerpo).toContain('La factura coincide con la nota de pedido: OK.');
    // La fecha de carga va en la planilla, no en el mail.
    expect(cuerpo).not.toContain('16/11/26');
    expect(cuerpo).not.toMatch(/^[A-Z° ]+: /m);
    expect(cuerpo).toContain('Se cargaron 6 u. en DEPOSITO MARTINEZ, 1 de ellas para ventas de iD que pasaron a DEPOSITO MARTINEZ.');
    expect(cuerpo).toMatch(/Detalle:\n• LTO0224043 .*: 4 u\. \(M 2, S 2\)/);
    expect(cuerpo).toMatch(/Para revisar:\n• LTO0226092: No se pudo dar de alta: XXL/);
  });
  it('sin nota de pedido (24-nov-2026): lo dice primero, en el asunto y en la planilla', () => {
    const sinNota = { ...r, semaforo: 'reclamar', totalSinPedirNeto: 900000, notaFaltante: true, unidadesSinNota: 38, unidades: 41, motivos: [
      'NOTA FALTANTE: 38 de 41 u. (18 de 19 artículos) no salen de ninguna nota de pedido cargada. Falta subir la nota de este pedido, o el proveedor facturó un pedido que no es nuestro: revisar antes de reclamar.',
      'FACTURADO SIN PEDIR: ZZ9 (1): $ 60.000,00 neto, $ 79.200,00 con impuestos.',
    ] } as unknown as ResultadoFactura;
    const { asunto, cuerpo } = textoAvisoAdmin({ ...o, r: sinNota });
    expect(asunto).toBe('Fac. ID - 0011-00139953 (sin nota de pedido)');
    expect(cuerpo).toContain('No encontramos la nota de pedido de esta factura: 38 de 41 u. no están en ninguna nota cargada.');
    expect(cuerpo).not.toContain('NOTA FALTANTE');
    expect(observacionesPlanilla(sinNota)).toBe('Sin nota de pedido (38 de 41 u.) · Facturado sin pedir ($ 900.000 neto)');
  });
  it('con diferencias: las informa, primero lo que no se pidió, sin reclamar', () => {
    const conDif = { ...r, semaforo: 'reclamar', totalSinPedirNeto: 60000, motivos: [
      'PRECIO: 1 artículo(s) más caros que en el pedido: $ 30.000,00 neto + IVA $ 6.300,00 + percepciones $ 3.300,00 = $ 39.600,00. Pedir nota de crédito por $ 30.000,00 neto más impuestos.',
      'FACTURADO SIN PEDIR: ZZ9 (1): $ 60.000,00 neto, $ 79.200,00 con impuestos.',
    ] } as unknown as ResultadoFactura;
    const { asunto, cuerpo } = textoAvisoAdmin({ ...o, prov: 'distrinando', r: conDif });
    expect(asunto).toBe('Fac. Distrinando - 0011-00139953 (con diferencias)');
    expect(cuerpo).toMatch(/no coincide con la nota de pedido\. Esto es lo que se encontró:\nVino algo que no se pidió:\n- FACTURADO SIN PEDIR: ZZ9/);
    expect(cuerpo).toMatch(/Otras diferencias encontradas:\n- PRECIO: .*= \$ 39\.600,00\.\n/);
    expect(cuerpo).not.toMatch(/nota de crédito|RECLAM/i);
  });
  it('proveedor y observaciones como los escribe la planilla', () => {
    expect(proveedorPlanilla('distrinando', [])).toBe('DISTRINANDO');
    expect(proveedorPlanilla('id', ['Zapatillas Converse Chuck'])).toBe('ID CONVERSE');
    expect(proveedorPlanilla('id', ['Converse X', 'Le Coq Y'])).toBe('ID CONVERSE / LE COQ');
    // Target (19-nov-2026): se aclara la empresa del grupo que factura, salvo la propia Target.
    expect(proveedorPlanilla('target', [], 'BAG COMPANY')).toBe('TARGET (BAG COMPANY)');
    expect(proveedorPlanilla('target', [], 'TARGET')).toBe('TARGET');
    expect(proveedorPlanilla('target', [])).toBe('TARGET');
    expect(observacionesPlanilla({ ...r, totalDifPrecio: 1500 } as ResultadoFactura)).toBe('Facturado más caro ($ 1.500 de más)');
    expect(fechaCorta('2026-11-05')).toBe('05/11/26');
  });
  it('el comentario de Trello resume lo cargado sin el saludo', () => {
    const t = comentarioTrello(o);
    expect(t).toMatch(/^\*\*Cargado en Shopify el 16\/11\/26\*\*: 6 u\. en DEPOSITO MARTINEZ/);
    expect(t).toContain('N° FACTURA: 0011-00139953');
    expect(t).not.toContain('Hola');
  });
  it('un mail muy largo se corta para que el enlace funcione', () => {
    const muchos: ResultadoCarga[] = Array.from({ length: 80 }, (_, i) => ({ codigo: `C${i}`, estado: 'cargada', mensaje: '', detalle: { titulo: 'Remera Converse con un nombre largo de prueba', sumados: [{ talle: 'M', antes: 0, suma: 1 }], costos: [], pasadas: [], notas: [] } }));
    const { cuerpo } = textoAvisoAdmin({ ...o, resultados: muchos });
    expect(cuerpo.length).toBeLessThan(2000);
    expect(cuerpo).toMatch(/… y \d+ artículo\(s\) más\./);
  });
});

describe('Fila para la planilla de ingreso (16-nov-2026)', () => {
  it('como las filas que ya están en CONTROL INGRESO MERCADERIA', () => {
    expect(filaPlanilla(o)).toEqual({
      fecha: '10/11/26', proveedor: 'ID LE COQ', numero: '0011-00139953', factura: 'FAC.OK - 0011-00139953',
      remito: '0013-00125274', monto: 1215508.21, observaciones: 'APP - ok', ok: true, carga: '16/11/26',
    });
  });
  it('Family: como las anotaba a mano (Familyarg, sin factura ni monto, con el remito)', () => {
    expect(filaPlanillaFamily({ fecha: '2026-11-11', remito: ' 0001-00002716 ', hoy: '2026-11-16' })).toEqual({
      fecha: '11/11/26', proveedor: 'Familyarg', numero: '0001-00002716', factura: '', remito: '0001-00002716',
      monto: null, observaciones: 'APP - ok', ok: true, carga: '16/11/26',
    });
  });
  it('con algo para revisar: «FAC. -» y la observación', () => {
    const f = filaPlanilla({ ...o, prov: 'distrinando', r: { ...r, totalDifPrecio: 1500 } as ResultadoFactura });
    expect(f).toMatchObject({ proveedor: 'DISTRINANDO', factura: 'FAC. - 0011-00139953', observaciones: 'APP - Facturado más caro ($ 1.500 de más)', ok: false });
  });
});

describe('Fecha de ingreso de la mercadería (21-nov-2026, gax)', () => {
  it('la planilla lleva el día que entró y CARGA STOCK el día que se carga; la factura es de antes', () => {
    expect(filaPlanilla({ ...o, ingreso: '2026-11-12' })).toMatchObject({ fecha: '12/11/26', carga: '16/11/26' });
  });
  it('el mail dice qué día entró y qué día se cargó, además de la fecha de la factura', () => {
    const { cuerpo } = textoAvisoAdmin({ ...o, ingreso: '2026-11-12' });
    expect(cuerpo).toContain('de ID LE COQ del 10/11/26 por');
    expect(cuerpo).toContain('Entró el 12/11/26 y se cargó en stock el 16/11/26.');
    expect(textoAvisoAdmin({ ...o, ingreso: '2026-11-16' }).cuerpo).toContain('Entró hoy, 16/11/26, y se cargó en stock en el día.');
    expect(comentarioTrello({ ...o, ingreso: '2026-11-12' })).toContain('ENTRÓ: 12/11/26');
  });
  it('el día: escrito a mano, si no el primero en que se subió la factura o el remito (en Argentina), si no el del papel', () => {
    const f = { fecha: '2026-11-16' };
    expect(fechaIngreso({ ...f, ingreso: '2026-11-18', subida: '2026-11-20T15:00:00.000Z' })).toEqual({ fecha: '2026-11-18', origen: 'escrita' });
    // 02:00 UTC del 19 es todavía el 18 en Argentina.
    expect(fechaIngreso({ ...f, subida: '2026-11-20T15:00:00.000Z' }, { subida: '2026-11-19T02:00:00.000Z' })).toEqual({ fecha: '2026-11-18', origen: 'subida' });
    // Entregas de antes del cambio: la última vez que se guardó el remito.
    expect(fechaIngreso(f, { actualizado: '2026-11-19T13:00:00.000Z' })).toEqual({ fecha: '2026-11-19', origen: 'subida' });
    expect(fechaIngreso(f, null)).toEqual({ fecha: '2026-11-16', origen: 'papel' });
    expect(diaArgentina('nada')).toBe('');
  });
  it('Family / Ullua: la fila va con el día que entró', () => {
    expect(filaPlanillaFamily({ fecha: fechaIngreso({ fecha: '2026-11-11', subida: '2026-11-13T12:00:00.000Z' }).fecha, remito: '0001-00002716', hoy: '2026-11-16' }).fecha).toBe('13/11/26');
  });
});
