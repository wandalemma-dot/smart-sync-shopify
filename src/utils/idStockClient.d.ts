import type { StockPlan, StockChange, StockRow } from './writeStock';

interface IDPlan {
  brand: string;
  locationId: string | null;
  stock: Pick<StockChange, 'inventoryItemId' | 'handle' | 'code' | 'talle' | 'sku' | 'current' | 'desired'>[];
  sizes: Pick<StockRow, 'productId' | 'handle' | 'code' | 'talle' | 'talleProveedor' | 'opcion' | 'precio' | 'costo' | 'desired'>[];
}
interface Receipt { id: string; expires: number; signature: string }
export function idPlan(brand: string, source: StockPlan): IDPlan;
export function idRequest(body: {mode: 'prepare'; plan: IDPlan}): Promise<{receipt: Receipt}>;
export function applyRows(plan: IDPlan, receipt: Receipt, action: 'stock' | 'sizes', indices: number[]):
  Promise<{written: number; unconfirmed: number; warnings: string[]; error: string}>;
