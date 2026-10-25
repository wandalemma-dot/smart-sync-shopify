// ============================================================================
// REPOSICIÓN POR VENTAS (25-oct-2026) — qué traer de iD a Martínez
// ----------------------------------------------------------------------------
// Pedido de gax: elegir una marca de iD (Converse o Le Coq), leer de Shopify las
// ventas de los últimos 15 y 3 días, y mostrar los modelos que más se vendieron
// con cada talle desglosado: vendidos, stock en DEPOSITO MARTINEZ y stock en iD.
// Reemplaza a la Reposición anterior (export de órdenes + alertas de Martínez).
//
// - Ventas = currentQuantity de cada línea (lo vendido menos lo devuelto o
//   quitado de la orden). Órdenes canceladas y de prueba no cuentan.
// - La marca se decide por el vendor de la línea: no se lee la tienda entera.
// - El modelo es el producto de Shopify (modelo + color). Se muestran TODOS sus
//   talles, también los que no se vendieron, para reponer la curva.
// - Nivel de inventario null = la variante no está dada de alta en esa
//   sucursal. NO es cero: se muestra «—».
// - Talle a pedir: la misma conversión de siempre (etiqueta TABLA DE TALLE
//   manda, después el maestro). Si no se sabe, NO se adivina: «a revisar».
// SOLO LECTURA: no escribe nada en Shopify.
// ============================================================================
import { shopifyGraphQL, mismaSucursal } from './shopify';
import { extraerCodigo, LOC_ID, LOC_MARTINEZ } from './reposicionLogic';
import { convertirConverse, convertirLeCoq } from './conversorTalles';
import { escapeCSV, triggerDownload, todayStamp } from './csv';
import { esCalzadoLeCoq } from './syncLogic';

export type MarcaId = 'converse' | 'lecoq';
export const MARCAS_ID: Record<MarcaId, string> = { converse: 'Converse', lecoq: 'Le Coq Sportif' };
export const DIAS_LARGO = 15;
export const DIAS_CORTO = 3;

export function esDeMarca(vendor: string | null | undefined, marca: MarcaId): boolean {
  const v = String(vendor || '').toLowerCase();
  return marca === 'converse' ? v.includes('converse') : v.includes('coq');
}

