import { describe, expect, it, vi } from 'vitest';
import { ordenesPendientesId, marcaDePlantilla, PENDIENTES_ID_QUERY } from '../pedidoId';

const conn = (nodes: any[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: !!next, endCursor: next } });
const fo = (id: number, vendor: string | string[], o: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  status: 'OPEN',
  order: { id: `gid://shopify/Order/${id}`, name: `#${id}`, cancelledAt: null, closed: false, displayFinancialStatus: 'PAID', tags: [], ...o },
  lineItems: { pageInfo: { hasNextPage: false }, nodes: [vendor].flat().map(v => ({ remainingQuantity: 1, lineItem: { product: { vendor: v } } })) },
  ...extra,
});
function shopify(paginas: any[][]) {
  const llamadas: any[] = [];
  const gql = vi.fn(async (q: string, v?: any) => {
    llamadas.push(v);
    if (q.includes('locations')) return { locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'DEPOSITO MARTINEZ' }, { id: 'gid://shopify/Location/92732457203', name: 'ID (Converse - Le Coq Sportif)' }] } };
    expect(q).toBe(PENDIENTES_ID_QUERY);
    const i = v.after ? Number(v.after) : 0;
    return { fulfillmentOrders: conn(paginas[i], i + 1 < paginas.length ? String(i + 1) : null) };
  });
  return { gql, llamadas };
}

describe('pedido iD: órdenes directo de Shopify (25-nov-2026)', () => {
  it('filtra como en Pedidos: marca, pagadas, sin «pedido id» ni «solucionar», sin preparar', async () => {
    const { gql, llamadas } = shopify([[
      fo(1, 'Le Coq Sportif'),
      fo(2, 'Converse'),
      fo(3, ['Converse', 'Le Coq Sportif']),
      fo(4, 'Le Coq Sportif', { tags: ['12/11', 'Pedido ID'] }),
      fo(5, 'Le Coq Sportif', { tags: ['solucionar'] }),
      fo(6, 'Le Coq Sportif', { displayFinancialStatus: 'PARTIALLY_PAID' }),
      fo(7, 'Le Coq Sportif', { closed: true }),
      fo(8, 'Le Coq Sportif', { cancelledAt: '2026-11-20' }),
      fo(9, 'Le Coq Sportif', {}, { status: 'ON_HOLD' }),
    ], [
      fo(1, 'Le Coq Sportif'),
      { ...fo(10, 'Le Coq Sportif'), lineItems: { pageInfo: { hasNextPage: false }, nodes: [{ remainingQuantity: 0, lineItem: { product: { vendor: 'Le Coq Sportif' } } }] } },
      { ...fo(11, 'Converse'), lineItems: { pageInfo: { hasNextPage: true }, nodes: [{ remainingQuantity: 1, lineItem: { product: { vendor: 'Converse' } } }] } },
    ]]);
    const r = await ordenesPendientesId('Le Coq', undefined, gql);
    expect(r.ids).toEqual(['gid://shopify/Order/1', 'gid://shopify/Order/3', 'gid://shopify/Order/11']);
    expect(r).toMatchObject({ pedidoId: 1, solucionar: 1, sinPagar: 1 });
    expect(llamadas[1]).toEqual({ q: 'assigned_location_id:92732457203', after: null });
    expect(llamadas[2].after).toBe('1');
  });
  it('Converse toma las suyas', async () => {
    const { gql } = shopify([[fo(1, 'Le Coq Sportif'), fo(2, 'Converse'), fo(3, ['Converse', 'Le Coq Sportif'])]]);
    expect((await ordenesPendientesId('Converse', undefined, gql)).ids).toEqual(['gid://shopify/Order/2', 'gid://shopify/Order/3']);
  });
  it('sin la sucursal de iD no adivina', async () => {
    const gql = vi.fn(async () => ({ locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'DEPOSITO MARTINEZ' }] } }));
    await expect(ordenesPendientesId('Le Coq', undefined, gql)).rejects.toThrow(/No encontré la sucursal/);
  });
  it('una respuesta incompleta corta la lectura', async () => {
    const gql = vi.fn(async (q: string) => q.includes('locations')
      ? { locations: { nodes: [{ id: 'gid://shopify/Location/9', name: 'ID (Converse - Le Coq Sportif)' }] } }
      : { fulfillmentOrders: null });
    await expect(ordenesPendientesId('Le Coq', undefined, gql)).rejects.toThrow(/respuesta completa/);
  });
  it('reconoce la marca de la plantilla por los códigos', () => {
    const a = (codigo: string) => ({ codigo, nombre: '', row: 0, celdas: [], pack: 1 });
    expect(marcaDePlantilla({ articulos: [a('LFN9924029'), a('LAN0122012P'), a('A10548C')] })).toBe('Le Coq');
    expect(marcaDePlantilla({ articulos: [a('A10548C'), a('157197C'), a('CTO0226102')] })).toBe('Converse');
    expect(marcaDePlantilla({ articulos: [] })).toBeNull();
  });
});

describe('pantalla del armado iD', () => {
  it('ya no pide el CSV: elige la marca y deja el CSV de respaldo', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { default: PedidoId } = await import('../../PedidoId');
    const html = renderToString(createElement(PedidoId));
    expect(html).toContain('se leen directo de Shopify');
    expect(html).toContain('Le Coq');
    expect(html).toContain('Converse');
    expect(html).toContain('Prefiero subir un export de órdenes (.csv)');
    expect(html).not.toContain('aria-label="Export de órdenes"');
  });
});
