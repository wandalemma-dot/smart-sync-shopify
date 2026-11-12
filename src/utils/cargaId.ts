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
//     El costo nuevo va a los talles que llegan y a los que están en 0 en Martínez; los que
//     tienen stock en Martínez conservan el suyo. Se escribe por /api/prices ANTES del stock.
// La ejecución, la marca «una sola vez» y la vista previa son las mismas de Family.
// ============================================================================
import { claveCodigo, fmt, type FilaChecklist, type RenglonFactura, type ResultadoFactura } from './controlFacturas';
import {
  llegaAl50, textoCarga, type AjustePrecio, type CargaFamily, type ItemCarga, type LineaReposicion, type OpcionCarga, type PlanCarga, type ReposicionFamily,
} from './cargaFamily';
import { esPrecioSugerido } from './conversePreciosFijos';
import { margenPct } from './margen';
import { converseTablaInfo, LOC_MARTINEZ_NOMBRE, precioId, redondear2, talleShopifyLeCoq } from './syncLogic';
import { mismaSucursal } from './shopify';

export const SUCURSAL_CARGA_ID = LOC_MARTINEZ_NOMBRE;

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

export interface VarianteId { id: string; talle: string; sku: string; inventoryItemId: string; seguimiento: boolean; disponible: number | null; precio: number | null; costo: number | null }
export interface ProductoId { id: string; titulo: string; vendor: string; estado: string; etiquetas: string[]; variantes: VarianteId[] }
export interface EstadoCargaId {
  locationId: string;
  /** código de la factura → productos de Shopify que lo llevan en el SKU o en una etiqueta. */
  porCodigo: Record<string, string[]>;
  productos: Record<string, ProductoId>;
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
  return { locationId: loc.id, porCodigo, productos };
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
 * los que tienen stock en Martínez y no llegan conservan el suyo.
 */
export function ajusteDe(p: ProductoId, ren: RenglonFactura, lineas: LineaReposicion[]): AjustePrecio | null {
  const lista = Number(ren.precioUnitario) || 0;
  if (!(lista > 0)) return null;
  const costoNuevo = redondear2(lista * (1 - (Number(ren.bonificacion) || 0) / 100));
  const precios = [...new Set(p.variantes.map((v) => v.precio).filter((x): x is number => x !== null))];
  const precioActual = precios.length === 1 && !p.variantes.some((v) => v.precio === null) ? precios[0] : null;
  const margen = precioActual !== null ? margenPct(precioActual, costoNuevo) : null;
  const llegan = new Set(lineas.map((l) => l.inventoryItemId));
  const costos: AjustePrecio['costos'] = [];
  const conservan: AjustePrecio['conservan'] = [];
  for (const v of p.variantes) {
    const stock = v.disponible ?? 0;
    if (stock > 0) { if (!llegan.has(v.inventoryItemId)) conservan.push({ talle: v.talle, stock, costo: v.costo }); continue; }
    if (v.costo === null || Math.round(v.costo * 100) !== Math.round(costoNuevo * 100)) costos.push({ id: v.id, talle: v.talle, actual: v.costo });
  }
  return {
    costoNuevo, precioActual, precios, margen, ok: precioActual !== null && llegaAl50(precioActual, costoNuevo),
    basico: esPrecioSugerido(ren.codigo), sugerido: precioId(ren.codigo, lista),
    variantes: p.variantes.map((v) => ({ id: v.id, talle: v.talle })), costos, conservan,
  };
}

function opcion(fila: FilaChecklist, descripcion: string, p: ProductoId | undefined, ren?: RenglonFactura): OpcionCarga {
  if (!p) return { clave: 'falta', etiqueta: 'Producto que no pude leer', accion: null, bloqueo: 'No pude leer ese producto en Shopify.', avisos: [] };
  const avisos: string[] = [];
  const base = { clave: `repo:${p.id}`, etiqueta: `Sumar el stock en «${p.titulo}»`, avisos };
  const marca = marcaDe(p.vendor);
  if (!marca) return { ...base, accion: null, bloqueo: `«${p.titulo}» es de ${p.vendor || 'otra marca'}, no de Converse ni Le Coq: cargalo a mano.` };
  const lineas: LineaReposicion[] = [];
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
    const ya = lineas.find((l) => l.inventoryItemId === vs[0].inventoryItemId);
    if (ya) { ya.suma += t.cantidad; continue; }
    lineas.push({ talle: vs[0].talle, inventoryItemId: vs[0].inventoryItemId, actual: vs[0].disponible, suma: t.cantidad });
  }
  if (problemas.length) return { ...base, accion: null, bloqueo: `En «${p.titulo}»: ${problemas.join('; ')}. Corregilo en Shopify (o el remito) y armá la carga de nuevo.` };
  for (const l of lineas) if (l.actual === null) avisos.push(`Talle ${l.talle}: no está dado de alta en ${SUCURSAL_CARGA_ID}; se da de alta con ${l.suma}.`);
  if (p.estado !== 'ACTIVE') avisos.push(`El producto está ${p.estado === 'DRAFT' ? 'en borrador' : 'archivado'} en Shopify: se le suma igual el stock.`);
  const ajuste = ren ? ajusteDe(p, ren, lineas) : null;
  if (!ajuste) avisos.push('La factura no trae el precio de lista de este artículo: no reviso el margen ni el costo.');
  else {
    const conStock = lineas.filter((l) => (l.actual ?? 0) > 0).map((l) => l.talle);
    if (conStock.length) avisos.push(`Talle ${conStock.join(', ')}: ya tenía stock en Martínez, conserva su costo por ahora.`);
  }
  return { ...base, accion: { tipo: 'reposicion', productoId: p.id, titulo: p.titulo, lineas, etiquetar: false, ...(ajuste ? { ajuste } : {}) } };
}

