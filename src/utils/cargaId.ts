// ============================================================================
// iD (CONVERSE / LE COQ) — CARGAR UNA ENTREGA EN SHOPIFY (12-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// «Con iD no tengo botón de carga»: lo que llegó (el remito, menos lo que salió para
// órdenes con la marca «-1» a mano) se SUMA al stock de DEPOSITO MARTINEZ, que es el
// depósito propio. La sucursal de iD es el stock del proveedor: esa la lleva la
// sincronización, no se toca acá.
//   · Solo reposición: si el producto no está en Shopify, se crea desde Sincronización
//     (ahí están las tablas de talle, los títulos y los precios de iD) y se vuelve a armar.
//   · El talle del remito es el del proveedor: Converse en US (la tabla la da la etiqueta
//     TABLA DE TALLE del producto; sin etiqueta se ELIGE en la vista previa y se le agrega al
//     cargar: el maestro de curvas solo se sugiere, no se usa solo, 17-nov-2026) y
//     Le Coq calzado uno más que en Shopify (talleShopifyLeCoq). Letras van tal cual.
//   · Precio y costo con la factura (gax): margen con el costo nuevo; 50% o más = verde;
//     menos = hay que poner un precio nuevo para TODA la curva (básicos: se avisa, no obliga).
//     El costo nuevo va a los talles que llegan y a los que están en 0 en Martínez. Un talle que
//     llega y ya tenía stock en Martínez lleva el promedio ponderado (lo que había a su costo +
//     lo que llega al costo nuevo); los que tienen stock y no llegan conservan el suyo. Se
//     escribe por /api/prices ANTES del stock (el servidor relee stock y costo del promedio).
//   · Vendido en iD (12-nov-2026, gax): las ventas sin preparar asignadas a la sucursal de iD
//     (las que se le piden a iD) se SEPARAN de lo que llegó y no se suman a Martínez. Se leen en
//     vivo (fulfillment orders abiertas de iD); lo que el depósito ya marcó «-1» en el remito cuenta
//     como separado. Órdenes canceladas, sin pagar o con la etiqueta «solucionar» no se descuentan:
//     se avisan. Si ya se separó antes, «cargarlo igual» suma todo.
//   · Packs (13-nov-2026, gax: «la factura dice por 6, es porque son 6 bandas»): iD factura y manda el pack entero y
//     la tienda vende por unidad. Con «X6» en el nombre de la factura o en el título de Shopify (la misma regla que
//     Sincronización), cada pack del remito se carga como 6 unidades y el costo es por unidad: lista ÷ 6 − bonificación.
//     Si ninguno lo dice, la lista de packs de la plantilla de iD (`packsId.ts`, por código). Si dicen cantidades
//     distintas, o el código de Le Coq termina en P y nadie dice cuántas trae, no se adivina; se escribe a mano.
// La ejecución, la marca «una sola vez» y la vista previa son las mismas de Family.
// ============================================================================
import { claveCodigo, fmt, type FilaChecklist, type RenglonFactura, type ResultadoFactura } from './controlFacturas';
import {
  llegaAl50, textoCarga, type TablaItem, type AjustePrecio, type CubiertaOrden, type EleccionesCarga, type LineaFOId, type LineaOrdenId, type ModoVenta, type MoverVenta, type NoEntroCarga, type SepararId, type CargaFamily, type ItemCarga, type LineaReposicion, type OpcionCarga, type PackCarga, type PlanCarga, type ReposicionFamily,
} from './cargaFamily';
import { esPrecioSugerido } from './conversePreciosFijos';
import { margenPct } from './margen';
import { packConocidoId, pareceCodigoPackId, unidadesPorPackId } from './packsId';
import { CONVERSE_CODE_TABLE } from './converseCurvas';
import { convTable1, convTable2, convTable3, convTable4, convTable5, convTable6, LOC_MARTINEZ_NOMBRE, precioId, redondear2, tablaDesdeEtiquetaTalle, talleShopifyLeCoq } from './syncLogic';
import { mismaSucursal } from './shopify';

export const SUCURSAL_CARGA_ID = LOC_MARTINEZ_NOMBRE;
/** Sucursal del proveedor: sus ventas sin preparar son las que se separan de la entrega. */
export const SUCURSAL_ID = 'ID (Converse - Le Coq Sportif)';

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

export interface VarianteId { id: string; talle: string; sku: string; inventoryItemId: string; seguimiento: boolean; disponible: number | null; precio: number | null; costo: number | null }
export interface ProductoId { id: string; titulo: string; vendor: string; estado: string; etiquetas: string[]; variantes: VarianteId[]; /** Nombres de las opciones (Talle…). */ opciones?: string[] }
export interface EstadoCargaId {
  locationId: string;
  /** código de la factura → productos de Shopify que lo llevan en el SKU o en una etiqueta. */
  porCodigo: Record<string, string[]>;
  productos: Record<string, ProductoId>;
  /** Ventas sin preparar asignadas a iD, por variante (lo que llega puede ser para ellas). */
  pendientesId?: Record<string, OrdenPendienteId[]>;
  /** No se pudieron leer: se avisa y no se separa nada. */
  errorPendientes?: string;
  /** Todo lo que cada una de esas órdenes espera de iD (para decir cuáles ya pueden salir). */
  ordenesId?: Record<string, LineaOrdenId[]>;
  /** La sucursal de iD (para dejar su stock como estaba al pasar una venta a Martínez). */
  idLocationId?: string;
  /** Canal Point of Sale (Distrinando: los productos nuevos se publican ahí). */
  posId?: string | null;
}

export interface OrdenPendienteId {
  nombre: string; fecha: string; cantidad: number;
  /** false = se avisa pero no se descuenta (cancelada, sin pagar o «solucionar»). */
  cuenta: boolean; motivo?: string;
  /** La línea de la preparación en iD (para pasar la venta a Martínez). */
  fo?: LineaFOId;
}

const buscable = (c: string) => /^[A-Z0-9._-]+$/.test(c);
/** Formas de escribir el código: la O y el 0 se confunden en las facturas de iD. */
export function formasCodigo(codigo: string): string[] {
  const c = String(codigo ?? '').trim().toUpperCase();
  const out = new Set([c, c.replace(/O/g, '0')]);
  if (/0$/.test(c)) out.add(c.replace(/0$/, 'O'));
  return [...out].filter(buscable);
}
const mismoCodigo = (a: string, b: string) => claveCodigo(a) === claveCodigo(b);
/** El SKU es de ese código: igual o seguido de un separador (A10520C-40, LFO0125084.40). */
function skuDelCodigo(sku: string, codigo: string): boolean {
  const s = String(sku ?? '').trim().toUpperCase();
  for (const c of formasCodigo(codigo)) {
    if (!s.startsWith(c)) continue;
    const resto = s.slice(c.length);
    if (!resto || /^[.\-_/ ]/.test(resto)) return true;
  }
  return false;
}
export const etiquetaDelCodigo = (etiquetas: string[], codigo: string) => etiquetas.some((t) => mismoCodigo(String(t).trim(), codigo));

const Q_SUCURSALES = `query { locations(first: 100) { nodes { id name } } }`;
const Q_CANALES = `query { publications(first: 50) { nodes { id name } } }`;
const Q_VARIANTES = `query($q: String!, $cursor: String) {
  productVariants(first: 100, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { sku product { id tags } }
  }
}`;
const Q_PRODUCTO = `query($id: ID!, $loc: ID!) {
  product(id: $id) {
    id title vendor status tags options { name }
    variants(first: 100) { nodes { id title sku price inventoryItem { id tracked unitCost { amount } inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } } } } }
  }
}`;
const Q_PENDIENTES_ID = `query($q: String!, $cursor: String) {
  fulfillmentOrders(first: 20, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id status
      order { name createdAt cancelledAt displayFinancialStatus tags }
      lineItems(first: 40) { pageInfo { hasNextPage endCursor } nodes { id remainingQuantity productTitle variantTitle variant { id } } }
    }
  }
}`;
const Q_LINEAS_FO = `query($id: ID!, $cursor: String) {
  fulfillmentOrder(id: $id) { lineItems(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id remainingQuantity productTitle variantTitle variant { id } } } }
}`;
interface Pagina<T> { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] }
type NodoProducto = {
  id: string; title: string; vendor: string; status: string; tags?: string[]; options?: { name: string }[];
  variants: { nodes: { id: string; title: string; sku: string | null; price?: string | null; inventoryItem: { id: string; tracked: boolean; unitCost?: { amount: string } | null; inventoryLevel: { quantities: { name: string; quantity: number }[] } | null } | null }[] };
};

