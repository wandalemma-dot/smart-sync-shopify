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
// Regla (confirmada por Wanda): el código es la etiqueta que mezcla LETRAS Y
// NÚMEROS, sin espacios. Ejemplos reales: A15621C, D1604101, MA5676023,
// 172180C, 652517B. Las etiquetas de categoría son solo palabras
// (INDUMENTARIA, CALZADO) y las de tabla de talle tienen espacios.
export const PATRON_CODIGO = /^(?=.*\d)[A-Z0-9]{4,}$/;

// Etiquetas que NUNCA son código, aunque tengan números (ej. "TABLA DE TALLE
// CONVERSE 1" ya queda afuera por tener espacios, pero por las dudas).
const TAGS_IGNORADOS = ['TABLA DE TALLE', 'HOT SALE', 'AVADA'];

export function extraerCodigo(tags: string): string | null {
  const lista = String(tags || '').split(',').map(t => t.trim()).filter(Boolean);

  // 1) Preferimos el que además está en el maestro de curvas (Converse seguro).
  for (const raw of lista) {
    const limpio = raw.trim().toUpperCase();
    if (curvaDe(limpio)) return limpio;
  }

  // 2) Si no, el primero que mezcle letras y números sin espacios.
  for (const raw of lista) {
    const t = raw.trim().toUpperCase();
    if (TAGS_IGNORADOS.some(ig => t.includes(ig))) continue;
    if (/\s/.test(t)) continue;          // con espacios no es un código
    if (!/\d/.test(t)) continue;          // sin números tampoco (INDUMENTARIA)
    if (PATRON_CODIGO.test(t)) return t;
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
  vendMartinez: number;  // vendido despachado desde Martínez
  vendId: number;        // vendido despachado desde iD
  vendidos: number;      // total (Martínez + iD + sin asignar)
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
          fulfillmentOrders(first: 20) {
            edges {
              node {
                assignedLocation { name }
                lineItems(first: 100) {
                  edges { node { totalQuantity lineItem { sku variant { sku } } } }
                }
              }
            }
          }
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

// Trae ventas por SKU desde una fecha, SEPARADAS por sucursal de despacho
// (de dónde salió la mercadería), más las devoluciones.
interface Ventas {
  mar: Record<string, number>;   // despachado desde DEPOSITO MARTINEZ
  id: Record<string, number>;    // despachado desde iD
  otras: Record<string, number>; // otra sucursal o todavía sin despachar
  devol: Record<string, number>;
  error?: string;
}

async function traerVentas(desde: string): Promise<Ventas> {
  const mar: Record<string, number> = {};
  const idl: Record<string, number> = {};
  const otras: Record<string, number> = {};
  const devol: Record<string, number> = {};
  const sum = (obj: Record<string, number>, sku: string, n: number) => { obj[sku] = (obj[sku] || 0) + n; };

  try {
    let cursor: string | null = null;
    let hasNext = true;
    let guard = 0;
    while (hasNext && guard < 100) {
      guard++;
      const data: any = await shopifyGraphQL<any>(ORDERS_QUERY, { cursor, q: `created_at:>=${desde}` });
      const conn = data?.orders;
      for (const edge of (conn?.edges || [])) {
        const orden = edge.node;

        // Ventas por sucursal: usamos la sucursal a la que Shopify ASIGNÓ el
        // pedido (la que tenía el stock), no de dónde se despachó físicamente.
        // Si no, todo cae en Martínez porque desde ahí se envía siempre.
        const despachado: Record<string, number> = {};
        for (const fo of (orden.fulfillmentOrders?.edges || [])) {
          const locName = String(fo?.node?.assignedLocation?.name || '').trim().toUpperCase();
          const destino = locName === LOC_MARTINEZ.toUpperCase() ? mar
            : locName === LOC_ID.toUpperCase() ? idl
            : otras;
          for (const fli of (fo?.node?.lineItems?.edges || [])) {
            const n = fli.node;
            const sku = String(n.lineItem?.variant?.sku || n.lineItem?.sku || '').toUpperCase();
            if (!sku) continue;
            const cant = Number(n.totalQuantity) || 0;
            sum(destino, sku, cant);
            sum(despachado, sku, cant);
          }
        }

        // Lo que se vendió pero todavía no se despachó -> "otras" (sin asignar).
        for (const li of (orden.lineItems?.edges || [])) {
          const n = li.node;
          const sku = String(n.variant?.sku || n.sku || '').toUpperCase();
          if (!sku) continue;
          const cant = Number(n.quantity) || 0;
          const yaDespachado = despachado[sku] || 0;
          const pendiente = Math.max(0, cant - yaDespachado);
          if (pendiente > 0) sum(otras, sku, pendiente);

          // Devuelto = lo que ya no es reembolsable respecto de lo vendido.
          const refundable = n.refundableQuantity === undefined || n.refundableQuantity === null
            ? cant : Number(n.refundableQuantity);
          const dev = Math.max(0, cant - refundable);
          if (dev > 0) sum(devol, sku, dev);
        }
      }
      hasNext = !!conn?.pageInfo?.hasNextPage;
      cursor = conn?.pageInfo?.endCursor || null;
    }
    return { mar, id: idl, otras, devol };
  } catch (e: any) {
    return { mar, id: idl, otras, devol, error: e?.message || 'No se pudieron leer las órdenes' };
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
  const ventas = await traerVentas(desde);
  const errOrdenes = ventas.error;

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
        const vendMartinez = ventas.mar[sku] || 0;
        const vendId = ventas.id[sku] || 0;
        const vendidos = vendMartinez + vendId + (ventas.otras[sku] || 0);
        const devueltos = ventas.devol[sku] || 0;

        // Si iD no lo tiene, no se puede reponer: no va a la lista.
        if (stockId <= 0) continue;

        // Qué mostramos: lo que tuvo venta, o lo que está en 0 en Martínez.
        if (vendidos === 0 && stockMartinez > 0) continue;

        // Solo el CALZADO necesita conversión (talles numéricos: 38, 40.5...).
        // La indumentaria y los accesorios (S, M, L, XL, TU) se piden con el
        // talle tal cual viene: no hay tabla ni curva que aplicar.
        const esCalzado = /^\d/.test(talleAr);

        const conv: Conversion = !esCalzado
          ? { ok: true, talleAr, tallePedido: talleAr, escala: '—' }
          : codigo
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
          vendMartinez,
          vendId,
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

  // Orden: primero lo MÁS VENDIDO (es lo que más importa para pedir), y dentro
  // de eso, lo más urgente por stock bajo en Martínez.
  const orden = (a: FilaReposicion, b: FilaReposicion) =>
    (b.vendidos - a.vendidos) || (a.stockMartinez - b.stockMartinez) || a.titulo.localeCompare(b.titulo);
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