// ---------- Tipos de lo que devuelve Shopify ----------
type Level = { quantities: { name: string; quantity: number }[] } | null;
interface Connection<T> { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
export interface LineaOrden {
  currentQuantity: number;
  vendor: string | null;
  variant: { id: string } | null;
  product: { id: string } | null;
}
export interface OrdenVenta {
  id: string;
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  lineItems: Connection<LineaOrden>;
}
export interface ProductoShopify {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  variants: Connection<{
    id: string;
    title: string;
    selectedOptions: { name: string; value: string }[];
    inventoryItem: { mar: Level; idl: Level } | null;
  }>;
}

// ---------- Resultado ----------
export interface VarianteReposicion {
  id: string;
  talle: string;
  tallePedido: string | null;
  escala: string | null;
  vendidos15: number;
  vendidos3: number;
  martinez: number | null;
  idStock: number | null;
  motivo?: string;
}
export interface ModeloReposicion {
  productId: string;
  titulo: string;
  codigo: string | null;
  estado: string;
  calzado: boolean;
  vendidos15: number;
  vendidos3: number;
  martinez: number;
  idStock: number;
  variantes: VarianteReposicion[];
  aviso?: string;
}
export interface ResultadoReposicionVentas {
  marca: MarcaId;
  desde: string;
  generadoEn: string;
  ordenes: number;
  modelos: ModeloReposicion[];
  avisos: string[];
}

// ---------- 1) Sumar ventas por variante ----------
export interface Ventas { v15: number; v3: number }
export interface VentasAcumuladas {
  porProducto: Map<string, Map<string, Ventas>>;
  ordenes: number;
  sinVariante: number;
}

export function nuevaAcumulacion(): VentasAcumuladas {
  return { porProducto: new Map(), ordenes: 0, sinVariante: 0 };
}

/** Suma las líneas de la marca. `corte` = desde cuándo cuenta como «últimos 3 días». */
export function acumularVentas(acc: VentasAcumuladas, ordenes: OrdenVenta[], marca: MarcaId, corte: Date): VentasAcumuladas {
  for (const o of ordenes) {
    if (o.cancelledAt || o.test) continue;
    const reciente = new Date(o.createdAt).getTime() >= corte.getTime();
    let cuenta = false;
    for (const l of o.lineItems.nodes) {
      if (!esDeMarca(l.vendor, marca)) continue;
      const q = Number(l.currentQuantity) || 0;
      if (q <= 0) continue;
      cuenta = true;
      if (!l.variant || !l.product) { acc.sinVariante += q; continue; }
      const vars = acc.porProducto.get(l.product.id) || new Map<string, Ventas>();
      const v = vars.get(l.variant.id) || { v15: 0, v3: 0 };
      v.v15 += q;
      if (reciente) v.v3 += q;
      vars.set(l.variant.id, v);
      acc.porProducto.set(l.product.id, vars);
    }
    if (cuenta) acc.ordenes++;
  }
  return acc;
}

// ---------- 2) Armar cada modelo con sus talles y stock ----------
function cantidad(level: Level | undefined): number | null {
  const value = level?.quantities.find(q => q.name === 'available')?.quantity;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const ROPA = /^(remera|campera|buzo|pantal[oó]n|short|medias|gorr[ao]|mochila|bolso|chomba|musculosa|vestido|parka|chaleco|calzas?|guantes|cuello|camiseta|riñonera|billetera|cord[oó]nes)\b/i;
/** Zapatilla / calzado: por tipo, título o etiqueta de tabla. Nunca solo por un talle numérico. */
export function esCalzado(p: Pick<ProductoShopify, 'title' | 'productType' | 'tags' | 'vendor'>, talles: string[]): boolean {
  if (ROPA.test(p.title.trim())) return false;
  if (/^(zapatillas|calzado|ojotas|botas|botitas|sandalias)$/i.test(p.productType.trim())) return true;
  if (/^(zapatillas|ojotas|botas|botitas|sandalias)\b/i.test(p.title.trim())) return true;
  if (p.tags.some(t => /^TABLA DE TALLE CONVERSE/i.test(t.trim()) || /^calzado$/i.test(t.trim()))) return true;
  if (/coq/i.test(p.vendor)) {
    const nombre = p.title.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return talles.some(t => esCalzadoLeCoq(nombre, t));
  }
  return false;
}

function talleDe(v: { title: string; selectedOptions: { name: string; value: string }[] }): string {
  const op = v.selectedOptions.find(o => /^(talle|talla|size)$/i.test(o.name.trim()));
  return op?.value || (v.selectedOptions.length <= 1 && v.title !== 'Default Title' ? v.title : '');
}

function convertirTalle(marca: MarcaId, p: ProductoShopify, codigo: string | null, talle: string) {
  if (!talle) return { ok: false as const, motivo: 'No se pudo identificar el talle de esta variante.' };
  const nombre = p.title.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const numerico = /^\d+([.,]\d+)?$/.test(talle) && (marca !== 'lecoq' || esCalzadoLeCoq(nombre, talle));
  if (!numerico) return { ok: true as const, tallePedido: talle, escala: '—' };
  return marca === 'converse' ? convertirConverse(codigo || '', talle, p.tags) : convertirLeCoq(talle);
}

const LETRAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', 'TU', 'U'];
function compararTalles(a: string, b: string): number {
  const ta = a.replace(',', '.'), tb = b.replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(ta) && /^\d+(\.\d+)?$/.test(tb)) return Number(ta) - Number(tb);
  const ia = LETRAS.indexOf(ta.toUpperCase()), ib = LETRAS.indexOf(tb.toUpperCase());
  if (ia >= 0 && ib >= 0) return ia - ib;
  return ta.localeCompare(tb, 'es', { numeric: true });
}

export function armarModelo(marca: MarcaId, p: ProductoShopify, ventas: Map<string, Ventas>): ModeloReposicion {
  const codigo = extraerCodigo(p.tags.join(', '));
  const variantes: VarianteReposicion[] = p.variants.nodes.map(v => {
    const talle = talleDe(v);
    const conv = convertirTalle(marca, p, codigo, talle);
    const vs = ventas.get(v.id) || { v15: 0, v3: 0 };
    return {
      id: v.id,
      talle: talle || v.title,
      tallePedido: conv.ok ? conv.tallePedido : null,
      escala: conv.ok ? conv.escala : null,
      vendidos15: vs.v15,
      vendidos3: vs.v3,
      martinez: cantidad(v.inventoryItem?.mar),
      idStock: cantidad(v.inventoryItem?.idl),
      motivo: conv.ok ? undefined : conv.motivo,
    };
  }).sort((a, b) => compararTalles(a.talle, b.talle));
  // Vendidos de talles que ya no existen en el producto (variante borrada) igual cuentan para el modelo.
  const conocidas = new Set(p.variants.nodes.map(v => v.id));
  let fuera15 = 0, fuera3 = 0;
  for (const [id, vs] of ventas) if (!conocidas.has(id)) { fuera15 += vs.v15; fuera3 += vs.v3; }
  const suma = (f: (v: VarianteReposicion) => number) => variantes.reduce((s, v) => s + f(v), 0);
  const avisos = [
    fuera15 ? `${fuera15} vendidos de talles que ya no existen en el producto.` : '',
  ].filter(Boolean);
  return {
    productId: p.id,
    titulo: p.title,
    codigo,
    estado: p.status,
    calzado: esCalzado(p, variantes.map(v => v.talle)),
    vendidos15: suma(v => v.vendidos15) + fuera15,
    vendidos3: suma(v => v.vendidos3) + fuera3,
    martinez: suma(v => Math.max(0, v.martinez ?? 0)),
    idStock: suma(v => Math.max(0, v.idStock ?? 0)),
    variantes,
    aviso: avisos.join(' ') || undefined,
  };
}

// ---------- 3) Filtrar y ordenar para la pantalla ----------
export interface Filtros { minimo: number; soloCalzado: boolean; orden: 'v15' | 'v3'; buscar?: string }
export function filtrarModelos(modelos: ModeloReposicion[], f: Filtros): ModeloReposicion[] {
  const q = (f.buscar || '').trim().toLowerCase();
  const clave = (m: ModeloReposicion) => f.orden === 'v3' ? m.vendidos3 : m.vendidos15;
  return modelos
    .filter(m => m.vendidos15 >= f.minimo && (!f.soloCalzado || m.calzado))
    .filter(m => !q || `${m.titulo} ${m.codigo || ''}`.toLowerCase().includes(q))
    .sort((a, b) => clave(b) - clave(a) || b.vendidos15 - a.vendidos15 || a.titulo.localeCompare(b.titulo));
}

// ---------- 4) Lectura de Shopify ----------
export const LOCATIONS_QUERY = `query RepoSucursales($cursor: String) {
  locations(first: 50, after: $cursor) { nodes { id name } pageInfo { hasNextPage endCursor } }
}`;

// 25 órdenes × 30 líneas: el costo pedido queda por debajo del límite de 1000.
export const ORDERS_QUERY = `query RepoVentas($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt cancelledAt test
      lineItems(first: 30) {
        pageInfo { hasNextPage endCursor }
        nodes { currentQuantity vendor variant { id } product { id } }
      }
    }
  }
}`;

export const ORDER_LINES_QUERY = `query RepoLineas($id: ID!, $cursor: String) {
  order(id: $id) {
    lineItems(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { currentQuantity vendor variant { id } product { id } }
    }
  }
}`;

// Variantes de varios productos a la vez (product_id:A OR product_id:B…).
// Un lote de productos con talles anidados pasaba el límite de costo de 1000.
export const VARIANTS_QUERY = `query RepoVariantes($cursor: String, $q: String!, $mar: ID!, $idl: ID!) {
  productVariants(first: 100, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title selectedOptions { name value }
      product { id title vendor productType status tags }
      inventoryItem {
        mar: inventoryLevel(locationId: $mar) { quantities(names: ["available"]) { name quantity } }
        idl: inventoryLevel(locationId: $idl) { quantities(names: ["available"]) { name quantity } }
      }
    }
  }
}`;
type VarianteLeida = ProductoShopify['variants']['nodes'][number] & { product: Omit<ProductoShopify, 'variants'> };

function siguiente<T>(conn: Connection<T> | undefined, anterior: string | null): string | null {
  if (!conn?.nodes || !conn.pageInfo) throw new Error('Shopify devolvió una respuesta incompleta. Volvé a consultar.');
  if (!conn.pageInfo.hasNextPage) return null;
  const cursor = conn.pageInfo.endCursor;
  if (!cursor || cursor === anterior) throw new Error('No se pudo completar la lectura de Shopify. Volvé a consultar.');
  return cursor;
}

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Si Shopify pide ir más despacio (THROTTLED), espera y reintenta. Cualquier otro error corta. */
async function consultar<T>(query: string, variables: Record<string, unknown>, espera = 2000): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      return await shopifyGraphQL<T>(query, variables);
    } catch (e) {
      if (intento >= 5 || !/THROTTLED/i.test(e instanceof Error ? e.message : '')) throw e;
      await esperar(espera * (intento + 1));
    }
  }
}

