import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { idsOrdenes, leerPendientesId, leerPlantillaId, cruzarPedido, generarExcelPedido } from '../pedidoId';
import type { PendienteId } from '../pedidoId';
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../shopify', async original => ({ ...await original<typeof import('../shopify')>(), shopifyGraphQL: api }));
function plantilla(nombre = 'REMERA', codigo = 'CTO0226102', qty = 2) {
  const s = XLSX.utils.aoa_to_sheet([['UUID'], ['Foto', 'Artículo', 'Color', 'Precio', '', 'S', 'M', 'Unidades', 'Importe'],
    ['', codigo, 'NEGRO', 100, 'Disponible', qty, '-'], ['', nombre, '', '', 'Cantidad', 9, 8]]);
  s.H4 = { t: 'n', f: 'SUM(F4:G4)', v: 17 }; s.I4 = { t: 'n', f: 'H4*D3', v: 1700 }; s['!ref'] = 'A1:I4';
  const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, s, 'Plantilla');
  return leerPlantillaId(new Uint8Array(XLSX.write(w, { type: 'array', bookType: 'xlsx' })));
}
const linea = (extra: Partial<PendienteId> = {}): PendienteId => ({ orden: '#1', id: 'l1', titulo: 'Remera Converse', sku: 'barcode', talle: 'S', cantidad: 1, tags: ['CTO0226102'], vendor: 'Converse', ...extra });
const conn = (nodes: any[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: !!next, endCursor: next } });
beforeEach(() => { api.mockReset(); });
describe('pedido iD: plantilla y faltantes', () => {
  it.each([false, true])('lee y exporta XML con prefijo x, incluso celdas omitidas: %s', omitida => {
    const source = plantilla(); const zip = unzipSync(source.original);
    for (const path of ['xl/workbook.xml', source.sheetPath]) {
      let xml = strFromU8(zip[path]).replace('xmlns="', 'xmlns:x="')
        .replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g, '<$1x:$2');
      if (omitida && path === source.sheetPath) xml = xml.replace(/<x:c\b[^>]*\br="F4"[^>]*>[\s\S]*?<\/x:c>/, '');
      zip[path] = strToU8(xml);
    }
    const p = leerPlantillaId(zipSync(zip));
    const out = generarExcelPedido(p, cruzarPedido([linea()], p));
    const s = XLSX.read(out, {type: 'array'}).Sheets.Plantilla;
    expect(s.F4.v).toBe(1); expect(s.G4.v).toBe(0);
    expect(s.H4.v).toBe(1); expect(s.I4.v).toBe(100);
    const after = unzipSync(out);
    expect(strFromU8(after['xl/workbook.xml'])).toContain('<x:calcPr');
    for (const path of Object.keys(zip)) if (![p.sheetPath, 'xl/workbook.xml'].includes(path)) expect(after[path]).toEqual(zip[path]);
  });
  it('deduplica órdenes y conserva IDs como texto', () => {
    expect(idsOrdenes('Name,Id\n#1,123456789012345678\n#1,\n#1,123456789012345678')).toEqual(['gid://shopify/Order/123456789012345678']);
    expect(() => idsOrdenes('Name,SKU\n#1,foo')).toThrow();
  });
  it('agrega demanda antes de limitar al stock y muestra órdenes afectadas', () => {
    const r = cruzarPedido([linea({ cantidad: 2 }), linea({ orden: '#2', cantidad: 2 })], plantilla());
    expect(r.filas[0]).toMatchObject({ necesaria: 4, pedir: 2, faltante: 2, ordenes: ['#1', '#2'], celda: 'F4' });
  });
  it('guiones son cero; códigos sin coincidencia no se exportan', () => {
    const r = cruzarPedido([linea({ talle: 'M' }), linea({ tags: [], sku: 'otro' })], plantilla());
    expect(r.filas.every(f => f.pedir === 0 && f.faltante === 1)).toBe(true);
  });
  it('redondea packs hacia arriba después de agrupar y muestra excedente', () => {
    const r = cruzarPedido([linea({ cantidad: 7 })], plantilla('MEDIAS X6'));
    expect(r.filas[0]).toMatchObject({ pack: 6, pedir: 2, excedente: 5, faltante: 0 });
  });
  it('no confunde códigos por prefijo ni inventa talles', () => {
    expect(cruzarPedido([linea({ tags: [], sku: 'CTO02261020-S' })], plantilla()).filas[0].pedir).toBe(0);
    expect(cruzarPedido([linea({ talle: '42' })], plantilla()).filas[0].motivo).toContain('tabla');
  });
  it('reemplaza cantidades previas y conserva partes originales y fórmulas con totales actualizados', () => {
    const p = plantilla(); const r = cruzarPedido([linea()], p);
    const bytes = generarExcelPedido(p, r);
    const s = XLSX.read(bytes, { type: 'array' }).Sheets.Plantilla;
    expect(s.F4.v).toBe(1); expect(s.G4.v).toBe(0); expect(s.H4.v).toBe(1); expect(s.I4.v).toBe(100);
    expect(s.H4.f).toBe('SUM(F4:G4)'); expect(s.F3.v).toBe(2);
    const before = unzipSync(p.original), after = unzipSync(bytes);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const path of Object.keys(before)) if (![p.sheetPath, 'xl/workbook.xml'].includes(path)) expect(after[path]).toEqual(before[path]);
  });
});
describe('lectura de Shopify', () => {
  it('sin permiso detiene el armado', async () => {
    api.mockResolvedValue({ currentAppInstallation: { accessScopes: [] } });
    await expect(leerPendientesId(['id'])).rejects.toThrow('read_merchant');
  });
  it('consulta solo pendientes de iD, pagina y no duplica órdenes ni líneas', async () => {
    api.mockImplementation(async (q: string, v: any) => {
      if (q.includes('PedidoIdPermisos')) return { currentAppInstallation: { accessScopes: [{ handle: 'read_merchant_managed_fulfillment_orders' }] } };
      if (q.includes('PedidoIdOrder')) return { order: { name: '#1', displayFinancialStatus: 'PAID', tags: [], fulfillmentOrders: conn([
        { id: 'martinez', status: 'OPEN', assignedLocation: { name: 'DEPOSITO MARTINEZ' } },
        { id: 'id-fo', status: 'OPEN', assignedLocation: { name: '🔴ID (Converse - Le Coq Sportif)' } },
      ]) } };
      expect(v.id).toBe('id-fo');
      return { fulfillmentOrder: { lineItems: conn(v.after ? [{ id: 'x', remainingQuantity: 2, lineItem: { title: 'Remera' } }, { id: 'y', remainingQuantity: 0 }] : [{ id: 'x', remainingQuantity: 2, lineItem: { title: 'Remera' } }], v.after ? null : 'next') } };
    });
    const r = await leerPendientesId(['id', 'id']);
    expect(r.lineas).toHaveLength(1); expect(r.lineas[0].cantidad).toBe(2);
    expect(api.mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  it.each([{ tags: ['pedido id'] }, { tags: ['solucionar'] }, { cancelledAt: 'date' }, { closed: true }, { displayFinancialStatus: 'REFUNDED' }])('excluye órdenes fuera del filtro %j', async patch => {
    api.mockImplementation(async q => q.includes('PedidoIdPermisos') ? { currentAppInstallation: { accessScopes: [{ handle: 'read_merchant_managed_fulfillment_orders' }] } } : { order: { name: '#1', tags: [], displayFinancialStatus: 'PAID', ...patch } });
    expect((await leerPendientesId(['id'])).lineas).toHaveLength(0);
  });
});
