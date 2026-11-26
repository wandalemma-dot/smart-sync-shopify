// Aviso de carga a administración y comentario en Trello (16-nov-2026, gax).
import { describe, expect, it } from 'vitest';
import { comentarioTrello, conCargasAnteriores, conLoCargado, diaArgentina, fechaCorta, fechaIngreso, filaPlanilla, filaPlanillaFamily, observacionesPlanilla, proveedorPlanilla, resultadosGuardados, textoAvisoAdmin } from '../avisoAdmin';
import type { CargaFamily } from '../cargaFamily';
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

describe('Planilla y mail sin lo interno del control (25-nov-2026, factura 0011-00140160)', () => {
  const f140160 = { ...r, semaforo: 'reclamar', difRemito: [{ codigo: '10027339A03', factura: 1, remito: 0 }], motivos: [
    'REMITO: facturaron más de lo que dice el remito: 10027339A03 (factura 1, remito 0).',
    'FALTANTE: CTO0226101 (pedido 8, facturado 6, faltan 2).',
    'ADELANTO: toma unidades de un pedido posterior; no deben volver a facturarse.',
  ] } as unknown as ResultadoFactura;
  const pantalon: ResultadoCarga = { codigo: '10027339A03', estado: 'cargada', mensaje: '', detalle: { titulo: 'Pantalón Converse Cargo', sumados: [{ talle: 'L', antes: 0, suma: 1 }], costos: [], pasadas: [], notas: [] } };
  it('lo que falta entregar de la nota no va: no es una diferencia con el proveedor', () => {
    const soloFaltante = { ...r, semaforo: 'observaciones', motivos: ['FALTANTE: CTO0226101 (pedido 8, facturado 6, faltan 2).', 'OTRA NOTA: X (1) corresponde al pedido N° 1.'] } as unknown as ResultadoFactura;
    expect(observacionesPlanilla(soloFaltante)).toBe('ok');
    expect(textoAvisoAdmin({ ...o, r: soloFaltante }).cuerpo).not.toMatch(/FALTANTE|OTRA NOTA/);
  });
  it('la foto del remito se salteó un renglón pero el artículo se cargó: llegó, no se anota', () => {
    expect(observacionesPlanilla(f140160)).toBe('REMITO: facturaron más de lo que dice el remito: 10027339A03 (factura 1, remito 0).');
    const conCarga = { ...o, r: f140160, resultados: [pantalon] };
    expect(filaPlanilla(conCarga)).toMatchObject({ factura: 'FAC.OK - 0011-00139953', observaciones: 'APP - ok', ok: true });
    const { asunto, cuerpo } = textoAvisoAdmin(conCarga);
    expect(asunto).toBe('Fac. OK ID - 0011-00139953');
    expect(cuerpo).not.toMatch(/REMITO:|FALTANTE|ADELANTO/);
  });
  it('lo que no se cargó (o se cargó de menos) sigue como diferencia con el remito', () => {
    const otro = { ...f140160, difRemito: [{ codigo: '10027339A03', factura: 1, remito: 0 }, { codigo: 'CTN1', factura: 3, remito: 1 }],
      motivos: ['REMITO: facturaron más de lo que dice el remito: 10027339A03 (factura 1, remito 0), CTN1 (factura 3, remito 1).'] } as unknown as ResultadoFactura;
    const menos: ResultadoCarga = { codigo: 'CTN1', estado: 'cargada', mensaje: '', detalle: { sumados: [{ talle: 'M', antes: 0, suma: 1 }], costos: [], pasadas: [], notas: [] } };
    const x = conLoCargado(otro, [pantalon, menos]);
    expect(x.motivos).toEqual(['REMITO: facturaron más de lo que dice el remito: CTN1 (factura 3, remito 1).']);
    expect(filaPlanilla({ ...o, r: otro, resultados: [pantalon, menos] }).observaciones).toBe('APP - REMITO: facturaron más de lo que dice el remito: CTN1 (factura 3, remito 1).');
    // Una carga con error no cuenta como que llegó.
    expect(conLoCargado(f140160, [{ ...pantalon, estado: 'error' }]).motivos[0]).toMatch(/^REMITO: facturaron/);
  });
});

