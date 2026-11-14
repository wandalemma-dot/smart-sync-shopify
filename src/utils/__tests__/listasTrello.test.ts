import { describe, it, expect } from 'vitest';
import { analizarFacturas, NUNCA_PENDIENTE, notaDisponible } from '../controlFacturas';
import type { Factura, Pedido, RenglonFactura } from '../controlFacturas';
import { conEstadoTrello, estadosTarjetas, listaFinalizado, listaRecibido, listasDePendientes, movimientosTarjetas, tarjetaDeNota } from '../listasTrello';

// Listas del tablero COMPRAS Y ENTREGAS (capturas de gax, 11-nov-2026).
const L = (n: number) => String(n).repeat(24).slice(0, 24);
const LISTAS = [
  { id: L(1), nombre: 'PEDIDOS PENDIENTES' },
  { id: L(2), nombre: 'PENDIENDE DE INDUMENTARIA/CALZADO' },
  { id: L(3), nombre: 'RECIBIDOS' },
  { id: L(4), nombre: 'Pagos' },
];
const T = (c: string) => c.repeat(24);

describe('listas de pedidos pendientes en Trello (gax: «solo tené en cuenta esto»)', () => {
  it('por defecto usa las listas que dicen «pendiente» (también «PENDIENDE»); si se eligieron, esas', () => {
    expect(listasDePendientes(LISTAS).map((l) => l.nombre)).toEqual(['PEDIDOS PENDIENTES', 'PENDIENDE DE INDUMENTARIA/CALZADO']);
    expect(listasDePendientes([{ id: L(5), nombre: 'Pedidos pendientes' }]).length).toBe(1);
    expect(listasDePendientes(LISTAS, [L(3)]).map((l) => l.nombre)).toEqual(['RECIBIDOS']);
    expect(listasDePendientes(LISTAS, ['f'.repeat(24)])).toEqual([]);
  });

  it('anota en qué lista está cada tarjeta con notas y desde cuándo salió de las de pendientes', () => {
    const notas = [{ origen: `trello:${T('a')}` }, { origen: `trello:${T('b')}` }, { origen: `trello:${T('c')}` }, { origen: `trello:${T('d')}` }, { origen: 'manual' }];
    const tarjetas = [
      { id: T('a'), idLista: L(1), lista: 'PEDIDOS PENDIENTES' },
      { id: T('b'), idLista: L(3), lista: 'RECIBIDOS' },
      { id: T('c'), idLista: L(3), lista: 'RECIBIDOS' },
      // d: archivada o borrada (no viene en la lista de tarjetas abiertas)
    ];
    const pendientes = new Set([L(1), L(2)]);
    const previos = {
      [T('c')]: { pendiente: true, visto: true, fuera: '', lista: 'PEDIDOS PENDIENTES' },
      [T('d')]: { pendiente: false, visto: true, fuera: '2026-11-05', lista: 'RECIBIDOS' },
    };
    const c = estadosTarjetas(notas, tarjetas, pendientes, previos, '2026-11-12');
    expect(c[T('a')]).toEqual({ pendiente: true, visto: true, fuera: '', lista: 'PEDIDOS PENDIENTES' });
    // Nunca estuvo en pendientes (las tarjetas viejas bajadas todas juntas el 11-nov).
    expect(c[T('b')]).toEqual({ pendiente: false, visto: false, fuera: '2026-11-12', lista: 'RECIBIDOS' });
    // Salió hoy: vale para las facturas de hasta hoy.
    expect(c[T('c')]).toEqual({ pendiente: false, visto: true, fuera: '2026-11-12', lista: 'RECIBIDOS' });
    // Ya estaba afuera: conserva la fecha en que salió.
    expect(c[T('d')]).toEqual({ pendiente: false, visto: true, fuera: '2026-11-05', lista: 'archivada o borrada' });
    // Sin cambios: no se vuelve a guardar.
    const otra = estadosTarjetas(notas, tarjetas, pendientes, { ...previos, ...c }, '2026-11-20');
    expect(otra).toEqual({});
    // Vuelve a una lista de pendientes: cuenta otra vez.
    const vuelve = estadosTarjetas(notas, [{ id: T('b'), idLista: L(2), lista: 'PENDIENDE DE INDUMENTARIA/CALZADO' }], pendientes, c, '2026-11-20');
    expect(vuelve[T('b')]).toMatchObject({ pendiente: true, visto: true, fuera: '' });
    expect(tarjetaDeNota({ origen: 'manual' })).toBe('');
  });

  it('las notas viejas de otras listas no se eligen solas; las que salieron, solo para facturas de hasta esa fecha', () => {
    const linea = (codigo: string, cantidad: number) => ({ sku: codigo, codigo, descripcion: codigo, talle: 'M', unidadesPorUdm: 1, precioLista: 100000, descuento: 10, cantidad });
    const ren = (codigo: string, cantidad: number): RenglonFactura => ({ codigo, descripcion: codigo, precioUnitario: 100000, bonificacion: 10, cantidad, total: 90000 * cantidad });
    const factura = (id: string, fecha: string, rs: RenglonFactura[]): Factura => {
      const subtotal = rs.reduce((t, r) => t + r.total, 0);
      return { id, numero: id, fecha, renglones: rs, subtotal, iva: subtotal * 0.21, percepcionCaba: subtotal * 0.05, percepcionBsAs: subtotal * 0.06, total: subtotal * 1.32 };
    };
    const nota = (id: string, fecha: string, card: string, lineas: ReturnType<typeof linea>[]): Pedido & { origen: string } => ({ id, nombre: id, fecha, lineas, origen: `trello:${card}` });
    // Vieja de otra lista con 3 de 3 artículos; la pendiente tiene 2 de 3.
    const vieja = nota('VIEJA', '2026-09-07', T('b'), [linea('X', 2), linea('Y', 2), linea('Z', 2)]);
    const pendiente = nota('PEND', '2026-11-01', T('a'), [linea('X', 2), linea('Y', 2)]);
    const recibida = nota('RECIB', '2026-10-20', T('c'), [linea('Z', 2)]);
    const estados = {
      [T('a')]: { pendiente: true, visto: true, fuera: '', lista: 'PEDIDOS PENDIENTES' },
      [T('b')]: { pendiente: false, visto: false, fuera: '2026-11-12', lista: 'RECIBIDOS' },
      [T('c')]: { pendiente: false, visto: true, fuera: '2026-11-05', lista: 'RECIBIDOS' },
    };
    const notas = conEstadoTrello([vieja, pendiente, recibida], estados, '2026-11-12');
    expect(notas.map((p) => p.cerradaDesde)).toEqual([NUNCA_PENDIENTE, undefined, '2026-11-05']);
    expect(notaDisponible(notas[0], '2026-01-01')).toBe(false);
    expect(notaDisponible(notas[2], '2026-11-05')).toBe(true);
    expect(notaDisponible(notas[2], '2026-11-06')).toBe(false);
    // Factura sin fecha leída: vale la nota que estuvo en pendientes, nunca la que no estuvo.
    expect(notaDisponible(notas[2], '')).toBe(true);
    expect(notaDisponible(notas[0], '')).toBe(false);

    // Factura del 04/11 (antes de que la tarjeta de RECIB saliera): Z sale de RECIB, nunca de la vieja.
    const f1 = analizarFacturas(notas, [factura('F1', '2026-11-04', [ren('X', 2), ren('Y', 2), ren('Z', 2)])]).facturas[0];
    expect([...f1.pedidosCubiertos].sort()).toEqual(['PEND', 'RECIB']);
    expect(f1.pedidoPrincipal).toBe('PEND');
    // Factura del 08/11: RECIB ya había salido de pendientes → Z es facturado sin pedir.
    const f2 = analizarFacturas(notas, [factura('F2', '2026-11-08', [ren('X', 2), ren('Z', 2)])]).facturas[0];
    expect(f2.pedidosCubiertos).toEqual(['PEND']);
    expect(f2.renglones[1].sinPedir).toBe(2);
    expect(f2.codigosSinNota).toEqual(['Z']);
    expect(f2.motivos.join(' ')).toMatch(/Z no figura en ninguna nota de pedido pendiente/);
    // Tildada a mano: se usa aunque su tarjeta no esté en pendientes.
    const f3 = analizarFacturas(notas, [factura('F3', '2026-11-08', [ren('X', 2), ren('Z', 2)])], { F3: ['VIEJA'] }).facturas[0];
    expect(f3.pedidoPrincipal).toBe('VIEJA');
    expect(f3.renglones.every((r) => r.sinPedir === 0)).toBe(true);
    // Solo notas viejas: la entrega queda incompleta («falta la nota»), no se reparte entre notas viejas.
    const f4 = analizarFacturas([notas[0]], [factura('F4', '2026-11-08', [ren('X', 2)])], {}, { F4: { numero: '', fecha: '', renglones: [{ codigo: 'X', cantidad: 2, talles: [] }] } }).facturas[0];
    expect(f4.faltaNota).toBe(true);
    expect(f4.semaforo).toBe('incompleta');
  });
});

