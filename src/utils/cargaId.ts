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
//     TABLA DE TALLE del producto, o el maestro de curvas; si no se sabe, NO se adivina) y
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
// La ejecución, la marca «una sola vez» y la vista previa son las mismas de Family.
// ============================================================================
import { claveCodigo, fmt, type FilaChecklist, type RenglonFactura, type ResultadoFactura } from './controlFacturas';
import {
  llegaAl50, textoCarga, type AjustePrecio, type CubiertaOrden, type EleccionesCarga, type LineaFOId, type LineaOrdenId, type ModoVenta, type MoverVenta, type SepararId, type CargaFamily, type ItemCarga, type LineaReposicion, type OpcionCarga, type PlanCarga, type ReposicionFamily,
} from './cargaFamily';
import { esPrecioSugerido } from './conversePreciosFijos';
import { margenPct } from './margen';
import { converseTablaInfo, LOC_MARTINEZ_NOMBRE, precioId, redondear2, talleShopifyLeCoq } from './syncLogic';
import { mismaSucursal } from './shopify';

export const SUCURSAL_CARGA_ID = LOC_MARTINEZ_NOMBRE;
/** Sucursal del proveedor: sus ventas sin preparar son las que se separan de la entrega. */
export const SUCURSAL_ID = 'ID (Converse - Le Coq Sportif)';

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

export interface VarianteId { id: string; talle: string; sku: string; inventoryItemId: string; seguimiento: boolean; disponible: number | null; precio: number | null; costo: number | null }
export interface ProductoId { id: string; titulo: string; vendor: string; estado: string; etiquetas: string[]; variantes: VarianteId[] }
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
const etiquetaDelCodigo = (etiquetas: string[], codigo: string) => etiquetas.some((t) => mismoCodigo(String(t).trim(), codigo));