describe('Corregir la fila en la planilla con lo cargado guardado (25-nov-2026)', () => {
  const cargas: Record<string, CargaFamily> = {
    'F-1|LTO0224043': { estado: 'cargada', fecha: '2026-11-21', firma: 'x', detalle: { titulo: 'Remera Le Coq Sportif Monochrome Tee', unidades: 4, talles: [{ talle: 'M', cantidad: 2 }, { talle: 'S', cantidad: 2 }] } },
    'F-1|MA5672FF7': { estado: 'parcial', fecha: '2026-11-21', firma: 'x', detalle: { titulo: 'Mochila Converse', unidades: 1 } },
    'F-1|LTO0226092': { estado: 'dudosa', fecha: '2026-11-21', firma: 'x' },
    'F-10|LTO0224043': { estado: 'cargada', fecha: '2026-11-21', firma: 'x', detalle: { talles: [{ talle: 'L', cantidad: 9 }] } },
  };
  it('arma los resultados de esa factura (cargados o en parte), con las unidades por talle', () => {
    const x = resultadosGuardados('F-1', cargas);
    expect(x.map((y) => [y.codigo, y.estado, y.detalle?.sumados.map((t) => `${t.talle}:${t.suma}`).join(',')])).toEqual([
      ['LTO0224043', 'cargada', 'M:2,S:2'], ['MA5672FF7', 'parcial', ':1'],
    ]);
  });
  it('con la nota ya cargada la fila queda «FAC.OK» y «APP - ok», y el proveedor sale de lo cargado', () => {
    expect(filaPlanilla({ ...o, resultados: resultadosGuardados('F-1', cargas), hoy: '2026-11-25' })).toMatchObject({
      proveedor: 'ID CONVERSE / LE COQ', factura: 'FAC.OK - 0011-00139953', observaciones: 'APP - ok', ok: true,
    });
  });
});

describe('El mail cuenta toda la factura, también las cargas anteriores (26-nov-2026, factura 0011-00140179)', () => {
  it('suma lo cargado antes (con sus ventas pasadas) y lo de esta carga manda para sus códigos', () => {
    const cargas: Record<string, CargaFamily> = {
      'F-1|CTO0325021': { estado: 'cargada', fecha: '2026-11-26', firma: 'x', detalle: { titulo: 'Buzo Converse Hoodie', unidades: 3, talles: [{ talle: 'M', cantidad: 2 }, { talle: 'L', cantidad: 1 }], pasadas: [{ talle: 'M', cantidad: 1, orden: '#212020' }] } },
      // Lo de esta carga (LTO0224043) reemplaza lo guardado antes para ese código.
      'F-1|LTO0224043': { estado: 'parcial', fecha: '2026-11-26', firma: 'x', detalle: { unidades: 1, talles: [{ talle: 'M', cantidad: 1 }] } },
      'F-2|CTO1': { estado: 'cargada', fecha: '2026-11-26', firma: 'x', detalle: { unidades: 9 } },
    };
    const todo = conCargasAnteriores('F-1', resultados, cargas);
    expect(todo.map((x) => x.codigo)).toEqual(['CTO0325021', 'LTO0224043', 'LTO0226092']);
    const { cuerpo } = textoAvisoAdmin({ ...o, resultados: todo });
    expect(cuerpo).toContain('Se cargaron 9 u. en DEPOSITO MARTINEZ, 2 de ellas para ventas de iD que pasaron a DEPOSITO MARTINEZ.');
    expect(cuerpo).toMatch(/• CTO0325021 Buzo Converse Hoodie: 3 u\. \(M 2, L 1\) · 1 u\. para ventas de iD/);
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

describe('iD facturado más caro: con observaciones, en amarillo (26-nov-2026, gax)', () => {
  const caro = { ...r, semaforo: 'observaciones', totalDifPrecio: 3850.26, precioInformativo: true } as unknown as ResultadoFactura;
  it('la planilla dice «Con observaciones (diferencias de precio contra nota de pedido)» y pide amarillo', () => {
    expect(observacionesPlanilla(caro)).toBe('Con observaciones (diferencias de precio contra nota de pedido: $ 3.850,26 de más)');
    expect(filaPlanilla({ ...o, r: caro })).toMatchObject({
      factura: 'FAC. - 0011-00139953', observaciones: 'APP - Con observaciones (diferencias de precio contra nota de pedido: $ 3.850,26 de más)', ok: false, aviso: true,
    });
  });
  it('si además hay algo facturado sin pedir, va en naranja como siempre', () => {
    expect(filaPlanilla({ ...o, r: { ...caro, totalSinPedirNeto: 60000 } as ResultadoFactura }).aviso).toBeUndefined();
  });
  it('Distrinando sigue diciendo «Facturado más caro»', () => {
    expect(filaPlanilla({ ...o, prov: 'distrinando', r: { ...r, totalDifPrecio: 1500 } as ResultadoFactura }).aviso).toBeUndefined();
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
