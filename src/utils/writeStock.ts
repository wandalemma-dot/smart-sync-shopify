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
import { talleMatches, STOCK_LOCATION, converseTableFromTags, talleShopifyLeCoq } from './syncLogic';
import type { SyncResult, SyncConfig } from './syncLogic';

export interface StockChange {
  handle: string;
  title: string;
  talle: string;
  sku: string;
  code: string; // código del proveedor (Código Item del Excel)
  inventoryItemId: string;
  current: number;
  desired: number;
  // Si viene, explica por qué se pone en 0 (el proveedor ya no lo lista).
  motivo?: string;
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
          tags
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

  // Productos que ya matchearon contra Shopify (tienen handle). Guardamos el
  // código del proveedor (la clave del excelMap) para mostrarlo en la tabla.
  const entries = Object.entries(result.excelMap)
    .filter(([, d]: [string, any]) => d.foundInShopify && d.shopifyHandle)
    .map(([cod, d]) => ({ cod, d }));

  // También traemos los productos que el proveedor YA NO LISTA: a esos les vamos
  // a poner el stock en 0 (no los borramos).
  const handlesPeligro = (result.enPeligro || []).map((p) => p.handle);
  const tituloPeligro = new Map((result.enPeligro || []).map((p) => [p.handle, p.titulo]));
  const codigoPeligro = new Map((result.enPeligro || []).map((p) => [p.handle, p.codigo || '']));

  const handles = [...new Set([
    ...entries.map((e) => e.d.shopifyHandle as string),
    ...handlesPeligro,
  ])];

  // Traemos las variantes en vivo (con inventoryItem id y stock actual) por lotes de handles.
  const liveByHandle: Record<string, any[]> = {};
  const titleByHandle: Record<string, string> = {}; // título REAL de Shopify
  const tagsByHandle: Record<string, string> = {};   // etiquetas (para la tabla de talle)
  const CHUNK = 20;
  for (let i = 0; i < handles.length; i += CHUNK) {
    const chunk = handles.slice(i, i + CHUNK);
    const q = chunk.map((h) => `handle:${JSON.stringify(h)}`).join(' OR ');
    const data = await shopifyGraphQL<any>(PRODUCTS_BY_HANDLE, { q, loc: locId });
    for (const edge of (data?.products?.edges || [])) {
      const p = edge.node;
      liveByHandle[p.handle] = (p.variants?.edges || []).map((e: any) => e.node);
      titleByHandle[p.handle] = String(p.title || '');
      tagsByHandle[p.handle] = Array.isArray(p.tags) ? p.tags.join(', ') : String(p.tags || '');
    }
  }

  const changes: StockChange[] = [];
  let unchanged = 0;
  const notFound: string[] = [];

  for (const { cod, d } of entries as { cod: string; d: any }[]) {
    const handle = d.shopifyHandle as string;
    const live = liveByHandle[handle] || [];
    // Como ya existe en Shopify, mostramos el título REAL de Shopify (no el del Excel).
    const shopTitle = titleByHandle[handle] || d.title;
    const code = cod.toUpperCase(); // código del proveedor (Código Item del Excel)
    // Converse: el proveedor manda talles US; Shopify los tiene en ARG. Convertimos
    // usando la tabla que indica la etiqueta del producto (TABLA DE TALLE CONVERSE X).
    const convTable = config.brand === 'converse' ? converseTableFromTags(tagsByHandle[handle] || '') : null;
    for (const [size, qtyRaw] of Object.entries(d.sizes || {})) {
      const desired = Number(qtyRaw);
      // Converse: US -> ARG por tabla. Le Coq calzado: el talle de Shopify es
      // UNO MENOS que el del Excel (Excel 40 = Shopify 39).
      const argSize = convTable
        ? (convTable[String(size)] || String(size))
        : config.brand === 'lecoq'
          ? talleShopifyLeCoq(size, d.title)
          : String(size);
      // Si la marca tiene conversión de talle (Converse / Le Coq calzado) usamos
      // SOLO el talle convertido: si aceptáramos también el original podríamos
      // cargarle el stock al talle equivocado.
      const hayConversion = !!convTable || (config.brand === 'lecoq' && argSize !== String(size));
      const v = live.find((n: any) =>
        hayConversion ? talleMatches(argSize, n.title) : talleMatches(size, n.title));
      if (!v || !v.inventoryItem?.id) {
        notFound.push(`${shopTitle} · ${size}`);
        continue;
      }
      const lvl = v.inventoryItem.inventoryLevel;
      const qEntry = (lvl?.quantities || []).find((x: any) => x.name === 'available');
      const current = qEntry ? Number(qEntry.quantity) : 0;
      if (current === desired) { unchanged++; continue; }
      changes.push({
        handle,
        title: shopTitle,
        talle: String(v.title || argSize),
        sku: String(v.sku || ''),
        code,
        inventoryItemId: v.inventoryItem.id,
        current,
        desired,
      });
    }
  }

  // El proveedor ya no lista estos productos -> les ponemos el stock en 0.
  // No se borran: solo dejan de estar disponibles para la venta.
  for (const handle of handlesPeligro) {
    const live = liveByHandle[handle] || [];
    const shopTitle = titleByHandle[handle] || tituloPeligro.get(handle) || handle;
    for (const v of live) {
      if (!v?.inventoryItem?.id) continue;
      const qEntry = (v.inventoryItem.inventoryLevel?.quantities || []).find((x: any) => x.name === 'available');
      const current = qEntry ? Number(qEntry.quantity) : 0;
      if (current <= 0) continue; // ya está en 0
      changes.push({
        handle,
        title: shopTitle,
        talle: String(v.title || ''),
        sku: String(v.sku || ''),
        code: codigoPeligro.get(handle) || '',
        inventoryItemId: v.inventoryItem.id,
        current,
        desired: 0,
        motivo: 'El proveedor ya no lo lista',
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
