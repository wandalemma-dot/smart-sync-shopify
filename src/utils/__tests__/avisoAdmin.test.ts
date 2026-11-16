// Aviso de carga a administración y comentario en Trello (16-nov-2026, gax).
import { describe, expect, it } from 'vitest';
import { comentarioTrello, fechaCorta, filaPlanilla, filaPlanillaFamily, observacionesPlanilla, proveedorPlanilla, textoAvisoAdmin } from '../avisoAdmin';
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