/** Lee lo que hace falta para armar la carga (solo lectura). Si algo falla, no se arma nada. */
export async function leerEstadoCargaId(codigos: string[], gql: Gql, opts: { ventasId?: boolean; pos?: boolean } = {}): Promise<EstadoCargaId> {
  const suc = (await gql(Q_SUCURSALES)) as { locations: { nodes: { id: string; name: string }[] } };
  const loc = suc.locations.nodes.find((l) => mismaSucursal(l.name, SUCURSAL_CARGA_ID));
  if (!loc) throw new Error(`No encontré la sucursal ${SUCURSAL_CARGA_ID} en Shopify. No se cargó nada.`);
  const unicos = [...new Set(codigos.map((c) => c.toUpperCase()))];
  const porCodigo: Record<string, string[]> = {};
  const formas = unicos.flatMap(formasCodigo);
  const ids = new Set<string>();
  const hallados: { sku: string; id: string; tags: string[] }[] = [];
  for (let i = 0; i < formas.length; i += 10) {
    const q = formas.slice(i, i + 10).map((c) => `sku:${c}* OR tag:${c}`).join(' OR ');
    let cursor: string | null = null;
    for (let pagina = 0; pagina < 30; pagina++) {
      const d = (await gql(Q_VARIANTES, { q, cursor })) as { productVariants: Pagina<{ sku: string | null; product: { id: string; tags?: string[] } }> };
      for (const n of d.productVariants.nodes) hallados.push({ sku: n.sku || '', id: n.product.id, tags: n.product.tags ?? [] });
      if (!d.productVariants.pageInfo.hasNextPage) break;
      cursor = d.productVariants.pageInfo.endCursor;
    }
  }
  for (const c of unicos) {
    const s = new Set(hallados.filter((h) => skuDelCodigo(h.sku, c) || etiquetaDelCodigo(h.tags, c)).map((h) => h.id));
    porCodigo[c] = [...s];
    for (const id of s) ids.add(id);
  }
  const productos: Record<string, ProductoId> = {};
  for (const id of ids) {
    const d = (await gql(Q_PRODUCTO, { id, loc: loc.id })) as { product: NodoProducto | null };
    const p = d.product;
    if (!p) continue;
    productos[id] = {
      id: p.id, titulo: p.title, vendor: p.vendor || '', estado: p.status, etiquetas: p.tags ?? [], opciones: (p.options ?? []).map((o) => o.name),
      variantes: p.variants.nodes.map((v) => {
        const nivel = v.inventoryItem?.inventoryLevel;
        const q = nivel?.quantities.find((x) => x.name === 'available');
        return {
          // Producto sin talles (mochilas, gorras): su variante única se muestra como TU, igual que en el remito.
          id: v.id, talle: v.title === 'Default Title' ? 'TU' : v.title, sku: v.sku || '', inventoryItemId: v.inventoryItem?.id || '', seguimiento: !!v.inventoryItem?.tracked,
          // Sin nivel = la variante no está dada de alta en Martínez (no es cero).
          disponible: nivel ? (Number.isFinite(Number(q?.quantity)) ? Number(q!.quantity) : null) : null,
          precio: v.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : null,
          costo: v.inventoryItem?.unitCost?.amount != null && Number(v.inventoryItem.unitCost.amount) > 0 ? Number(v.inventoryItem.unitCost.amount) : null,
        };
      }),
    };
  }
  const estado: EstadoCargaId = { locationId: loc.id, porCodigo, productos };
  if (opts.pos) {
    const can = (await gql(Q_CANALES)) as { publications: { nodes: { id: string; name: string }[] } };
    estado.posId = can.publications.nodes.find((p) => {
      const n = String(p.name || '').toLowerCase();
      return n.includes('point of sale') || n.includes('punto de venta') || n === 'pos';
    })?.id ?? null;
  }
  // Distrinando: no hay ventas de iD que separar.
  if (opts.ventasId === false) return estado;
  const locId = suc.locations.nodes.find((l) => mismaSucursal(l.name, SUCURSAL_ID));
  if (!locId) estado.errorPendientes = `no encontré la sucursal ${SUCURSAL_ID}`;
  else estado.idLocationId = locId.id;
  if (locId && ids.size) {
    const variantes = new Set(Object.values(productos).flatMap((p) => p.variantes.map((v) => v.id)));
    try { ({ porVariante: estado.pendientesId, porOrden: estado.ordenesId } = await leerVentasId(locId.id, variantes, gql)); }
    catch (e) { estado.errorPendientes = e instanceof Error ? e.message : 'error'; }
  }
  return estado;
}

type LineaFO = { id?: string; remainingQuantity: number; productTitle?: string; variantTitle?: string | null; variant: { id: string } | null };
type NodoFO = {
  id: string; status: string;
  order: { name: string; createdAt: string; cancelledAt: string | null; displayFinancialStatus: string | null; tags?: string[] } | null;
  lineItems: Pagina<LineaFO>;
};
const PAGADA = new Set(['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED']);
/** Ventas sin preparar asignadas a iD (solo lectura), de las variantes que interesan. */
export async function leerPendientesId(locationId: string, variantes: Set<string>, gql: Gql): Promise<Record<string, OrdenPendienteId[]>> {
  return (await leerVentasId(locationId, variantes, gql)).porVariante;
}
/** Lo mismo, y además todo lo que esas órdenes esperan de iD (cualquier artículo). */
export async function leerVentasId(locationId: string, variantes: Set<string>, gql: Gql): Promise<{ porVariante: Record<string, OrdenPendienteId[]>; porOrden: Record<string, LineaOrdenId[]> }> {
  const num = locationId.split('/').pop();
  const out: Record<string, OrdenPendienteId[]> = {};
  const todas: Record<string, LineaOrdenId[]> = {};
  const tocadas = new Set<string>();
  let cursor: string | null = null;
  for (let pagina = 0; ; pagina++) {
    if (pagina >= 80) throw new Error('hay demasiadas ventas pendientes en iD para leerlas todas');
    const d = (await gql(Q_PENDIENTES_ID, { q: `assigned_location_id:${num}`, cursor })) as { fulfillmentOrders: Pagina<NodoFO> };
    for (const fo of d.fulfillmentOrders.nodes) {
      if (fo.status !== 'OPEN' && fo.status !== 'IN_PROGRESS') continue;
      const o = fo.order;
      if (!o || o.cancelledAt) continue;
      const lineas = [...fo.lineItems.nodes];
      let lc = fo.lineItems.pageInfo.hasNextPage ? fo.lineItems.pageInfo.endCursor : null;
      for (let i = 0; lc && i < 20; i++) {
        const m = (await gql(Q_LINEAS_FO, { id: fo.id, cursor: lc })) as { fulfillmentOrder: { lineItems: Pagina<LineaFO> } | null };
        if (!m.fulfillmentOrder) break;
        lineas.push(...m.fulfillmentOrder.lineItems.nodes);
        lc = m.fulfillmentOrder.lineItems.pageInfo.hasNextPage ? m.fulfillmentOrder.lineItems.pageInfo.endCursor : null;
      }
      const solucionar = (o.tags ?? []).some((t) => String(t).trim().toLowerCase() === 'solucionar');
      const pagada = PAGADA.has(String(o.displayFinancialStatus || ''));
      const motivo = solucionar ? 'etiqueta solucionar' : pagada ? undefined : 'sin pagar';
      for (const l of lineas) {
        if (l.id && l.remainingQuantity > 0) (todas[o.name] ??= []).push({ lineaId: l.id, titulo: l.productTitle || 'artículo', talle: l.variantTitle || '', cantidad: l.remainingQuantity });
        const id = l.variant?.id;
        if (!id || !variantes.has(id) || !(l.remainingQuantity > 0)) continue;
        if (!motivo) tocadas.add(o.name);
        const enFO = l.id ? { fo: { id: fo.id, lineaId: l.id, abierta: fo.status === 'OPEN' } } : {};
        (out[id] ??= []).push({ nombre: o.name, fecha: o.createdAt, cantidad: l.remainingQuantity, cuenta: !motivo, ...(motivo ? { motivo } : {}), ...enFO });
      }
    }
    if (!d.fulfillmentOrders.pageInfo.hasNextPage) break;
    cursor = d.fulfillmentOrders.pageInfo.endCursor;
  }
  for (const xs of Object.values(out)) xs.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const porOrden: Record<string, LineaOrdenId[]> = {};
  for (const n of tocadas) porOrden[n] = todas[n] ?? [];
  return { porVariante: out, porOrden };
}

/**
 * Cuánto de lo que llegó de una variante es para ventas de iD: hasta lo pendiente (de la más vieja a la más
 * nueva), sin pasar lo que llegó. Lo que el depósito ya marcó «-1» cuenta como separado (no se separa dos veces).
 */
