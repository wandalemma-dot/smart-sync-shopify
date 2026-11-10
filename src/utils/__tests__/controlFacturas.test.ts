import { describe, it, expect } from 'vitest';
import { analizarFacturas, compararRecepcion, fmt, mensajePagos, reporteReclamo, resumenPedidos } from '../controlFacturas';
import type { Factura, Pedido, RenglonFactura } from '../controlFacturas';
import { numero, leerPedidoExcel, leerPedidoAuto, leerPedidoId } from '../lectoresFacturas';

const linea = (codigo: string, talle: string, cantidad: number, precio = 100000, dto = 40) =>
  ({ sku: `${codigo}-${talle}`, codigo, descripcion: `Modelo ${codigo} ${talle}`, talle, unidadesPorUdm: 1, precioLista: precio, descuento: dto, cantidad });
const ren = (codigo: string, cantidad: number, precio = 100000, bonif = 40): RenglonFactura =>
  ({ codigo, descripcion: codigo, precioUnitario: precio, bonificacion: bonif, cantidad, total: Math.round(precio * (1 - bonif / 100) * cantidad * 100) / 100 });
function factura(id: string, fecha: string, renglones: RenglonFactura[]): Factura {
  const subtotal = Math.round(renglones.reduce((s, r) => s + r.total, 0) * 100) / 100;
  const iva = Math.round(subtotal * 21) / 100, caba = Math.round(subtotal * 5) / 100, bsas = Math.round(subtotal * 6) / 100;
  return { id, numero: `0001-0000000${id}`, fecha, renglones, subtotal, iva, percepcionCaba: caba, percepcionBsAs: bsas, total: Math.round((subtotal + iva + caba + bsas) * 100) / 100, vencimiento: '2026-12-10' };
}
const pA: Pedido = { id: 'A', nombre: 'Pedido A', fecha: '2026-10-01', lineas: [linea('X1', '40', 2), linea('X1', '41', 3), linea('ROJO', '40', 2)] };
const pB: Pedido = { id: 'B', nombre: 'Pedido B', fecha: '2026-10-20', lineas: [linea('X1', '42', 4), linea('Y9', '38', 1, 50000)] };

