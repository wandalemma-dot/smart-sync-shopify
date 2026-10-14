import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { cruzarPedido, detectarPedidosMixtos, generarExcelPedido, leerPendientesId, leerPendientesSucursal, leerPlantillaId, LINES_QUERY } from '../pedidoId';
import type { PendienteId } from '../pedidoId';
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../shopify', async original => ({ ...await original<typeof import('../shopify')>(), shopifyGraphQL: api }));
const linea = (id: string, vendor: string, extra: Partial<PendienteId> = {}): PendienteId => ({
  id, vendor, orden: '#100', titulo: 'Artículo', sku: vendor === 'Converse' ? 'CTO0226102' : 'LAN0122016P',
  tags: [], talle: 'M', cantidad: 1, ...extra,
});
const c = linea('c', 'Converse');
const l = linea('l', 'Le Coq Sportif');
const conn = (nodes: any[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: !!next, endCursor: next } });
const fo = (id: string, name = 'ID (Converse - Le Coq Sportif)', status = 'OPEN') => ({ id, status, assignedLocation: { name } });
const item = (l: PendienteId) => ({ id: l.id, remainingQuantity: l.cantidad, lineItem: { title: l.titulo, sku: l.sku, variantTitle: l.talle, product: { vendor: l.vendor, tags: l.tags } } });
function simular(tags: string[] = [], martinez = false) {
  api.mockImplementation(async (q: string, v: any) => {
    if (q.includes('PedidoIdPermisos')) return { currentAppInstallation: { accessScopes: [{ handle: 'read_merchant_managed_fulfillment_orders' }] } };
    if (q.includes('PedidoIdOrder')) return { order: { name: '#100', tags, displayFinancialStatus: 'PAID', fulfillmentOrders: conn(v.after ? [fo('lecoq', martinez ? 'DEPOSITO MARTINEZ' : undefined)] : [fo('converse')], v.after ? null : 'fo-next') } };
    return { fulfillmentOrder: { lineItems: v.id === 'converse' ? conn(v.after ? [item(c), item(linea('agotada', 'Le Coq', { cantidad: 0 }))] : [item(c)], v.after ? null : 'line-next') : conn([item(l)]) } };
  });
}
function plantilla() {
  const s = XLSX.utils.aoa_to_sheet([
    ['UUID'], ['Foto', 'Artículo', 'Color', 'Precio', '', 'M', 'Unidades', 'Importe'],
    ['', 'CTO0226102', '', 100, 'Disponible', 10], ['', 'REMERA', '', '', 'Cantidad', 7],
  ]);
  const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, s, 'Plantilla');
  return leerPlantillaId(new Uint8Array(XLSX.write(w, { type: 'array', bookType: 'xlsx' })));
}
beforeEach(() => { api.mockReset(); });
describe('pedidos mixtos iD', () => {
  it('detecta por orden y vendor, aunque la otra marca no esté en la plantilla', () => {
    const mixtos = detectarPedidosMixtos([c, l, c]);
    expect(mixtos).toHaveLength(1); expect(mixtos[0].lineas).toHaveLength(2);
    expect(cruzarPedido([c, l], plantilla()).filas[1].motivo).toContain('Código no encontrado');
    expect(detectarPedidosMixtos([c, { ...l, orden: '#101' }])).toEqual([]);
    expect(detectarPedidosMixtos([c, { ...l, vendor: '', titulo: 'Le Coq' }])).toEqual([]);
    expect(detectarPedidosMixtos([c, { ...l, cantidad: 0 }])).toEqual([]);
  });
  it('pagina preparaciones y líneas; la mezcla se detecta después de leerlas todas', async () => {
    simular();
    const p = await leerPendientesId(['order', 'order']);
    expect(p.lineas.map(x => x.id)).toEqual(['c', 'l']);
    expect(detectarPedidosMixtos(p.lineas)).toHaveLength(1);
    expect(p.etiquetadas).toEqual([]);
    expect(api.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  it('no mezcla marcas de Martínez ni cantidades ya preparadas', async () => {
    simular([], true);
    const p = await leerPendientesId(['order']);
    expect(p.lineas).toHaveLength(1);
    expect(detectarPedidosMixtos(p.lineas)).toEqual([]);
    expect(api.mock.calls.some(([, v]) => v?.id === 'lecoq')).toBe(false);
  });
  it('pedido id permite advertir la mezcla, pero nunca suma unidades al Excel', async () => {
    simular([' PEDIDO ID ']);
    const p = await leerPendientesId(['order']);
    expect(p.lineas).toEqual([]); expect(p.etiquetadas).toHaveLength(2);
    expect(detectarPedidosMixtos(p.lineas, p.etiquetadas)[0]).toMatchObject({ orden: '#100', etiquetado: true });
    expect(cruzarPedido(p.lineas, plantilla()).filas).toEqual([]);
    expect(p.avisos.join(' ')).toContain('excluida del Excel');
    const out = XLSX.read(generarExcelPedido(plantilla(), cruzarPedido(p.lineas, plantilla())), { type: 'array' });
    expect(out.Sheets.Plantilla.F4.v).toBe(0);
  });
  it('solucionar sigue excluyendo sin consultar las líneas, incluso junto a pedido id', async () => {
    simular(['pedido id', 'solucionar']);
    const p = await leerPendientesId(['order']);
    expect(p.lineas).toEqual([]); expect(p.etiquetadas).toEqual([]);
    expect(api.mock.calls).toHaveLength(2);
  });
  it('sin revisión optativa de etiquetas conserva la exclusión del lector compartido', async () => {
    simular(['pedido distrinando']);
    const p = await leerPendientesSucursal(['order'], { ubicacion: 'DISTRINANDO SA (Reebok - Kappa)', etiqueta: 'DISTRINANDO', excluirTags: ['pedido distrinando'], estadosPago: ['PAID'], linesQuery: LINES_QUERY });
    expect(p.lineas).toEqual([]); expect(p.etiquetadas).toEqual([]);
    expect(api.mock.calls).toHaveLength(2);
  });
  it('destildar una línea no excluye el mismo producto de otra orden; recalcula el Excel', () => {
    const p = plantilla();
    const otras = [c, l, { ...c, id: 'c2', orden: '#101', cantidad: 2 }];
    const r = cruzarPedido(otras, p, [], 2, ['c']);
    expect(r.filas.find(f => f.codigo === c.sku)).toMatchObject({ necesaria: 2, pedir: 2, ordenes: ['#101'] });
    expect(detectarPedidosMixtos(otras)[0].orden).toBe('#100');
    const out = XLSX.read(generarExcelPedido(p, r), { type: 'array' });
    expect(out.Sheets.Plantilla.F4.v).toBe(2);
    expect(cruzarPedido(otras, p, [], 2, []).filas[0].pedir).toBe(3);
  });
  it('la advertencia de mezcla no reemplaza los motivos de faltantes', () => {
    const p = plantilla(); p.articulos[0].celdas[0].disponible = 0;
    const r = cruzarPedido([c, l], p);
    expect(detectarPedidosMixtos([c, l])).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ pedir: 0, faltante: 1, motivo: 'Sin stock en la plantilla.' });
    expect(r.filas[1].motivo).toContain('Código no encontrado');
  });
  it('una respuesta incompleta al revisar etiquetadas bloquea el resultado', async () => {
    simular(['pedido id']);
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (q, v) => q.includes('PedidoIdLines') ? { fulfillmentOrder: { lineItems: null } } : normal(q, v));
    await expect(leerPendientesId(['order'])).rejects.toThrow('respuesta completa');
  });
});