export function separarDe(ordenes: OrdenPendienteId[], cantidad: number, retirado: number): { cantidad: number; ordenes: { nombre: string; cantidad: number; fo?: LineaFOId }[]; retirados: { nombre: string; cantidad: number; fo?: LineaFOId }[] } {
  const cuentan = ordenes.filter((o) => o.cuenta);
  const pendiente = cuentan.reduce((s, o) => s + o.cantidad, 0);
  const total = Math.min(cantidad + retirado, pendiente);
  const sep = Math.max(0, Math.min(cantidad, total - retirado));
  const out: { nombre: string; cantidad: number; fo?: LineaFOId }[] = [];
  const retirados: { nombre: string; cantidad: number; fo?: LineaFOId }[] = [];
  let saltar = retirado, falta = sep;
  for (const o of cuentan) {
    let q = o.cantidad;
    const s = Math.min(saltar, q); saltar -= s; q -= s;
    if (s > 0) retirados.push({ nombre: o.nombre, cantidad: s, ...(o.fo ? { fo: o.fo } : {}) });
    const t = Math.min(falta, q); falta -= t;
    if (t > 0) out.push({ nombre: o.nombre, cantidad: t, ...(o.fo ? { fo: o.fo } : {}) });
    if (!falta && !saltar) break;
  }
  return { cantidad: sep, ordenes: out, retirados };
}

// ---------------------------------------------------------------------------
// TALLE DEL PROVEEDOR → TALLE DE SHOPIFY
// ---------------------------------------------------------------------------
type Marca = 'converse' | 'lecoq';
export function marcaDe(vendor: string): Marca | null {
  const v = String(vendor ?? '').toUpperCase();
  if (v.includes('CONVERSE')) return 'converse';
  if (v.includes('COQ')) return 'lecoq';
  return null;
}
const esNumero = (s: string) => /^\d+([.,]\d+)?$/.test(s);
const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Tablas de talle de Converse que se pueden elegir en la carga (17-nov-2026, gax): la clave es la etiqueta que se le
 * agrega al producto. `nro` = el número del maestro de curvas (`converseCurvas.ts`).
 */
export const TABLAS_CONVERSE: { etiqueta: string; nro: number; tabla: Record<string, string> }[] = [
  { etiqueta: 'TABLA DE TALLE CONVERSE 1', nro: 1, tabla: convTable1 },
  { etiqueta: 'TABLA DE TALLE CONVERSE 2', nro: 2, tabla: convTable2 },
  { etiqueta: 'TABLA DE TALLE CONVERSE MUJER', nro: 3, tabla: convTable3 },
  { etiqueta: 'TABLA DE TALLE CONVERSE MUJER 2', nro: 6, tabla: convTable6 },
  { etiqueta: 'TABLA DE TALLE CONVERSE NIÑO', nro: 4, tabla: convTable4 },
  { etiqueta: 'TABLA DE TALLE CONVERSE BEBE', nro: 5, tabla: convTable5 },
];
const tablaConverse = (etiqueta: string | undefined) => TABLAS_CONVERSE.find((t) => t.etiqueta === etiqueta);
/** «055» o «5.5» = US 5.5 (Converse); Le Coq tal cual. */
const numeroProveedor = (marca: Marca, t: string) => (/^\d{3}$/.test(t) ? Number(t) / (marca === 'converse' ? 10 : 1) : Number(t));
const normTalleProv = (talle: string) => String(talle ?? '').trim().toUpperCase().replace(',', '.');
/** La tabla de la etiqueta TABLA DE TALLE del producto (null = no tiene, o es una que no reconozco). */
const tablaDeEtiqueta = (etiquetas: string[]) => tablaDesdeEtiquetaTalle(etiquetas.join(', '));
const sinTabla = (error: string) => error.startsWith('el producto no tiene la etiqueta TABLA DE TALLE');

/**
 * El talle del remito o de la nota en el de Shopify. Nunca adivina: si no se sabe, devuelve el motivo.
 * Converse: «055» o «5.5» = US 5.5 → AR por la tabla de la etiqueta TABLA DE TALLE del producto. Sin etiqueta, la
 * tabla elegida en la vista previa (17-nov-2026, gax: la A10548C no tenía etiqueta, el maestro decía tabla 2 y era la
 * 1: se cargó un talle que no era). El maestro de curvas ya no se usa solo. Le Coq: «040» o «40» → calzado 39.
 */
export function talleEnShopify(marca: Marca, talle: string, _codigo: string, etiquetas: string[], nombreProveedor: string, elegida?: string): { talle: string } | { error: string } {
  const t = normTalleProv(talle);
  if (!esNumero(t)) return { talle: t };
  const n = numeroProveedor(marca, t);
  if (marca === 'lecoq') return { talle: talleShopifyLeCoq(fmtNum(n), nombreProveedor) };
  const tabla = tablaDeEtiqueta(etiquetas) ?? tablaConverse(elegida)?.tabla;
  if (!tabla) return { error: 'el producto no tiene la etiqueta TABLA DE TALLE: elegí la tabla abajo' };
  const ar = tabla[fmtNum(n)];
  return ar ? { talle: ar } : { error: `el US ${fmtNum(n)} no está en su tabla de talle` };
}

/**
 * Converse sin etiqueta TABLA DE TALLE (17-nov-2026, gax: «que detecte que no tiene etiqueta de tabla de talle, para que
 * no cargue talles que en realidad no son»): el selector de la tabla. Ninguna viene elegida; la del maestro de iD se
 * marca como sugerencia. Una tabla que no tiene un US que llegó, o que lo manda a un talle que el producto no tiene, no
 * se puede elegir. null = no hace falta (tiene etiqueta, no es Converse o no llegaron talles numéricos).
 */
export function tablaCargaId(fila: FilaChecklist, productos: (ProductoId | undefined)[], elegida: string | undefined): TablaItem | null {
  const sinEtiqueta = productos.filter((p): p is ProductoId => !!p && marcaDe(p.vendor) === 'converse' && !tablaDeEtiqueta(p.etiquetas));
  const us = [...new Set((fila.talles ?? []).filter((t) => t.cantidad > 0).map((t) => normTalleProv(t.talle)).filter(esNumero).map((t) => fmtNum(numeroProveedor('converse', t))))];
  if (!sinEtiqueta.length || !us.length) return null;
  const maestro = TABLAS_CONVERSE.find((t) => t.nro === CONVERSE_CODE_TABLE[fila.codigo.toUpperCase()]);
  const evaluadas = TABLAS_CONVERSE.map((t) => {
    const falta = us.find((u) => !t.tabla[u]);
    if (falta) return { ...t, bloqueo: `no tiene el US ${falta}` };
    for (const p of sinEtiqueta) {
      const no = us.find((u) => !p.variantes.some((v) => igualTalle(v.talle, t.tabla[u])));
      if (no) return { ...t, bloqueo: `el US ${no} va al ${t.tabla[no]}, y el producto no tiene ese talle` };
    }
    return { ...t, bloqueo: '' };
  });
  const valida = evaluadas.find((t) => t.etiqueta === elegida && !t.bloqueo);
  const conv = (t: typeof evaluadas[number]) => us.map((u) => `US ${u} → ${t.tabla[u]}`).join(', ');
  return {
    elegida: valida ? valida.etiqueta : '',
    actual: null,
    hace: true,
    avisos: [`El producto no tiene la etiqueta TABLA DE TALLE: no sé en qué talle va cada par. Mirá la caja (o la tabla de la web) y elegí la tabla; se la agrego al cargar.${maestro ? ` El maestro de iD dice ${maestro.etiqueta.replace('TABLA DE TALLE ', '')}, pero a veces se equivoca.` : ''}`],
    opciones: [
      { clave: '', etiqueta: 'Elegí la tabla de talle…' },
      ...evaluadas.map((t) => ({
        clave: t.etiqueta,
        etiqueta: `${t.etiqueta}${t === evaluadas.find((x) => x.nro === maestro?.nro) ? ' (sugerida por el maestro)' : ''}${t.bloqueo ? '' : `: ${conv(t)}`}`,
        ...(t.bloqueo ? { bloqueo: t.bloqueo } : {}),
      })),
    ],
  };
}
/** El mismo talle en Shopify: «39» = «39.0», «xl» = «XL». */
/**
 * Talle único (16-nov-2026, gax: MA5672FF7, mochila con «TU» en el remito y sin talles en Shopify): TU, U, ÚNICO,
 * talle único u OS del remito es el mismo que la variante única de un producto sin talles («Default Title»).
 */
const SIN_TALLE = new Set(['TU', 'T.U.', 'U', 'UNICO', 'TALLEUNICO', 'OS', 'ONESIZE', 'DEFAULTTITLE']);
export const esSinTalle = (t: string) => SIN_TALLE.has(String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ''));

function igualTalle(a: string, b: string): boolean {
  const A = String(a ?? '').trim().toUpperCase().replace(',', '.'), B = String(b ?? '').trim().toUpperCase().replace(',', '.');
  if (A === B) return true;
  if (esSinTalle(A) && esSinTalle(B)) return true;
  return esNumero(A) && esNumero(B) && Number(A) === Number(B);
}