describe('control de facturas contra pedidos', () => {
  it('factura completa de un pedido: OK, talles deducidos y cuentas bien', () => {
    const r = analizarFacturas([pA, pB], [factura('1', '2026-10-05', [ren('X1', 5), ren('ROJO', 2)])]);
    const f = r.facturas[0];
    expect(f.estado).toBe('ok');
    expect(f.pedidoPrincipal).toBe('A');
    expect(f.checklist[0].talles).toEqual([{ talle: '40', cantidad: 2 }, { talle: '41', cantidad: 3 }]);
    expect(r.pendientes.filter((x) => x.pedidoId === 'A').every((x) => x.pendiente === 0)).toBe(true);
  });

  it('entrega parcial: talle a confirmar y pendiente sin talle', () => {
    const r = analizarFacturas([pA], [factura('1', '2026-10-05', [ren('X1', 3)])]);
    expect(r.facturas[0].checklist[0].talles).toBeNull();
    expect(r.facturas[0].checklist[0].nota).toMatch(/confirmar/);
    expect(r.pendientes.find((x) => x.codigo === 'X1')!.pendiente).toBeNull();
    expect(r.pendientes.find((x) => x.codigo === 'ROJO')!.pendiente).toBe(2);
  });

  it('facturado sin pedir, acumulado entre facturas y valorizado con impuestos', () => {
    const r = analizarFacturas([pA], [factura('1', '2026-10-05', [ren('ROJO', 1)]), factura('2', '2026-10-09', [ren('ROJO', 3)])]);
    const f2 = r.facturas[1];
    expect(f2.renglones[0].sinPedir).toBe(2);
    expect(f2.totalSinPedirNeto).toBe(120000);
    expect(f2.totalSinPedirConImpuestos).toBe(Math.round(120000 * 1.32 * 100) / 100);
    expect(f2.estado).toBe('revisar');
    expect(reporteReclamo(f2)).toMatch(/sin pedido 2 unidades/);
  });

  it('otro color con el mismo precio NO cubre lo pedido', () => {
    const r = analizarFacturas([pA], [factura('1', '2026-10-05', [ren('AZUL', 2)])]);
    expect(r.facturas[0].renglones[0].sinPedir).toBe(2);
    expect(r.facturas[0].checklist[0].nota).toMatch(/otro color/);
  });

  it('una factura que cubre dos pedidos y adelanta del posterior; refacturar es doble cobro', () => {
    const r = analizarFacturas([pA, pB], [
      factura('1', '2026-10-21', [ren('X1', 9)]),
      factura('2', '2026-10-25', [ren('X1', 4)]),
    ]);
    const f1 = r.facturas[0];
    expect(f1.renglones[0].asignaciones).toEqual([{ pedidoId: 'A', cantidad: 5, adelanto: false }, { pedidoId: 'B', cantidad: 4, adelanto: true }]);
    expect(f1.motivos.join(' ')).toMatch(/ADELANTO/);
    const f2 = r.facturas[1];
    expect(f2.renglones[0].sinPedir).toBe(4);
    expect(f2.renglones[0].posibleDobleCobro).toBe(true);
  });

  it('precio contra la lista DEL PEDIDO asignado, en ambos sentidos', () => {
    const r = analizarFacturas([pA, pB], [factura('1', '2026-10-21', [ren('Y9', 1, 55000), ren('ROJO', 2, 100000, 45)])]);
    const [y9, rojo] = r.facturas[0].renglones;
    expect(y9.difPrecio[0].diferencia).toBe(3000);
    expect(rojo.difPrecio[0].diferencia).toBe(-10000);
  });

  it('control aritmético detecta IVA y total mal', () => {
    const f = factura('1', '2026-10-05', [ren('X1', 5)]);
    f.iva += 10; f.total += 10;
    const r = analizarFacturas([pA], [f]);
    expect(r.facturas[0].aritmetica.errores.some((e) => /IVA/.test(e))).toBe(true);
  });

  it('formato argentino y mensaje de pagos', () => {
    expect(fmt(1234567.891)).toBe('$ 1.234.567,89');
    expect(numero('63,982.40')).toBe(63982.4);
    expect(numero('8.837.577,37')).toBe(8837577.37);
    const r = analizarFacturas([pA], [factura('1', '2026-10-05', [ren('X1', 5), ren('ROJO', 2)])]);
    expect(mensajePagos(r.facturas[0])).toMatch(/✅ OK: pedido/);
  });

  it('pedido Excel: packs pasan a pares con precio por par', () => {
    const filas = [
      ['SKU', 'Modelo color', 'Descripción del artículo', 'UDM', 'Mayorista', 'Descuento', 'Mayorista con descuento', 'Pedido'],
      ['RBK1-10', 'RBK1', 'NANO - 43', 'Pares', 63982.4, 40, 1, 2],
      ['RBK2---M12 4/7.5 (1)', 'RBK2', 'NANO COURT - M12', 'Pack de 12 Unidades', 991729.14, 40, 1, 3],
      ['RBK3-10', 'RBK3', 'NANO - 44', 'Pares', 63982.4, 40, 1, null],
    ];
    const { pedido } = leerPedidoExcel(filas, 'p', 'pedido', '2026-11-05');
    expect(pedido.lineas).toHaveLength(2);
    expect(pedido.lineas[0].talle).toBe('43');
    expect(pedido.lineas[1].cantidad).toBe(36);
    expect(pedido.lineas[1].precioLista).toBeCloseTo(82644.095, 3);
  });
});