const NO_CARGAR: OpcionCarga = { clave: 'no', etiqueta: 'No cargar este artículo', accion: null, avisos: [] };

/**
 * Vista previa de la carga de una entrega de iD. No escribe nada.
 * `cargas`: las marcas guardadas de todas las entregas de iD, leídas recién de la base.
 */
export function planCargaId(r: ResultadoFactura, estado: EstadoCargaId, cargas: Record<string, CargaFamily>): PlanCarga {
  const f = r.factura;
  const avisos: string[] = [];
  const remito = r.remito?.numero || f.remito || '';
  const enFactura = new Set(r.checklist.map((c) => claveCodigo(c.codigo)));
  const fuera = (r.remito?.renglones ?? []).filter((x) => !enFactura.has(claveCodigo(x.codigo))).map((x) => x.codigo);
  if (fuera.length) avisos.push(`En el remito y no en la factura: ${[...new Set(fuera)].join(', ')}. No se cargan desde acá: revisalo y cargalo a mano.`);
  if (r.difRemito.length) avisos.push('El remito y la factura no coinciden en algún artículo: se carga lo del remito (lo que llegó).');
  const items = r.checklist.map((c): ItemCarga => {
    const ren = r.factura.renglones.find((x) => claveCodigo(x.codigo) === claveCodigo(c.codigo));
    const descripcion = ren?.descripcion || c.descripcion;
    const firma = firmaCargaId(f.fecha, remito, c);
    const unidades = (c.talles ?? []).reduce((s, t) => s + t.cantidad, 0);
    const base = { codigo: c.codigo, descripcion, unidades, firma };
    const bloqueado = (motivo: string): ItemCarga => ({ ...base, estado: 'bloqueado', motivo, opciones: [] });
    const carga = cargas[`${f.id}|${c.codigo}`];
    if (carga) return { ...base, estado: 'cargado', motivo: textoCarga(carga), opciones: [], carga };
    const otra = Object.entries(cargas).find(([k, x]) => !k.startsWith(`${f.id}|`) && x.firma === firma);
    if (otra) return bloqueado(`Esta misma mercadería (mismo día, remito, código y talles) ya se cargó desde otra entrega (${textoCarga(otra[1])}).`);
    if (!c.talles) return bloqueado('No sé qué talles llegaron: escribí el remito con los talles («✏️ Ver o corregir») y armá la carga de nuevo.');
    if (!unidades) return bloqueado(c.retirado ? 'Todo lo que llegó salió para órdenes: no hay nada para cargar.' : 'No tiene cantidades.');
    if (!buscable(c.codigo.toUpperCase())) return bloqueado('El código tiene caracteres que no puedo buscar en Shopify: cargalo a mano.');
    const ids = estado.porCodigo[c.codigo.toUpperCase()] ?? [];
    if (!ids.length) return bloqueado('No está en Shopify: crealo desde Sincronización (con el archivo de iD) y armá la carga de nuevo.');
    const opciones = ids.map((id) => opcion(c, descripcion, estado.productos[id], ren));
    if (c.retirado) for (const o of opciones) o.avisos.push(`Salieron ${c.retirado} para órdenes (marca a mano en el remito): no se suman.`);
    if (ids.length === 1) return opciones[0].bloqueo ? bloqueado(opciones[0].bloqueo) : { ...base, estado: 'listo', motivo: '', opciones };
    return { ...base, estado: 'elegir', motivo: `El código está en ${ids.length} productos de Shopify: elegí en cuál sumar el stock.`, opciones: [NO_CARGAR, ...opciones] };
  });
  return { entregaId: f.id, locationId: estado.locationId, posId: null, items, avisos, sucursal: SUCURSAL_CARGA_ID };
}

