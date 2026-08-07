// ============================================================================
// ESCRITURA DE STOCK EN SHOPIFY (con simulación / dry-run)
// ----------------------------------------------------------------------------
// Dos pasos, siempre en este orden:
//   1) planStockWrite()  -> LEE el stock actual en vivo y calcula qué cambiaría.
//                           NO escribe nada. Sirve para el preview.
//   2) executeStockWrite() -> ESCRIBE de verdad, usando el plan del paso 1.
//                             Solo toca cantidades (inventorySetQuantities).
// Nunca crea, borra ni cambia precios.
// ============================================================================

import { shopifyGraphQL } from './shopify';
import { talleMatches, STOCK_LOCATION } from './syncLogic';
import type { SyncResult, SyncConfig } from './syncLogic';

export interface StockChange {
  handle: string;
  title: string;
  talle: string;
  sku: string;
  inventoryItemId: string;
  current: number;
  desired: number;
}

export interface StockPlan {
  locationName: string;
  locationId: string | null;
  locationFound: boolean;
  changes: StockChange[];
  unchanged: number;
  notFound: string[]; // variantes del proveedor que no se pudieron ubicar en Shopify
}

export interface WriteResult {
  written: number;
  failed: number;
  errors: string[];
}

const LOCATIONS_QUERY = `query { locations(first: 50) { edges { node { id name } } } }`;

const PRODUCTS_BY_HANDLE = `
  query($q: String!, $loc: ID!) {
    products(first: 50, query: $q) {
      edges {
        node {
          handle
          title
          variants(first: 100) {
            edges {
              node {
                sku
                title
                inventoryItem {
                  id
                  inventoryLevel(locationId: $loc) {
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const SET_MUTATION = `
  mutation Set($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

async function getLocationId(name: string): Promise<string | null> {
  const data = await shopifyGraphQL<any>(LOCATIONS_QUERY);
  const edges: any[] = data?.locations?.edges || [];
  const loc = edges.find((e) => String(e.node.name).trim() === name);
  return loc ? loc.node.id : null;
}

// PASO 1 — Calcula el plan (no escribe nada).
export async function planStockWrite(result: SyncResult, config: SyncConfig): Promise<StockPlan> {
  const locName = STOCK_LOCATION[config.brand];
  const locId = await getLocationId(locName);
  if (!locId) {
    return { locationName: locName, locationId: null, locationFound: false, changes: [], unchanged: 0, notFound: [] };
  }

  // Productos que ya matchearon contra Shopify (tienen handle).
  const entries = Object.entries(result.excelMap)
    .map(([, d]) => d)
    .filter((d: any) => d.foundInShopify && d.shopifyHandle);

  const handles = [...new Set(entries.map((d: any) => d.shopifyHandle as string))];

  // Traemos las variantes en vivo (con inventoryItem id y stock actual) por lotes de handles.
  const liveByHandle: Record<string, any[]> = {};
  const CHUNK = 20;
  for (let i = 0; i < handles.length; i += CHUNK) {
    const chunk = handles.slice(i, i + CHUNK);
    const q = chunk.map((h) => `handle:${JSON.stringify(h)}`).join(' OR ');
    const data = await shopifyGraphQL<any>(PRODUCTS_BY_HANDLE, { q, loc: locId });
    for (const edge of (data?.products?.edges || [])) {
      const p = edge.node;
      liveByHandle[p.handle] = (p.variants?.edges || []).map((e: any) => e.node);
    }
  }

  const changes: StockChange[] = [];
  let unchanged = 0;
  const notFound: string[] = [];

  for (const d of entries as any[]) {
    const handle = d.shopifyHandle as string;
    const live = liveByHandle[handle] || [];
    for (const [size, qtyRaw] of Object.entries(d.sizes || {})) {
      const desired = Number(qtyRaw);
      const v = live.find((n: any) => talleMatches(size, n.title));
      if (!v || !v.inventoryItem?.id) {
        notFound.push(`${d.title} · ${size}`);
        continue;
      }
      const lvl = v.inventoryItem.inventoryLevel;
      const qEntry = (lvl?.quantities || []).find((x: any) => x.name === 'available');
      const current = qEntry ? Number(qEntry.quantity) : 0;
      if (current === desired) { unchanged++; continue; }
      changes.push({
        handle,
        title: d.title,
        talle: String(size),
        sku: String(v.sku || ''),
        inventoryItemId: v.inventoryItem.id,
        current,
        desired,
      });
    }
  }

  return { locationName: locName, locationId: locId, locationFound: true, changes, unchanged, notFound };
}

// PASO 2 — Escribe de verdad, en lotes. Solo cantidades.
export async function executeStockWrite(
  plan: StockPlan,
  onProgress?: (done: number, total: number) => void,
): Promise<WriteResult> {
  if (!plan.locationId) throw new Error('No se encontró la sucursal para escribir.');
  const total = plan.changes.length;
  let written = 0;
  let failed = 0;
  const errors: string[] = [];
  const BATCH = 100;

  for (let i = 0; i < plan.changes.length; i += BATCH) {
    const batch = plan.changes.slice(i, i + BATCH);
    const input = {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: batch.map((c) => ({
        inventoryItemId: c.inventoryItemId,
        locationId: plan.locationId,
        quantity: c.desired,
      })),
    };
    try {
      const data = await shopifyGraphQL<any>(SET_MUTATION, { input });
      const ue = data?.inventorySetQuantities?.userErrors || [];
      if (ue.length) { failed += batch.length; errors.push(...ue.map((e: any) => e.message)); }
      else written += batch.length;
    } catch (err: any) {
      failed += batch.length;
      errors.push(err?.message || 'Error desconocido');
    }
    onProgress?.(Math.min(i + BATCH, total), total);
  }

  return { written, failed, errors };
}
