// ============================================================================
// FAMILY — CARGAR UNA ENTREGA EN SHOPIFY (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Copia cómo se cargaban a mano los Family en la tienda:
//   · NUEVOS: título «Tipo Familyarg Modelo Color», vendor Familyarg, opción
//     Talle, precio = PRECIO PUBLICO de la planilla, costo = por mayor − 15%
//     (el 42,5% del público, con centavos), SKU código.talle, etiqueta con el
//     código, stock en 🟢FAMILYARG, activos y publicados SOLO en Point of Sale
//     (las fotos y los demás canales se agregan a mano).
//   · REPOSICIÓN: SUMA lo entregado al stock de FAMILYARG, sin pisar lo que hay.
//     Va con changeFromQuantity = lo que había al armar la carga: si cambió en
//     el medio (una venta), Shopify rechaza y no se suma nada.
//   · Los PRECIOS de los productos que ya existen NUNCA se tocan: solo se avisa.
// Antes de crear se busca el producto por SKU, por etiqueta y por NOMBRE (hay
// Family sin SKU): si aparece uno parecido, la usuaria elige si es ese o si se
// crea nuevo. Nada se escribe sin la vista previa y su confirmación.
// Cada artículo de cada entrega se carga UNA sola vez: la marca se pone en la
// base ANTES de escribir. Una respuesta incompleta de Shopify queda «dudosa»
// y no se reintenta sola: hay que mirar Shopify y liberarla a mano.
// ============================================================================
import { fmt } from './controlFacturas';
import {
  busquedaCodigos, codigoBuscable, etiquetaEsDelCodigo, skuEsDelCodigo, talleFamily,
  type FilaFamily, type RenglonFamily, type ResultadoFamily,
} from './controlFamily';
import { mismaSucursal } from './shopify';

export const SUCURSAL_FAMILY = 'FAMILYARG';
export const VENDOR_FAMILY = 'Familyarg';
/** Costo = precio por mayor − 15% (en la tienda: 42,5% del público). */
export const DESCUENTO_FAMILY = 15;

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// TÍTULO, TIPO, TALLES Y COSTO DE LOS NUEVOS (como están cargados hoy los Family)
// ---------------------------------------------------------------------------
export interface TipoFamily { prefijo: string; productType: string; etiquetas: string[]; gramos: number }
const ROPA = ['Indumentaria', 'Ropa'];
const PANTALONES = ['Indumentaria', 'Pantalones', 'Ropa'];
const TIPOS: [RegExp, TipoFamily][] = [
  [/^SHORTS?$/, { prefijo: 'Bermuda Short', productType: 'Bermudas', etiquetas: PANTALONES, gramos: 750 }],
  [/^BERMUDAS?$/, { prefijo: 'Bermuda', productType: 'Bermudas', etiquetas: PANTALONES, gramos: 750 }],
  [/^PANTALON(ES)?$/, { prefijo: 'Pantalon', productType: 'Pantalon', etiquetas: PANTALONES, gramos: 750 }],
  [/^REMERAS?$/, { prefijo: 'Remera', productType: 'Remera', etiquetas: ROPA, gramos: 400 }],
  [/^BUZOS?$/, { prefijo: 'Buzo', productType: 'Buzos', etiquetas: ROPA, gramos: 400 }],
  [/^CAMPERAS?$/, { prefijo: 'Campera', productType: 'Camperas', etiquetas: ROPA, gramos: 900 }],
  [/^MALLAS?$/, { prefijo: 'Malla', productType: 'Malla', etiquetas: ROPA, gramos: 150 }],
  [/^MEDIAS?$/, { prefijo: 'Medias', productType: 'Medias', etiquetas: ['Accesorios', 'Medias', 'NO TIENE CAMBIO NI DEVOLUCION'], gramos: 100 }],
  [/^GORRAS?$/, { prefijo: 'Gorra', productType: 'Gorras', etiquetas: ['Accesorios'], gramos: 150 }],
];

