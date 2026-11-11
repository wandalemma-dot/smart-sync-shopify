// Registro de cargas en Shopify (11-nov-2026, pedido de gax): agrupar, buscar y armar el Excel.
import { describe, it, expect } from 'vitest';
import {
  accionRegistro, agruparRegistro, enlaceShopify, estadoRegistro, filasExcel, filtrarRegistro, horaAr, textoFactura,
  type EventoRegistro,
} from '../registroCargas';

const ev = (x: Partial<EventoRegistro>): EventoRegistro => ({
  tipo: 'carga', hora: '2026-11-11T19:20:55.000Z', proveedor: 'family', entregaId: 'E1', codigo: 'SHBSPEC',
  entrega: { fecha: '2026-10-30', nombre: 'Planilla (foto)' }, remito: '0001-00002715', factura: '', estado: 'cargada',
  accion: 'alta', titulo: 'Bermuda Short Familyarg Spectrum Basket Negro Multi', productoId: 'gid://shopify/Product/15571634946291',
  unidades: 20, talles: [{ talle: 'S', cantidad: 2 }, { talle: 'XXL', cantidad: 4 }], ...x,
});

const EVENTOS: EventoRegistro[] = [
  ev({}),
  ev({ hora: '2026-11-11T19:20:58.000Z', codigo: 'GSKPT23', titulo: 'Pantalon Familyarg Garage', unidades: 10, productoId: 'gid://shopify/Product/15571635142899' }),
  ev({ hora: '2026-11-11T20:05:00.000Z', entregaId: 'E2', codigo: 'BFRMCPC29', titulo: 'Remera Familyarg Panchart Cry Ladrillo', remito: '0001-00002716', entrega: { fecha: '2026-11-10', nombre: 'Planilla (foto)' }, unidades: 8 }),
  ev({ tipo: 'liberada', hora: '2026-11-11T21:00:00.000Z', entregaId: 'E2', codigo: 'BFRMCPC29', remito: '0001-00002716', entrega: { fecha: '2026-11-10', nombre: '' }, estado: 'dudosa', unidades: undefined, mensaje: 'Marca liberada a mano' }),
];

describe('Registro de cargas', () => {
  it('agrupa por entrega (la de actividad más nueva primero), con remito, factura y unidades cargadas', () => {
    const g = agruparRegistro(EVENTOS);
    expect(g.map((x) => x.entregaId)).toEqual(['E2', 'E1']);
    expect(g[1]).toMatchObject({ remito: '0001-00002715', unidades: 30, entrega: { fecha: '2026-10-30' } });
    expect(g[1].eventos.map((e) => e.codigo)).toEqual(['SHBSPEC', 'GSKPT23']);
    // La marca liberada no suma unidades; el nombre de la planilla no se pierde por un evento sin nombre.
    expect(g[0]).toMatchObject({ unidades: 8, entrega: { nombre: 'Planilla (foto)' } });
    expect(textoFactura('family', '')).toMatch(/no tiene \(Family no factura\)/);
    expect(textoFactura('id', '0011-00139953')).toBe('0011-00139953');
  });

  it('busca por código, producto, remito y fecha, sin importar mayúsculas ni acentos', () => {
    const g = agruparRegistro(EVENTOS);
    expect(filtrarRegistro(g, 'gskpt').flatMap((x) => x.eventos.map((e) => e.codigo))).toEqual(['GSKPT23']);
    expect(filtrarRegistro(g, '2716').map((x) => x.entregaId)).toEqual(['E2']);
    expect(filtrarRegistro(g, 'pantalón')).toHaveLength(1);
    expect(filtrarRegistro(g, '30/10/2026').map((x) => x.entregaId)).toEqual(['E1']);
    expect(filtrarRegistro(g, '  ')).toHaveLength(2);
    expect(filtrarRegistro(g, 'zzz')).toEqual([]);
  });

  it('hora de Argentina, enlace al producto en Shopify y textos de cada evento', () => {
    expect(horaAr('2026-11-11T19:20:55.000Z')).toBe('11/11/2026 16:20');
    expect(enlaceShopify('gid://shopify/Product/15571634946291')).toBe('https://admin.shopify.com/store/indy-com-ar/products/15571634946291');
    expect(enlaceShopify(undefined)).toBe('');
    expect(accionRegistro(EVENTOS[0])).toEqual(['🆕', 'Producto nuevo']);
    expect(accionRegistro(ev({ accion: 'reposicion' }))[1]).toBe('Reposición');
    expect(estadoRegistro(EVENTOS[3])[1]).toBe('Se puede cargar otra vez');
    expect(estadoRegistro(ev({ estado: 'dudosa' }))[1]).toMatch(/revisar en Shopify/);
  });

  it('el Excel: una fila por artículo, la más nueva primero, con remito, factura, talles y enlace', () => {
    const [enc, ...filas] = filasExcel(EVENTOS);
    expect(enc).toEqual(['Fecha y hora', 'Proveedor', 'Entrega del', 'Planilla', 'Remito', 'Factura', 'Código', 'Producto', 'Qué se hizo', 'Talles', 'Unidades', 'Estado', 'Detalle', 'Enlace a Shopify']);
    expect(filas).toHaveLength(4);
    expect(filas[0].slice(0, 7)).toEqual(['11/11/2026 18:00', 'Family', '10/11/2026', '', '0001-00002716', 'no tiene (Family no factura)', 'BFRMCPC29']);
    expect(filas[0][10]).toBe('');
    expect(filas[3]).toEqual([
      '11/11/2026 16:20', 'Family', '30/10/2026', 'Planilla (foto)', '0001-00002715', 'no tiene (Family no factura)', 'SHBSPEC',
      'Bermuda Short Familyarg Spectrum Basket Negro Multi', 'Producto nuevo', 'S:2 XXL:4', 20, 'Cargado', '',
      'https://admin.shopify.com/store/indy-com-ar/products/15571634946291',
    ]);
  });
});
