import { convTable1, convTable2, convTable3, convTable4, convTable5, sortSizeEntries } from './syncLogic';

// ============================================================================
// ANÁLISIS PARA PEDIDO (en vivo contra Shopify)
// Mira SOLO Converse y Le Coq Sportif, y SOLO el stock de la sucursal iD.
// Lista los talles agotados (stock <= umbral) para armar el pedido de reposición.
// ============================================================================

// Ubicación fija de iD para Converse / Le Coq Sportif (tal cual figura en Shopify).
export const ID_LOCATION_NAME = 'ID (Converse - Le Coq Sportif)';

// "Agotado" para el pedido = stock disponible <= este umbral (0 o 1).
export const RESTOCK_THRESHOLD = 1;

export interface RestockSize {
  shopifyTalle: string; // talle como figura en Shopify (ARG)
  pedidoTalle: string;  // talle para el pedido al proveedor (US en Converse, ARG+1 en Le Coq)
  available: number;    // stock actual en la sucursal iD
  sku: string;
}

export interface RestockItem {
  vendor: string;
  brand: 'converse' | 'lecoq';
  title: string;
  handle: string;
  sizes: RestockSize[];
}

export interface RestockResult {
  locationName: string;
  locationFound: boolean;
  generatedAt: string;
  productsScanned: number;
  variantsAtLocation: number;
  items: RestockItem[];
}

// Llama a Shopify a través del proxy /api/shopify (mismo que usa el resto de la app).
async function shopifyGraphQL(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch('/api/shopify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`Error de conexión con Shopify (${res.status}): ${raw.substring(0, 120)}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error('Shopify error: ' + JSON.stringify(json.errors));
  return json.data;
}

const LOCATIONS_QUERY = `
  query { locations(first: 50) { edges { node { id name } } } }
`;

const PRODUCTS_QUERY = `
  query Restock($cursor: String, $loc: ID!, $q: String!) {
    products(first: 15, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          title
          handle
          vendor
          variants(first: 40) {
            edges {
              node {
                title
                sku
                inventoryItem {
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

// Detecta la mejor tabla de Converse a partir de los talles (ARG) que el producto
// ya tiene en Shopify, y devuelve el mapa inverso ARG -> US para armar el pedido.
function converseArgToUs(argTitles: string[]): Record<string, string> {
  const tables = [convTable1, convTable2, convTable3, convTable4, convTable5];
  let best = convTable1;
  let bestScore = -1;
  for (const table of tables) {
    const vals = Object.values(table);
    const score = argTitles.filter(t => vals.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = table; }
  }
  const inv: Record<string, string> = {};
  for (const [us, arg] of Object.entries(best)) inv[arg] = us;
  return inv;
}

export async function analyzeRestock(): Promise<RestockResult> {
  // 1) Ubicación fija de iD.
  const locData = await shopifyGraphQL(LOCATIONS_QUERY);
  const locEdges: Array<{ node: { id: string; name: string } }> = locData?.locations?.edges || [];
  const loc = locEdges.find(e => String(e.node.name).trim() === ID_LOCATION_NAME);
  if (!loc) {
    return {
      locationName: ID_LOCATION_NAME,
      locationFound: false,
      generatedAt: new Date().toISOString(),
      productsScanned: 0,
      variantsAtLocation: 0,
      items: [],
    };
  }
  const locId = loc.node.id;

  // 2) Recorrer todos los productos Converse y Le Coq Sportif (paginado).
  const items: RestockItem[] = [];
  let productsScanned = 0;
  let variantsAtLocation = 0;
  let cursor: string | null = null;
  let hasNext = true;
  let guard = 0;

  while (hasNext && guard < 200) {
    guard++;
    const data = await shopifyGraphQL(PRODUCTS_QUERY, {
      cursor,
      loc: locId,
      q: 'vendor:Converse OR vendor:"Le Coq Sportif"',
    });
    const conn = data?.products;
    const edges: any[] = conn?.edges || [];
    for (const edge of edges) {
      const p = edge.node;
      productsScanned++;
      const vendor = String(p.vendor || '');
      const vlow = vendor.toLowerCase();
      const brand: 'converse' | 'lecoq' | null =
        vlow.includes('coq') ? 'lecoq' : (vlow.includes('converse') ? 'converse' : null);
      if (!brand) continue;

      const vEdges: any[] = p.variants?.edges || [];
      const argTitles = vEdges.map((v: any) => String(v.node.title || ''));
      const inv = brand === 'converse' ? converseArgToUs(argTitles) : {};

      const sizes: RestockSize[] = [];
      for (const v of vEdges) {
        const node = v.node;
        const level = node.inventoryItem?.inventoryLevel;
        if (!level) continue; // el talle no está cargado en iD -> no cuenta
        variantsAtLocation++;
        const qEntry = (level.quantities || []).find((q: any) => q.name === 'available');
        const available = qEntry ? Number(qEntry.quantity) : 0;
        if (available > RESTOCK_THRESHOLD) continue; // hay stock -> no hace falta pedir

        const shopifyTalle = String(node.title || '');
        let pedidoTalle = shopifyTalle;
        if (brand === 'converse') {
          pedidoTalle = inv[shopifyTalle] || shopifyTalle;
        } else {
          const n = parseInt(shopifyTalle, 10);
          if (!isNaN(n)) pedidoTalle = String(n + 1);
        }
        sizes.push({ shopifyTalle, pedidoTalle, available, sku: String(node.sku || '') });
      }

      if (sizes.length > 0) {
        const ordered = sortSizeEntries(sizes.map(s => [s.shopifyTalle, s] as [string, RestockSize]))
          .map(([, s]) => s);
        items.push({ vendor, brand, title: String(p.title || ''), handle: String(p.handle || ''), sizes: ordered });
      }
    }
    hasNext = !!conn?.pageInfo?.hasNextPage;
    cursor = conn?.pageInfo?.endCursor || null;
  }

  items.sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));

  return {
    locationName: ID_LOCATION_NAME,
    locationFound: true,
    generatedAt: new Date().toISOString(),
    productsScanned,
    variantsAtLocation,
    items,
  };
}

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadRestockCSV(result: RestockResult) {
  if (!result.items.length) { alert('No hay talles agotados para descargar.'); return; }
  const headers = ['Marca', 'Modelo', 'Handle', 'Talle Shopify (ARG)', 'Talle Pedido', 'Stock actual', 'SKU'];
  let csv = headers.join(',') + '\n';
  for (const it of result.items) {
    const marca = it.brand === 'lecoq' ? 'Le Coq Sportif' : 'Converse';
    for (const s of it.sizes) {
      csv += [marca, it.title, it.handle, s.shopifyTalle, s.pedidoTalle, s.available, s.sku]
        .map(escapeCSV).join(',') + '\n';
    }
  }
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const urlObj = URL.createObjectURL(blob);
  link.setAttribute('href', urlObj);
  link.setAttribute('download', `Pedido_Faltantes_iD_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
