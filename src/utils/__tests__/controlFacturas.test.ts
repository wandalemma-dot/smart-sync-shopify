import { describe, it, expect } from 'vitest';
import { analizarFacturas, compararRecepcion, conImpuestos, fmt, huellaPedido, mensajePagos, mismoTalle, reporteReclamo, resumenPedidos } from '../controlFacturas';
import type { Factura, Pedido, RenglonFactura } from '../controlFacturas';
import { numero, leerFacturaId, leerPedidoExcel, leerPedidoAuto, leerPedidoId, leerTextoRemito, textoRemito } from '../lectoresFacturas';

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

describe('factura PDF de iD (FA 0011)', () => {
  // Misma disposición que la factura real: filas por altura, columnas por x. Datos de ejemplo.
  const fila = (y: number, celdas: [number, string][]) => celdas.map(([x, str]) => ({ str, transform: [1, 0, 0, 1, x, y] }));
  const items = [
    ...fila(800, [[279, 'A'], [447, 'Factura de Venta A']]),
    ...fila(790, [[249, 'Código Nº 01'], [451, '0011-00000001']]),
    ...fila(780, [[418, 'Fecha:'], [469, '05-11-26']]),
    ...fila(770, [[84, 'Inscripto'], [299, '30000000000'], [514, '30 DIAS']]),
    ...fila(700, [[38, 'Código'], [134, 'Descripción'], [362, 'Cantidad'], [452, 'Precio'], [537, 'Importe']]),
    ...fila(690, [[36, 'A1C'.padEnd(7, '0')], [129, 'CHUCK TAYLOR'], [394, '5'], [449, '63.903,74'], [507, '10%'], [533, '287.566,83']]),
    ...fila(680, [[35, 'A12975C'], [129, 'LIFT DOUBLE STACK'], [390, '17'], [449, '82.834,22'], [507, '10%'], [530, '1.267.363,5']]),
    ...fila(300, [[504, '$'], [519, '1.554.930,40']]),
    ...fila(290, [[33, 'Despachos:'], [101, '1'], [214, 'Comprobante Ref:'], [287, '00000002']]),
    ...fila(280, [[406, 'I.V.A Inscripto'], [505, '$'], [525, '326.535,38']]),
    ...fila(270, [[33, 'Cantidad total:'], [116, '22']]),
    ...fila(260, [[405, 'Perc. IIBB CABA'], [504, '$'], [532, '77.746,52']]),
    ...fila(250, [[400, 'Perc. IIBB BS.AS.'], [504, '$'], [533, '93.295,82']]),
    ...fila(240, [[504, '$']]),
    ...fila(230, [[505, '$'], [523, '2.052.508,12']]),
  ];

  it('lee renglones, totales, vencimiento y corrige importes cortados', () => {
    const { factura, avisos } = leerFacturaId([items], 'f');
    expect(avisos).toEqual([]);
    expect(factura.numero).toBe('0011-00000001');
    expect(factura.fecha).toBe('2026-11-05');
    expect(factura.vencimiento).toBe('2026-12-05');
    expect(factura.remito).toBe('00000002');
    expect(factura.renglones.map((r) => `${r.codigo} ${r.cantidad} ${r.precioUnitario} ${r.bonificacion} ${r.total}`))
      .toEqual(['A1C0000 5 63903.74 10 287566.83', 'A12975C 17 82834.22 10 1267363.57']);
    expect([factura.subtotal, factura.iva, factura.percepcionCaba, factura.percepcionBsAs, factura.total])
      .toEqual([1554930.4, 326535.38, 77746.52, 93295.82, 2052508.12]);
    const r = analizarFacturas([], [factura]);
    expect(r.facturas[0].aritmetica.errores).toEqual([]);
  });

  it('lista nueva sobre pedido viejo: avisa el aumento contra el precio del pedido', () => {
    const { factura } = leerFacturaId([items], 'f');
    const filas = [
      ['Pedido N° 00002538'],
      ['Imagen', 'Código', 'Descripción', 'Color', '055', '060', 'Total', 'Precio unit.', 'Subtotal', 'Bonif. %'],
      [null, 'A1C0000', 'CHUCK', '1', 2, 3, 5, 63903.74, 0, 10],
      [null, 'A12975C', 'LIFT', '1', 10, 7, 17, 80000, 0, 10],
      [null, null, 'TOTAL', null, 12, 10, 22],
    ];
    const { pedido } = leerPedidoAuto(filas, 'P', 'pedido', '2026-10-01');
    const r = analizarFacturas([pedido], [factura]);
    const f = r.facturas[0];
    expect(f.semaforo).toBe('reclamar');
    expect(f.renglones[1].difPrecio[0].diferencia).toBe(43363.57);
    expect(f.pedidosCompletos).toBe(true);
    expect(f.checklist[0].talles).toEqual([{ talle: '055', cantidad: 2 }, { talle: '060', cantidad: 3 }]);
  });
});

