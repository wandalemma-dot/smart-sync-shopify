// Aviso de carga a administración y comentario en Trello (16-nov-2026, gax).
import { describe, expect, it } from 'vitest';
import { comentarioTrello, fechaCorta, filaPlanilla, observacionesPlanilla, proveedorPlanilla, textoAvisoAdmin } from '../avisoAdmin';
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
  it('lleva las columnas de la planilla de ingreso', () => {
    const { asunto, cuerpo } = textoAvisoAdmin(o);
    expect(asunto).toBe('Carga de mercadería — ID LE COQ factura 0011-00139953');
    for (const l of ['FECHA: 10/11/26', 'PROVEEDOR: ID LE COQ', 'N° FACTURA: 0011-00139953', 'N° REMITO: 0013-00125274', 'MONTO: $ 1.215.508,21', 'OBSERVACIONES: ok', 'CARGA STOCK: 16/11/26']) expect(cuerpo).toContain(l);
    expect(cuerpo).toContain('Cargado en DEPOSITO MARTINEZ: 6 u. (1 u. para ventas de iD que pasaron a DEPOSITO MARTINEZ).');
    expect(cuerpo).toMatch(/LTO0224043 .*: 4 u\. \(M 2, S 2\)/);
    expect(cuerpo).toMatch(/Para revisar:\n• LTO0226092: No se pudo dar de alta: XXL/);
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
  it('con algo para revisar: «FAC. -» y la observación', () => {
    const f = filaPlanilla({ ...o, prov: 'distrinando', r: { ...r, totalDifPrecio: 1500 } as ResultadoFactura });
    expect(f).toMatchObject({ proveedor: 'DISTRINANDO', factura: 'FAC. - 0011-00139953', observaciones: 'APP - Facturado más caro ($ 1.500 de más)', ok: false });
  });
});
