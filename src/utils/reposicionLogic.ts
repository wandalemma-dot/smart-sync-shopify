// ============================================================================
// REPOSICIÓN — armar el pedido de iD hacia DEPOSITO MARTINEZ
// ----------------------------------------------------------------------------
// Contexto del negocio:
//   - "DEPOSITO MARTINEZ" es el depósito propio (lo que Wanda tiene en mano).
//   - "ID (Converse - Le Coq Sportif)" es stock del PROVEEDOR: figura en la
//     tienda pero no está en su poder. Para venderlo hay que pedirlo.
//   El pedido consiste en traer de iD a Martínez lo que se vende bien, para no
//   quedarse en cero (tarda ~2 días).
//
// Esta pantalla SOLO LEE. No escribe nada en Shopify ni carga la web externa.
// ============================================================================

import { shopifyGraphQL } from './shopify';
import { convertir, normCodigo, curvaDe } from './conversorTalles';
import type { Conversion } from './conversorTalles';

export const LOC_MARTINEZ = 'DEPOSITO MARTINEZ';
export const LOC_ID = 'ID (Converse - Le Coq Sportif)';

// ---- Extracción del código de proveedor desde las ETIQUETAS del producto ----
// El código vive en los tags, no en el SKU. Formatos vistos:
//   Converse: A15621C, 172180C, 652517B   (letra/dígitos + letra final)
//   Le Coq:   D1604101                     (D + dígitos)
// Configurable a propósito: el brief pide no hardcodear hasta confirmar.
export const PATRON_CODIGO = /^(?:[A-Z]?\d{5,7}[A-Z]|D\d{6,8})$/;

// Etiquetas que NUNCA son código (categorías, tablas de talle, marcas, etc.)
const TAGS_IGNORADOS = [
  'TABLA DE TALLE', 'INDUMENTARIA', 'CALZADO', 'ACCESORIOS', 'CONVERSE',
  'LE COQ', 'LECOQ', 'ZAPATILLAS', 'MUJER', 'HOMBRE', 'NIÑO', 'NINO', 'UNISEX',
  'TODOS LOS PRODUCTOS', 'REGALOS',
];

export function extraerCodigo(tags: string): string | null {
  const lista = String(tags || '').split(',').map(t => t.trim()).filter(Boolean);
  for (const raw of lista) {
    const t = raw.toUpperCase();
    if (TAGS_IGNORADOS.some(ig => t.includes(ig))) continue;
    const limpio = t.replace(/\s+/g, '');
    if (PATRON_CODIGO.test(limpio)) return limpio;
  }
  // Si ninguno matchea el patrón, probamos con el maestro de curvas (Converse).
  for (const raw of lista) {
    const limpio = raw.trim().toUpperCase().replace(/\s+/g, '');
    if (curvaDe(limpio)) return limpio;
  }
  return null;
}

export interface FilaReposicion {
  codigo: string | null;
  titulo: string;
  marca: 'converse' | 'lecoq';
  handle: string;
  talleAr: string;
  tallePedido: string | null;  // US (Converse) o EU (Le Coq); null si no se pudo
  escala: string | null;
  stockMartinez: number;
  stockId: number;
  vendidos: number;
  devueltos: number;
  disponibleEnId: boolean;     // si iD no tiene, se muestra en gris
  motivoRevisar?: string;      // si no se pudo convertir
}

export interface ResultadoReposicion {
  desde: string;
  generadoEn: string;
  puedeLeerOrdenes: boolean;
  avisoOrdenes?: string;
  filas: FilaReposicion[];       // listas para pedir
  revisar: FilaReposicion[];     // no se pudo convertir: se muestran, no se descartan
  productosEscaneados: number;
}

const LOCATIONS_QUERY = `query { locations(first: 50) { edges { node { id name } } } }`;

const PRODUCTS_QUERY = `
  query($cursor: String, $q: String!, $mar: ID!, $idl: ID!) {
    products(first: 25, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          handle
          title
          vendor
          tags
          variants(first: 100) {
            edges {
              node {
                title
                sku
                inventoryItem {
                  id
                  mar: inventoryLevel(locationId: $mar) { quantities(names: ["available"]) { name quantity } }
                  idl: inventoryLevel(locationId: $idl) { quantities(names: ["available"]) { name quantity } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Ventas + devoluciones desde una fecha. Si el token no tiene read_orders,
// esto falla y lo avisamos en pantalla (sin romper el resto).
const ORDERS_QUERY = `
  query($cursor: String, $q: String!) {
    orders(first: 50, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          name
          createdAt
          lineItems(first: 100) {
            edges { node { quantity sku refundableQuantity variant { sku } } }
          }
        }
      }
    }
  }