/** Cómo se ve un talle de Shopify: «Default Title» (producto sin talles) es TU. */
const verTalle = (t: string) => (String(t ?? '') === 'Default Title' ? 'TU' : String(t ?? ''));
/** Los talles que tiene hoy el producto en Shopify (sin repetir, en su orden). */
function tallesShopify(p: ProductoId): string[] {
  const out: string[] = [];
  for (const v of p.variantes) if (!out.some((x) => igualTalle(x, v.talle))) out.push(v.talle);
  return out.map(verTalle);
}

/**
 * iD (19-nov-2026, gax, medias LAN0122018P: la foto del remito leyó «12/1» y en Shopify solo existen el 1 y el 2): para
 * cada talle que llegó, en qué talle de Shopify entra y cuáles tiene hoy el producto, para elegirlo a mano. Lo elegido
 * manda; si no, el automático (la conversión de siempre) cuando existe. Solo con un producto en Shopify.
 */
export function destinosId(fila: FilaChecklist, descripcion: string, p: ProductoId | undefined, tabla: string, elegidos: Readonly<Record<string, string>> = {}):
  Record<string, { destino: string; manual: boolean; enShopify: string[]; problema?: string }> | null {
  const marca = p ? marcaDe(p.vendor) : null;
  if (!p || !marca || !fila.talles) return null;
  const enShopify = tallesShopify(p);
  if (!enShopify.length) return null;
  const out: Record<string, { destino: string; manual: boolean; enShopify: string[]; problema?: string }> = {};
  for (const t of fila.talles) {
    const aMano = elegidos[t.talle];
    const v = aMano ? p.variantes.find((x) => igualTalle(x.talle, aMano)) : undefined;
    if (v) { out[t.talle] = { destino: verTalle(v.talle), manual: true, enShopify }; continue; }
    const conv = talleEnShopify(marca, t.talle, fila.codigo, p.etiquetas, descripcion, tabla);
    if ('error' in conv) { out[t.talle] = { destino: '', manual: false, enShopify, ...(sinTabla(conv.error) ? {} : { problema: conv.error }) }; continue; }
    const w = p.variantes.find((x) => igualTalle(x.talle, conv.talle));
    out[t.talle] = w ? { destino: verTalle(w.talle), manual: false, enShopify } : { destino: '', manual: false, enShopify, problema: `no existe el talle ${conv.talle} en Shopify` };
  }
  return out;
}

// ---------------------------------------------------------------------------
// PACKS (13-nov-2026, gax)
// ---------------------------------------------------------------------------
/**
 * Cuántas unidades trae cada pack: el «X6» del nombre en la factura o del título del producto en Shopify, con la misma
 * regla que Sincronización (`unidadesPorPackId`: «X6», «X 6», con separadores), o la lista de packs de la plantilla de
 * iD (`packConocidoId`, por código). Si dicen cantidades distintas, no se adivina. Un código de Le Coq terminado en P
 * es un pack: si nadie dice cuántas trae, tampoco se adivina. Lo escrito a mano manda (1 = no viene en pack).
 */
export function packDeCarga(descripcion: string, titulos: string[], manual?: number, codigo = ''): Pick<PackCarga, 'unidades' | 'fuente' | 'manual' | 'error'> {
  if (manual !== undefined && Number.isInteger(manual) && manual >= 1) return { unidades: manual, fuente: 'lo escribiste a mano', manual: true };
  const deFactura = unidadesPorPackId(String(descripcion ?? ''));
  const deShopify = [...new Set(titulos.map((t) => unidadesPorPackId(String(t ?? ''))).filter((n) => n > 1))];
  const dePlantilla = packConocidoId(codigo) ?? 1;
  const todos = [...new Set([deFactura, ...deShopify, dePlantilla].filter((n) => n > 1))];
  if (todos.length > 1) {
    const dicen = enumerar([
      deFactura > 1 ? `la factura dice packs de ${deFactura}` : '',
      deShopify.length ? `el nombre en Shopify dice ${deShopify.join(' y ')}` : '',
      dePlantilla > 1 ? `la plantilla de iD dice ${dePlantilla}` : '',
    ]);
    return { unidades: 1, fuente: '', error: `No sé cuántas unidades trae cada pack: ${dicen}.` };
  }
  if (!todos.length) {
    return pareceCodigoPackId(codigo)
      ? { unidades: 1, fuente: '', error: 'El código termina en P (en iD es un pack), pero ni la factura ni el nombre en Shopify dicen cuántas unidades trae.' }
      : { unidades: 1, fuente: '' };
  }
  const fuentes = enumerar([deFactura > 1 ? 'la factura' : '', deShopify.length ? 'el nombre en Shopify' : '', dePlantilla > 1 ? 'la plantilla de iD' : '']);
  return { unidades: todos[0], fuente: `lo dice ${fuentes}` };
}
/** «a», «a y b», «a, b y c» (sin los vacíos). */
function enumerar(partes: string[]): string {
  const p = partes.filter(Boolean);
  return p.length > 1 ? `${p.slice(0, -1).join(', ')} y ${p[p.length - 1]}` : (p[0] ?? '');
}

// ---------------------------------------------------------------------------
// PLAN (vista previa)
// ---------------------------------------------------------------------------
/** Lo que identifica la mercadería cargada: fecha, código, unidades, talles y remito. */
export function firmaCargaId(fecha: string, remito: string, fila: Pick<FilaChecklist, 'codigo' | 'talles'>): string {
  const talles = (fila.talles ?? []).filter((t) => t.cantidad > 0).map((t) => `${t.talle}:${t.cantidad}`).sort().join(',');
  const unidades = (fila.talles ?? []).reduce((s, t) => s + t.cantidad, 0);
  return `${fecha}|${fila.codigo}|${unidades}|${talles}|${String(remito || '').replace(/\|/g, '')}`;
}

/**
 * Precio y costo con la factura (12-nov-2026, gax): margen con el precio actual y el costo nuevo;
 * 50% o más = verde; menos, hay que poner un precio nuevo a TODA la curva (los precios son iguales
 * en todos los talles). El costo nuevo va a los talles que llegan y a los que están en 0 en Martínez;
 * los que llegan con stock en Martínez llevan el promedio ponderado (costo actual desconocido: no se
 * inventa, conserva el suyo); los que tienen stock en Martínez y no llegan conservan el suyo.
 */
export function ajusteDe(p: ProductoId, ren: RenglonFactura, lineas: LineaReposicion[], precio?: { sugerido: number; basico: boolean }): AjustePrecio | null {
  const lista = Number(ren.precioUnitario) || 0;
  if (!(lista > 0)) return null;
  const costoNuevo = redondear2(lista * (1 - (Number(ren.bonificacion) || 0) / 100));
  const precios = [...new Set(p.variantes.map((v) => v.precio).filter((x): x is number => x !== null))];
  const precioActual = precios.length === 1 && !p.variantes.some((v) => v.precio === null) ? precios[0] : null;
  const margen = precioActual !== null ? margenPct(precioActual, costoNuevo) : null;
  const llegan = new Map(lineas.map((l) => [l.inventoryItemId, l.suma]));
  const costos: AjustePrecio['costos'] = [];
  const conservan: AjustePrecio['conservan'] = [];
  const ponderados: AjustePrecio['ponderados'] = [];
  for (const v of p.variantes) {
    const stock = v.disponible ?? 0;
    if (stock > 0) {
      const suma = llegan.get(v.inventoryItemId);
      if (!suma) conservan.push({ talle: v.talle, stock, costo: v.costo });
      else if (v.costo === null) conservan.push({ talle: v.talle, stock, costo: null, motivo: 'su costo actual es cero o desconocido: no se puede promediar' });
      else {
        const costo = costoPromedio(stock, v.costo, suma, costoNuevo);
        if (Math.round(costo * 100) !== Math.round(v.costo * 100)) ponderados.push({ id: v.id, talle: v.talle, stock, suma, actual: v.costo, costo });
      }
      continue;
    }
    if (v.costo === null || Math.round(v.costo * 100) !== Math.round(costoNuevo * 100)) costos.push({ id: v.id, talle: v.talle, actual: v.costo });
  }
  return {
    costoNuevo, precioActual, precios, margen, ok: precioActual !== null && llegaAl50(precioActual, costoNuevo),
    basico: precio ? precio.basico : esPrecioSugerido(ren.codigo), sugerido: precio ? precio.sugerido : precioId(ren.codigo, lista),
    variantes: p.variantes.map((v) => ({ id: v.id, talle: v.talle })), costos, ponderados, conservan,
  };
}
/** Promedio ponderado en centavos (igual que lo verifica /api/prices): lo que hay a su costo + lo que llega. */
export function costoPromedio(stock: number, costo: number, suma: number, costoNuevo: number): number {
  return Math.round((stock * Math.round(costo * 100) + suma * Math.round(costoNuevo * 100)) / (stock + suma)) / 100;
}