const capital = (w: string) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/** Separa la descripción de la planilla (ARTICULO MODELO CORTE COLOR) en el tipo y el resto. */
export function partesFamily(descripcion: string): { articulo: string; resto: string[]; tipo: TipoFamily | null } {
  const palabras = String(descripcion ?? '').replace(/\//g, ' ').split(/\s+/).filter(Boolean);
  const [primera = '', ...resto] = palabras;
  const tipo = TIPOS.find(([re]) => re.test(norm(primera)))?.[1] ?? null;
  return { articulo: primera, resto: resto.filter((w) => !/^FAMILY(ARG)?$/.test(norm(w))), tipo };
}

/** «SHORT SPECTRUM BASKET NEGRO/MULTI» → «Bermuda Short Familyarg Spectrum Basket Negro Multi». */
export function tituloFamily(descripcion: string): string {
  const { articulo, resto, tipo } = partesFamily(descripcion);
  return [tipo?.prefijo ?? capital(articulo), VENDOR_FAMILY, ...resto.map(capital)].filter(Boolean).join(' ');
}

/** Talle con el que se crea la variante (como en la tienda): 2XL = XXL, 3XL = XXXL. */
export function talleAlta(t: string): string {
  const s = String(t ?? '').toUpperCase().replace(/\s+/g, '');
  return ({ '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL' } as Record<string, string>)[s] ?? s;
}

/** Costo con centavos: por mayor − 15%. 34.500 → 29.325. */
export const costoFamily = (precioMayor: number) => Math.round(precioMayor * (100 - DESCUENTO_FAMILY)) / 100;

/** Lo que identifica la mercadería cargada: fecha, código, total y talles. */
export function firmaCarga(fecha: string, r: Pick<RenglonFamily, 'codigo' | 'cantidad' | 'talles'>): string {
  const talles = r.talles.map((t) => `${talleFamily(t.talle)}:${t.cantidad}`).sort().join(',');
  return `${fecha}|${r.codigo}|${r.cantidad}|${talles}`;
}

// ---------------------------------------------------------------------------
// LO QUE HAY EN SHOPIFY (solo lectura)
// ---------------------------------------------------------------------------
export interface VarianteCarga { id: string; talle: string; sku: string; inventoryItemId: string; seguimiento: boolean; disponible: number | null }
export interface ProductoCarga { id: string; titulo: string; estado: string; etiquetas: string[]; variantes: VarianteCarga[] }
export interface ProductoLista { id: string; titulo: string; estado: string; etiquetas: string[] }
export interface EstadoCarga {
  locationId: string;
  posId: string | null;
  /** código → productos que lo llevan en el SKU o en una etiqueta. */
  porCodigo: Record<string, string[]>;
  /** Todos los productos Familyarg (para buscar por nombre los que no tienen SKU). */
  familia: ProductoLista[];
  /** Variantes y stock en FAMILYARG de los productos que pueden recibir stock. */
  productos: Record<string, ProductoCarga>;
}
/** Marca guardada en la base por entrega y artículo. */
export interface CargaFamily {
  estado: 'en curso' | 'cargada' | 'parcial' | 'dudosa';
  fecha: string;
  firma: string;
  detalle?: { accion?: 'alta' | 'reposicion'; productoId?: string; titulo?: string; unidades?: number; mensaje?: string; talles?: { talle: string; cantidad: number }[] };
  /** Ya quedó anotada en el registro de cargas. */
  registrado?: boolean;
}

/** Productos parecidos por nombre (Family sin SKU ni etiqueta con el código). */
export function candidatosPorNombre(descripcion: string, familia: ProductoLista[]): (ProductoLista & { motivo: string })[] {
  const { resto, tipo } = partesFamily(descripcion);
  const clave = resto.map(norm).flatMap((w) => w.split(/[^A-Z0-9]+/)).filter((w) => w.length > 1 || /\d/.test(w));
  if (!clave.length) return [];
  const primeraDelTipo = norm(tipo?.prefijo.split(' ')[0] ?? '');
  const fuertes: (ProductoLista & { motivo: string })[] = [];
  const debiles: (ProductoLista & { motivo: string })[] = [];
  for (const p of familia) {
    const palabras = new Set(norm(p.titulo).split(/[^A-Z0-9]+/).filter(Boolean));
    const primera = norm(p.titulo).split(/\s+/)[0] ?? '';
    if (clave.every((w) => palabras.has(w))) fuertes.push({ ...p, motivo: 'tiene todas las palabras del modelo y el color' });
    else if ((!primeraDelTipo || primera === primeraDelTipo) && palabras.has(clave[0])) {
      // Mismo tipo y modelo, y el color (última palabra) o casi todas las palabras: «Negro Multi» ≈ «Negro».
      const tiene = clave.filter((w) => palabras.has(w)).length;
      if (palabras.has(clave[clave.length - 1]) || tiene / clave.length >= 0.75) debiles.push({ ...p, motivo: 'mismo tipo y modelo, nombre parecido' });
    }
  }
  return [...fuertes, ...debiles];
}

const Q_SUCURSALES = `query { locations(first: 100) { nodes { id name } } }`;
const Q_CANALES = `query { publications(first: 50) { nodes { id name } } }`;
const Q_VARIANTES = `query($q: String!, $cursor: String) {
  productVariants(first: 100, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { sku product { id tags } }
  }
}`;
const Q_FAMILY = `query($cursor: String) {
  products(first: 100, after: $cursor, query: "vendor:Familyarg") {
    pageInfo { hasNextPage endCursor }
    nodes { id title status tags }
  }
}`;
const Q_PRODUCTO = `query($id: ID!, $loc: ID!) {
  product(id: $id) {
    id title status tags
    variants(first: 100) { nodes { id title sku inventoryItem { id tracked inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } } } } }
  }
}`;

interface Pagina<T> { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] }
type NodoVariante = { sku: string | null; product: { id: string; tags?: string[] } };
type NodoProducto = {
  id: string; title: string; status: string; tags?: string[];
  variants: { nodes: { id: string; title: string; sku: string | null; inventoryItem: { id: string; tracked: boolean; inventoryLevel: { quantities: { name: string; quantity: number }[] } | null } | null }[] };
};