describe('mover las tarjetas solas (14-nov-2026, gax: «que haga todo automático»)', () => {
  const TAB = [
    { id: L(1), nombre: 'PEDIDOS PENDIENTES' },
    { id: L(2), nombre: 'PENDIENDE DE INDUMENTARIA/CALZADO' },
    { id: L(3), nombre: 'RECIBIDO / CONTROL / CARGA' },
    { id: L(5), nombre: 'FINALIZADO' },
    { id: L(4), nombre: 'Pagos' },
  ];
  const tarjetas = [
    { id: T('a'), nombre: 'LE COQ el 1/11', idLista: L(1), lista: 'PEDIDOS PENDIENTES' },
    { id: T('b'), nombre: 'LE COQ el 3/11', idLista: L(3), lista: 'RECIBIDO / CONTROL / CARGA' },
    { id: T('c'), nombre: 'CONVERSE', idLista: L(2), lista: 'PENDIENDE DE INDUMENTARIA/CALZADO' },
    { id: T('e'), nombre: 'Otra', idLista: L(4), lista: 'Pagos' },
    { id: T('f'), nombre: 'Ya terminada', idLista: L(5), lista: 'FINALIZADO' },
  ];
  const pendientes = new Set(listasDePendientes(TAB).map((l) => l.id));
  const base = { tarjetas, listas: TAB, pendientes };

  it('«RECIBIDO / CONTROL / CARGA» cuenta como lista de notas; «RECIBIDOS» a secas no', () => {
    expect(listasDePendientes(TAB).map((l) => l.nombre)).toEqual(['PEDIDOS PENDIENTES', 'PENDIENDE DE INDUMENTARIA/CALZADO', 'RECIBIDO / CONTROL / CARGA']);
    expect(listasDePendientes(TAB, [L(1)]).map((l) => l.nombre)).toEqual(['PEDIDOS PENDIENTES', 'RECIBIDO / CONTROL / CARGA']);
    expect(listaRecibido(LISTAS)).toBeUndefined();
    expect(listaFinalizado(TAB)?.id).toBe(L(5));
    // Dos listas con el mismo nombre: no se adivina.
    expect(listaFinalizado([...TAB, { id: L(6), nombre: 'Finalizados 2025' }])).toBeUndefined();
  });

  it('con la factura subida, de pendientes a «RECIBIDO / CONTROL / CARGA»; las de otras listas no se tocan', () => {
    const r = movimientosTarjetas({ ...base, tarjetasEntrega: [T('a'), T('b'), T('c'), T('e'), T('f'), T('a')], cerrada: false, consejos: () => ['finalizar'] });
    expect(r.mover.map((m) => [m.nombre, m.hacia.nombre])).toEqual([
      ['LE COQ el 1/11', 'RECIBIDO / CONTROL / CARGA'],
      ['CONVERSE', 'RECIBIDO / CONTROL / CARGA'],
    ]);
    expect(r.avisos).toEqual([]);
  });

  it('con la entrega cerrada: llegó todo → FINALIZADO; llegó una parte → pendientes de indumentaria/calzado', () => {
    const consejos = (t: string) => (t === T('a') ? ['finalizar' as const] : t === T('b') ? ['parcial' as const] : ['finalizar' as const, 'nada' as const]);
    const r = movimientosTarjetas({ ...base, tarjetasEntrega: [T('a'), T('b'), T('c'), T('e'), T('f')], cerrada: true, consejos });
    expect(r.mover.map((m) => [m.nombre, m.hacia.nombre])).toEqual([
      ['LE COQ el 1/11', 'FINALIZADO'],
      ['LE COQ el 3/11', 'PENDIENDE DE INDUMENTARIA/CALZADO'],
      // CONVERSE ya está en la lista de parciales: se queda.
    ]);
    // Nada llegó todavía: no se mueve.
    expect(movimientosTarjetas({ ...base, tarjetasEntrega: [T('b')], cerrada: true, consejos: () => ['nada'] }).mover).toEqual([]);
  });

  it('sin la lista de destino avisa para moverla a mano', () => {
    const sin = TAB.filter((l) => l.id !== L(5) && l.id !== L(3));
    const r1 = movimientosTarjetas({ ...base, listas: sin, tarjetasEntrega: [T('a')], cerrada: false, consejos: () => [] });
    expect(r1.mover).toEqual([]);
    expect(r1.avisos[0]).toMatch(/RECIBIDO \/ CONTROL \/ CARGA.*a mano/);
    const r2 = movimientosTarjetas({ ...base, listas: sin, tarjetasEntrega: [T('a')], cerrada: true, consejos: () => ['finalizar'] });
    expect(r2.avisos[0]).toMatch(/FINALIZADO.*a mano/);
  });
});