function opcion(fila: FilaChecklist, descripcion: string, p: ProductoId | undefined, ren: RenglonFactura | undefined,
  pendientes: Record<string, OrdenPendienteId[]> | undefined, modo: ModoVenta, pack = 1, tabla = '', elegidos: Readonly<Record<string, string>> = {}): OpcionCarga {
  if (!p) return { clave: 'falta', etiqueta: 'Producto que no pude leer', accion: null, bloqueo: 'No pude leer ese producto en Shopify.', avisos: [] };
  const avisos: string[] = [];
  const base = { clave: `repo:${p.id}`, etiqueta: `Sumar el stock en «${p.titulo}»`, avisos };
  const marca = marcaDe(p.vendor);
  if (!marca) return { ...base, accion: null, bloqueo: `«${p.titulo}» es de ${p.vendor || 'otra marca'}, no de Converse ni Le Coq: cargalo a mano.` };
  const llegan: { v: VarianteId; cantidad: number; retirado: number }[] = [];
  const problemas: string[] = [];
  let elegir = false;
  const manuales: string[] = [];
  for (const t of fila.talles ?? []) {
    if (!(t.cantidad > 0)) continue;
    // El talle de Shopify elegido a mano (19-nov-2026) manda sobre la conversión.
    const aMano = elegidos[t.talle];
    const conv = aMano ? { talle: aMano } : talleEnShopify(marca, t.talle, fila.codigo, p.etiquetas, descripcion, tabla);
    if ('error' in conv && sinTabla(conv.error)) return { ...base, accion: null, bloqueo: `«${p.titulo}» no tiene la etiqueta TABLA DE TALLE: elegí la tabla de talle abajo (mirá la caja) y se la agrego al cargar.` };
    if ('error' in conv) { problemas.push(`talle ${t.talle}: ${conv.error}`); elegir = true; continue; }
    const vs = p.variantes.filter((v) => igualTalle(v.talle, conv.talle));
    const como = conv.talle === t.talle ? t.talle : `${t.talle} (en Shopify ${conv.talle})`;
    if (aMano && !igualTalle(aMano, t.talle)) manuales.push(`${t.talle} → ${verTalle(vs[0]?.talle ?? aMano)}`);
    if (!vs.length) { problemas.push(`no existe el talle ${como}`); elegir = true; continue; }
    if (vs.length > 1) { problemas.push(`hay dos variantes del talle ${como}`); continue; }
    if (!vs[0].seguimiento || !vs[0].inventoryItemId) { problemas.push(`el talle ${como} no lleva control de stock`); continue; }
    const ya = llegan.find((l) => l.v.id === vs[0].id);
    if (ya) { ya.cantidad += t.cantidad; ya.retirado += t.retirado ?? 0; continue; }
    llegan.push({ v: vs[0], cantidad: t.cantidad, retirado: t.retirado ?? 0 });
  }
  if (problemas.length) {
    const hay = tallesShopify(p);
    return { ...base, accion: null, bloqueo: `En «${p.titulo}»: ${problemas.join('; ')}${elegir && hay.length
      ? ` (en Shopify tiene ${hay.join(', ')}). Elegí arriba, al lado de la cantidad, en qué talle de Shopify entra; si no llegó, «Sacar de la carga (no llegó)».`
      : '. Corregilo en Shopify (o el remito) y armá la carga de nuevo.'}` };
  }
  if (manuales.length) avisos.push(`Talle elegido a mano: ${manuales.join(' · ')} (el remito dice otro talle).`);
  // Vendido en iD: se separa para esas órdenes y no se suma (salvo «cargarlo igual»).
  const separar: SepararId[] = [];
  const otras: string[] = [];
  const lineas: LineaReposicion[] = [];
  const mover: MoverVenta[] = [];
  const enCurso: string[] = [];
  const cubiertas: CubiertaOrden[] = [];
  let movibles = 0;
  for (const l of llegan) {
    const ords = pendientes?.[l.v.id] ?? [];
    const s = separarDe(ords, l.cantidad, l.retirado);
    if (s.cantidad) separar.push({ talle: l.v.talle, cantidad: s.cantidad, ordenes: s.ordenes });
    for (const o of ords) if (!o.cuenta) otras.push(`${l.v.talle} ${o.nombre} (${o.motivo})`);
    // «Pasar la venta»: solo las preparaciones abiertas; las que están en preparación en iD se separan igual.
    let pasan = 0;
    for (const o of s.ordenes) {
      if (!o.fo?.abierta) continue;
      movibles += o.cantidad;
      if (modo !== 'pasar') continue;
      pasan += o.cantidad;
      mover.push({ talle: l.v.talle, orden: o.nombre, cantidad: o.cantidad, foId: o.fo.id, lineaId: o.fo.lineaId, inventoryItemId: l.v.inventoryItemId });
    }
    if (modo === 'pasar') for (const o of s.ordenes) if (!o.fo?.abierta) enCurso.push(`${l.v.talle} ${o.nombre}`);
    // Qué orden se lleva cada unidad que llegó (para decir cuáles ya pueden salir). «Cargarlo igual»: ya se separó antes.
    for (const o of s.retirados) if (o.fo) cubiertas.push({ orden: o.nombre, lineaId: o.fo.lineaId, cantidad: o.cantidad, como: 'retirado' });
    if (modo !== 'igual') for (const o of s.ordenes) if (o.fo) cubiertas.push({ orden: o.nombre, lineaId: o.fo.lineaId, cantidad: o.cantidad, como: modo === 'pasar' && o.fo.abierta ? 'pasar' : 'separar' });
    const suma = modo === 'igual' ? l.cantidad : l.cantidad - s.cantidad + pasan;
    if (suma > 0) lineas.push({ talle: l.v.talle, inventoryItemId: l.v.inventoryItemId, actual: l.v.disponible, suma });
  }
  const sep = { ...(separar.length ? { separar, separarAplicado: modo === 'separar', modoVenta: modo, movibles } : {}), ...(cubiertas.length ? { cubiertas } : {}) };
  // En la acción (resumen y registro) van solo las que se separan de verdad: en «pasar», las que están en preparación.
  const separadas = modo === 'pasar'
    ? separar.map((x) => {
      const ordenes = x.ordenes.filter((o) => !o.fo?.abierta);
      return { ...x, ordenes, cantidad: ordenes.reduce((t, o) => t + o.cantidad, 0) };
    }).filter((x) => x.cantidad > 0)
    : separar;
  const sepAccion = separadas.length ? { separar: separadas, separarAplicado: modo !== 'igual' } : {};
  if (enCurso.length) avisos.push(`No puedo pasar a Martínez la venta de ${enCurso.join(', ')}: en Shopify figura en preparación en iD. Esas unidades se separan; pasala a mano si hace falta.`);
  if (mover.length) avisos.push(`Después de sumar el stock, la venta de ${mover.map((m) => `${m.talle} ${m.orden}`).join(', ')} pasa de iD a Martínez (en Shopify la orden queda en dos envíos si tiene otros artículos en iD). El stock de iD queda como estaba: la unidad que Shopify libera ahí no se suma, porque iD lo lleva la sincronización.`);
  if (otras.length) avisos.push(`También hay ventas pendientes en iD que no descuento: ${otras.join(', ')}. Revisalas a mano.`);
  // Todo vendido en iD: no se suma stock, pero el precio y el costo de la factura se actualizan igual
  // (12-nov-2026, gax: «no saques lo del precio, es importante actualizarlo igual»).
  const vendidoTodo = !lineas.length;
  for (const l of lineas) if (l.actual === null) avisos.push(`Talle ${l.talle}: no está dado de alta en ${SUCURSAL_CARGA_ID}; se da de alta con ${l.suma}.`);
  if (p.estado !== 'ACTIVE') avisos.push(`El producto está ${p.estado === 'DRAFT' ? 'en borrador' : 'archivado'} en Shopify: se le suma igual el stock.`);
  // Pack: la factura trae el precio del pack entero; el costo y el margen van por unidad.
  const ajuste = ren ? ajusteDe(p, pack > 1 ? { ...ren, precioUnitario: (Number(ren.precioUnitario) || 0) / pack } : ren, lineas) : null;
  if (vendidoTodo && (!ajuste || (ajuste.ok && !ajuste.costos.length && !ajuste.ponderados.length))) {
    return { ...base, ...sep, accion: null, bloqueo: 'Todo lo que llegó ya está vendido en iD: separalo para esas órdenes. No queda nada para sumar en Martínez ni precio o costo para cambiar.' };
  }
  if (vendidoTodo) avisos.push('Todo lo que llegó ya está vendido en iD: no se suma stock en Martínez, pero se actualizan el precio y el costo.');
  if (!ajuste) avisos.push('La factura no trae el precio de lista de este artículo: no reviso el margen ni el costo.');
  else {
    for (const c of ajuste.conservan) if (c.motivo) avisos.push(`Talle ${c.talle}: ya tenía ${c.stock} en Martínez y ${c.motivo}. Conserva su costo: revisalo a mano.`);
    // Un costo que deja el margen en negativo casi siempre es un pack que no dice «X6» en ningún lado.
    if (pack === 1 && ajuste.margen !== null && ajuste.margen < 0) {
      avisos.push(`El costo de la factura (${fmt(ajuste.costoNuevo)}) deja el margen en negativo. ¿Viene en pack? Si trae varias unidades, tocá «¿Viene en pack?» y escribí cuántas.`);
    }
  }
  // La tabla elegida (producto sin etiqueta TABLA DE TALLE) se le agrega al cargar.
  const etiquetar = marca === 'converse' && tabla && !tablaDeEtiqueta(p.etiquetas) && lineas.length ? { etiquetas: [tabla] } : {};
  return { ...base, ...sep, accion: { tipo: 'reposicion', productoId: p.id, titulo: p.titulo, lineas, etiquetar: false, ...etiquetar, ...(ajuste ? { ajuste } : {}), ...sepAccion, ...(mover.length ? { mover } : {}), ...(pack > 1 ? { pack } : {}) } };
}

