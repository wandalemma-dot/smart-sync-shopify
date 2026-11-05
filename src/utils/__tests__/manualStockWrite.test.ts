import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activarEnSucursal, executeStockWrite } from '../writeStock';
import type { StockPlan } from '../writeStock';
import { STOCK_LOCATION } from '../syncLogic';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../shopify', async original => ({ ...await original<typeof import('../shopify')>(), shopifyGraphQL: api }));
const success = () => ({ inventorySetQuantities: { userErrors: [], inventoryAdjustmentGroup: { createdAt: '2026-11-04T00:00:00Z' } } });
function plan(locationName = 'NTF'): StockPlan {
  const codes = ['15692', '15693', '15697', '17503', '17503'];
  const sizes = ['46', '40', '44', '42', '44'];
  const current = [4, 3, 1, 3, 3], desired = [5, 4, 4, 4, 4];
  return {
    locationName, locationId: 'gid://shopify/Location/123', locationFound: true,
    changes: codes.map((code, i) => ({ code, talle: sizes[i], current: current[i], desired: desired[i],
      handle: code, title: 'Producto de prueba ' + code, sku: `${code}-${sizes[i]}`, inventoryItemId: `gid://shopify/InventoryItem/${i + 1}` })),
    unchanged: 72, unchangedRows: [], notFound: [], sinActivar: [], talleCorrido: [], apartadosPorCorrido: [], excluidos: [],
  };
}
beforeEach(() => { api.mockReset().mockResolvedValue(success()); });

describe('escritura manual para todas las marcas, con Shopify simulado', () => {
  it.each(Object.entries(STOCK_LOCATION))('%s permite escribir las cantidades de la sucursal simulada', async (_brand, location) => {
    const p = plan(location);
    const result = await executeStockWrite(p);
    expect(result).toEqual({ written: 5, failed: 0, errors: [] });
    expect(api).toHaveBeenCalledOnce();
    const [query, variables] = api.mock.calls[0];
    expect(query).toContain('@idempotent(key: $key)');
    expect(variables.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(variables.input).not.toHaveProperty('ignoreCompareQuantity');
    expect(variables.input.quantities).toEqual(p.changes.map(c => ({
      inventoryItemId: c.inventoryItemId, locationId: p.locationId, quantity: c.desired, changeFromQuantity: null,
    })));
    expect(JSON.stringify(variables)).not.toMatch(/price|cost|order/);
    expect(p.unchanged).toBe(72);
  });
  it('permite una nueva confirmación manual, sin bloqueo por haber usado antes el botón', async () => {
    await executeStockWrite(plan()); await executeStockWrite(plan());
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[0][1].key).not.toBe(api.mock.calls[1][1].key);
  });
  it.each([{}, { inventorySetQuantities: { userErrors: [] } }])('no informa éxito ni repite una respuesta incompleta: %j', async reply => {
    api.mockResolvedValue(reply);
    expect(await executeStockWrite(plan())).toMatchObject({ written: 0, failed: 5 });
    expect(api).toHaveBeenCalledOnce();
  });
  it('no repite escrituras automáticamente si se pierde la respuesta', async () => {
    api.mockRejectedValue(new Error('Respuesta perdida'));
    expect(await executeStockWrite(plan())).toMatchObject({ written: 0, failed: 5 });
    expect(api).toHaveBeenCalledOnce();
  });
  it('si Shopify rechaza el lote completo, conserva la recuperación individual', async () => {
    api.mockResolvedValueOnce({ inventorySetQuantities: { userErrors: [{ message: 'Una variante no está activa' }] } });
    expect(await executeStockWrite(plan())).toMatchObject({ written: 5, failed: 0 });
    expect(api).toHaveBeenCalledTimes(6);
    expect(new Set(api.mock.calls.map(([, v]) => v.key)).size).toBe(6);
    expect(api.mock.calls.slice(1).every(([, v]) => v.input.quantities.length === 1)).toBe(true);
  });
  it('activa stock manual con clave idempotente y exige confirmación de Shopify', async () => {
    const p = plan();
    p.sinActivar = [{ title: 'Prueba', code: '1', talle: 'M', talleProveedor: 'M', current: null, desired: 2, inventoryItemId: 'gid://shopify/InventoryItem/8' }];
    api.mockResolvedValueOnce({ inventoryActivate: { userErrors: [], inventoryLevel: { id: 'level' } } });
    expect(await activarEnSucursal(p)).toEqual({ written: 1, failed: 0, errors: [] });
    expect(api.mock.calls[0][0]).toContain('@idempotent(key: $key)');
    expect(api.mock.calls[0][1]).toMatchObject({ available: 2, locationId: p.locationId, key: expect.any(String) });
    api.mockResolvedValue({ inventoryActivate: { userErrors: [] } });
    expect(await activarEnSucursal(p)).toMatchObject({ written: 0, failed: 1 });
  });
});
