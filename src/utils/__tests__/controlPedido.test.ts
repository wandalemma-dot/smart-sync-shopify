// ============================================================================
// CONTROL DE CARGA — factura contra notas de pedido
// ----------------------------------------------------------------------------
// ⚠ LO QUE CUIDA ESTE ARCHIVO:
//   1) Lo pedido y no facturado es PENDIENTE, nunca error (entrega parcial).
//   2) Facturar más de lo pedido, algo no pedido o a otro costo, SÍ es error.
//   3) Varias notas se SUMAN; el costo de referencia es el de la nota más nueva.
//   4) Factura sin talles → se compara el total del modelo.
//   5) Los costos se comparan con centavos.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { compararConPedido, notaDesdeFilas, numeroAr } from '../controlPedido';
import type { NotaPedido, RenglonPedido } from '../controlPedido';
import type { Remito, RenglonRemito } from '../controlRemitos';

const fac = (renglones: Partial<RenglonRemito>[]): Remito => ({
  proveedor: 'X', numero: '0001-00000001', fecha: '2026-10-20',
  renglones: renglones.map((r) => ({ codigo: '', descripcion: '', color: '', talle: '', cantidad: 1, ...r })),
});
const nota = (nombre: string, fecha: string, renglones: Partial<RenglonPedido>[], orden = 0): NotaPedido => ({
  nombre, fecha, orden, renglones: renglones.map((r) => ({ codigo: '', descripcion: '', color: '', talle: '', cantidad: 1, ...r })),
});

describe('factura contra pedido', () => {
  it('todo pedido y al mismo costo → ok; lo no facturado queda pendiente', () => {
    const r = compararConPedido(
      fac([{ codigo: 'A1', talle: '40', cantidad: 2, precio_unitario: 1000 }]),
      [nota('N1', '2026-10-01', [{ codigo: 'A1', talle: '40', cantidad: 3, costo: 1000 }, { codigo: 'A1', talle: '41', cantidad: 1, costo: 1000 }])],
    );
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].tipo).toBe('ok');
    expect(r.totales).toMatchObject({ ok: 1, excede: 0, costo: 0, noPedido: 0, pendiente: 2 });
    expect(r.pendientes.map((p) => [p.talle, p.falta])).toEqual([['40', 1], ['41', 1]]);
  });

  it('facturan más de lo pedido → excede', () => {
    const r = compararConPedido(fac([{ codigo: 'A1', talle: '40', cantidad: 4, precio_unitario: 1000 }]),
      [nota('N1', '', [{ codigo: 'A1', talle: '40', cantidad: 3, costo: 1000 }])]);
    expect(r.filas[0]).toMatchObject({ tipo: 'excede', cantPedida: 3, cantFacturada: 4 });
  });

  it('artículo no pedido, o pedido en otro talle → noPedido con aclaración', () => {
    const r = compararConPedido(fac([{ codigo: 'B9', talle: '40' }, { codigo: 'A1', talle: '42' }]),
      [nota('N1', '', [{ codigo: 'A1', talle: '40' }])]);
    expect(r.filas.every((f) => f.tipo === 'noPedido')).toBe(true);
    expect(r.filas.find((f) => f.codigo === 'A1')!.nota).toMatch(/otros talles/);
  });

  it('costo distinto → costo; con centavos, 1 centavo de redondeo se tolera', () => {
    const r = compararConPedido(
      fac([{ codigo: 'A1', talle: '40', precio_unitario: 43267.39 }, { codigo: 'A1', talle: '41', precio_unitario: 43267.5 }]),
      [nota('N1', '', [{ codigo: 'A1', talle: '40', costo: 43267.38 }, { codigo: 'A1', talle: '41', costo: 43267.38 }])],
    );
    expect(r.filas.find((f) => f.talle === '40')!.tipo).toBe('ok');
    expect(r.filas.find((f) => f.talle === '41')!.tipo).toBe('costo');
  });

  it('varias notas se suman y manda el costo de la más nueva (precio de última)', () => {
    const notas = [
      nota('Nueva', '2026-10-15', [{ codigo: 'A1', talle: '40', cantidad: 2, costo: 1200 }], 0),
      nota('Vieja', '2026-10-01', [{ codigo: 'A1', talle: '40', cantidad: 3, costo: 1000 }], 1),
    ];
    const ok = compararConPedido(fac([{ codigo: 'A1', talle: '40', cantidad: 5, precio_unitario: 1200 }]), notas);
    expect(ok.filas[0]).toMatchObject({ tipo: 'ok', cantPedida: 5, costoPedido: 1200 });
    expect(ok.avisos.join(' ')).toMatch(/nota más nueva/);
    const viejo = compararConPedido(fac([{ codigo: 'A1', talle: '40', cantidad: 5, precio_unitario: 1000 }]), notas);
    expect(viejo.filas[0].tipo).toBe('costo');
  });

  it('misma fecha: desempata el orden de carga (la última subida es la más nueva)', () => {
    const r = compararConPedido(fac([{ codigo: 'A1', talle: '40', precio_unitario: 900 }]), [
      nota('B', '2026-10-01', [{ codigo: 'A1', talle: '40', costo: 900 }], 2),
      nota('A', '2026-10-01', [{ codigo: 'A1', talle: '40', costo: 800 }], 1),
    ]);
    expect(r.filas[0].tipo).toBe('ok');
  });

  it('factura sin talles → total del modelo contra lo pedido en todos los talles', () => {
    const notas = [nota('N1', '', [
      { codigo: 'M7', talle: '36', cantidad: 3, costo: 500 }, { codigo: 'M7', talle: '37', cantidad: 3, costo: 500 },
      { codigo: 'M7', talle: '38', cantidad: 2, costo: 500 },
    ])];
    const ok = compararConPedido(fac([{ codigo: 'M7', cantidad: 8, precio_unitario: 500 }]), notas);
    expect(ok.filas[0]).toMatchObject({ tipo: 'ok', porModelo: true, cantPedida: 8 });
    expect(ok.pendientes).toHaveLength(0);
    const mas = compararConPedido(fac([{ codigo: 'M7', cantidad: 9, precio_unitario: 500 }]), notas);
    expect(mas.filas[0].tipo).toBe('excede');
    const menos = compararConPedido(fac([{ codigo: 'M7', cantidad: 6, precio_unitario: 500 }]), notas);
    expect(menos.filas[0].tipo).toBe('ok');
    expect(menos.pendientes[0]).toMatchObject({ talle: '', falta: 2 });
  });

  it('sin precio en la factura o sin costo en la nota: no se inventa error, se avisa', () => {
    const r = compararConPedido(fac([{ codigo: 'A1', talle: '40' }, { codigo: 'A2', talle: '40', precio_unitario: 10 }]),
      [nota('N1', '', [{ codigo: 'A1', talle: '40', costo: 10 }, { codigo: 'A2', talle: '40' }])]);
    expect(r.filas.every((f) => f.tipo === 'ok')).toBe(true);
    expect(r.filas.find((f) => f.codigo === 'A1')!.nota).toMatch(/no trae precio/);
    expect(r.filas.find((f) => f.codigo === 'A2')!.nota).toMatch(/no trae costo/);
  });

  it('el código se compara sin guiones/espacios y con O = 0', () => {
    const r = compararConPedido(fac([{ codigo: 'a-1o5', talle: 'XXL' }]), [nota('N1', '', [{ codigo: 'A 105', talle: '2XL' }])]);
    expect(r.filas[0].tipo).toBe('ok');
  });
});

