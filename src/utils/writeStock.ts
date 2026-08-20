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

import { shopifyGraphQL, mismaSucursal } from './shopify';
import { talleMatches, STOCK_LOCATION, converseTablaDe, talleShopifyLeCoq } from './syncLogic';
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

// Fila "informativa" (no se escribe nada): sirve para que se vea en pantalla que
// el producto SÍ fue procesado, aunque no haya nada para cambiar.
export interface StockRow {
  title: string;
  code: string;           // código del proveedor
  talle: string;          // talle como figura en Shopify (o el buscado, si no se ubicó)
  talleProveedor: string; // talle tal cual viene en el Excel del proveedor
  current: number | null; // null = no se pudo ubicar la variante en Shopify
  desired: number;
  // Solo lo llevan las filas de `sinActivar`: hace falta para darlas de alta.
  inventoryItemId?: string;
}

export interface StockPlan {
  locationName: string;
  locationId: string | null;
  locationFound: boolean;
  changes: StockChange[];
  unchanged: number;
  unchangedRows: StockRow[]; // ya coinciden: solo para mostrar, no se escriben
  notFound: StockRow[];      // variantes del proveedor que no se pudieron ubicar en Shopify
  // Variantes que existen en Shopify pero NO están dadas de alta en esta
  // sucursal. Shopify no deja escribirles stock: devuelve
  // "The specified inventory item is not stocked at the location."
  // Se muestran, NO se escriben. Wanda decidió activarlas ella a mano.
  sinActivar: StockRow[];
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

// Da de alta un inventory item en una sucursal y, de paso, le pone la cantidad.
// Es la ÚNICA forma de cargarle stock a una variante que todavía no existe en
// esa sucursal. Va de a una: Shopify no tiene versión en lote de esta mutación.
const ACTIVATE_MUTATION = `
  mutation Activar($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
      inventoryLevel { id }
      userErrors { field message }
    }
  }
`;

async function getLocationId(name: string): Promise<string | null> {
  const data = await shopifyGraphQL<any>(LOCATIONS_QUERY);
  const edges: any[] = data?.locations?.edges || [];
  const loc = edges.find((e) => mismaSucursal(e.node.name, name));
  return loc ? loc.node.id : null;
}

// PASO 1 — Calcula el plan (no escribe nada).
export async function planStockWrite(result: SyncResult, config: SyncConfig): Promise<StockPlan> {
  const locName = STOCK_LOCATION[config.brand];
  const locId = await getLocationId(locName);
  if (!locId) {
    return { locationName: locName, locationId: null, locationFound: false, changes: [], unchanged: 0, unchangedRows: [], notFound: [], sinActivar: [] };
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
  const unchangedRows: StockRow[] = [];
  const notFound: StockRow[] = [];
  const sinActivar: StockRow[] = [];

  for (const { cod, d } of entries as { cod: string; d: any }[]) {
    const handle = d.shopifyHandle as string;
    const live = liveByHandle[handle] || [];
    // Como ya existe en Shopify, mostramos el título REAL de Shopify (no el del Excel).
    const shopTitle = titleByHandle[handle] || d.title;
    const code = cod.toUpperCase(); // código del proveedor (Código Item del Excel)
    // Converse: el proveedor manda talles US; Shopify los tiene en ARG. Convertimos
    // usando la tabla que indica la etiqueta del producto (TABLA DE TALLE CONVERSE X).
    // La tabla sale del CÓDIGO (maestro de curvas del proveedor). La etiqueta
    // solo se usa de respaldo, y únicamente la que dice "TABLA DE TALLE".
    const convTable = config.brand === 'converse'
      ? converseTablaDe(code, tagsByHandle[handle] || '')
      : null;
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
        notFound.push({
          title: shopTitle, code, talle: String(argSize),
          talleProveedor: String(size), current: null, desired,
        });
        continue;
      }
      const lvl = v.inventoryItem.inventoryLevel;
      // ⚠ SI ESTO VIENE NULL, la variante NO está dada de alta en la sucursal.
      // NO es que tenga cero: directamente no existe ahí. Si la mandáramos a
      // escribir, Shopify rechaza el lote ENTERO con
      // "The specified inventory item is not stocked at the location"
      // y se caen también las 99 variantes buenas que iban en ese lote.
      // Por eso se aparta ACÁ, antes de escribir.
      if (!lvl) {
        sinActivar.push({
          title: shopTitle, code, talle: String(v.title || argSize),
          talleProveedor: String(size), current: null, desired,
          inventoryItemId: v.inventoryItem.id,
        });
        continue;
      }
      const qEntry = (lvl.quantities || []).find((x: any) => x.name === 'available');
      const current = qEntry ? Number(qEntry.quantity) : 0;
      if (current === desired) {
        unchangedRows.push({
          title: shopTitle, code, talle: String(v.title || argSize),
          talleProveedor: String(size), current, desired,
        });
        continue;
      }
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

  return {
    locationName: locName, locationId: locId, locationFound: true,
    changes, unchanged: unchangedRows.length, unchangedRows, notFound, sinActivar,
  };
}

// PASO 2-bis (OPCIONAL, botón aparte) — Da de alta en la sucursal las variantes
// que todavía no están, y les carga la cantidad del proveedor.
// Se ejecuta SOLO si Wanda lo confirma: es la única operación de la app que
// agrega una variante a una sucursal donde antes no estaba.
export async function activarEnSucursal(
  plan: StockPlan,
  onProgress?: (hechas: number, total: number) => void,
): Promise<WriteResult> {
  if (!plan.locationId) throw new Error('No se encontró la sucursal.');
  const filas = plan.sinActivar.filter((f) => !!f.inventoryItemId);
  let written = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    try {
      const data = await shopifyGraphQL<any>(ACTIVATE_MUTATION, {
        inventoryItemId: f.inventoryItemId,
        locationId: plan.locationId,
        available: f.desired,
      });
      const ue = data?.inventoryActivate?.userErrors || [];
      if (ue.length) {
        failed++;
        if (errors.length < 5) errors.push(`${f.title} ${f.talle}: ${ue[0].message}`);
      } else {
        written++;
      }
    } catch (err: any) {
      failed++;
      if (errors.length < 5) errors.push(`${f.title} ${f.talle}: ${err?.message || 'Error desconocido'}`);
    }
    onProgress?.(i + 1, filas.length);
  }

  return { written, failed, errors };
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
    let loteOk = false;
    try {
      const data = await shopifyGraphQL<any>(SET_MUTATION, { input });
      const ue = data?.inventorySetQuantities?.userErrors || [];
      if (!ue.length) { written += batch.length; loteOk = true; }
      else if (errors.length < 5) errors.push(...ue.slice(0, 2).map((e: any) => e.message));
    } catch (err: any) {
      if (errors.length < 5) errors.push(err?.message || 'Error desconocido');
    }

    // ⚠ Shopify rechaza el LOTE ENTERO si una sola variante falla. Antes eso
    // contaba 100 fallidas y perdíamos 99 escrituras que estaban bien.
    // Ahora, si el lote falla, se reintenta de a una: así solo se pierde la
    // que realmente tiene el problema.
    if (!loteOk) {
      for (const c of batch) {
        try {
          const d = await shopifyGraphQL<any>(SET_MUTATION, {
            input: {
              name: 'available',
              reason: 'correction',
              ignoreCompareQuantity: true,
              quantities: [{ inventoryItemId: c.inventoryItemId, locationId: plan.locationId, quantity: c.desired }],
            },
          });
          const ue = d?.inventorySetQuantities?.userErrors || [];
          if (ue.length) {
            failed++;
            if (errors.length < 5) errors.push(`${c.title} ${c.talle}: ${ue[0].message}`);
          } else written++;
        } catch (err: any) {
          failed++;
          if (errors.length < 5) errors.push(`${c.title} ${c.talle}: ${err?.message || 'Error'}`);
        }
      }
    }
    onProgress?.(Math.min(i + BATCH, total), total);
  }

  return { written, failed, errors };
}