const NO_CARGAR: OpcionCarga = { clave: 'no', etiqueta: 'No cargar este artículo', accion: null, avisos: [] };

/**
 * Vista previa de la carga de una entrega de iD. No escribe nada.
 * `cargas`: las marcas guardadas de todas las entregas de iD, leídas recién de la base.
 */
/** Cantidades escritas a mano en la vista previa: código → talle → unidades a cargar. */
export type CantidadesCarga = ReadonlyMap<string, Readonly<Record<string, number>>>;

export function planCargaId(r: ResultadoFactura, estado: EstadoCargaId, cargas: Record<string, CargaFamily>, modos: ReadonlyMap<string, ModoVenta> = new Map(),
  cantidades: CantidadesCarga = new Map(), packs: ReadonlyMap<string, number> = new Map(), tablas: ReadonlyMap<string, string> = new Map(),
  destinos: ReadonlyMap<string, Readonly<Record<string, string>>> = new Map()): PlanCarga {
  const f = r.factura;
  const avisos: string[] = [];
  const remito = r.remito?.numero || f.remito || '';
  const enFactura = new Set(r.checklist.map((c) => claveCodigo(c.codigo)));
  const fuera = (r.remito?.renglones ?? []).filter((x) => !enFactura.has(claveCodigo(x.codigo))).map((x) => x.codigo);
  if (fuera.length) avisos.push(`En el remito y no en la factura: ${[...new Set(fuera)].join(', ')}. No se cargan desde acá: revisalo y cargalo a mano.`);
  // Un artículo de la factura que la foto del remito no trae (25-nov-2026, factura 0011-00140160: la foto girada se
  // salteó el primer renglón) se arma con lo facturado: que el depósito confirme si llegó antes de cargarlo.
  const sinRemito = r.remito ? r.difRemito.filter((d) => d.remito === 0 && d.factura > 0) : [];
  if (sinRemito.length) avisos.push(`El remito leído no trae ${sinRemito.map((d) => `${d.codigo} (factura ${d.factura})`).join(', ')}: se arma con lo facturado. Si llegó, cargalo y, si la foto se salteó el renglón, corregí el remito en «✏️ Ver o corregir»; si no llegó, «Sacar de la carga (no llegó)».`);
  if (r.difRemito.length > sinRemito.length) avisos.push('El remito y la factura no coinciden en algún artículo: se carga lo del remito (lo que llegó).');
  if (estado.errorPendientes) avisos.push(`No pude leer las ventas pendientes de iD (${estado.errorPendientes}): no separo nada. Revisá a mano si algo de lo que llegó ya está vendido antes de cargar.`);
  const items = r.checklist.map((orig): ItemCarga => {
    const ren = r.factura.renglones.find((x) => claveCodigo(x.codigo) === claveCodigo(orig.codigo));
    const descripcion = ren?.descripcion || orig.descripcion;
    // La firma es la del remito, no la de lo escrito a mano: así la misma mercadería nunca se carga dos veces.
    const firma = firmaCargaId(f.fecha, remito, orig);
    const ids = estado.porCodigo[orig.codigo.toUpperCase()] ?? [];
    // Pack (13-nov-2026, gax): el remito cuenta packs y se cargan unidades. Lo marcado «-1» son unidades que salieron
    // para órdenes (las ventas son por unidad): de un pack de 6 con «-1» se cargan 5.
    const pk = packDeCarga(descripcion, ids.map((id) => estado.productos[id]?.titulo ?? ''), packs.get(orig.codigo), orig.codigo);
    const n = pk.error ? 1 : pk.unidades;
    // Remito sin talles (21-nov-2026, gax, LAN0122012P «Tripack Algodon», 2 packs de 6 y en Shopify talles 1 y 2:
    // «que nos dé alguna opción de avanzar, de corregir la falla nosotros manualmente»). Con un solo producto en
    // Shopify, se muestran SUS talles para escribir cuántas unidades llegaron de cada uno (con un solo talle o sin
    // talles, va todo ahí). Lo escrito ya es en unidades y en talles de Shopify: no se convierte ni se multiplica.
    const unico = ids.length === 1 ? estado.productos[ids[0]] : undefined;
    const enShop = !orig.talles && unico ? tallesShopify(unico) : [];
    const sinTalleRemito = enShop.length > 0;
    const renRemito = (r.remito?.renglones ?? []).filter((x) => claveCodigo(x.codigo) === claveCodigo(orig.codigo));
    const delRemito = renRemito.length ? renRemito.reduce((s, x) => s + (Number(x.cantidad) || 0), 0) : orig.cantidad;
    const esperado = sinTalleRemito ? Math.max(0, delRemito * n - (orig.retirado ?? 0)) : 0;
    const conTalles: FilaChecklist = sinTalleRemito
      ? { ...orig, talles: enShop.map((t) => ({ talle: t, cantidad: enShop.length === 1 ? esperado : 0 })) }
      : orig;
    const enUnidades: FilaChecklist = n > 1 && orig.talles
      ? { ...orig, talles: orig.talles.map((t) => ({ ...t, cantidad: Math.max(0, (t.cantidad + (t.retirado ?? 0)) * n - (t.retirado ?? 0)) })) }
      : conTalles;
    const escritas = cantidades.get(orig.codigo);
    const c = enUnidades.talles && escritas
      ? { ...enUnidades, talles: enUnidades.talles.map((t) => (escritas[t.talle] !== undefined ? { ...t, cantidad: escritas[t.talle] } : t)) }
      : enUnidades;
    const unidades = (c.talles ?? []).reduce((s, t) => s + t.cantidad, 0);
    // Sin talles en el remito no hay «lo que dice el remito» por talle: lo escrito no se marca como cambiado.
    const talles = c.talles?.map((t, i) => ({ talle: t.talle, cantidad: t.cantidad, original: sinTalleRemito ? t.cantidad : enUnidades.talles![i].cantidad }));
    const cambiadas = (talles ?? []).filter((t) => t.cantidad !== t.original);
    const lista = Number(ren?.precioUnitario) || 0, bonificacion = Number(ren?.bonificacion) || 0;
    const pack: PackCarga | undefined = n > 1 || pk.manual || pk.error ? {
      ...pk, unidades: n,
      // El mismo cálculo que ajusteDe con la lista por unidad (sin redondear la división).
      ...(n > 1 && lista > 0 ? { lista, bonificacion, costo: redondear2((lista / n) * (1 - bonificacion / 100)) } : {}),
    } : undefined;
    const base = { codigo: c.codigo, descripcion, unidades, firma, ...(talles ? { talles } : {}), ...(pack ? { pack } : {}) };
    const bloqueado = (motivo: string): ItemCarga => ({ ...base, estado: 'bloqueado', motivo, opciones: [] });
    const carga = cargas[`${f.id}|${c.codigo}`];
    if (carga) return { codigo: c.codigo, descripcion, unidades, firma, estado: 'cargado', motivo: textoCarga(carga), opciones: [], carga };
    const otra = Object.entries(cargas).find(([k, x]) => !k.startsWith(`${f.id}|`) && x.firma === firma);
    if (otra) return bloqueado(`Esta misma mercadería (mismo día, remito, código y talles) ya se cargó desde otra entrega (${textoCarga(otra[1])}).`);
    if (!c.talles) return bloqueado(ids.length > 1
      ? 'No sé qué talles llegaron y el código está en varios productos de Shopify: escribí el remito con los talles («✏️ Ver o corregir») y armá la carga de nuevo.'
      : 'No sé qué talles llegaron: escribí el remito con los talles («✏️ Ver o corregir») y armá la carga de nuevo.');
    const queDice = `el remito dice ${esperado} u.${n > 1 ? ` (${delRemito} pack${delRemito === 1 ? '' : 's'} de ${n})` : ''}${orig.retirado ? `, menos ${orig.retirado} que salieron para órdenes` : ''}`;
    if (sinTalleRemito && !unidades) return bloqueado(`El remito no dice los talles: escribí arriba cuántas unidades llegaron de cada talle (${queDice}). Si no llegó, «Sacar de la carga (no llegó)».`);
    if (!unidades) return bloqueado(cambiadas.length ? 'Pusiste 0 en todos los talles: no hay nada para cargar.' : c.retirado ? 'Todo lo que llegó salió para órdenes: no hay nada para cargar.' : 'No tiene cantidades.');
    if (!buscable(c.codigo.toUpperCase())) return bloqueado('El código tiene caracteres que no puedo buscar en Shopify: cargalo a mano.');
    if (!ids.length) return bloqueado('No está en Shopify: crealo desde Sincronización (con el archivo de iD) y armá la carga de nuevo.');
    if (pk.error) return bloqueado(`${pk.error} Escribí cuántas unidades trae cada pack.`);
    // Converse sin etiqueta TABLA DE TALLE: se elige la tabla (17-nov-2026, gax).
    const tabla = sinTalleRemito ? null : tablaCargaId(c, ids.map((id) => estado.productos[id]), tablas.get(c.codigo));
    const conTabla = (x: ItemCarga): ItemCarga => (tabla ? { ...x, tabla } : x);
    // Talle de Shopify elegido a mano (19-nov-2026): con un solo producto, se muestran sus talles para elegir.
    // Sin talles en el remito, cada talle escrito ya es el de Shopify.
    const elegidos = sinTalleRemito ? Object.fromEntries(enShop.map((t) => [t, t])) : destinos.get(c.codigo) ?? {};
    const dest = ids.length === 1 && !sinTalleRemito ? destinosId(c, descripcion, estado.productos[ids[0]], tabla?.elegida ?? '', elegidos) : null;
    if (dest && base.talles) base.talles = base.talles.map((t) => (dest[t.talle] ? { ...t, destino: dest[t.talle].destino, destinoManual: dest[t.talle].manual, enShopify: dest[t.talle].enShopify, ...(dest[t.talle].problema ? { problema: dest[t.talle].problema } : {}) } : t));
    const opciones = ids.map((id) => opcion(c, descripcion, estado.productos[id], ren, estado.pendientesId, modos.get(c.codigo) ?? 'separar', n, tabla?.elegida ?? '', ids.length === 1 ? elegidos : {}));
    if (c.retirado && !cambiadas.length) {
      for (const o of opciones) o.avisos.push(n > 1
        ? `Salieron ${c.retirado} para órdenes (marca a mano en el remito): las cuento como unidades sueltas del pack y no se suman. Si salió el pack entero, corregí la cantidad.`
        : `Salieron ${c.retirado} para órdenes (marca a mano en el remito): no se suman.`);
    }
    if (sinTalleRemito) {
      const escrito = (c.talles ?? []).filter((t) => t.cantidad > 0).map((t) => `${t.talle}: ${t.cantidad}`).join(' · ');
      for (const o of opciones) o.avisos.push(unidades === esperado
        ? `El remito no dice los talles: ${enShop.length === 1 ? `va todo al único talle (${escrito})` : `lo escribiste a mano (${escrito})`}.`
        : `El remito no dice los talles y lo escrito (${escrito}) suma ${unidades} u., pero ${queDice}. Revisá antes de cargar.`);
    }
    if (cambiadas.length) for (const o of opciones) o.avisos.push(`Cantidad escrita a mano: ${cambiadas.map((t) => `${t.talle} ${t.original}→${t.cantidad}`).join(' · ')} (el remito dice otra cosa).`);
    // Todo vendido en iD: queda bloqueado pero con la opción, para mostrar qué separar y «cargarlo igual».
    if (ids.length === 1) return conTabla(opciones[0].bloqueo ? { ...bloqueado(opciones[0].bloqueo), opciones: opciones[0].separar ? opciones : [] } : { ...base, estado: 'listo', motivo: '', opciones });
    return conTabla({ ...base, estado: 'elegir', motivo: `El código está en ${ids.length} productos de Shopify: elegí en cuál sumar el stock.`, opciones: [NO_CARGAR, ...opciones] });
  });
  return { entregaId: f.id, locationId: estado.locationId, posId: null, items, avisos, sucursal: SUCURSAL_CARGA_ID, ...(estado.ordenesId ? { ordenesId: estado.ordenesId } : {}), ...(estado.idLocationId ? { idLocationId: estado.idLocationId } : {}) };
}