const Q_SUCURSALES = `query { locations(first: 100) { nodes { id name } } }`;
const Q_VARIANTES = `query($q: String!, $cursor: String) {
  productVariants(first: 100, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { sku product { id tags } }
  }
}`;
const Q_PRODUCTO = `query($id: ID!, $loc: ID!) {
  product(id: $id) {
    id title vendor status tags
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
  id: string; title: string; vendor: string; status: string; tags?: string[];
  variants: { nodes: { id: string; title: string; sku: string | null; price?: string | null; inventoryItem: { id: string; tracked: boolean; unitCost?: { amount: string } | null; inventoryLevel: { quantities: { name: string; quantity: number }[] } | null } | null }[] };
};

/** Lee lo que hace falta para armar la carga (solo lectura). Si algo falla, no se arma nada. */
export async function leerEstadoCargaId(codigos: string[], gql: Gql): Promise<EstadoCargaId> {
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
      id: p.id, titulo: p.title, vendor: p.vendor || '', estado: p.status, etiquetas: p.tags ?? [],
      variantes: p.variants.nodes.map((v) => {
        const nivel = v.inventoryItem?.inventoryLevel;
        const q = nivel?.quantities.find((x) => x.name === 'available');
        return {
          id: v.id, talle: v.title, sku: v.sku || '', inventoryItemId: v.inventoryItem?.id || '', seguimiento: !!v.inventoryItem?.tracked,
          // Sin nivel = la variante no está dada de alta en Martínez (no es cero).
          disponible: nivel ? (Number.isFinite(Number(q?.quantity)) ? Number(q!.quantity) : null) : null,
          precio: v.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : null,
          costo: v.inventoryItem?.unitCost?.amount != null && Number(v.inventoryItem.unitCost.amount) > 0 ? Number(v.inventoryItem.unitCost.amount) : null,
        };
      }),
    };
  }
  const estado: EstadoCargaId = { locationId: loc.id, porCodigo, productos };
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
 * El talle del remito o de la nota en el de Shopify. Nunca adivina: si no se sabe, devuelve el motivo.
 * Converse: «055» o «5.5» = US 5.5 → AR por la tabla del producto. Le Coq: «040» o «40» → calzado 39.
 */
export function talleEnShopify(marca: Marca, talle: string, codigo: string, etiquetas: string[], nombreProveedor: string): { talle: string } | { error: string } {
  const t = String(talle ?? '').trim().toUpperCase().replace(',', '.');
  if (!esNumero(t)) return { talle: t };
  const n = /^\d{3}$/.test(t) ? Number(t) / (marca === 'converse' ? 10 : 1) : Number(t);
  if (marca === 'lecoq') return { talle: talleShopifyLeCoq(fmtNum(n), nombreProveedor) };
  const info = converseTablaInfo(codigo, etiquetas.join(', '));
  if (info.origen === 'default') return { error: `no sé qué tabla de talle lleva (el producto no tiene la etiqueta TABLA DE TALLE y el código no está en el maestro)` };
  const ar = info.tabla[fmtNum(n)];
  return ar ? { talle: ar } : { error: `el US ${fmtNum(n)} no está en su tabla de talle` };
}
/** El mismo talle en Shopify: «39» = «39.0», «xl» = «XL». */
function igualTalle(a: string, b: string): boolean {
  const A = String(a ?? '').trim().toUpperCase().replace(',', '.'), B = String(b ?? '').trim().toUpperCase().replace(',', '.');
  if (A === B) return true;
  return esNumero(A) && esNumero(B) && Number(A) === Number(B);
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
export function ajusteDe(p: ProductoId, ren: RenglonFactura, lineas: LineaReposicion[]): AjustePrecio | null {
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
    basico: esPrecioSugerido(ren.codigo), sugerido: precioId(ren.codigo, lista),
    variantes: p.variantes.map((v) => ({ id: v.id, talle: v.talle })), costos, ponderados, conservan,
  };
}
/** Promedio ponderado en centavos (igual que lo verifica /api/prices): lo que hay a su costo + lo que llega. */
export function costoPromedio(stock: number, costo: number, suma: number, costoNuevo: number): number {
  return Math.round((stock * Math.round(costo * 100) + suma * Math.round(costoNuevo * 100)) / (stock + suma)) / 100;
}

function opcion(fila: FilaChecklist, descripcion: string, p: ProductoId | undefined, ren: RenglonFactura | undefined,
  pendientes: Record<string, OrdenPendienteId[]> | undefined, modo: ModoVenta): OpcionCarga {
  if (!p) return { clave: 'falta', etiqueta: 'Producto que no pude leer', accion: null, bloqueo: 'No pude leer ese producto en Shopify.', avisos: [] };
  const avisos: string[] = [];
  const base = { clave: `repo:${p.id}`, etiqueta: `Sumar el stock en «${p.titulo}»`, avisos };
  const marca = marcaDe(p.vendor);
  if (!marca) return { ...base, accion: null, bloqueo: `«${p.titulo}» es de ${p.vendor || 'otra marca'}, no de Converse ni Le Coq: cargalo a mano.` };
  const llegan: { v: VarianteId; cantidad: number; retirado: number }[] = [];
  const problemas: string[] = [];
  for (const t of fila.talles ?? []) {
    if (!(t.cantidad > 0)) continue;
    const conv = talleEnShopify(marca, t.talle, fila.codigo, p.etiquetas, descripcion);
    if ('error' in conv) { problemas.push(`talle ${t.talle}: ${conv.error}`); continue; }
    const vs = p.variantes.filter((v) => igualTalle(v.talle, conv.talle));
    const como = conv.talle === t.talle ? t.talle : `${t.talle} (en Shopify ${conv.talle})`;
    if (!vs.length) { problemas.push(`no existe el talle ${como}`); continue; }
    if (vs.length > 1) { problemas.push(`hay dos variantes del talle ${como}`); continue; }
    if (!vs[0].seguimiento || !vs[0].inventoryItemId) { problemas.push(`el talle ${como} no lleva control de stock`); continue; }
    const ya = llegan.find((l) => l.v.id === vs[0].id);
    if (ya) { ya.cantidad += t.cantidad; ya.retirado += t.retirado ?? 0; continue; }
    llegan.push({ v: vs[0], cantidad: t.cantidad, retirado: t.retirado ?? 0 });
  }
  if (problemas.length) return { ...base, accion: null, bloqueo: `En «${p.titulo}»: ${problemas.join('; ')}. Corregilo en Shopify (o el remito) y armá la carga de nuevo.` };
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
  const ajuste = ren ? ajusteDe(p, ren, lineas) : null;
  if (vendidoTodo && (!ajuste || (ajuste.ok && !ajuste.costos.length && !ajuste.ponderados.length))) {
    return { ...base, ...sep, accion: null, bloqueo: 'Todo lo que llegó ya está vendido en iD: separalo para esas órdenes. No queda nada para sumar en Martínez ni precio o costo para cambiar.' };
  }
  if (vendidoTodo) avisos.push('Todo lo que llegó ya está vendido en iD: no se suma stock en Martínez, pero se actualizan el precio y el costo.');
  if (!ajuste) avisos.push('La factura no trae el precio de lista de este artículo: no reviso el margen ni el costo.');
  else {
    for (const c of ajuste.conservan) if (c.motivo) avisos.push(`Talle ${c.talle}: ya tenía ${c.stock} en Martínez y ${c.motivo}. Conserva su costo: revisalo a mano.`);
  }
  return { ...base, ...sep, accion: { tipo: 'reposicion', productoId: p.id, titulo: p.titulo, lineas, etiquetar: false, ...(ajuste ? { ajuste } : {}), ...sepAccion, ...(mover.length ? { mover } : {}) } };
}

const NO_CARGAR: OpcionCarga = { clave: 'no', etiqueta: 'No cargar este artículo', accion: null, avisos: [] };

/**
 * Vista previa de la carga de una entrega de iD. No escribe nada.
 * `cargas`: las marcas guardadas de todas las entregas de iD, leídas recién de la base.
 */
/** Cantidades escritas a mano en la vista previa: código → talle → unidades a cargar. */
export type CantidadesCarga = ReadonlyMap<string, Readonly<Record<string, number>>>;

export function planCargaId(r: ResultadoFactura, estado: EstadoCargaId, cargas: Record<string, CargaFamily>, modos: ReadonlyMap<string, ModoVenta> = new Map(),
  cantidades: CantidadesCarga = new Map()): PlanCarga {
  const f = r.factura;
  const avisos: string[] = [];
  const remito = r.remito?.numero || f.remito || '';
  const enFactura = new Set(r.checklist.map((c) => claveCodigo(c.codigo)));
  const fuera = (r.remito?.renglones ?? []).filter((x) => !enFactura.has(claveCodigo(x.codigo))).map((x) => x.codigo);
  if (fuera.length) avisos.push(`En el remito y no en la factura: ${[...new Set(fuera)].join(', ')}. No se cargan desde acá: revisalo y cargalo a mano.`);
  if (r.difRemito.length) avisos.push('El remito y la factura no coinciden en algún artículo: se carga lo del remito (lo que llegó).');
  if (estado.errorPendientes) avisos.push(`No pude leer las ventas pendientes de iD (${estado.errorPendientes}): no separo nada. Revisá a mano si algo de lo que llegó ya está vendido antes de cargar.`);
  const items = r.checklist.map((orig): ItemCarga => {
    const ren = r.factura.renglones.find((x) => claveCodigo(x.codigo) === claveCodigo(orig.codigo));
    const descripcion = ren?.descripcion || orig.descripcion;
    // La firma es la del remito, no la de lo escrito a mano: así la misma mercadería nunca se carga dos veces.
    const firma = firmaCargaId(f.fecha, remito, orig);
    const escritas = cantidades.get(orig.codigo);
    const c = orig.talles && escritas
      ? { ...orig, talles: orig.talles.map((t) => (escritas[t.talle] !== undefined ? { ...t, cantidad: escritas[t.talle] } : t)) }
      : orig;
    const unidades = (c.talles ?? []).reduce((s, t) => s + t.cantidad, 0);
    const talles = c.talles?.map((t, i) => ({ talle: t.talle, cantidad: t.cantidad, original: orig.talles![i].cantidad }));
    const cambiadas = (talles ?? []).filter((t) => t.cantidad !== t.original);
    const base = { codigo: c.codigo, descripcion, unidades, firma, ...(talles ? { talles } : {}) };
    const bloqueado = (motivo: string): ItemCarga => ({ ...base, estado: 'bloqueado', motivo, opciones: [] });
    const carga = cargas[`${f.id}|${c.codigo}`];
    if (carga) return { codigo: c.codigo, descripcion, unidades, firma, estado: 'cargado', motivo: textoCarga(carga), opciones: [], carga };
    const otra = Object.entries(cargas).find(([k, x]) => !k.startsWith(`${f.id}|`) && x.firma === firma);
    if (otra) return bloqueado(`Esta misma mercadería (mismo día, remito, código y talles) ya se cargó desde otra entrega (${textoCarga(otra[1])}).`);
    if (!c.talles) return bloqueado('No sé qué talles llegaron: escribí el remito con los talles («✏️ Ver o corregir») y armá la carga de nuevo.');
    if (!unidades) return bloqueado(cambiadas.length ? 'Pusiste 0 en todos los talles: no hay nada para cargar.' : c.retirado ? 'Todo lo que llegó salió para órdenes: no hay nada para cargar.' : 'No tiene cantidades.');
    if (!buscable(c.codigo.toUpperCase())) return bloqueado('El código tiene caracteres que no puedo buscar en Shopify: cargalo a mano.');
    const ids = estado.porCodigo[c.codigo.toUpperCase()] ?? [];
    if (!ids.length) return bloqueado('No está en Shopify: crealo desde Sincronización (con el archivo de iD) y armá la carga de nuevo.');
    const opciones = ids.map((id) => opcion(c, descripcion, estado.productos[id], ren, estado.pendientesId, modos.get(c.codigo) ?? 'separar'));
    if (c.retirado && !cambiadas.length) for (const o of opciones) o.avisos.push(`Salieron ${c.retirado} para órdenes (marca a mano en el remito): no se suman.`);
    if (cambiadas.length) for (const o of opciones) o.avisos.push(`Cantidad escrita a mano: ${cambiadas.map((t) => `${t.talle} ${t.original}→${t.cantidad}`).join(' · ')} (el remito dice otra cosa).`);
    // Todo vendido en iD: queda bloqueado pero con la opción, para mostrar qué separar y «cargarlo igual».
    if (ids.length === 1) return opciones[0].bloqueo ? { ...bloqueado(opciones[0].bloqueo), opciones: opciones[0].separar ? opciones : [] } : { ...base, estado: 'listo', motivo: '', opciones };
    return { ...base, estado: 'elegir', motivo: `El código está en ${ids.length} productos de Shopify: elegí en cuál sumar el stock.`, opciones: [NO_CARGAR, ...opciones] };
  });
  return { entregaId: f.id, locationId: estado.locationId, posId: null, items, avisos, sucursal: SUCURSAL_CARGA_ID, ...(estado.ordenesId ? { ordenesId: estado.ordenesId } : {}), ...(estado.idLocationId ? { idLocationId: estado.idLocationId } : {}) };
}

/** Cuántos artículos de la factura ya están cargados en Shopify. */
export function estadoCargaFactura(r: ResultadoFactura, cargas: Record<string, CargaFamily>): { cargados: number; total: number; completa: boolean } {
  const codigos = [...new Set(r.checklist.map((c) => c.codigo))];
  const cargados = codigos.filter((c) => cargas[`${r.factura.id}|${c}`]?.estado === 'cargada').length;
  return { cargados, total: codigos.length, completa: codigos.length > 0 && cargados === codigos.length };
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
