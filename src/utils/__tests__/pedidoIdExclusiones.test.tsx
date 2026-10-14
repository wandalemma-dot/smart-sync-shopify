import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import ExclusionPedidoId from '../../ExclusionPedidoId';
import { analizarExclusionId, cruzarPedido, generarExcelPedido, leerPendientesId, leerPlantillaId, motivosExclusionOrden } from '../pedidoId';
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../shopify', async original => ({ ...await original<typeof import('../shopify')>(), shopifyGraphQL: api }));
const conn = (nodes: any[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const filtro = { excluirTags: ['pedido id', 'solucionar'], estadosPago: ['PAID'] };
function plantilla() {
  const s = XLSX.utils.aoa_to_sheet([['UUID'], ['Foto', 'Artículo', 'Color', 'Precio', '', 'L', 'Unidades'],
    ['', 'LTN0224101', '', 100, 'Disponible', 3], ['', 'REMERA', '', '', 'Cantidad', 7]]);
  const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, s, 'Plantilla');
  return leerPlantillaId(new Uint8Array(XLSX.write(w, { type: 'array', bookType: 'xlsx' })));
}
function simular(patch: Record<string, unknown> = {}, status = 'OPEN') {
  api.mockImplementation(async (q: string, v: any) => {
    if (q.includes('PedidoIdPermisos')) return { currentAppInstallation: { accessScopes: [{ handle: 'read_merchant_managed_fulfillment_orders' }] } };
    if (q.includes('PedidoIdOrder')) return { order: { name: '#209869', displayFinancialStatus: 'PAID', closed: false, cancelledAt: null, tags: ['id', 'solucionar'], ...patch,
      fulfillmentOrders: conn([
        { id: 'id-fo', status, assignedLocation: { name: 'ID (Converse - Le Coq Sportif)' } },
        { id: 'd-fo', status: 'OPEN', assignedLocation: { name: 'DISTRINANDO SA (Reebok - Kappa)' } },
      ]) } };
    expect(v.id).toBe('id-fo');
    return { fulfillmentOrder: { lineItems: conn([{ id: 'l1', remainingQuantity: 1, lineItem: { title: 'Remera Le Coq', sku: 'ltn0224101-L', variantTitle: 'L', product: { vendor: 'Le Coq Sportif', tags: [] } } }]) } };
  });
}
beforeEach(() => { api.mockReset(); });
describe('exclusiones con causas precisas y análisis independiente', () => {
  it('pagada con solucionar informa solo la etiqueta, y se renderiza en una fila de la tabla', async () => {
    simular(); const p = await leerPendientesId(['gid://shopify/Order/1']);
    expect(p.exclusiones).toHaveLength(1);
    expect(p.exclusiones[0]).toMatchObject({ orden: '#209869', pago: 'Pagado', motivo: 'Etiqueta «solucionar»', alcance: 'orden' });
    expect(p.avisos.join(' ')).not.toMatch(/cancelada|cerrada|no admitido|pedido id/);
    expect(p.lineas).toEqual([]);
    const html = renderToStaticMarkup(<table><tbody><ExclusionPedidoId exclusion={p.exclusiones[0]} plantilla={plantilla()} /></tbody></table>);
    expect(html).toContain('<tr'); expect(html).toContain('#209869'); expect(html).toContain('Pagado');
    expect(html).toContain('solucionar'); expect(html).toContain('Analizar por separado');
  });
  it.each([
    [{ cancelledAt: '2026-10-14' }, 'Orden cancelada'],
    [{ closed: true }, 'Orden archivada/cerrada'],
    [{ displayFinancialStatus: 'PENDING' }, 'Estado de pago no admitido para esta compra: Pago pendiente'],
    [{ tags: [' PEDIDO ID '] }, 'Etiqueta «pedido id»'],
  ])('explica solo la causa presente %j', (patch, motivo) => {
    expect(motivosExclusionOrden({ displayFinancialStatus: 'PAID', tags: [], ...patch }, filtro)).toEqual([motivo]);
  });
  it('muestra todas las causas reales y conserva pago como dato separado', () => {
    expect(motivosExclusionOrden({ displayFinancialStatus: 'PAID', closed: true, tags: ['solucionar', 'pedido id'] }, filtro))
      .toEqual(['Orden archivada/cerrada', 'Etiqueta «pedido id»', 'Etiqueta «solucionar»']);
    expect(motivosExclusionOrden({ displayFinancialStatus: 'PAID', tags: ['id'] }, filtro)).toEqual([]);
  });
  it('la revisión separada lee solo pendientes iD y no altera las líneas ni el Excel principal', async () => {
    simular(); const plantillaId = plantilla();
    const principal = await leerPendientesId(['gid://shopify/Order/1']);
    const antes = JSON.stringify(principal);
    const revision = await analizarExclusionId(principal.exclusiones[0].ordenId, plantillaId);
    expect(revision.filas[0]).toMatchObject({ codigo: 'LTN0224101', necesaria: 1, disponible: 3, pedir: 1 });
    expect(revision.avisos.join(' ')).toContain('Etiqueta «solucionar»');
    expect(JSON.stringify(principal)).toBe(antes);
    const excel = XLSX.read(generarExcelPedido(plantillaId, cruzarPedido(principal.lineas, plantillaId)), { type: 'array' });
    expect(excel.Sheets.Plantilla.F4.v).toBe(0);
    expect(api.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  it('la revisión vuelve a consultar Shopify y detecta que ya no hay exclusión', async () => {
    simular({ tags: [] }); const r = await analizarExclusionId('order', plantilla());
    expect(r.avisos).toEqual([]); expect(r.filas).toHaveLength(1);
  });
  it('una preparación cerrada nunca aporta cantidades ni se presenta como falta de pago', async () => {
    simular({ tags: [] }, 'CLOSED');
    const p = await leerPendientesId(['order']);
    expect(p.lineas).toEqual([]);
    expect(p.exclusiones[0]).toMatchObject({ pago: 'Pagado', alcance: 'preparacion' });
    expect(p.exclusiones[0].motivo).toContain('CLOSED');
    const r = await analizarExclusionId('order', plantilla()); expect(r.filas).toEqual([]);
  });
  it('fallos de lectura no se presentan como ausencia de artículos', async () => {
    api.mockRejectedValue(new Error('Sin conexión'));
    await expect(analizarExclusionId('order', plantilla())).rejects.toThrow('Sin conexión');
  });
});