/**
 * Cuántos artículos de la factura ya están cargados en Shopify. Lo que se sacó de la carga porque no llegó
 * (guardado en «noLlego», 14-nov-2026) también cuenta como terminado: no queda nada por cargar de eso.
 */
export function estadoCargaFactura(r: ResultadoFactura, cargas: Record<string, CargaFamily>, noLlego: Record<string, unknown> = {}): { cargados: number; noLlego: string[]; pendientes: string[]; total: number; completa: boolean } {
  const codigos = [...new Set(r.checklist.map((c) => c.codigo))];
  const cargados = codigos.filter((c) => cargas[`${r.factura.id}|${c}`]?.estado === 'cargada');
  const faltan = codigos.filter((c) => !cargados.includes(c) && noLlego[`${r.factura.id}|${c}`]);
  // Lo que todavía no se cargó ni se sacó de la carga (21-nov-2026, gax: «hay pendiente un producto por cargar»).
  const pendientes = codigos.filter((c) => !cargados.includes(c) && !faltan.includes(c));
  return { cargados: cargados.length, noLlego: faltan, pendientes, total: codigos.length, completa: codigos.length > 0 && cargados.length + faltan.length === codigos.length };
}

/**
 * ¿La entrega va al apartado verde de cargadas? (14-nov-2026, gax: «la carga la terminé… me gustaría que aparezca como
 * ya cerrado, en un apartado en verde, como archivadas»). Sola, cuando todo está cargado (o no llegó) y no hay nada que
 * reclamar al proveedor; las observaciones (faltante, adelanto) no la dejan abierta. A mano manda lo que se eligió:
 * «cerrada» (por ejemplo, Kappa o Crocs cargados a mano) o «abierta» (volver a abrirla aunque esté toda cargada).
 * Con `soloCompleta` (iD y Target, 21-nov-2026, gax: «cuando una carga no quede terminada, no le des la opción de
 * cerrar»), cerrarla a mano no vale mientras quede algo sin cargar ni sacar de la carga.
 */
export function entregaArchivada(r: ResultadoFactura, carga: { completa: boolean } | null, manual?: 'cerrada' | 'abierta', soloCompleta = false): boolean {
  if (manual === 'cerrada') return !(soloCompleta && carga && !carga.completa);
  if (manual === 'abierta' || !carga) return false;
  return carga.completa && r.semaforo !== 'reclamar' && r.semaforo !== 'incompleta';
}

/** Una orden de iD que se lleva algo de esta entrega: si ya puede salir o qué le falta de iD. */
export interface OrdenQueSale {
  orden: string;
  puede: boolean;
  /** Algo de esta orden pasa a prepararse desde Martínez. */
  pasa: boolean;
  llega: string[];
  faltan: string[];
}
/**
 * ¿Qué órdenes ya pueden salir? (12-nov-2026, gax: «que diga qué ventas ya pueden salir… así separo los
 * productos y los dejo apartados»). Con lo que se separa o se pasa a Martínez en esta carga (y lo marcado «-1»),
 * una orden puede salir si ya no espera nada más de iD. Lo que la orden tenga en Martínez se da por disponible.
 * Lo destildado no cuenta (queda para otro día).
 */