export interface Progreso { etapa: 'ventas' | 'stock'; hechas: number; total?: number }

export async function consultarReposicion(
  marca: MarcaId,
  onProgress?: (p: Progreso) => void,
  ahora: Date = new Date(),
  espera = 2000,
): Promise<ResultadoReposicionVentas> {
  // Sucursales: tienen que existir las dos, una sola vez cada una.
  const locations: { id: string; name: string }[] = [];
  let cursor: string | null = null;
  do {
    const data: { locations: Connection<{ id: string; name: string }> } = await consultar(LOCATIONS_QUERY, { cursor }, espera);
    cursor = siguiente(data.locations, cursor);
    locations.push(...data.locations.nodes);
  } while (cursor);
  const localizar = (nombre: string) => {
    const m = locations.filter(l => mismaSucursal(l.name, nombre));
    if (m.length !== 1) throw new Error(`No pude identificar una única sucursal «${nombre}» en Shopify.`);
    return m[0].id;
  };
  const mar = localizar(LOC_MARTINEZ), idl = localizar(LOC_ID);

  const desde = new Date(ahora.getTime() - DIAS_LARGO * 86400000);
  const corte = new Date(ahora.getTime() - DIAS_CORTO * 86400000);
  const acc = nuevaAcumulacion();
  let leidas = 0;
  do {
    const data: { orders: Connection<OrdenVenta> } = await consultar(ORDERS_QUERY, { cursor, q: `created_at:>='${desde.toISOString()}'` }, espera);
    cursor = siguiente(data.orders, cursor);
    for (const o of data.orders.nodes) {
      // Orden con más de 30 líneas: se leen las que faltan, nunca se cuentan a medias.
      let lc = siguiente(o.lineItems, null);
      while (lc) {
        const extra: { order: { lineItems: Connection<LineaOrden> } | null } = await consultar(ORDER_LINES_QUERY, { id: o.id, cursor: lc }, espera);
        if (!extra.order) throw new Error('No se pudo leer una orden completa. Volvé a consultar.');
        o.lineItems.nodes.push(...extra.order.lineItems.nodes);
        lc = siguiente(extra.order.lineItems, lc);
      }
    }
    acumularVentas(acc, data.orders.nodes, marca, corte);
    leidas += data.orders.nodes.length;
    onProgress?.({ etapa: 'ventas', hechas: leidas });
  } while (cursor);

  const ids = [...acc.porProducto.keys()];
  const productos = new Map<string, ProductoShopify>();
  const LOTE = 15;
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const q = lote.map(id => `product_id:${id.split('/').pop()}`).join(' OR ');
    let vc: string | null = null;
    do {
      const data: { productVariants: Connection<VarianteLeida> } = await consultar(VARIANTS_QUERY, { cursor: vc, q, mar, idl }, espera);
      vc = siguiente(data.productVariants, vc);
      for (const v of data.productVariants.nodes) {
        if (!v.product || !lote.includes(v.product.id)) continue;
        const p = productos.get(v.product.id) || { ...v.product, variants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
        p.variants.nodes.push({ id: v.id, title: v.title, selectedOptions: v.selectedOptions, inventoryItem: v.inventoryItem });
        productos.set(v.product.id, p);
      }
    } while (vc);
    onProgress?.({ etapa: 'stock', hechas: Math.min(i + LOTE, ids.length), total: ids.length });
  }
  const modelos: ModeloReposicion[] = [];
  let borrados = 0;
  for (const id of ids) {
    const p = productos.get(id);
    if (!p) { borrados++; continue; }
    modelos.push(armarModelo(marca, p, acc.porProducto.get(id)!));
  }

  const avisos = [
    acc.sinVariante ? `${acc.sinVariante} unidades vendidas de productos o talles que ya no existen en Shopify (no se pueden reponer).` : '',
    borrados ? `${borrados} productos vendidos ya no están en Shopify.` : '',
  ].filter(Boolean);
  return { marca, desde: desde.toISOString(), generadoEn: ahora.toISOString(), ordenes: acc.ordenes, modelos, avisos };
}

// ---------- 5) Exportar ----------
export function descargarReposicion(modelos: ModeloReposicion[], marca: MarcaId) {
  const n = (x: number | null) => x === null ? 'sin alta' : x;
  const header = ['Producto', 'Código', 'Talle tienda', 'Talle iD', 'Escala', `Vendidos ${DIAS_LARGO} días`, `Vendidos ${DIAS_CORTO} días`, 'Stock Martínez', 'Stock iD', 'Estado', 'Revisar'];
  const rows = modelos.flatMap(m => m.variantes.map(v => [
    m.titulo, m.codigo, v.talle, v.tallePedido, v.escala, v.vendidos15, v.vendidos3, n(v.martinez), n(v.idStock), m.estado, v.motivo,
  ]));
  triggerDownload([header, ...rows].map(r => r.map(escapeCSV).join(',')).join('\n'), `reposicion-${marca}-${todayStamp()}.csv`);
}