// ---------------------------------------------------------------------------
// 11-nov-2026: método de gax, remito y carga obligatoria de las tres partes.
// ---------------------------------------------------------------------------
describe('método de gax: otra nota, faltantes, precio y tolerancias', () => {
  const remitoDe = (f: Factura) => ({ numero: '', fecha: '', renglones: f.renglones.map((r) => ({ codigo: r.codigo, cantidad: r.cantidad, talles: [] })) });

  it('la fecha de la nota de iD sale de la fila 1', () => {
    const filas = [
      [null, 'Pedido N° 00002576', '2059 — ELEVE SAS', '27/10/2026'],
      ['Código', 'Color', '075', 'Total', 'Precio unit.'], ['A1', 'N', 2, 2, 100],
    ];
    const r = leerPedidoAuto(filas, 'p', 'pedido', '2026-11-11');
    expect(r.fechaArchivo).toBe('2026-10-27');
    expect(r.pedido.fecha).toBe('2026-10-27');
    expect(leerPedidoId([['Pedido N° 0001'], ['Código', '075', 'Total', 'Precio unit.'], ['A1', 1, 1, 100]], 'p', 'x', '2026-11-11').pedido.fecha).toBe('2026-11-11');
  });

  it('renglón de una nota anterior = OTRA NOTA; menos que lo pedido = FALTANTE (observaciones, no reclamo)', () => {
    const p471: Pedido = { id: '471', nroProveedor: '471', nombre: 'n', fecha: '2026-10-09', lineas: [linea('LFO0225061', '040', 2)] };
    // CASO 4 de gax: LFO0225061 no está en el 497 → se busca en las otras notas y está en el 471.
    const p497: Pedido = { id: '497', nroProveedor: '497', nombre: 'n', fecha: '2026-10-30', lineas: [linea('LFO0125084', '040', 9)] };
    const f = factura('1', '2026-11-05', [ren('LFO0225061', 2), ren('LFO0125084', 6)]);
    const r = analizarFacturas([p471, p497], [f], {}, { 1: remitoDe(f) }).facturas[0];
    expect(r.pedidoPrincipal).toBe('497');
    expect(r.renglones[0].otraNota).toEqual(['471']);
    expect(r.renglones[1].faltante).toBe(3);
    expect(r.renglones[1].pedidoCantidad).toBe(9);
    expect(r.motivos.join(' ')).toMatch(/OTRA NOTA: LFO0225061 \(2\) corresponde al pedido N° 471 del 09\/10\/2026, no al N° 497/);
    expect(r.motivos.join(' ')).toMatch(/FALTANTE: LFO0125084 \(pedido 9, facturado 6, faltan 3\)/);
    expect(r.semaforo).toBe('observaciones');
    expect(r.pendientePedidos.map((x) => `${x.pedidoId} ${x.codigo} ${x.pendiente}`).sort()).toEqual(['497 LFO0125084 3']);
  });

  it('precio mayor: reclamo con IVA 21% y percepciones 11% (×1,32), nota de crédito por el neto', () => {
    const ped: Pedido = { id: 'P', nombre: 'P', fecha: '2026-10-27', lineas: [linea('571818C', '050', 9, 69251.34, 10)] };
    const f = factura('1', '2026-11-04', [ren('571818C', 8, 74598.93, 10)]);
    const r = analizarFacturas([ped], [f], {}, { 1: remitoDe(f) }).facturas[0];
    expect(r.semaforo).toBe('reclamar');
    expect(r.totalDifPrecio).toBe(38502.65);
    expect(r.reclamo).toEqual({ neto: 38502.65, iva: 8085.56, percepciones: 4235.29, total: 50823.5 });
    expect(conImpuestos(94812.8, f).total).toBe(125152.9); // caso real 2576: neto $94.812,80 → $125.152,90
    expect(reporteReclamo(r, () => 'N° 2576')).toMatch(/en el pedido N° 2576[\s\S]*nota de crédito por \$ 38\.502,65 neto/);
  });

  it('precio más barato o diferencia de 2 centavos: no es reclamo', () => {
    const ped: Pedido = { id: 'P', nombre: 'P', fecha: '2026-10-27', lineas: [linea('A', '40', 1, 1000, 10), linea('B', '40', 1, 1000, 10)] };
    const f = factura('1', '2026-11-04', [ren('A', 1, 1000.02, 10), ren('B', 1, 900, 10)]);
    const r = analizarFacturas([ped], [f], {}, { 1: remitoDe(f) }).facturas[0];
    expect(r.renglones[0].difPrecio).toEqual([]);
    expect(r.renglones[1].difPrecio[0].diferencia).toBe(-90);
    expect(r.semaforo).toBe('observaciones');
    expect(r.reclamo.neto).toBe(0);
  });

  it('total con tolerancia de $1', () => {
    const f = factura('1', '2026-10-05', [ren('X1', 5)]);
    f.total += 0.8;
    expect(analizarFacturas([pA], [f]).facturas[0].aritmetica.errores).toEqual([]);
    f.total += 0.5;
    expect(analizarFacturas([pA], [f]).facturas[0].aritmetica.errores.join(' ')).toMatch(/Total/);
  });
});

