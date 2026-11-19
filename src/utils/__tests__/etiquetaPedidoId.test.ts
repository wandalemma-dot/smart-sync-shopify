import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { leerPlantillaId, type PendienteId } from '../pedidoId';
import { etiquetarOrdenes, etiquetasPedidoId, hoyArgentina, numeroPedidoId, ordenesAEtiquetar } from '../etiquetaPedidoId';
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../shopify', async original => ({ ...await original<typeof import('../shopify')>(), shopifyGraphQL: api }));

// Plantilla con una remera Converse: M con 10 disponibles, L con 1 y XL sin stock.
function plantilla() {
  const s = XLSX.utils.aoa_to_sheet([
    ['UUID'], ['Foto', 'Artículo', 'Color', 'Precio', '', 'M', 'L', 'XL', 'Unidades', 'Importe'],
    ['', 'CTO0226102', '', 100, 'Disponible', 10, 1, '-'], ['', 'REMERA', '', '', 'Cantidad', 0, 0, 0],
  ]);
  const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, s, 'Plantilla');
  return leerPlantillaId(new Uint8Array(XLSX.write(w, { type: 'array', bookType: 'xlsx' })));
}
const linea = (id: string, orden: string, talle: string, extra: Partial<PendienteId> = {}): PendienteId => ({
  id, orden, ordenId: `gid://shopify/Order/${orden.slice(1)}`, titulo: 'Remera Converse', sku: 'CTO0226102', tags: [], talle, cantidad: 1, vendor: 'Converse', ...extra,
});
beforeEach(() => { api.mockReset(); });

describe('etiqueta «pedido id» al descargar', () => {
  it('etiqueta solo las órdenes que se piden completas', () => {
    const p = plantilla();
    const r = ordenesAEtiquetar([
      linea('a', '#1', 'M'),
      linea('b', '#2', 'M'), linea('c', '#2', 'XL'), // XL sin stock
      linea('d', '#3', 'L'), linea('e', '#4', 'L'), // L: 1 disponible para 2 órdenes
      linea('f', '#5', 'M', { vendor: 'Le Coq Sportif', sku: 'LAN0122016P', titulo: 'Medias' }), // otra plantilla
      linea('g', '#6', 'M'),
    ], p, ['g']);
    expect(r.etiquetar).toEqual([{ orden: '#1', ordenId: 'gid://shopify/Order/1' }]);
    const motivos = Object.fromEntries(r.noEtiquetar.map(o => [o.orden, o.motivos.join(' | ')]));
    expect(motivos['#2']).toContain('XL');
    expect(motivos['#3']).toContain('Stock insuficiente');
    expect(motivos['#4']).toContain('Stock insuficiente');
    expect(motivos['#5']).toContain('Código no encontrado');
    expect(motivos['#6']).toContain('destildaste');
  });

  it('una orden con dos artículos que entran completos se etiqueta una sola vez', () => {
    const r = ordenesAEtiquetar([linea('a', '#7', 'M'), linea('b', '#7', 'L', { cantidad: 1 })], plantilla());
    expect(r.etiquetar.map(o => o.orden)).toEqual(['#7']);
    expect(r.noEtiquetar).toEqual([]);
  });

  it('fecha de Argentina y las dos etiquetas', () => {
    expect(hoyArgentina(new Date('2026-11-18T02:30:00Z'))).toBe('17/11/2026');
    expect(etiquetasPedidoId('18/11/2026')).toEqual(['pedido id', '18/11/2026']);
  });

  it('agrega las etiquetas con tagsAdd y cuenta solo lo que Shopify confirmó', async () => {
    api.mockImplementation(async (q: string, v: any) => {
      if (q.includes('PedidoIdPermisoEtiqueta')) return { currentAppInstallation: { accessScopes: [{ handle: 'write_orders' }] } };
      if (v.id.endsWith('/2')) return { tagsAdd: { node: null, userErrors: [{ message: 'Orden archivada' }] } };
      if (v.id.endsWith('/3')) return { tagsAdd: null };
      return { tagsAdd: { node: { id: v.id }, userErrors: [] } };
    });
    const r = await etiquetarOrdenes(['1', '2', '3'].map(n => ({ orden: `#${n}`, ordenId: `gid://shopify/Order/${n}` })), ['pedido id', '18/11/2026']);
    expect(r.ok).toEqual(['#1']);
    expect(r.fallidas.map(f => f.orden)).toEqual(['#2', '#3']);
    expect(r.fallidas[0].error).toContain('archivada');
    const llamada = api.mock.calls.find(c => String(c[0]).includes('tagsAdd'))!;
    expect(llamada[1]).toEqual({ id: 'gid://shopify/Order/1', tags: ['pedido id', '18/11/2026'] });
  });

  it('sin permiso write_orders no escribe nada', async () => {
    api.mockResolvedValue({ currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } });
    const r = await etiquetarOrdenes([{ orden: '#1', ordenId: 'gid://shopify/Order/1' }], ['pedido id', '18/11/2026']);
    expect(r.sinPermiso).toBe(true);
    expect(r.ok).toEqual([]);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('número de pedido de iD: solo dígitos, conserva los ceros', async () => {
    expect(numeroPedidoId(' 00002616 ')).toBe('00002616');
    expect(numeroPedidoId('N° 00002616')).toBe('00002616');
    expect(numeroPedidoId('Pedido 2616')).toBe('2616');
    expect(numeroPedidoId('2616a')).toBe('');
    expect(numeroPedidoId('')).toBe('');
    api.mockImplementation(async (q: string, v: any) => q.includes('PedidoIdPermisoEtiqueta')
      ? { currentAppInstallation: { accessScopes: [{ handle: 'write_orders' }] } }
      : { tagsAdd: { node: { id: v.id }, userErrors: [] } });
    const r = await etiquetarOrdenes([{ orden: '#1', ordenId: 'gid://shopify/Order/1' }], ['00002616']);
    expect(r.ok).toEqual(['#1']);
    expect(api.mock.calls.find(c => String(c[0]).includes('tagsAdd'))?.[1]).toEqual({ id: 'gid://shopify/Order/1', tags: ['00002616'] });
  });
});