/** Cuántos artículos de la factura ya están cargados en Shopify. */
export function estadoCargaFactura(r: ResultadoFactura, cargas: Record<string, CargaFamily>): { cargados: number; total: number; completa: boolean } {
  const codigos = [...new Set(r.checklist.map((c) => c.codigo))];
  const cargados = codigos.filter((c) => cargas[`${r.factura.id}|${c}`]?.estado === 'cargada').length;
  return { cargados, total: codigos.length, completa: codigos.length > 0 && cargados === codigos.length };
}

// ---------------------------------------------------------------------------
// PRECIO Y COSTO ANTES DEL STOCK
// ---------------------------------------------------------------------------
type Precios = (variables: { productId: string; variants: { id: string; price?: string; inventoryItem?: { cost: string } }[] }) => Promise<unknown>;

/**
 * Escribe el precio (toda la curva) y el costo (talles en 0 en Martínez) por /api/prices ANTES de sumar
 * el stock: con stock en Martínez el costo queda protegido y ya no se podría poner.
 */
export function precioYCostoAntes(precios: Precios) {
  return async (_codigo: string, accion: ReposicionFamily): Promise<{ estado: 'ok'; mensaje: string } | { estado: 'error' | 'dudosa'; mensaje: string }> => {
    const a = accion.ajuste;
    if (!a) return { estado: 'ok', mensaje: '' };
    const porId = new Map<string, { id: string; price?: string; inventoryItem?: { cost: string } }>();
    if (a.precio !== undefined) for (const v of a.variantes) porId.set(v.id, { id: v.id, price: String(a.precio) });
    for (const c of a.costos) porId.set(c.id, { ...(porId.get(c.id) ?? { id: c.id }), inventoryItem: { cost: a.costoNuevo.toFixed(2) } });
    if (!porId.size) return { estado: 'ok', mensaje: '' };
    const partes = [
      a.precio !== undefined ? `precio de toda la curva ${fmt(a.precioActual ?? 0)} → ${fmt(a.precio)}` : '',
      a.costos.length ? `costo ${fmt(a.costoNuevo)} en ${a.costos.map((c) => c.talle).join(', ')}` : '',
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