/** Productos que llevan el código en el SKU o en una etiqueta (lectura). */
export async function productosDelCodigo(codigos: string[], gql: Gql): Promise<Record<string, string[]>> {
  const out: Record<string, Set<string>> = {};
  const validos = [...new Set(codigos)].filter(codigoBuscable);
  for (const c of validos) out[c] = new Set();
  for (let i = 0; i < validos.length; i += 10) {
    const lote = validos.slice(i, i + 10);
    let cursor: string | null = null;
    for (let pagina = 0; pagina < 30; pagina++) {
      const d = (await gql(Q_VARIANTES, { q: busquedaCodigos(lote), cursor })) as { productVariants: Pagina<NodoVariante> };
      for (const n of d.productVariants.nodes) {
        for (const c of lote) if (skuEsDelCodigo(n.sku || '', c) || etiquetaEsDelCodigo(n.product.tags, c)) out[c].add(n.product.id);
      }
      if (!d.productVariants.pageInfo.hasNextPage) break;
      cursor = d.productVariants.pageInfo.endCursor;
    }
  }
  return Object.fromEntries(Object.entries(out).map(([c, s]) => [c, [...s]]));
}

/** Lee todo lo que hace falta para armar la carga. Solo lectura; si algo falla, no se arma nada. */
export async function leerEstadoCarga(renglones: RenglonFamily[], gql: Gql): Promise<EstadoCarga> {
  const suc = (await gql(Q_SUCURSALES)) as { locations: { nodes: { id: string; name: string }[] } };
  const loc = suc.locations.nodes.find((l) => mismaSucursal(l.name, SUCURSAL_FAMILY));
  if (!loc) throw new Error(`No encontré la sucursal ${SUCURSAL_FAMILY} en Shopify. No se cargó nada.`);
  const can = (await gql(Q_CANALES)) as { publications: { nodes: { id: string; name: string }[] } };
  const pos = can.publications.nodes.find((p) => {
    const n = String(p.name || '').toLowerCase();
    return n.includes('point of sale') || n.includes('punto de venta') || n === 'pos';
  });

  const porCodigo = await productosDelCodigo(renglones.map((r) => r.codigo), gql);
  const familia: ProductoLista[] = [];
  const sinProducto = renglones.filter((r) => codigoBuscable(r.codigo) && !porCodigo[r.codigo]?.length);
  if (sinProducto.length) {
    let cursor: string | null = null;
    for (let pagina = 0; pagina < 30; pagina++) {
      const d = (await gql(Q_FAMILY, { cursor })) as { products: Pagina<{ id: string; title: string; status: string; tags?: string[] }> };
      for (const p of d.products.nodes) familia.push({ id: p.id, titulo: p.title, estado: p.status, etiquetas: p.tags ?? [] });
      if (!d.products.pageInfo.hasNextPage) break;
      cursor = d.products.pageInfo.endCursor;
    }
  }
  const ids = new Set<string>(Object.values(porCodigo).flat());
  for (const r of sinProducto) for (const c of candidatosPorNombre(r.descripcion, familia).slice(0, 4)) ids.add(c.id);
  const productos: Record<string, ProductoCarga> = {};
  for (const id of ids) {
    const d = (await gql(Q_PRODUCTO, { id, loc: loc.id })) as { product: NodoProducto | null };
    const p = d.product;
    if (!p) continue;
    productos[id] = {
      id: p.id, titulo: p.title, estado: p.status, etiquetas: p.tags ?? [],
      variantes: p.variants.nodes.map((v) => {
        const nivel = v.inventoryItem?.inventoryLevel;
        const q = nivel?.quantities.find((x) => x.name === 'available');
        return {
          id: v.id, talle: v.title, sku: v.sku || '', inventoryItemId: v.inventoryItem?.id || '', seguimiento: !!v.inventoryItem?.tracked,
          // Sin nivel = la variante no está dada de alta en FAMILYARG (no es cero).
          disponible: nivel ? (Number.isFinite(Number(q?.quantity)) ? Number(q!.quantity) : null) : null,
        };
      }),
    };
  }
  return { locationId: loc.id, posId: pos?.id ?? null, porCodigo, familia, productos };
}

// ---------------------------------------------------------------------------
// PLAN (vista previa): qué se va a hacer con cada artículo
// ---------------------------------------------------------------------------
export interface AltaFamily {
  tipo: 'alta';
  titulo: string;
  productType: string;
  etiquetas: string[];
  gramos: number;
  precio: number;
  costo: number;
  variantes: { talle: string; sku: string; cantidad: number }[];
}
export interface LineaReposicion { talle: string; inventoryItemId: string; actual: number | null; suma: number }
export interface ReposicionFamily { tipo: 'reposicion'; productoId: string; titulo: string; lineas: LineaReposicion[]; etiquetar: boolean }
export interface OpcionCarga { clave: string; etiqueta: string; accion: AltaFamily | ReposicionFamily | null; bloqueo?: string; avisos: string[] }
export interface ItemCarga {
  codigo: string;
  descripcion: string;
  unidades: number;
  firma: string;
  /** listo: hay una sola cosa para hacer · elegir: la usuaria elige · bloqueado / cargado: no se hace nada. */
  estado: 'listo' | 'elegir' | 'bloqueado' | 'cargado';
  motivo: string;
  /** La primera es la elegida por defecto (en «elegir», «No cargar»). */
  opciones: OpcionCarga[];
  carga?: CargaFamily;
}
export interface PlanCarga { entregaId: string; locationId: string; posId: string | null; items: ItemCarga[]; avisos: string[] }

const NO_CARGAR: OpcionCarga = { clave: 'no', etiqueta: 'No cargar este artículo', accion: null, avisos: [] };
const fechaAr = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };

