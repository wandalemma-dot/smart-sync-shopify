import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alertaDeVariante, consultarAlertasMartinez } from '../alertasMartinez';
import type { VarianteAlerta } from '../alertasMartinez';
import { shopifyGraphQL } from '../shopify';
vi.mock('../shopify', async importOriginal => ({ ...await importOriginal<typeof import('../shopify')>(), shopifyGraphQL: vi.fn() }));
const nivel = (quantity: number) => ({ quantities: [{ name: 'available', quantity }] });
function variante(mar = 0, idl = 5): VarianteAlerta {
  return { id: 'v1', title: '38', selectedOptions: [{ name: 'Talle', value: '38' }],
    product: { title: 'Converse Mujer', vendor: 'Converse', tags: ['A13016C', 'TABLA DE TALLE CONVERSE MUJER 2'], status: 'ACTIVE' },
    inventoryItem: { mar: nivel(mar), idl: nivel(idl) } };
}
const conexion = <T,>(nodes: T[], endCursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: !!endCursor, endCursor } });
describe('alertas de Martínez', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([-2, 0, 1, 2, 3])('incluye stock %s y convierte Mujer 2', stock => {
    expect(alertaDeVariante(variante(stock))).toMatchObject({ stockMartinez: stock, stockId: 5, tallePedido: '8' });
  });
  it('excluye stock mayor a 3 y proveedor agotado', () => {
    expect(alertaDeVariante(variante(4))).toBeNull();
    expect(alertaDeVariante(variante(0, 0))).toBeNull();
    expect(alertaDeVariante(variante(0, -1))).toBeNull();
  });
  it('no confunde falta de alta ni cantidad desconocida con cero', () => {
    const v = variante(); v.inventoryItem.mar = null;
    expect(alertaDeVariante(v)).toBeNull();
    v.inventoryItem.mar = { quantities: [] };
    expect(alertaDeVariante(v)).toBeNull();
  });
  it('conserva productos sin código o conversión para revisión', () => {
    const v = variante(); v.product.tags = [];
    expect(alertaDeVariante(v)).toMatchObject({ tallePedido: null, codigo: null });
    expect(alertaDeVariante(v)?.motivo).toBeTruthy();
  });
  it('respeta la etiqueta sobre el maestro, Le Coq y talles alfanuméricos', () => {
    const v = variante(); v.product.tags = ['A13016C', 'TABLA DE TALLE CONVERSE 1'];
    expect(alertaDeVariante(v)?.tallePedido).toBe('6.5');
    v.product.vendor = 'Le Coq Sportif';
    expect(alertaDeVariante(v)?.tallePedido).toBe('39');
    v.product.title = 'Pantalón Le Coq';
    expect(alertaDeVariante(v)?.tallePedido).toBe('38');
    v.title = '3XL'; v.selectedOptions[0].value = '3XL';
    expect(alertaDeVariante(v)?.tallePedido).toBe('3XL');
    v.product.vendor = 'Vans'; expect(alertaDeVariante(v)).toBeNull();
  });
  it('identifica el talle entre varias opciones sin perder el color', () => {
    const v = variante(); v.title = 'Rojo / 38'; v.selectedOptions.unshift({ name: 'Color', value: 'Rojo' });
    expect(alertaDeVariante(v)).toMatchObject({ talleAr: '38', variante: 'Rojo / 38', tallePedido: '8' });
  });
  it('pagina ubicaciones y variantes, conserva ceros y ordena por stock', async () => {
    vi.mocked(shopifyGraphQL)
      .mockResolvedValueOnce({ locations: conexion([{ id: 'mar', name: 'DEPÓSITO MARTÍNEZ' }], 'l2') })
      .mockResolvedValueOnce({ locations: conexion([{ id: 'id', name: '🔴ID (Converse - Le Coq Sportif)' }]) })
      .mockResolvedValueOnce({ productVariants: conexion([variante(3)], 'v2') })
      .mockResolvedValueOnce({ productVariants: conexion([{ ...variante(0), id: 'v2' }]) });
    const res = await consultarAlertasMartinez();
    expect(res.filas.map(f => f.stockMartinez)).toEqual([0, 3]);
    expect(res.escaneadas).toBe(2);
    expect(vi.mocked(shopifyGraphQL).mock.calls[3][1]).toEqual({ cursor: 'v2', mar: 'mar', idl: 'id' });
    expect(vi.mocked(shopifyGraphQL).mock.calls.every(([q]) => !q.includes('mutation'))).toBe(true);
  });
  it('falla explícitamente si falta la sucursal', async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce({ locations: conexion([]) });
    await expect(consultarAlertasMartinez()).rejects.toThrow('sucursal');
  });
  it('no entrega resultados parciales ante fallas de página', async () => {
    vi.mocked(shopifyGraphQL)
      .mockResolvedValueOnce({ locations: conexion([{ id: 'mar', name: 'DEPOSITO MARTINEZ' }, { id: 'id', name: 'ID (Converse - Le Coq Sportif)' }]) })
      .mockResolvedValueOnce({ productVariants: conexion([variante()], 'v2') })
      .mockRejectedValueOnce(new Error('Sin conexión'));
    await expect(consultarAlertasMartinez()).rejects.toThrow('Sin conexión');
  });
});
