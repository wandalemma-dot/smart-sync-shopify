import { describe, it, expect } from 'vitest';
import { claveTalle, entranteDe, entrantesPorTalle, excelSinLeer, textoEntrante, type DatosEntrantes } from '../entrantesId';
import type { Factura, Pedido, RenglonFactura } from '../controlFacturas';

const linea = (codigo: string, talle: string, cantidad: number, extra: object = {}) =>
  ({ sku: `${codigo}-${talle}`, codigo, descripcion: codigo, talle, unidadesPorUdm: 1, precioLista: 1000, descuento: 10, cantidad, ...extra });
const ren = (codigo: string, cantidad: number): RenglonFactura =>
  ({ codigo, descripcion: codigo, precioUnitario: 1000, bonificacion: 10, cantidad, total: 900 * cantidad });
function factura(id: string, fecha: string, renglones: RenglonFactura[]): Factura {
  const subtotal = renglones.reduce((s, r) => s + r.total, 0);
  const iva = Math.round(subtotal * 21) / 100, caba = Math.round(subtotal * 5) / 100, bsas = Math.round(subtotal * 6) / 100;
  return { id, numero: `0011-${id}`, fecha, renglones, subtotal, iva, percepcionCaba: caba, percepcionBsAs: bsas, total: subtotal + iva + caba + bsas };
}
const datos = (pedidos: (Pedido & { origen?: string })[], facturas: Factura[] = [], tarjetasTrello: DatosEntrantes['tarjetasTrello'] = {}): DatosEntrantes =>
  ({ pedidos, facturas, asignaciones: {}, remitos: {}, tarjetasTrello });
const HOY = '2026-11-13';
const TARJ = 'a'.repeat(24), VIEJA = 'b'.repeat(24);

describe('entrantes del armado de pedido iD', () => {
  it('suma lo pedido y no llegado por código y talle del proveedor, entre notas', () => {
    const m = entrantesPorTalle(datos([
      { id: 'T-1', nombre: 'CONVERSE PEDIDO el 1/11', fecha: '2026-11-01', lineas: [linea('166695C', '055', 2), linea('166695C', '060', 1)], origen: `trello:${TARJ}` },
      { id: 'T-2', nombre: 'CONVERSE PEDIDO el 3/11', fecha: '2026-11-03', nroProveedor: '2601', lineas: [linea('166695C', '055', 1)], origen: `trello:${TARJ}` },
    ], [], { [TARJ]: { pendiente: true, visto: true, fuera: '', lista: 'PEDIDOS PENDIENTES' } }), HOY);
    const e = entranteDe(m, '166695C', '055')!;
    expect(e.cantidad).toBe(3);
    expect(e.notas.map((n) => n.nombre)).toEqual(['CONVERSE PEDIDO el 1/11', 'N° 2601']);
    expect(entranteDe(m, '166695C', '060')!.cantidad).toBe(1);
    expect(entranteDe(m, '166695C', '065')).toBeNull();
    expect(entranteDe(m, '156991C', '055')).toBeNull();
  });

  it('descuenta lo facturado (código completo) y lo pintado en verde', () => {
    const m = entrantesPorTalle(datos([
      { id: 'A', nombre: 'A', fecha: '2026-11-01', lineas: [linea('X1', '055', 2), linea('Y1', 'XL', 2, { entregado: 1, entregadoDesde: '2026-11-05' }), linea('Y1', 'L', 1)] },
    ], [factura('1', '2026-11-05', [ren('X1', 2)])]), HOY);
    expect(entranteDe(m, 'X1', '055')).toBeNull();
    expect(entranteDe(m, 'Y1', 'XL')!.cantidad).toBe(1);
    expect(entranteDe(m, 'Y1', 'L')!.cantidad).toBe(1);
  });

  it('factura parcial de un modelo sin talles: queda «a confirmar», nunca se inventa el talle', () => {
    const m = entrantesPorTalle(datos([
      { id: 'A', nombre: 'A', fecha: '2026-11-01', lineas: [linea('X1', '055', 2), linea('X1', '060', 2)] },
    ], [factura('1', '2026-11-05', [ren('X1', 1)])]), HOY);
    const e = entranteDe(m, 'X1', '055')!;
    expect(e.cantidad).toBe(0);
    expect(e.aConfirmar).toBe(2);
    expect(textoEntrante(e)).toBe('hasta 2 (a confirmar)');
  });

  it('las notas de tarjetas que salieron de las listas de pendientes no cuentan', () => {
    const m = entrantesPorTalle(datos([
      { id: 'T-9', nombre: 'viejo', fecha: '2026-10-01', lineas: [linea('X1', '055', 5)], origen: `trello:${VIEJA}` },
    ], [], { [VIEJA]: { pendiente: false, visto: true, fuera: '2026-11-02', lista: 'ENTREGADOS' } }), HOY);
    expect(entranteDe(m, 'X1', '055')).toBeNull();
  });

  it('talles: 055 = 55, letras en mayúsculas; código con O y 0 iguales', () => {
    expect(claveTalle(' 055 ')).toBe('55');
    expect(claveTalle('xl')).toBe('XL');
    const m = entrantesPorTalle(datos([{ id: 'A', nombre: 'A', fecha: '2026-11-01', lineas: [linea('CTO0225001', 'xl', 1)] }]), HOY);
    expect(entranteDe(m, 'CTO0225001', 'XL')!.cantidad).toBe(1);
    expect(textoEntrante(null)).toBe('—');
  });

  it('avisa los Excel de tarjetas pendientes que la app todavía no leyó', () => {
    const tarjetas = [
      { id: TARJ, nombre: 'CONVERSE PEDIDO el 3/11', idLista: 'L1', adjuntos: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }] },
      { id: VIEJA, nombre: 'otra lista', idLista: 'L9', adjuntos: [{ id: 'z' }] },
    ];
    const pedidos = [{ id: 'T-x1', nombre: 'n', fecha: '2026-11-03', lineas: [], copias: [{ tarjeta: TARJ, adjunto: 'x2', fecha: '' }] }];
    expect(excelSinLeer(tarjetas, new Set(['L1']), pedidos, {})).toEqual([{ tarjeta: 'CONVERSE PEDIDO el 3/11', excel: 1 }]);
    expect(excelSinLeer(tarjetas, new Set(['L1']), pedidos, { x3: {} })).toEqual([]);
  });
});

describe('entrantes en Reposición: talle de pedido → columna de la nota', () => {
  it('Converse US × 10, Le Coq EU tal cual, letras sin cambio, sin talle → null', async () => {
    const { talleNotaDe } = await import('../entrantesId');
    expect(talleNotaDe('converse', '4.5')).toBe('45');
    expect(talleNotaDe('converse', '10')).toBe('100');
    expect(talleNotaDe('lecoq', '40')).toBe('40');
    expect(talleNotaDe('converse', 'XL')).toBe('XL');
    expect(talleNotaDe('converse', null)).toBeNull();
    const m = entrantesPorTalle(datos([{ id: 'A', nombre: 'A', fecha: '2026-11-01', lineas: [linea('A08258C', '055', 2), linea('LFO1', '040', 1)] }]), HOY);
    expect(entranteDe(m, 'A08258C', talleNotaDe('converse', '5.5')!)!.cantidad).toBe(2);
    expect(entranteDe(m, 'LFO1', talleNotaDe('lecoq', '40')!)!.cantidad).toBe(1);
  });
});
