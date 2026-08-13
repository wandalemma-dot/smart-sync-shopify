// ============================================================================
// ACTUALIZAR PRECIOS Y COSTOS DIRECTO EN SHOPIFY
// ----------------------------------------------------------------------------
// ⚠ POR QUÉ EXISTE ESTO:
//   Importar un CSV con "Sobrescribir productos" BORRA todo lo que no venga en
//   el archivo (fotos, descripción, categoría, canales de venta...). Ya nos pasó.
//   Esta vía usa productVariantsBulkUpdate, que toca ÚNICAMENTE los campos que
//   se le pasan: precio y costo. Es imposible que borre nada más.
// ============================================================================

import { shopifyGraphQL } from './shopify';
import type { SyncResult, UpdateAction } from './syncLogic';

const BULK_UPDATE = `
  mutation ActualizarPrecios($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

export interface PriceWriteResult {
  actualizadas: number;
  fallidas: number;
  errores: string[];
}

// Solo las actualizaciones de precio que tienen los identificadores necesarios.
export function actualizacionesAplicables(result: SyncResult): UpdateAction[] {
  return result.updatesToApply.filter(
    (u) => u.type === 'PRICE' && !!u.productId && !!u.variantId,
  );
}

export async function aplicarPrecios(
  result: SyncResult,
  onProgress?: (hechas: number, total: number) => void,
): Promise<PriceWriteResult> {
  const updates = actualizacionesAplicables(result);

  // productVariantsBulkUpdate trabaja por producto: agrupamos.
  const porProducto = new Map<string, UpdateAction[]>();
  for (const u of updates) {
    const pid = u.productId as string;
    if (!porProducto.has(pid)) porProducto.set(pid, []);
    porProducto.get(pid)!.push(u);
  }

  let actualizadas = 0;
  let fallidas = 0;
  const errores: string[] = [];
  let hechas = 0;

  for (const [productId, lista] of porProducto) {
    const variants = lista.map((u) => {
      const v: any = { id: u.variantId };
      if (u.newPrice !== undefined) v.price = String(u.newPrice);
      // El costo va dentro de inventoryItem (no pisa nada más del ítem).
      if (u.newCost !== undefined && u.newCost > 0) {
        v.inventoryItem = { cost: String(Math.round(u.newCost)) };
      }
      return v;
    });

    try {
      const data = await shopifyGraphQL<any>(BULK_UPDATE, { productId, variants });
      const ue = data?.productVariantsBulkUpdate?.userErrors || [];
      if (ue.length) {
        fallidas += lista.length;
        errores.push(`${lista[0].title || productId}: ${ue.map((e: any) => e.message).join('; ')}`);
      } else {
        actualizadas += lista.length;
      }
    } catch (e: any) {
      fallidas += lista.length;
      errores.push(`${lista[0].title || productId}: ${e?.message || 'error'}`);
    }
    hechas += lista.length;
    onProgress?.(hechas, updates.length);
  }

  return { actualizadas, fallidas, errores };
}