export function ordenesQueSalen(plan: PlanCarga, elecciones: EleccionesCarga): OrdenQueSale[] {
  const todas = plan.ordenesId;
  if (!todas) return [];
  const porOrden = new Map<string, CubiertaOrden[]>();
  for (const it of plan.items) {
    const clave = elecciones[it.codigo]?.clave ?? it.opciones[0]?.clave;
    if (clave === 'no') continue;
    const op = it.opciones.find((o) => o.clave === clave) ?? (it.estado === 'bloqueado' ? it.opciones[0] : undefined);
    for (const c of op?.cubiertas ?? []) porOrden.set(c.orden, [...(porOrden.get(c.orden) ?? []), c]);
  }
  const fmtLinea = (l: LineaOrdenId, n: number) => `${l.titulo}${l.talle && l.talle !== 'Default Title' ? ` ${l.talle}` : ''}${n > 1 ? ` ×${n}` : ''}`;
  const out: OrdenQueSale[] = [];
  for (const [orden, cs] of porOrden) {
    const lineas = todas[orden];
    if (!lineas) continue;
    const llega: string[] = [], faltan: string[] = [];
    for (const l of lineas) {
      const mias = cs.filter((c) => c.lineaId === l.lineaId);
      const n = Math.min(l.cantidad, mias.reduce((t, c) => t + c.cantidad, 0));
      if (n) {
        const como = mias.some((c) => c.como === 'pasar') ? ' (pasa a Martínez)' : mias.every((c) => c.como === 'retirado') ? ' (ya salió con la marca «-1»)' : '';
        llega.push(`${fmtLinea(l, n)}${como}`);
      }
      if (l.cantidad > n) faltan.push(fmtLinea(l, l.cantidad - n));
    }
    out.push({ orden, puede: !faltan.length, pasa: cs.some((c) => c.como === 'pasar'), llega, faltan });
  }
  return out.sort((a, b) => Number(b.puede) - Number(a.puede) || a.orden.localeCompare(b.orden));
}

/**
 * Productos pedidos que no entraron (17-nov-2026, gax: «iD siempre va a preparar los pedidos completos… hay que poner
 * a revisión y avisarle a atención al cliente»). Por cada artículo que falta de una nota, las ventas sin preparar en
 * iD que lo esperan. El talle de iD se pasa al de Shopify con las mismas reglas de la carga; si no se sabe (sin tabla
 * de talle o sin talle), se muestran las ventas de todos los talles del modelo, avisando. Solo lectura.
 */
export function noEntraronId(items: { codigo: string; descripcion: string; talle: string; unidades: number; nota: string }[], estado: EstadoCargaId): NoEntroCarga[] {
  return items.map((x) => {
    const base: NoEntroCarga = { ...x, ordenes: [] };
    const prods = (estado.porCodigo[x.codigo.toUpperCase()] ?? []).map((id) => estado.productos[id]).filter((p): p is ProductoId => !!p);
    if (!prods.length) return { ...base, aviso: 'no lo encontré en Shopify: buscá las ventas a mano' };
    const avisos: string[] = [];
    if (prods.length > 1) avisos.push(`está en ${prods.length} productos de Shopify`);
    let variantes: { v: VarianteId; todos: boolean }[] = [];
    for (const p of prods) {
      const marca = marcaDe(p.vendor);
      const conv = !x.talle ? { error: 'no sé de qué talle es lo que falta' }
        : marca ? talleEnShopify(marca, x.talle, x.codigo, p.etiquetas, x.descripcion) : { talle: normTalleProv(x.talle) };
      if ('error' in conv) {
        avisos.push(`${sinTabla(conv.error) ? 'el producto no tiene la etiqueta TABLA DE TALLE' : conv.error}: te muestro las ventas de todos los talles`);
        variantes.push(...p.variantes.map((v) => ({ v, todos: true })));
        continue;
      }
      base.talleShopify = conv.talle;
      variantes.push(...p.variantes.filter((v) => igualTalle(v.talle, conv.talle)).map((v) => ({ v, todos: false })));
    }
    base.producto = prods.map((p) => p.titulo).join(' / ');
    if (estado.errorPendientes || !estado.pendientesId) avisos.push(`no pude leer las ventas de iD${estado.errorPendientes ? ` (${estado.errorPendientes})` : ''}`);
    else {
      variantes = variantes.filter((a, i) => variantes.findIndex((b) => b.v.id === a.v.id) === i);
      for (const { v, todos } of variantes) {
        for (const o of estado.pendientesId[v.id] ?? []) {
          base.ordenes.push({ nombre: o.nombre, cantidad: o.cantidad, ...(todos ? { talle: v.talle } : {}), ...(o.motivo ? { motivo: o.motivo } : {}) });
        }
      }
    }
    return avisos.length ? { ...base, aviso: avisos.join('; ') } : base;
  });
}

/** El texto para atención al cliente (se copia; la app no lo manda). */
export function textoNoEntraron(items: NoEntroCarga[], factura: string): string {
  const lineas = items.map((x) => {
    const talle = x.talleShopify ? ` talle ${x.talleShopify}` : x.talle ? ` talle iD ${x.talle}` : '';
    const ventas = x.ordenes.length
      ? x.ordenes.map((o) => `${o.nombre}${o.talle ? ` (talle ${o.talle})` : ''}${o.cantidad > 1 ? ` ×${o.cantidad}` : ''}${o.motivo ? ` [${o.motivo}]` : ''}`).join(', ')
      : 'sin ventas pendientes en iD';
    return `- ${x.codigo} ${x.producto || x.descripcion}${talle} (${x.unidades} u. pedidas, nota ${x.nota}): ${ventas}.${x.aviso ? ` Ojo: ${x.aviso}.` : ''}`;
  });
  return [
    `Productos pedidos a iD que no entraron${factura ? ` (factura ${factura})` : ''}.`,
    'iD prepara cada nota completa: si no los mandó, posiblemente no tengan stock. Hay que solucionar estas ventas:',
    ...lineas,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// PRECIO Y COSTO ANTES DEL STOCK
// ---------------------------------------------------------------------------
type VariantePrecio = {
  id: string; price?: string; inventoryItem?: { cost: string };
  /** Promedio ponderado: /api/prices relee el stock y el costo de Martínez y solo acepta este promedio. */
  ponderado?: { stock: number; costoAnterior: string; unidades: number; costoNuevo: string };
};
type Precios = (variables: { productId: string; variants: VariantePrecio[] }) => Promise<unknown>;

/**
 * Escribe el precio (toda la curva) y el costo (talles en 0 en Martínez) por /api/prices ANTES de sumar
 * el stock: con stock en Martínez el costo queda protegido y ya no se podría poner.
 */
/** Pesos con hasta 2 decimales, como los acepta /api/prices («36082.5», «20000»). */
const dinero = (n: number) => String(Math.round(n * 100) / 100);
export function precioYCostoAntes(precios: Precios) {
  return async (_codigo: string, accion: ReposicionFamily): Promise<{ estado: 'ok'; mensaje: string } | { estado: 'error' | 'dudosa'; mensaje: string }> => {
    const a = accion.ajuste;
    if (!a) return { estado: 'ok', mensaje: '' };
    const porId = new Map<string, VariantePrecio>();
    if (a.precio !== undefined) for (const v of a.variantes) porId.set(v.id, { id: v.id, price: String(a.precio) });
    for (const c of a.costos) porId.set(c.id, { ...(porId.get(c.id) ?? { id: c.id }), inventoryItem: { cost: a.costoNuevo.toFixed(2) } });
    for (const c of a.ponderados) porId.set(c.id, {
      ...(porId.get(c.id) ?? { id: c.id }), inventoryItem: { cost: c.costo.toFixed(2) },
      ponderado: { stock: c.stock, costoAnterior: dinero(c.actual), unidades: c.suma, costoNuevo: dinero(a.costoNuevo) },
    });
    if (!porId.size) return { estado: 'ok', mensaje: '' };
    const partes = [
      a.precio !== undefined ? `precio de toda la curva ${fmt(a.precioActual ?? 0)} → ${fmt(a.precio)}` : '',
      a.costos.length ? `costo ${fmt(a.costoNuevo)} en ${a.costos.map((c) => c.talle).join(', ')}` : '',
      a.ponderados.length ? `costo promedio en ${a.ponderados.map((c) => `${c.talle} ${fmt(c.costo)}`).join(', ')}` : '',
    ].filter(Boolean).join(' y ');
    let data: { productVariantsBulkUpdate?: { userErrors?: { message?: string }[] } } | null;
    try { data = (await precios({ productId: accion.productoId, variants: [...porId.values()] })) as typeof data; }
    catch (e) {
      const m = e instanceof Error ? e.message : '';
      // /api/prices: «no confirmó» = no se sabe si se escribió; los demás rechazos son antes de escribir.
      if (!m || /no confirm/i.test(m) || /fetch|network|Failed/i.test(m)) return { estado: 'dudosa', mensaje: `No sé si se cambió ${partes} en «${accion.titulo}»: revisá en Shopify.` };
      return { estado: 'error', mensaje: `No se cambió ${partes} en «${accion.titulo}»: ${m.slice(0, 200)}` };
    }
    const ue = data?.productVariantsBulkUpdate?.userErrors;
    if (!Array.isArray(ue)) return { estado: 'dudosa', mensaje: `No sé si se cambió ${partes} en «${accion.titulo}»: revisá en Shopify.` };
    if (ue.length) return { estado: 'error', mensaje: `Shopify no cambió ${partes} en «${accion.titulo}»: ${ue.map((x) => x.message).filter(Boolean).join('; ')}.` };
    return { estado: 'ok', mensaje: `Cambiado ${partes}.` };
  };
}