`;

async function getLocationIds(): Promise<{ martinez: string | null; id: string | null }> {
  const data = await shopifyGraphQL<any>(LOCATIONS_QUERY);
  const edges: any[] = data?.locations?.edges || [];
  const find = (name: string) => {
    const e = edges.find(x => String(x.node.name).trim().toUpperCase() === name.toUpperCase());
    return e ? e.node.id : null;
  };
  return { martinez: find(LOC_MARTINEZ), id: find(LOC_ID) };
}

function qty(level: any): number {
  const q = (level?.quantities || []).find((x: any) => x.name === 'available');
  return q ? Number(q.quantity) : 0;
}

// Trae ventas (y devoluciones) por SKU desde una fecha.
async function traerVentas(desde: string): Promise<{ ventas: Record<string, number>; devol: Record<string, number>; error?: string }> {
  const ventas: Record<string, number> = {};
  const devol: Record<string, number> = {};
  try {
    let cursor: string | null = null;
    let hasNext = true;
    let guard = 0;
    while (hasNext && guard < 100) {
      guard++;
      const data: any = await shopifyGraphQL<any>(ORDERS_QUERY, { cursor, q: `created_at:>=${desde}` });
      const conn = data?.orders;
      for (const edge of (conn?.edges || [])) {
        for (const li of (edge.node.lineItems?.edges || [])) {
          const n = li.node;
          const sku = String(n.variant?.sku || n.sku || '').toUpperCase();
          if (!sku) continue;
          const cant = Number(n.quantity) || 0;
          ventas[sku] = (ventas[sku] || 0) + cant;
          // Lo devuelto = lo que ya no es reembolsable respecto de lo vendido.
          const refundable = n.refundableQuantity === undefined || n.refundableQuantity === null
            ? cant : Number(n.refundableQuantity);
          const dev = Math.max(0, cant - refundable);
          if (dev > 0) devol[sku] = (devol[sku] || 0) + dev;
        }
      }
      hasNext = !!conn?.pageInfo?.hasNextPage;
      cursor = conn?.pageInfo?.endCursor || null;
    }
    return { ventas, devol };
  } catch (e: any) {
    return { ventas, devol, error: e?.message || 'No se pudieron leer las órdenes' };
  }
}

export async function analizarReposicion(
  desde: string,
  onProgress?: (escaneados: number) => void,
): Promise<ResultadoReposicion> {
  const locs = await getLocationIds();
  if (!locs.martinez) throw new Error(`No encontré la sucursal "${LOC_MARTINEZ}" en Shopify.`);
  if (!locs.id) throw new Error(`No encontré la sucursal "${LOC_ID}" en Shopify.`);

  // Ventas y devoluciones (si el token no tiene read_orders, seguimos sin ellas).
  const { ventas, devol, error: errOrdenes } = await traerVentas(desde);

  const filas: FilaReposicion[] = [];
  const revisar: FilaReposicion[] = [];
  let escaneados = 0;

  let cursor: string | null = null;
  let hasNext = true;
  let guard = 0;
  while (hasNext && guard < 200) {
    guard++;
    const data: any = await shopifyGraphQL<any>(PRODUCTS_QUERY, {
      cursor,
      q: 'vendor:Converse OR vendor:"Le Coq Sportif"',
      mar: locs.martinez,
      idl: locs.id,
    });
    const conn = data?.products;
    for (const edge of (conn?.edges || [])) {
      const p = edge.node;
      escaneados++;
      const vendorLow = String(p.vendor || '').toLowerCase();
      const marca: 'converse' | 'lecoq' | null =
        vendorLow.includes('coq') ? 'lecoq' : (vendorLow.includes('converse') ? 'converse' : null);
      if (!marca) continue;

      const tagsStr = Array.isArray(p.tags) ? p.tags.join(', ') : String(p.tags || '');
      const codigo = extraerCodigo(tagsStr);

      for (const ve of (p.variants?.edges || [])) {
        const v = ve.node;
        const talleAr = String(v.title || '').trim();
        const stockMartinez = qty(v.inventoryItem?.mar);
        const stockId = qty(v.inventoryItem?.idl);
        const sku = String(v.sku || '').toUpperCase();
        const vendidos = ventas[sku] || 0;
        const devueltos = devol[sku] || 0;

        // Qué mostramos: lo que tuvo venta, o lo que está en 0 en Martínez.
        if (vendidos === 0 && stockMartinez > 0) continue;

        const conv: Conversion = codigo
          ? convertir(marca, codigo, talleAr)
          : { ok: false, talleAr, motivo: 'No encontré el código del proveedor en las etiquetas' };

        const base: FilaReposicion = {
          codigo: codigo ? normCodigo(codigo) : null,
          titulo: String(p.title || ''),
          marca,
          handle: String(p.handle || ''),
          talleAr,
          tallePedido: conv.ok ? conv.tallePedido : null,
          escala: conv.ok ? conv.escala : null,
          stockMartinez,
          stockId,
          vendidos,
          devueltos,
          disponibleEnId: stockId > 0,
        };

        if (conv.ok) filas.push(base);
        else revisar.push({ ...base, motivoRevisar: conv.motivo });
      }
    }
    hasNext = !!conn?.pageInfo?.hasNextPage;
    cursor = conn?.pageInfo?.endCursor || null;
    onProgress?.(escaneados);
  }

  // Orden: primero lo más urgente (Martínez en 0), después por más vendido.
  const orden = (a: FilaReposicion, b: FilaReposicion) =>
    (a.stockMartinez - b.stockMartinez) || (b.vendidos - a.vendidos) || a.titulo.localeCompare(b.titulo);
  filas.sort(orden);
  revisar.sort(orden);

  return {
    desde,
    generadoEn: new Date().toISOString(),
    puedeLeerOrdenes: !errOrdenes,
    avisoOrdenes: errOrdenes,
    filas,
    revisar,
    productosEscaneados: escaneados,
  };
}