describe('pedido de iD (talles en columnas)', () => {
  it('lee código, talles por nombre de columna, precio y bonificación', () => {
    const filas = [
      ['Pedido N° 00002538'],
      [],
      ['Código', 'Descripción', 'Color', '075', '080', '035', 'S', 'Total', 'Precio unit.', 'Bonif. %'],
      ['A15621C', 'CHUCK 70', 'NEGRO', 2, '', 1, '', 3, 53422.46, 10],
      ['10025', 'TEE', 'BLANCO', '', '', '', 4, 4, 20000, 10],
      ['A1', 'X', 'Y', '', '', '', '', 0, 1000, 10],
    ];
    const r = leerPedidoAuto(filas, 'p', 'pedido', '2026-11-01');
    expect(r.proveedor).toBe('id');
    expect(r.nroProveedor).toBe('00002538');
    expect(r.pedido.lineas.map((l) => `${l.codigo} ${l.talle} ${l.cantidad}`)).toEqual(['A15621C 075 2', 'A15621C 035 1', '10025 S 4']);
    expect(r.pedido.lineas[0].descuento).toBe(10);
    expect(r.avisos).toEqual([]);
  });

  it('avisa si los talles no suman el total', () => {
    const filas = [['Código', 'Color', '075', 'Total', 'Precio unit.'], ['A1', 'N', 2, 5, 100]];
    expect(leerPedidoId(filas, 'p', 'pedido', '2026-11-01').avisos.join(' ')).toMatch(/suman 2/);
  });
});

describe('semáforo, estado de pedidos y recepción', () => {
  it('semáforo, pedidos completos y diferencias del depósito', () => {
    const ped = { id: 'P1', nombre: 'P1', fecha: '2026-10-01', lineas: [
      { sku: 'A-40', codigo: 'A', descripcion: 'a', talle: '40', unidadesPorUdm: 1, precioLista: 100, descuento: 10, cantidad: 2 },
      { sku: 'A-41', codigo: 'A', descripcion: 'a', talle: '41', unidadesPorUdm: 1, precioLista: 100, descuento: 10, cantidad: 1 },
    ] };
    const fac = { id: 'F1', numero: '1', fecha: '2026-10-05', renglones: [{ codigo: 'A', descripcion: 'a', precioUnitario: 100, bonificacion: 10, cantidad: 3, total: 270 }],
      subtotal: 270, iva: 56.7, percepcionCaba: 13.5, percepcionBsAs: 16.2, total: 356.4 };
    const r = analizarFacturas([ped], [fac]);
    expect(r.facturas[0].semaforo).toBe('ok');
    expect(r.facturas[0].pedidosCompletos).toBe(true);
    expect(mensajePagos(r.facturas[0], 'contado 7% desc')).toMatch(/3 pares, total \$ 356,40, sin vencimiento, completa\.\nRecordar: contado 7% desc\./);
    expect(resumenPedidos([ped], r)[0].estado).toBe('completo');
    const rec = compararRecepcion(r.facturas[0].checklist, { recibido: { 'A|40': 2, 'A|41': 0 }, extras: [{ codigo: 'B', talle: '41', cantidad: 1 }] });
    expect(rec.ok).toBe(false);
    expect(rec.filas.filter((f) => f.diferencia).map((f) => `${f.codigo} ${f.talle} ${f.diferencia}`)).toEqual(['A 41 -1', 'B 41 1']);
  });

  it('código que no está en ningún pedido sugiere cargar pedido y va a reclamar', () => {
    const fac = { id: 'F1', numero: '1', fecha: '2026-10-05', renglones: [{ codigo: 'Z', descripcion: 'z', precioUnitario: 100, bonificacion: 0, cantidad: 1, total: 100 }],
      subtotal: 100, iva: 21, percepcionCaba: 0, percepcionBsAs: 0, total: 121 };
    const r = analizarFacturas([], [fac]);
    expect(r.facturas[0].semaforo).toBe('reclamar');
    expect(r.facturas[0].motivos.join(' ')).toMatch(/falta cargar un pedido/);
  });
});