export function textoCarga(c: CargaFamily): string {
  const cuando = fechaAr(c.fecha);
  const que = c.detalle?.titulo ? ` en «${c.detalle.titulo}»` : '';
  if (c.estado === 'cargada') return `✔ Cargado en Shopify el ${cuando}${que}${c.detalle?.unidades ? ` (${c.detalle.unidades} u.)` : ''}.`;
  if (c.estado === 'parcial') return `⚠️ Cargado en parte el ${cuando}${que}: ${c.detalle?.mensaje || 'revisá en Shopify'}.`;
  if (c.estado === 'dudosa') return `❓ No sé si se cargó (${cuando})${que}: ${c.detalle?.mensaje || 'revisá en Shopify'}.`;
  return `⏳ Se empezó a cargar el ${cuando}${que} y no terminó: revisá en Shopify.`;
}

function opcionAlta(r: RenglonFamily): OpcionCarga {
  const { articulo, tipo } = partesFamily(r.descripcion);
  const titulo = tituloFamily(r.descripcion);
  const avisos: string[] = [];
  const base = { clave: 'alta', etiqueta: `Crear producto nuevo «${titulo}»`, avisos };
  if (!r.talles.length) return { ...base, accion: null, bloqueo: 'La planilla no trae talles: no sé qué variantes crear. Cargalo a mano.' };
  if (!(r.precioPublico > 0)) return { ...base, accion: null, bloqueo: 'Falta el precio público en la planilla (es el precio de venta).' };
  if (!(r.precioMayor > 0)) return { ...base, accion: null, bloqueo: 'Falta el precio por mayor en la planilla (de ahí sale el costo).' };
  const variantes = r.talles.map((t) => ({ talle: talleAlta(t.talle), sku: `${r.codigo}.${talleAlta(t.talle)}`, cantidad: t.cantidad }));
  const repetidos = variantes.filter((v, i) => variantes.findIndex((x) => x.talle === v.talle) !== i).map((v) => v.talle);
  if (repetidos.length) return { ...base, accion: null, bloqueo: `El talle ${[...new Set(repetidos)].join(', ')} está dos veces en la planilla.` };
  if (!tipo) avisos.push(`No conozco el tipo «${articulo}»: revisá el título antes de crear.`);
  if (Math.abs(r.precioMayor * 2 - r.precioPublico) > 1) {
    avisos.push(`El por mayor (${fmt(r.precioMayor)}) no es la mitad del público (${fmt(r.precioPublico)}): el costo sale igual del por mayor − 15%.`);
  }
  return {
    ...base,
    accion: {
      tipo: 'alta', titulo, productType: tipo?.productType ?? capital(articulo), etiquetas: [r.codigo, ...(tipo?.etiquetas ?? ROPA)],
      gramos: tipo?.gramos ?? 400, precio: r.precioPublico, costo: costoFamily(r.precioMayor), variantes,
    },
  };
}

function opcionReposicion(r: RenglonFamily, p: ProductoCarga | undefined, fila: FilaFamily | undefined, porNombre: string | null): OpcionCarga {
  if (!p) return { clave: 'falta', etiqueta: 'Producto que no pude leer', accion: null, bloqueo: 'No pude leer ese producto en Shopify.', avisos: [] };
  const avisos: string[] = [];
  const base = { clave: `repo:${p.id}`, etiqueta: `Sumar el stock en «${p.titulo}»${porNombre ? ` (${porNombre})` : ''}`, avisos };
  const lineas: LineaReposicion[] = [];
  const faltan: string[] = [], dobles: string[] = [], sinControl: string[] = [];
  const pares = r.talles.length ? r.talles : p.variantes.length === 1 ? [{ talle: p.variantes[0].talle, cantidad: r.cantidad }] : null;
  if (!pares) return { ...base, accion: null, bloqueo: 'La planilla no trae talles y el producto tiene varios: cargalo a mano.' };
  for (const t of pares) {
    const vs = r.talles.length ? p.variantes.filter((v) => talleFamily(v.talle) === talleFamily(t.talle)) : p.variantes;
    if (!vs.length) { faltan.push(t.talle); continue; }
    if (vs.length > 1) { dobles.push(t.talle); continue; }
    if (!vs[0].seguimiento || !vs[0].inventoryItemId) { sinControl.push(t.talle); continue; }
    lineas.push({ talle: vs[0].talle, inventoryItemId: vs[0].inventoryItemId, actual: vs[0].disponible, suma: t.cantidad });
  }
  if (faltan.length) return { ...base, accion: null, bloqueo: `En «${p.titulo}» no existe el talle ${faltan.join(', ')}: crealo en Shopify y armá la carga de nuevo.` };
  if (dobles.length) return { ...base, accion: null, bloqueo: `«${p.titulo}» tiene dos variantes del talle ${dobles.join(', ')}: cargalo a mano.` };
  if (sinControl.length) return { ...base, accion: null, bloqueo: `En «${p.titulo}» el talle ${sinControl.join(', ')} no lleva control de stock: cargalo a mano.` };
  for (const l of lineas) if (l.actual === null) avisos.push(`Talle ${l.talle}: no está dado de alta en ${SUCURSAL_FAMILY}; se da de alta con ${l.suma}.`);
  if (p.estado !== 'ACTIVE') avisos.push(`El producto está ${p.estado === 'DRAFT' ? 'en borrador' : 'archivado'} en Shopify: se le suma igual el stock.`);
  if (fila?.cambiosPrecio.length) avisos.push('Family cambió el precio: el precio de Shopify NO se cambia (si querés, cambialo a mano).');
  const etiquetar = !!porNombre && !etiquetaEsDelCodigo(p.etiquetas, r.codigo);
  if (etiquetar) avisos.push(`Se le agrega la etiqueta ${r.codigo} para reconocerlo en las próximas entregas.`);
  return { ...base, accion: { tipo: 'reposicion', productoId: p.id, titulo: p.titulo, lineas, etiquetar } };
}

