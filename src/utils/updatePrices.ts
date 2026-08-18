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
//
// ORDEN (pedido por Wanda): primero las que REALMENTE cambian el precio de
// venta, y recién después las que solo cambian el costo (los "básicos" de
// Converse van siempre al precio sugerido, así que su precio no se mueve).
// Si no, al scrollear caías 12 talles seguidos del mismo Chuck Taylor con
// "109900 -> 109900" y parecía que la app no hacía nada.
// El orden NO afecta lo que se escribe: aplicarPrecios() agrupa por producto.
export function actualizacionesAplicables(result: SyncResult): UpdateAction[] {
  const lista = result.updatesToApply.filter(
    (u) => u.type === 'PRICE' && !u.sinCambios && !!u.productId && !!u.variantId,
  );
  const cambiaPrecio = (u: UpdateAction) =>
    u.newPrice !== undefined && u.oldPrice !== undefined && Number(u.newPrice) !== Number(u.oldPrice);
  // sort() de JS es estable: dentro de cada grupo se respeta el orden original
  // (o sea, los talles de un mismo modelo siguen juntos y en su orden).
  return lista.slice().sort((a, b) => Number(cambiaPrecio(b)) - Number(cambiaPrecio(a)));
}

// Las que ya están iguales (precio y costo coinciden): se muestran en verde
// para que se vea que no se les va a tocar nada.
export function sinCambios(result: SyncResult): UpdateAction[] {
  return result.updatesToApply.filter((u) => u.type === 'PRICE' && u.sinCambios);
}

// IVA para calcular el margen (el precio de venta lo incluye).
export const IVA = 1.21;

// Margen que queda con ese precio y costo. Es lo que Wanda mira para decidir.
export function margenPct(precio: number, costo: number): number | null {
  if (!precio || precio <= 0 || !costo || costo <= 0) return null;
  return (1 - costo / (precio / IVA)) * 100;
}

export interface OpcionesPrecio {
  precio: boolean; // actualizar el precio de venta
  costo: boolean;  // actualizar el costo (Cost per item)
}

export async function aplicarPrecios(
  updates: UpdateAction[],
  opciones: OpcionesPrecio = { precio: true, costo: true },
  onProgress?: (hechas: number, total: number) => void,
): Promise<PriceWriteResult> {
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
      // Solo se toca lo que la usuaria eligió: puede querer cambiar el costo
      // sin tocar el precio de venta (o al revés).
      if (opciones.precio && u.newPrice !== undefined) v.price = String(u.newPrice);
      // El costo va dentro de inventoryItem (no pisa nada más del ítem).
      if (opciones.costo && u.newCost !== undefined && u.newCost > 0) {
        v.inventoryItem = { cost: String(Math.round(u.newCost)) };
      }
      return v;
    }).filter((v) => v.price !== undefined || v.inventoryItem !== undefined);
    if (variants.length === 0) continue;

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