describe('notas exactas de cada factura (11-nov-2026: «matchear exactas las que sí son»)', () => {
  const nota = (id: string, fecha: string, lineas: ReturnType<typeof linea>[]): Pedido => ({ id, nroProveedor: id, nombre: id, fecha, lineas });
  const cubiertas = (r: { pedidosCubiertos: string[] }) => [...r.pedidosCubiertos].sort();

  it('factura 0011-00139953: con muchas notas viejas en Trello usa solo la nota que la explica y la que tiene lo que falta', () => {
    // La nota del 1/11 tiene 7 de los 8 artículos; la del 9/9 («entra la indu») tiene 3, incluido el 8.º;
    // las tarjetas viejas que nunca se archivaron tienen sueltos los mismos artículos, con saldo.
    const real = nota('N1101', '2026-11-01', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((cod) => linea(cod, 'M', 4)));
    const indu = nota('N0909', '2026-09-09', [linea('C6', 'M', 2), linea('C7', 'M', 2), linea('C8', 'L', 9)]);
    const n1005 = nota('N1005', '2026-10-05', [linea('C8', 'L', 9), linea('C1', 'S', 3)]);
    const viejas = [
      nota('N0716', '2026-07-16', [linea('C1', 'S', 5), linea('C2', 'S', 5)]),
      nota('N0812', '2026-08-12', [linea('C3', 'S', 5)]),
      nota('N0904', '2026-09-04', [linea('C4', 'S', 5), linea('C5', 'S', 5)]),
      nota('N0907', '2026-09-07', [linea('C8', 'S', 9)]),
    ];
    const f = factura('1', '2026-11-06', [...['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((cod) => ren(cod, 4)), ren('C8', 9)]);
    const r = analizarFacturas([...viejas, indu, n1005, real], [f]).facturas[0];
    expect(r.pedidoPrincipal).toBe('N1101');
    expect(cubiertas(r)).toEqual(['N0909', 'N1101']);
    expect(r.renglones.every((x) => x.sinPedir === 0)).toBe(true);
    expect(r.renglones[7].otraNota).toEqual(['N0909']);
    expect(r.renglones.slice(0, 7).every((x) => x.asignaciones.length === 1 && x.asignaciones[0].pedidoId === 'N1101')).toBe(true);
    // Elegida a mano: se usa primero; lo demás sigue por la nota que más artículos tiene.
    const m = analizarFacturas([...viejas, indu, n1005, real], [f], { 1: ['N0907'] }).facturas[0];
    expect(m.pedidoPrincipal).toBe('N0907');
    expect(cubiertas(m)).toEqual(['N0907', 'N1101']);
  });

  it('el código que está en la nota principal se descuenta de ella, aunque una nota más vieja también lo tenga', () => {
    const p471 = nota('471', '2026-10-09', [linea('LFO0225061', '040', 2)]);
    const p497 = nota('497', '2026-10-30', [linea('LFO0125084', '040', 9), linea('LFO0225061', '041', 2)]);
    const res = analizarFacturas([p471, p497], [factura('1', '2026-11-05', [ren('LFO0225061', 2), ren('LFO0125084', 6)])]);
    const r = res.facturas[0];
    expect(r.pedidoPrincipal).toBe('497');
    expect(cubiertas(r)).toEqual(['497']);
    expect(r.renglones[0].otraNota).toEqual([]);
    expect(res.pendientes.find((x) => x.pedidoId === '471')!.pendiente).toBe(2);
  });

  it('lo que la nota principal no alcanza sale de otra nota anterior a la factura (la más vieja), nunca de una posterior', () => {
    const real = nota('REAL', '2026-11-01', [linea('X', '40', 2), linea('Y', '40', 1)]);
    const vieja = nota('VIEJA', '2026-07-16', [linea('X', '41', 1)]);
    const cercana = nota('CERCANA', '2026-10-20', [linea('X', '42', 1)]);
    const posterior = nota('POSTERIOR', '2026-11-20', [linea('X', '43', 5), linea('Y', '43', 5)]);
    const r = analizarFacturas([posterior, cercana, real, vieja], [factura('1', '2026-11-06', [ren('X', 3), ren('Y', 1)])]).facturas[0];
    expect(r.pedidoPrincipal).toBe('REAL');
    expect(r.renglones[0].asignaciones).toEqual([{ pedidoId: 'REAL', cantidad: 2, adelanto: false }, { pedidoId: 'VIEJA', cantidad: 1, adelanto: false }]);
    expect(r.renglones[0].otraNota).toEqual(['VIEJA']);
    // Una nota posterior a la factura se usa solo si ninguna anterior tiene saldo.
    const sola = analizarFacturas([vieja, posterior], [factura('1', '2026-11-06', [ren('X', 2)])]).facturas[0];
    expect(sola.renglones[0].asignaciones.map((a) => a.pedidoId)).toEqual(['VIEJA', 'POSTERIOR']);
  });

  it('una nota nueva (posterior a la factura) no se queda con una factura ya controlada', () => {
    const r = nota('R', '2026-11-01', [linea('A', 'M', 4), linea('B', 'M', 4)]);
    const o = nota('O', '2026-10-01', [linea('C', 'M', 1)]);
    const n = nota('N', '2026-11-20', [linea('A', 'M', 6), linea('B', 'M', 6), linea('C', 'M', 6)]);
    const f1 = factura('1', '2026-11-06', [ren('A', 4), ren('B', 4), ren('C', 1)]);
    const res = analizarFacturas([r, o, n], [f1, factura('2', '2026-11-25', [ren('A', 6), ren('B', 6), ren('C', 6)])]);
    expect(res.facturas[0].pedidoPrincipal).toBe('R');
    expect(cubiertas(res.facturas[0])).toEqual(['O', 'R']);
    expect(cubiertas(res.facturas[1])).toEqual(['N']);
    expect(res.facturas[1].motivos.join(' ')).not.toMatch(/OTRA NOTA/);
  });

  it('un resto de 1 unidad por artículo en una nota vieja no le gana a la nota que trae los artículos completos', () => {
    const cods = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    const resto = nota('RESTO', '2026-07-16', [...cods, 'C8'].map((cod) => linea(cod, 'S', 1)));
    const indu = nota('INDU', '2026-09-09', [linea('C8', 'L', 9)]);
    const real = nota('REAL', '2026-11-01', cods.map((cod) => linea(cod, 'M', 4)));
    const r = analizarFacturas([resto, indu, real], [factura('1', '2026-11-06', [...cods.map((cod) => ren(cod, 4)), ren('C8', 9)])]).facturas[0];
    expect(r.pedidoPrincipal).toBe('REAL');
    expect(cubiertas(r)).toEqual(['INDU', 'REAL']);
    expect(r.renglones.some((x) => x.asignaciones.some((a) => a.adelanto))).toBe(false);
  });

  it('dos notas iguales seguidas: va a la del mismo precio que la factura (y si no, a la más vieja)', () => {
    const n1 = nota('N1', '2026-10-01', [linea('A', 'M', 2, 100000), linea('B', 'M', 2, 100000)]);
    const n2 = nota('N2', '2026-10-05', [linea('A', 'M', 2, 110000), linea('B', 'M', 2, 110000)]);
    const res = analizarFacturas([n1, n2], [
      factura('1', '2026-10-07', [ren('A', 2, 110000), ren('B', 2, 110000)]),
      factura('2', '2026-10-09', [ren('A', 2, 100000), ren('B', 2, 100000)]),
    ]);
    expect(res.facturas.map((f) => f.pedidosCubiertos)).toEqual([['N2'], ['N1']]);
    expect(res.facturas.every((f) => f.renglones.every((x) => x.difPrecio.length === 0))).toBe(true);
    const igual = analizarFacturas([n2, n1], [factura('1', '2026-10-07', [ren('A', 2, 90000), ren('B', 2, 90000)])]).facturas[0];
    expect(igual.pedidoPrincipal).toBe('N1');
  });
});

describe('tres partes obligatorias y remito', () => {
  const ped: Pedido = { id: 'P', nombre: 'P', nroProveedor: '2576', fecha: '2026-10-27', lineas: [
    linea('571818C', '050', 1), linea('571818C', '060', 2), linea('571818C', '075', 3),
    linea('A12744C', '100', 2), linea('A12744C', '110', 2),
  ] };
  const f = factura('1', '2026-11-04', [ren('571818C', 6), ren('A12744C', 4)]);
  f.remito = '00125246';
  const rem = (texto: string) => ({ ...leerTextoRemito(texto).remito, origen: 'manual' as const });

  it('sin remito o sin ninguna nota: incompleta, no se paga', () => {
    const sinRemito = analizarFacturas([ped], [f], {}, {}).facturas[0];
    expect(sinRemito.semaforo).toBe('incompleta');
    expect(sinRemito.faltaRemito).toBe(true);
    expect(mensajePagos(sinRemito)).toMatch(/⏳ INCOMPLETA, NO PAGAR TODAVÍA/);
    const sinNota = analizarFacturas([], [f], {}, { 1: rem('571818C 6\nA12744C 4') }).facturas[0];
    expect(sinNota.semaforo).toBe('incompleta');
    expect(sinNota.faltaNota).toBe(true);
    expect(sinNota.motivos.join(' ')).toMatch(/falta la nota de pedido/);
    expect(sinNota.motivos.join(' ')).not.toMatch(/SIN PEDIR/);
    // Sin pasar remitos (compatibilidad): no se exige.
    expect(analizarFacturas([ped], [f]).facturas[0].semaforo).toBe('ok');
  });

  it('remito que coincide: OK, y el checklist del depósito usa sus talles', () => {
    const r = analizarFacturas([ped], [f], {}, { 1: rem('Remito 0016-00125246\n571818C 5.0/1 6.0/2 7.5/3\nA12744C 10.0/2 11.0/2') }).facturas[0];
    expect(r.semaforo).toBe('ok');
    expect(r.renglones.map((x) => x.remito)).toEqual([6, 4]);
    expect(r.checklist[0].talles).toEqual([{ talle: '5.0', cantidad: 1 }, { talle: '6.0', cantidad: 2 }, { talle: '7.5', cantidad: 3 }]);
  });

  it('la O y el 0 cuentan igual entre factura, nota y remito (factura 0011-00139953: CTN0225003O / CTN02250030)', () => {
    const pedO: Pedido = { id: 'P2', nombre: 'P2', fecha: '2026-11-01', lineas: [linea('CTN02250030', 'S', 2), linea('CTN02250030', 'M', 2), linea('CTO0226101', 'L', 1)] };
    const fO = factura('9', '2026-11-06', [ren('CTN0225003O', 4), ren('CTO0226101', 1)]);
    fO.remito = '00125274';
    const r = analizarFacturas([pedO], [fO], {}, { 9: rem('Remito 0013-00125274\nCTN02250030 4\nCT00226101 1') }).facturas[0];
    expect(r.renglones.map((x) => [x.codigo, x.sinPedir, x.remito])).toEqual([['CTN0225003O', 0, 4], ['CTO0226101', 0, 1]]);
    expect(r.difRemito).toEqual([]);
    expect(r.semaforo).toBe('ok');
  });

  it('remito con menos que la factura es reclamo; con más, observación; otro número, observación', () => {
    const menos = analizarFacturas([ped], [f], {}, { 1: rem('571818C 5.0/1 6.0/2 7.5/2\nA12744C 4') }).facturas[0];
    expect(menos.semaforo).toBe('reclamar');
    expect(menos.difRemito).toEqual([{ codigo: '571818C', factura: 6, remito: 5 }]);
    expect(reporteReclamo(menos)).toMatch(/571818C: facturaron 6 y el remito trae 5/);
    const mas = analizarFacturas([ped], [f], {}, { 1: rem('Remito 0016-00999999\n571818C 6\nA12744C 4\nZZZ999 1') }).facturas[0];
    expect(mas.semaforo).toBe('observaciones');
    expect(mas.motivos.join(' ')).toMatch(/llegó más de lo facturado: ZZZ999/);
    expect(mas.motivos.join(' ')).toMatch(/remito cargado es el 0016-00999999 y la factura dice 00125246/);
  });

  it('talle que no se pidió: observación', () => {
    const r = analizarFacturas([ped], [f], {}, { 1: rem('571818C 5.0/1 6.0/2 7.5/3\nA12744C 10.0/3 11.0/1') }).facturas[0];
    expect(r.tallesNoPedidos).toEqual([{ codigo: 'A12744C', talle: '10.0', llegaron: 3, pedidos: 2 }]);
    expect(r.semaforo).toBe('observaciones');
  });

  it('mismo talle escrito distinto (Converse US×10 y Le Coq)', () => {
    expect(mismoTalle('055', '5.5')).toBe(true);
    expect(mismoTalle('100', '10.0')).toBe(true);
    expect(mismoTalle('040', '40')).toBe(true);
    expect(mismoTalle('xl', 'XL')).toBe(true);
    expect(mismoTalle('055', '5')).toBe(false);
    expect(mismoTalle('S', 'M')).toBe(false);
  });

  it('remito en texto: talles, total sin talles, repetidos y errores', () => {
    const { remito, errores } = leerTextoRemito('Remito N° 0016-00125246\nFecha 04/11/2026\n571818C 5.0/1, 6.0 / 2\n571818C 5.0x1\nCAMP01 XLx2 2XL/1\nA10520C 3\nhola\nB123 7.5-2');
    expect(remito.numero).toBe('0016-00125246');
    expect(remito.fecha).toBe('2026-11-04');
    expect(remito.renglones).toEqual([
      { codigo: '571818C', cantidad: 4, talles: [{ talle: '5.0', cantidad: 2 }, { talle: '6.0', cantidad: 2 }] },
      { codigo: 'CAMP01', cantidad: 3, talles: [{ talle: 'XL', cantidad: 2 }, { talle: '2XL', cantidad: 1 }] },
      { codigo: 'A10520C', cantidad: 3, talles: [] },
      { codigo: 'B123', cantidad: 0, talles: [] },
    ]);
    expect(errores).toHaveLength(2);
    expect(textoRemito(remito).split('\n').slice(0, 3)).toEqual(['Remito 0016-00125246', 'Fecha 04/11/2026', '571818C 5.0/2 6.0/2']);
  });
});

describe('huellaPedido (notas de Trello borradas a mano, 11-nov-2026)', () => {
  it('la misma nota en otro orden da la misma huella; otra cantidad, otra huella', () => {
    const a = [{ sku: 'A13438C-055', cantidad: 4 }, { sku: 'CTO0325003-S', cantidad: 2 }];
    const b = [{ sku: 'CTO0325003-S', cantidad: 2 }, { sku: 'A13438C-055', cantidad: 4 }];
    expect(huellaPedido(a)).toBe(huellaPedido(b));
    expect(huellaPedido(a)).toMatch(/^[a-z0-9]{1,16}$/);
    expect(huellaPedido([{ sku: 'A13438C-055', cantidad: 5 }, { sku: 'CTO0325003-S', cantidad: 2 }])).not.toBe(huellaPedido(a));
  });
});