/**
 * Arma la vista previa de la carga de una entrega. No escribe nada.
 * `cargas` son las marcas guardadas (de todas las entregas), leídas recién de la base.
 */
export function planCargaFamily(r: ResultadoFamily, estado: EstadoCarga, cargas: Record<string, CargaFamily>): PlanCarga {
  const e = r.entrega;
  const avisos: string[] = [];
  if (!estado.posId) avisos.push('No encontré el canal «Point of Sale»: los nuevos se crean activos, pero sin publicar en ningún canal.');
  const items = e.renglones.map((ren): ItemCarga => {
    const fila = r.filas.find((f) => f.codigo === ren.codigo);
    const firma = firmaCarga(e.fecha, ren);
    const base = { codigo: ren.codigo, descripcion: ren.descripcion, unidades: ren.cantidad, firma };
    const bloqueado = (motivo: string): ItemCarga => ({ ...base, estado: 'bloqueado', motivo, opciones: [] });
    const carga = cargas[`${e.id}|${ren.codigo}`];
    if (carga) return { ...base, estado: 'cargado', motivo: textoCarga(carga), opciones: [], carga };
    const otra = Object.entries(cargas).find(([k, c]) => !k.startsWith(`${e.id}|`) && c.firma === firma);
    if (otra) return bloqueado(`Esta misma mercadería (mismo día, código y talles) ya se cargó desde otra entrega (${textoCarga(otra[1])}). Si de verdad es otra entrega, cargala a mano.`);
    if (!(ren.cantidad > 0)) return bloqueado('No tiene cantidades.');
    if (fila?.sumaMal) return bloqueado('Los talles no suman el TOTAL de la planilla: corregí la planilla primero.');
    if (!codigoBuscable(ren.codigo)) return bloqueado('El código tiene caracteres que no puedo buscar en Shopify: cargalo a mano.');

    const ids = estado.porCodigo[ren.codigo] ?? [];
    if (ids.length) {
      const opciones = ids.map((id) => opcionReposicion(ren, estado.productos[id], fila, null));
      if (ids.length === 1) return opciones[0].bloqueo ? bloqueado(opciones[0].bloqueo) : { ...base, estado: 'listo', motivo: '', opciones };
      return { ...base, estado: 'elegir', motivo: `El código está en ${ids.length} productos de Shopify: elegí en cuál sumar el stock.`, opciones: [NO_CARGAR, ...opciones] };
    }
    const alta = opcionAlta(ren);
    const parecidos = candidatosPorNombre(ren.descripcion, estado.familia).slice(0, 4);
    if (parecidos.length) {
      return {
        ...base, estado: 'elegir',
        motivo: `No hay ningún producto con este código, pero ${parecidos.length === 1 ? 'hay uno parecido' : `hay ${parecidos.length} parecidos`} (puede ser el mismo, cargado sin SKU). Elegí si es ese o si se crea nuevo.`,
        opciones: [NO_CARGAR, ...parecidos.map((c) => opcionReposicion(ren, estado.productos[c.id], fila, c.motivo)), alta],
      };
    }
    return alta.bloqueo ? bloqueado(alta.bloqueo) : { ...base, estado: 'listo', motivo: '', opciones: [alta] };
  });
  return { entregaId: e.id, locationId: estado.locationId, posId: estado.posId, items, avisos };
}

/** Elección de la usuaria por artículo: qué opción y, si se crea, con qué título. */
export type EleccionesCarga = Record<string, { clave: string; titulo?: string }>;

/** Lo que se va a hacer, con las elecciones aplicadas (solo opciones sin bloqueo). */
export function accionesElegidas(plan: PlanCarga, elecciones: EleccionesCarga): { codigo: string; firma: string; accion: AltaFamily | ReposicionFamily }[] {
  const out: { codigo: string; firma: string; accion: AltaFamily | ReposicionFamily }[] = [];
  for (const it of plan.items) {
    if (it.estado !== 'listo' && it.estado !== 'elegir') continue;
    const clave = elecciones[it.codigo]?.clave ?? it.opciones[0]?.clave;
    const op = it.opciones.find((o) => o.clave === clave);
    if (!op?.accion || op.bloqueo) continue;
    let accion = op.accion;
    if (accion.tipo === 'alta') {
      const titulo = (elecciones[it.codigo]?.titulo ?? accion.titulo).replace(/\s+/g, ' ').trim();
      accion = { ...accion, titulo: titulo || accion.titulo };
    }
    out.push({ codigo: it.codigo, firma: it.firma, accion });
  }
  return out;
}