describe('nota de pedido desde Excel', () => {
  it('lee encabezados por nombre, números argentinos y la fecha de arriba', () => {
    const n = notaDesdeFilas([
      ['Nota de pedido 123 — 14/10/2026'],
      [],
      ['Artículo', 'Descripción', 'Talle', 'Cantidad', 'Costo unitario'],
      ['A1', 'Zapa', '40', '2', '43.267,38'],
      ['A1', 'Zapa', '41', 0, '43.267,38'],
      ['', 'TOTAL', '', 2, ''],
    ], 'nota.xlsx');
    expect(n.fecha).toBe('2026-10-14');
    expect(n.renglones).toEqual([{ codigo: 'A1', descripcion: 'Zapa', color: '', talle: '40', cantidad: 2, costo: 43267.38 }]);
  });

  it('sin columna de talle = pedido por modelo', () => {
    const n = notaDesdeFilas([['Código', 'Cantidad', 'Precio'], ['M7', 8, 500]], 'x');
    expect(n.renglones[0]).toMatchObject({ talle: '', cantidad: 8, costo: 500 });
  });

  it('sin encabezados reconocibles → error claro', () => {
    expect(() => notaDesdeFilas([['a', 'b']], 'x.xlsx')).toThrow(/encabezados/);
  });

  it('numeroAr', () => {
    expect(numeroAr('1.234,56')).toBe(1234.56);
    expect(numeroAr('$ 72.900')).toBe(72900);
    expect(numeroAr('1234.5')).toBe(1234.5);
    expect(numeroAr(10)).toBe(10);
  });
});