// ---------------------------------------------------------------------------
// EJECUCIÓN (después de la confirmación)
// ---------------------------------------------------------------------------
const CREAR = `mutation CrearFamily($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) { product { id title } userErrors { field message } }
}`;
const PUBLICAR = `mutation PublicarFamily($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { userErrors { field message } }
}`;
const SUMAR = `mutation SumarFamily($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { createdAt } userErrors { code field message } }
}`;
const ACTIVAR = `mutation ActivarFamily($inventoryItemId: ID!, $locationId: ID!, $available: Int, $key: String!) {
  inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) @idempotent(key: $key) { inventoryLevel { id } userErrors { field message } }
}`;
const ETIQUETAR = `mutation EtiquetarFamily($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { message } }
}`;

export interface DepsCarga {
  gql: Gql;
  /** Pone la marca «en curso» (solo si no existe). ok:false = ya estaba cargado o cargándose. */
  reservar: (codigo: string, firma: string, detalle: CargaFamily['detalle']) => Promise<{ ok: boolean; existente?: CargaFamily | null }>;
  terminar: (codigo: string, estado: 'cargada' | 'parcial' | 'dudosa', detalle: CargaFamily['detalle']) => Promise<void>;
  liberar: (codigo: string) => Promise<void>;
  /** Clave de idempotencia nueva para cada escritura de stock. */
  clave: () => string;
  onProgreso?: (hechos: number, total: number) => void;
}
export interface ResultadoCarga { codigo: string; estado: 'cargada' | 'parcial' | 'dudosa' | 'error' | 'saltado'; mensaje: string; productoId?: string }
/** talles: lo mandado a Shopify por talle, sin lo que Shopify rechazó (para el registro de cargas). */
type Paso = { estado: 'cargada' | 'parcial' | 'dudosa' | 'error'; mensaje: string; productoId?: string; titulo?: string; unidades?: number; talles?: { talle: string; cantidad: number }[] };

const errores = (ue: { message?: string }[]) => ue.map((x) => x.message).filter(Boolean).join('; ') || 'error de Shopify';
const NO_SE_SABE = 'la respuesta de Shopify no llegó completa. Revisá en Shopify antes de volver a intentar';
/**
 * Fallas en las que Shopify seguro NO ejecutó la escritura: la app la rechazó antes de mandarla
 * (sesión, origen, operación no permitida) o Shopify la rechazó sin ejecutarla (consulta inválida,
 * límite de velocidad, permiso). Cualquier otra (corte, timeout, 502) queda «dudosa».
 */
export function noSeEjecuto(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return /Error de conexión con Shopify \((400|401|403|405|413|415)\)/.test(m)
    || /^Shopify error: .*(THROTTLED|ACCESS_DENIED|undefinedField|argumentNotAccepted|missingRequiredArguments|variableMismatch|doesn't exist on type|Parse error)/s.test(m);
}
const motivo = (e: unknown) => (e instanceof Error ? e.message : 'error').slice(0, 200);

async function crearAlta(codigo: string, a: AltaFamily, plan: PlanCarga, deps: DepsCarga): Promise<Paso> {
  // Revisión fresca: si mientras tanto alguien lo creó con este código, no se duplica.
  try {
    const ya = await productosDelCodigo([codigo], deps.gql);
    if (ya[codigo]?.length) return { estado: 'error', mensaje: 'Mientras tanto apareció en Shopify un producto con este código: no se creó nada. Armá la carga de nuevo.' };
  } catch (e) {
    return { estado: 'error', mensaje: `No pude revisar Shopify antes de crear (${motivo(e)}): no se creó nada.` };
  }
  const input = {
    title: a.titulo,
    vendor: VENDOR_FAMILY,
    status: 'ACTIVE',
    productType: a.productType,
    tags: a.etiquetas,
    productOptions: [{ name: 'Talle', values: a.variantes.map((v) => ({ name: v.talle })) }],
    variants: a.variantes.map((v) => ({
      optionValues: [{ optionName: 'Talle', name: v.talle }],
      price: String(a.precio),
      inventoryItem: { sku: v.sku, cost: String(a.costo), tracked: true, measurement: { weight: { value: a.gramos, unit: 'GRAMS' } } },
      inventoryQuantities: [{ locationId: plan.locationId, name: 'available', quantity: v.cantidad }],
    })),
  };
  const unidades = a.variantes.reduce((s, v) => s + v.cantidad, 0);
  const talles = a.variantes.map((v) => ({ talle: v.talle, cantidad: v.cantidad }));
  let data: { productSet?: { product?: { id?: string } | null; userErrors?: { message?: string }[] } } | null;
  try { data = (await deps.gql(CREAR, { input })) as typeof data; }
  catch (e) {
    if (noSeEjecuto(e)) return { estado: 'error', mensaje: `Shopify no creó «${a.titulo}» (${motivo(e)}).` };
    return { estado: 'dudosa', mensaje: `No sé si se creó «${a.titulo}»: ${NO_SE_SABE}.`, titulo: a.titulo, talles };
  }
  const ue = data?.productSet?.userErrors;
  if (!Array.isArray(ue)) return { estado: 'dudosa', mensaje: `No sé si se creó «${a.titulo}»: ${NO_SE_SABE}.`, titulo: a.titulo, talles };
  if (ue.length) return { estado: 'error', mensaje: `Shopify no creó «${a.titulo}»: ${errores(ue)}.` };
  const pid = data?.productSet?.product?.id;
  if (!pid) return { estado: 'dudosa', mensaje: `No sé si se creó «${a.titulo}»: ${NO_SE_SABE}.`, titulo: a.titulo, talles };
  let publicado = '';
  if (plan.posId) {
    try {
      const p = (await deps.gql(PUBLICAR, { id: pid, input: [{ publicationId: plan.posId }] })) as { publishablePublish?: { userErrors?: { message?: string }[] } } | null;
      const pe = p?.publishablePublish?.userErrors;
      if (!Array.isArray(pe) || pe.length) publicado = ' No pude publicarlo en Point of Sale: publicalo a mano.';
    } catch { publicado = ' No pude publicarlo en Point of Sale: publicalo a mano.'; }
  }
  return { estado: 'cargada', productoId: pid, titulo: a.titulo, unidades, talles, mensaje: `Creado «${a.titulo}» con ${unidades} u. en ${SUCURSAL_FAMILY} (${a.variantes.map((v) => `${v.talle}:${v.cantidad}`).join(' ')}).${publicado}` };
}

async function sumarStock(codigo: string, rep: ReposicionFamily, plan: PlanCarga, deps: DepsCarga): Promise<Paso> {
  const activas = rep.lineas.filter((l) => l.actual !== null);
  const sinAlta = rep.lineas.filter((l) => l.actual === null);
  const hechas: string[] = [];
  let unidades = 0;
  const talles = (ls: LineaReposicion[]) => ls.map((l) => ({ talle: l.talle, cantidad: l.suma }));
  if (activas.length) {
    const input = {
      name: 'available',
      reason: 'received',
      // Suma: lo que había + lo entregado. Si cambió desde la vista previa, Shopify rechaza todo el lote.
      quantities: activas.map((l) => ({ inventoryItemId: l.inventoryItemId, locationId: plan.locationId, quantity: l.actual! + l.suma, changeFromQuantity: l.actual })),
    };
    let data: { inventorySetQuantities?: { inventoryAdjustmentGroup?: unknown; userErrors?: { code?: string; message?: string }[] } } | null;
    try { data = (await deps.gql(SUMAR, { input, key: deps.clave() })) as typeof data; }
    catch (e) {
      if (noSeEjecuto(e)) return { estado: 'error', mensaje: `Shopify no sumó el stock en «${rep.titulo}» (${motivo(e)}). No se sumó nada.` };
      return { estado: 'dudosa', mensaje: `No sé si se sumó el stock en «${rep.titulo}»: ${NO_SE_SABE}.`, productoId: rep.productoId, titulo: rep.titulo, talles: talles(activas) };
    }
    const ue = data?.inventorySetQuantities?.userErrors;
    if (!Array.isArray(ue)) return { estado: 'dudosa', mensaje: `No sé si se sumó el stock en «${rep.titulo}»: ${NO_SE_SABE}.`, productoId: rep.productoId, titulo: rep.titulo, talles: talles(activas) };
    if (ue.length) {
      const cambio = ue.some((x) => /CHANGE_FROM_QUANTITY_STALE|COMPARE_QUANTITY_STALE/.test(String(x.code)));
      return { estado: 'error', mensaje: cambio
        ? `El stock de «${rep.titulo}» en ${SUCURSAL_FAMILY} cambió desde que armaste la carga (por ejemplo, una venta). No se sumó nada: armá la carga de nuevo.`
        : `Shopify no sumó el stock en «${rep.titulo}»: ${errores(ue)}. No se sumó nada.` };
    }
    if (!data?.inventorySetQuantities?.inventoryAdjustmentGroup) return { estado: 'dudosa', mensaje: `No sé si se sumó el stock en «${rep.titulo}»: ${NO_SE_SABE}.`, productoId: rep.productoId, titulo: rep.titulo, talles: talles(activas) };
    for (const l of activas) { hechas.push(`${l.talle} ${l.actual}→${l.actual! + l.suma}`); unidades += l.suma; }
  }
  const fallas: string[] = [], dudas: string[] = [];
  const enviadas: LineaReposicion[] = [...activas];
  for (const l of sinAlta) {
    try {
      const d = (await deps.gql(ACTIVAR, { inventoryItemId: l.inventoryItemId, locationId: plan.locationId, available: l.suma, key: deps.clave() })) as
        { inventoryActivate?: { inventoryLevel?: { id?: string } | null; userErrors?: { message?: string }[] } } | null;
      const ue = d?.inventoryActivate?.userErrors;
      if (!Array.isArray(ue) || (!ue.length && !d?.inventoryActivate?.inventoryLevel?.id)) { dudas.push(l.talle); enviadas.push(l); }
      else if (ue.length) fallas.push(`${l.talle} (${errores(ue)})`);
      else { hechas.push(`${l.talle} alta con ${l.suma}`); unidades += l.suma; enviadas.push(l); }
    } catch (e) { if (noSeEjecuto(e)) fallas.push(`${l.talle} (${motivo(e)})`); else { dudas.push(l.talle); enviadas.push(l); } }
  }
  let etiqueta = '';
  if (rep.etiquetar && hechas.length) {
    try {
      const t = (await deps.gql(ETIQUETAR, { id: rep.productoId, tags: [codigo] })) as { tagsAdd?: { node?: { id?: string } | null; userErrors?: { message?: string }[] } } | null;
      if (!t?.tagsAdd?.node?.id || t.tagsAdd.userErrors?.length) etiqueta = ` No pude agregarle la etiqueta ${codigo}: agregala a mano.`;
    } catch { etiqueta = ` No pude agregarle la etiqueta ${codigo}: agregala a mano.`; }
  }
  const comun = { productoId: rep.productoId, titulo: rep.titulo, unidades, talles: talles(enviadas) };
  if (!hechas.length && !dudas.length) return { estado: 'error', mensaje: `Shopify no dio de alta el stock en «${rep.titulo}»: ${fallas.join(', ')}. No se sumó nada.` };
  const resumen = hechas.length ? `Sumado en «${rep.titulo}»: ${hechas.join(', ')}.` : '';
  if (dudas.length) return { ...comun, estado: 'dudosa', mensaje: `${resumen} No sé si se dio de alta el talle ${dudas.join(', ')}: ${NO_SE_SABE}.${fallas.length ? ` Falló: ${fallas.join(', ')}.` : ''}${etiqueta}`.trim() };
  if (fallas.length) return { ...comun, estado: 'parcial', mensaje: `${resumen} No se pudo dar de alta: ${fallas.join(', ')}; cargalo a mano.${etiqueta}`.trim() };
  return { ...comun, estado: 'cargada', mensaje: `${resumen}${etiqueta}` };
}

/**
 * Carga en Shopify lo elegido, artículo por artículo. Cada uno se marca en la base
 * ANTES de escribir; si Shopify lo rechaza (no se escribió nada) se libera la marca;
 * si la respuesta no llega completa queda «dudosa» y no se reintenta sola.
 */
export async function ejecutarCargaFamily(plan: PlanCarga, elecciones: EleccionesCarga, deps: DepsCarga): Promise<ResultadoCarga[]> {
  const acciones = accionesElegidas(plan, elecciones);
  const out: ResultadoCarga[] = [];
  for (let i = 0; i < acciones.length; i++) {
    const { codigo, firma, accion } = acciones[i];
    const detalle = { accion: accion.tipo, titulo: accion.titulo, ...(accion.tipo === 'reposicion' ? { productoId: accion.productoId } : {}) };
    let reserva: { ok: boolean; existente?: CargaFamily | null };
    try { reserva = await deps.reservar(codigo, firma, detalle); }
    catch (e) { out.push({ codigo, estado: 'error', mensaje: `No pude anotar la carga en la base (${e instanceof Error ? e.message : 'error'}): no se cargó nada.` }); deps.onProgreso?.(i + 1, acciones.length); continue; }
    if (!reserva.ok) {
      out.push({ codigo, estado: 'saltado', mensaje: reserva.existente ? `No se cargó otra vez. ${textoCarga(reserva.existente)}` : 'Ya estaba cargado (o se está cargando en otra pantalla): no se cargó otra vez.' });
      deps.onProgreso?.(i + 1, acciones.length);
      continue;
    }
    let paso: Paso;
    try { paso = accion.tipo === 'alta' ? await crearAlta(codigo, accion, plan, deps) : await sumarStock(codigo, accion, plan, deps); }
    catch (e) { paso = { estado: 'dudosa', mensaje: `Algo falló a mitad de camino (${e instanceof Error ? e.message : 'error'}): revisá en Shopify.` }; }
    let mensaje = paso.mensaje;
    if (paso.estado === 'error') {
      // Shopify no escribió nada: se libera la marca para poder volver a armar la carga.
      try { await deps.liberar(codigo); } catch { mensaje += ' (No pude liberar la marca: liberala a mano después de revisar.)'; }
    } else {
      try { await deps.terminar(codigo, paso.estado, { accion: accion.tipo, productoId: paso.productoId, titulo: paso.titulo ?? accion.titulo, unidades: paso.unidades, mensaje: paso.mensaje.slice(0, 600), ...(paso.talles ? { talles: paso.talles } : {}) }); }
      catch { mensaje += ' (No pude anotar el resultado en la base: NO lo vuelvas a cargar.)'; }
    }
    out.push({ codigo, estado: paso.estado, mensaje, ...(paso.productoId ? { productoId: paso.productoId } : {}) });
    deps.onProgreso?.(i + 1, acciones.length);
  }
  return out;
}

/** Resumen para la confirmación. */
export function resumenCarga(plan: PlanCarga, elecciones: EleccionesCarga): { altas: number; reposiciones: number; unidades: number; lineas: string[] } {
  const acciones = accionesElegidas(plan, elecciones);
  const lineas: string[] = [];
  let altas = 0, reposiciones = 0, unidades = 0;
  for (const { codigo, accion } of acciones) {
    if (accion.tipo === 'alta') {
      altas++;
      const u = accion.variantes.reduce((s, v) => s + v.cantidad, 0);
      unidades += u;
      lineas.push(`• ${codigo}: crear «${accion.titulo}» a ${fmt(accion.precio)} (costo ${fmt(accion.costo)}) con ${u} u.`);
    } else {
      reposiciones++;
      const u = accion.lineas.reduce((s, l) => s + l.suma, 0);
      unidades += u;
      lineas.push(`• ${codigo}: sumar ${u} u. en «${accion.titulo}»`);
    }
  }
  return { altas, reposiciones, unidades, lineas };
}
