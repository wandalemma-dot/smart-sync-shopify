// ============================================================================
// TARGET — SEPARAR POR COLORES LO YA CARGADO (21-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// «Mi empleado cargó todo sin los colores… ¿cómo hacemos para editar?» (gax eligió un botón en la app).
// Un artículo de Target ya cargado como UN producto (SKU = código) se separa en un producto por color, sin
// deshacer la carga y sin borrar nada:
//   · El producto original pasa a ser el PRIMER color nuevo de la lista: título «nombre + color», SKU
//     código-COLOR y la etiqueta del color. Conserva fotos, historial y las ventas que ya tenga.
//   · Un color que ya está en Shopify (producto de Target con SKU código-COLOR) solo cambia su stock.
//   · Los demás colores se crean como en la carga (mismo precio, costo, marca y tipo; activos y en POS).
//   · Lo que no está en la lista queda en 0 (no se borra).
//   · Los colores tienen que sumar EXACTO lo que hay hoy disponible en DEPOSITO MARTINEZ.
// Orden de escritura: primero se BAJA el stock (con la cantidad leída: si cambió, no se hace nada), después se
// renombra, se crean los colores nuevos y al final se sube el stock de los colores que ya estaban. Así nunca
// hay más unidades a la venta que las que hay. Si algo falla, se dice qué quedó hecho y qué falta a mano.
// ============================================================================
import { confirmarCantidades, type Gql } from './confirmarStock';
import { mismaSucursal } from './shopify';
import { LOC_MARTINEZ_NOMBRE } from './syncLogic';
import { colorDeSku, nombreColor, skuColorTarget, slugColor, type ColorTarget } from './cargaTarget';
import { esDeTarget, ETIQUETA_TARGET, tipoTarget } from './target';

/** Un producto de Target de ese código (el original sin color o uno ya separado). */
export interface MiembroColor {
  id: string; titulo: string; vendor: string; productType: string; estado: string; etiquetas: string[];
  /** Color del SKU («NEGRO»); '' = el original, sin color. */
  color: string;
  variantes: number; varianteId: string; sku: string; inventoryItemId: string; seguimiento: boolean;
  precio: number | null; costo: number | null;
  /** Disponible en Martínez (null = sin alta en la sucursal). */
  disponible: number | null;
  /** Vendido sin preparar (queda en este producto). */
  comprometido: number;
}
export interface GrupoColores { codigo: string; locationId: string; posId: string | null; miembros: MiembroColor[]; /** Productos con el código pero sin la etiqueta Target: no se tocan. */ ajenos: string[] }

const Q_SUCURSALES = `query { locations(first: 100) { nodes { id name } } }`;
const Q_CANALES = `query { publications(first: 50) { nodes { id name } } }`;
const Q_BUSCAR = `query BuscarColores($q: String!) { productVariants(first: 100, query: $q) { nodes { sku product { id tags } } } }`;
const Q_PRODUCTO = `query ProductoColores($id: ID!, $loc: ID!) {
  product(id: $id) {
    id title vendor productType status tags
    variants(first: 5) { nodes { id sku price inventoryItem { id tracked unitCost { amount } inventoryLevel(locationId: $loc) { quantities(names: ["available", "committed"]) { name quantity } } } } }
  }
}`;
type NodoProducto = {
  id: string; title: string; vendor?: string | null; productType?: string | null; status: string; tags?: string[];
  variants: { nodes: { id: string; sku: string | null; price?: string | null; inventoryItem: { id: string; tracked: boolean; unitCost?: { amount: string } | null; inventoryLevel: { quantities: { name: string; quantity: number }[] } | null } | null }[] };
};

/** El color del SKU para ese código: '' = el original (SKU = código); null = no es de este código. */
export function colorDelGrupo(sku: string, codigo: string): string | null {
  const s = String(sku ?? '').trim().toUpperCase(), c = String(codigo ?? '').trim().toUpperCase();
  if (!c) return null;
  if (s === c) return '';
  return colorDeSku(s, c) || null;
}

/** Lee los productos de Target del código (solo lectura). */
export async function leerGrupoColores(codigo: string, gql: Gql): Promise<GrupoColores> {
  const cod = String(codigo ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(cod)) throw new Error(`El código «${codigo}» no es válido.`);
  const suc = (await gql(Q_SUCURSALES, {})) as { locations: { nodes: { id: string; name: string }[] } };
  const loc = suc.locations.nodes.find((l) => mismaSucursal(l.name, LOC_MARTINEZ_NOMBRE));
  if (!loc) throw new Error(`No encontré la sucursal ${LOC_MARTINEZ_NOMBRE} en Shopify.`);
  const d = (await gql(Q_BUSCAR, { q: `sku:${cod}* OR tag:${cod}` })) as { productVariants: { nodes: { sku: string | null; product: { id: string; tags?: string[] } }[] } };
  const ids = new Set<string>(), ajenosIds = new Set<string>();
  for (const n of d.productVariants.nodes) {
    if (colorDelGrupo(n.sku || '', cod) === null) continue;
    (esDeTarget(n.product.tags ?? []) ? ids : ajenosIds).add(n.product.id);
  }
  const miembros: MiembroColor[] = [], ajenos: string[] = [];
  for (const id of [...ids, ...ajenosIds]) {
    const r = (await gql(Q_PRODUCTO, { id, loc: loc.id })) as { product: NodoProducto | null };
    const p = r.product;
    if (!p) continue;
    if (!ids.has(id)) { ajenos.push(p.title); continue; }
    const v = p.variants.nodes[0];
    const qs = v?.inventoryItem?.inventoryLevel?.quantities;
    const q = (n: string) => qs?.find((x) => x.name === n)?.quantity;
    miembros.push({
      id: p.id, titulo: p.title, vendor: p.vendor || '', productType: p.productType || '', estado: p.status, etiquetas: p.tags ?? [],
      color: colorDelGrupo(v?.sku || '', cod) ?? '',
      variantes: p.variants.nodes.length, varianteId: v?.id || '', sku: v?.sku || '', inventoryItemId: v?.inventoryItem?.id || '', seguimiento: !!v?.inventoryItem?.tracked,
      precio: v?.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : null,
      costo: v?.inventoryItem?.unitCost?.amount != null && Number(v.inventoryItem.unitCost.amount) > 0 ? Number(v.inventoryItem.unitCost.amount) : null,
      disponible: qs && Number.isInteger(q('available')) ? q('available')! : null,
      comprometido: Number(q('committed')) || 0,
    });
  }
  // El original primero, después por color.
  miembros.sort((a, b) => (a.color ? 1 : 0) - (b.color ? 1 : 0) || a.color.localeCompare(b.color));
  const can = (await gql(Q_CANALES, {})) as { publications: { nodes: { id: string; name: string }[] } };
  const posId = can.publications.nodes.find((x) => {
    const n = String(x.name || '').toLowerCase();
    return n.includes('point of sale') || n.includes('punto de venta') || n === 'pos';
  })?.id ?? null;
  return { codigo: cod, locationId: loc.id, posId, miembros, ajenos };
}

/** Nombre sin el color al final (para proponer el nombre base). */
export function nombreBase(grupo: GrupoColores): string {
  const orig = grupo.miembros.find((m) => !m.color);
  if (orig) return orig.titulo.trim();
  const m = grupo.miembros[0];
  if (!m) return '';
  const color = nombreColor(m.color).toLowerCase();
  const t = m.titulo.trim();
  return color && t.toLowerCase().endsWith(` ${color}`) ? t.slice(0, t.length - color.length - 1).trim() : t;
}

const tituloConColor = (base: string, color: string) => {
  const b = base.replace(/\s+/g, ' ').trim(), c = nombreColor(color);
  return b.toLowerCase().endsWith(` ${c.toLowerCase()}`) ? b : `${b} ${c}`;
};

export type PasoColor =
  | { tipo: 'renombrar'; miembro: MiembroColor; color: string; titulo: string; sku: string; desde: number; hasta: number }
  | { tipo: 'ajustar'; miembro: MiembroColor; color: string; desde: number; hasta: number }
  | { tipo: 'cero'; miembro: MiembroColor; desde: number }
  | { tipo: 'crear'; color: string; titulo: string; sku: string; cantidad: number; precio: number; costo: number | null; vendor: string; productType: string; etiquetas: string[]; gramos: number };
export interface PlanColores { codigo: string; total: number; pasos: PasoColor[]; avisos: string[]; error?: string }

const fmt = (n: number) => `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

/** Vista previa: qué se renombra, qué se crea y cómo queda el stock. No escribe nada. */
export function planSepararColores(grupo: GrupoColores, filas: ColorTarget[], base: string, descripcion = ''): PlanColores {
  const vacio = (error: string): PlanColores => ({ codigo: grupo.codigo, total: 0, pasos: [], avisos: [], error });
  if (!grupo.miembros.length) return vacio(`No encontré en Shopify un producto de Target (con la etiqueta «${ETIQUETA_TARGET}») con el código ${grupo.codigo}.`);
  for (const m of grupo.miembros) {
    if (m.variantes !== 1) return vacio(`«${m.titulo}» tiene ${m.variantes} variantes: separalo a mano.`);
    if (!m.seguimiento || !m.inventoryItemId) return vacio(`«${m.titulo}» no lleva control de stock: separalo a mano.`);
    if (m.disponible === null) return vacio(`«${m.titulo}» no está dado de alta en ${LOC_MARTINEZ_NOMBRE}: separalo a mano.`);
    if (m.disponible < 0) return vacio(`«${m.titulo}» tiene ${m.disponible} disponible en ${LOC_MARTINEZ_NOMBRE}: corregí el stock antes de separar.`);
  }
  const total = grupo.miembros.reduce((s, m) => s + (m.disponible ?? 0), 0);
  const nombre = base.replace(/\s+/g, ' ').trim();
  if (!nombre) return vacio('Escribí el nombre del producto (sin el color).');
  const fs = filas.map((f) => ({ color: nombreColor(f.color), slug: slugColor(f.color), cantidad: f.cantidad }));
  if (!fs.length) return vacio('Escribí al menos un color.');
  if (fs.some((f) => !f.slug)) return vacio('Escribí el nombre de cada color (o quitá la fila vacía).');
  const rep = fs.find((f, i) => fs.findIndex((g) => g.slug === f.slug) !== i);
  if (rep) return vacio(`El color «${rep.color}» está dos veces: juntá las unidades en una sola fila.`);
  if (fs.some((f) => !Number.isInteger(f.cantidad) || f.cantidad < 0)) return vacio('Cada color tiene que tener un número entero de unidades.');
  const suma = fs.reduce((s, f) => s + f.cantidad, 0);
  if (suma !== total) return { ...vacio(`Los colores suman ${suma} u. y en ${LOC_MARTINEZ_NOMBRE} hay ${total} u. disponibles: ${suma < total ? `faltan ${total - suma}` : `sobran ${suma - total}`}. Tiene que dar lo mismo.`), total };

  const avisos: string[] = [];
  const original = grupo.miembros.find((m) => !m.color);
  const modelo = original ?? grupo.miembros[0];
  const precios = new Set(grupo.miembros.map((m) => m.precio));
  if (modelo.precio === null || !(modelo.precio > 0)) return vacio(`«${modelo.titulo}» no tiene precio en Shopify: ponéselo antes de separar.`);
  if (precios.size > 1) avisos.push(`Los productos de este código tienen precios distintos: los colores nuevos se crean a ${fmt(modelo.precio)} (el de «${modelo.titulo}»).`);
  if (modelo.costo === null) avisos.push(`«${modelo.titulo}» no tiene costo: los colores nuevos se crean sin costo. Cargalo a mano.`);
  const usados = new Set<string>();
  const pasos: PasoColor[] = [];
  let originalUsado = false;
  for (const f of fs) {
    const ya = grupo.miembros.find((m) => m.color === f.slug);
    if (ya) {
      usados.add(ya.id);
      pasos.push({ tipo: 'ajustar', miembro: ya, color: f.color, desde: ya.disponible!, hasta: f.cantidad });
    } else if (original && !originalUsado) {
      originalUsado = true;
      usados.add(original.id);
      pasos.push({ tipo: 'renombrar', miembro: original, color: f.color, titulo: tituloConColor(nombre, f.color), sku: skuColorTarget(grupo.codigo, f.color), desde: original.disponible!, hasta: f.cantidad });
      if (original.comprometido > 0) avisos.push(`«${original.titulo}» tiene ${original.comprometido} u. vendida(s) sin preparar: siguen en este producto, que pasa a ser el ${f.color}. Si eran de otro color, cambiá la venta a mano.`);
    } else if (f.cantidad > 0) {
      const tipo = tipoTarget(descripcion || nombre);
      pasos.push({
        tipo: 'crear', color: f.color, titulo: tituloConColor(nombre, f.color), sku: skuColorTarget(grupo.codigo, f.color), cantidad: f.cantidad,
        precio: modelo.precio, costo: modelo.costo, vendor: modelo.vendor || ETIQUETA_TARGET, productType: modelo.productType || tipo?.tipo || 'Accesorio',
        etiquetas: [ETIQUETA_TARGET, grupo.codigo, f.color], gramos: tipo?.gramos ?? 400,
      });
    }
  }
  for (const m of grupo.miembros) {
    if (usados.has(m.id)) continue;
    if (m.disponible) pasos.push({ tipo: 'cero', miembro: m, desde: m.disponible });
    avisos.push(`«${m.titulo}» no está en la lista: queda en 0 (no se borra). ${m.color ? '' : 'Si ya no lo usás, archivalo a mano en Shopify.'}`.trim());
    if (m.comprometido > 0) avisos.push(`«${m.titulo}» tiene ${m.comprometido} u. vendida(s) sin preparar: cambiá esa venta a mano al color que corresponde.`);
  }
  const cambia = pasos.some((p) => p.tipo === 'crear' || p.tipo === 'cero' || p.tipo === 'renombrar' || p.desde !== p.hasta);
  if (!cambia) return { codigo: grupo.codigo, total, pasos: [], avisos, error: 'Ya está así en Shopify: no hay nada para cambiar.' };
  if (grupo.ajenos.length) avisos.push(`${grupo.ajenos.map((t) => `«${t}»`).join(', ')} tiene el mismo código pero no es de Target: no se toca.`);
  return { codigo: grupo.codigo, total, pasos, avisos };
}

/** Una línea por paso, para la vista previa y la confirmación. */
export function textoPaso(p: PasoColor): string {
  if (p.tipo === 'renombrar') return `«${p.miembro.titulo}» pasa a ser «${p.titulo}» (SKU ${p.sku}): ${p.desde} → ${p.hasta} u.`;
  if (p.tipo === 'ajustar') return `«${p.miembro.titulo}» (ya existe): ${p.desde} → ${p.hasta} u.`;
  if (p.tipo === 'cero') return `«${p.miembro.titulo}»: ${p.desde} → 0 u. (no se borra)`;
  return `Nuevo «${p.titulo}» (SKU ${p.sku}): ${p.cantidad} u., precio ${fmt(p.precio)}${p.costo !== null ? `, costo ${fmt(p.costo)}` : ', sin costo'}`;
}

// ---------------------------------------------------------------------------
// EJECUCIÓN (después de la confirmación)
// ---------------------------------------------------------------------------
const STOCK = `mutation StockColores($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { createdAt } userErrors { code field message } }
}`;
const TITULO = `mutation TituloColor($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id title } userErrors { field message } }
}`;
const SKU = `mutation SkuColor($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id } userErrors { field message } }
}`;
const ETIQUETAR = `mutation EtiquetaColor($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { message } }
}`;
const CREAR = `mutation CrearColor($input: ProductSetInput!) {
  productSet(input: $input, synchronous: true) { product { id title } userErrors { field message } }
}`;
const PUBLICAR = `mutation PublicarColor($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { userErrors { field message } }
}`;
const Q_SKU_LIBRE = `query SkuLibreColor($q: String!) { productVariants(first: 5, query: $q) { nodes { sku } } }`;

export interface DepsColores { gql: Gql; clave: () => string }
export interface ResultadoColores { ok: boolean; hecho: string[]; faltan: string[] }

const motivo = (e: unknown) => (e instanceof Error ? e.message : 'error').slice(0, 200);
const errores = (ue: { message?: string }[]) => ue.map((x) => x.message).filter(Boolean).join('; ') || 'error de Shopify';

type Cambio = { inventoryItemId: string; desde: number; hasta: number; titulo: string };
/** Escribe un lote de stock con la cantidad leída. ok:false = no se cambió nada (o no se sabe). */
async function escribirStock(cambios: Cambio[], grupo: GrupoColores, deps: DepsColores): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  if (!cambios.length) return { ok: true };
  const input = {
    name: 'available', reason: 'correction',
    quantities: cambios.map((c) => ({ inventoryItemId: c.inventoryItemId, locationId: grupo.locationId, quantity: c.hasta, changeFromQuantity: c.desde })),
  };
  let d: { inventorySetQuantities?: { inventoryAdjustmentGroup?: unknown; userErrors?: { code?: string; message?: string }[] } } | null;
  try { d = (await deps.gql(STOCK, { input, key: deps.clave() })) as typeof d; }
  catch (e) { return { ok: false, mensaje: `No sé si Shopify cambió el stock (${motivo(e)}). Revisá en Shopify antes de volver a intentar.` }; }
  const ue = d?.inventorySetQuantities?.userErrors;
  if (!Array.isArray(ue)) return { ok: false, mensaje: 'La respuesta de Shopify no llegó completa: revisá el stock en Shopify antes de volver a intentar.' };
  if (ue.length) {
    const cambio = ue.some((x) => /CHANGE_FROM_QUANTITY_STALE|COMPARE_QUANTITY_STALE/.test(String(x.code)));
    return { ok: false, mensaje: cambio ? `El stock cambió desde que lo leí (por ejemplo, una venta). No se cambió nada: tocá «Leer de nuevo».` : `Shopify no cambió el stock: ${errores(ue)}.` };
  }
  if (!d?.inventorySetQuantities?.inventoryAdjustmentGroup
    && (await confirmarCantidades(cambios.map((c) => ({ inventoryItemId: c.inventoryItemId, quantity: c.hasta })), grupo.locationId, deps.gql)).size !== cambios.length) {
    return { ok: false, mensaje: 'La respuesta de Shopify no llegó completa: revisá el stock en Shopify antes de volver a intentar.' };
  }
  return { ok: true };
}

export async function ejecutarSepararColores(plan: PlanColores, grupo: GrupoColores, deps: DepsColores): Promise<ResultadoColores> {
  const hecho: string[] = [], faltan: string[] = [];
  if (plan.error || !plan.pasos.length) return { ok: false, hecho, faltan: [plan.error ?? 'No hay nada para cambiar.'] };
  const cambio = (p: PasoColor): Cambio | null =>
    p.tipo === 'crear' ? null : { inventoryItemId: p.miembro.inventoryItemId, desde: p.desde, hasta: p.tipo === 'cero' ? 0 : p.hasta, titulo: p.miembro.titulo };
  const cambios = plan.pasos.map(cambio).filter((c): c is Cambio => !!c && c.desde !== c.hasta);
  // 1) Primero se baja el stock: nunca quedan más unidades a la venta que las que hay.
  const bajan = cambios.filter((c) => c.hasta < c.desde);
  const b = await escribirStock(bajan, grupo, deps);
  if (!b.ok) return { ok: false, hecho, faltan: [b.mensaje] };
  for (const c of bajan) hecho.push(`«${c.titulo}»: ${c.desde} → ${c.hasta} u.`);
  // 2) El original pasa a ser el primer color: título, SKU y etiqueta del color.
  for (const p of plan.pasos) {
    if (p.tipo !== 'renombrar') continue;
    const m = p.miembro;
    try {
      const t = (await deps.gql(TITULO, { product: { id: m.id, title: p.titulo } })) as { productUpdate?: { product?: { id?: string } | null; userErrors?: { message?: string }[] } } | null;
      const ue = t?.productUpdate?.userErrors;
      if (!Array.isArray(ue) || ue.length || !t?.productUpdate?.product?.id) faltan.push(`Cambiale el nombre a «${m.titulo}» por «${p.titulo}» a mano${Array.isArray(ue) && ue.length ? ` (${errores(ue)})` : ''}.`);
      else hecho.push(`«${m.titulo}» ahora se llama «${p.titulo}».`);
    } catch (e) { faltan.push(`Cambiale el nombre a «${m.titulo}» por «${p.titulo}» a mano (${motivo(e)}).`); }
    try {
      const s = (await deps.gql(SKU, { productId: m.id, variants: [{ id: m.varianteId, inventoryItem: { sku: p.sku } }] })) as { productVariantsBulkUpdate?: { productVariants?: unknown[] | null; userErrors?: { message?: string }[] } } | null;
      const ue = s?.productVariantsBulkUpdate?.userErrors;
      if (!Array.isArray(ue) || ue.length || !s?.productVariantsBulkUpdate?.productVariants?.length) faltan.push(`Cambiale el SKU a «${p.titulo}» por ${p.sku} a mano${Array.isArray(ue) && ue.length ? ` (${errores(ue)})` : ''}.`);
      else hecho.push(`SKU ${m.sku} → ${p.sku}.`);
    } catch (e) { faltan.push(`Cambiale el SKU a «${p.titulo}» por ${p.sku} a mano (${motivo(e)}).`); }
    try {
      const e2 = (await deps.gql(ETIQUETAR, { id: m.id, tags: [p.color] })) as { tagsAdd?: { node?: { id?: string } | null; userErrors?: { message?: string }[] } } | null;
      if (!e2?.tagsAdd?.node?.id || e2.tagsAdd.userErrors?.length) faltan.push(`Agregale la etiqueta «${p.color}» a «${p.titulo}» a mano.`);
    } catch { faltan.push(`Agregale la etiqueta «${p.color}» a «${p.titulo}» a mano.`); }
  }
  // 3) Los colores nuevos, con su stock en Martínez.
  for (const p of plan.pasos) {
    if (p.tipo !== 'crear') continue;
    const aMano = `Creá a mano «${p.titulo}» (SKU ${p.sku}) con ${p.cantidad} u. en ${LOC_MARTINEZ_NOMBRE}, precio ${fmt(p.precio)}${p.costo !== null ? ` y costo ${fmt(p.costo)}` : ''}`;
    try {
      const d = (await deps.gql(Q_SKU_LIBRE, { q: `sku:'${p.sku.replace(/'/g, '')}'` })) as { productVariants?: { nodes?: { sku?: string | null }[] } } | null;
      if ((d?.productVariants?.nodes ?? []).some((n) => String(n.sku ?? '').toUpperCase() === p.sku.toUpperCase())) { faltan.push(`Ya hay un producto con el SKU ${p.sku}: no se creó «${p.titulo}». Sumale ${p.cantidad} u. a mano.`); continue; }
    } catch (e) { faltan.push(`${aMano} (no pude revisar Shopify: ${motivo(e)}).`); continue; }
    const input = {
      title: p.titulo, vendor: p.vendor, status: 'ACTIVE', productType: p.productType, tags: p.etiquetas,
      productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
      variants: [{
        optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: String(p.precio),
        inventoryItem: { sku: p.sku, ...(p.costo !== null ? { cost: String(p.costo) } : {}), tracked: true, measurement: { weight: { value: p.gramos, unit: 'GRAMS' } } },
        inventoryQuantities: [{ locationId: grupo.locationId, name: 'available', quantity: p.cantidad }],
      }],
    };
    let d: { productSet?: { product?: { id?: string } | null; userErrors?: { message?: string }[] } } | null;
    try { d = (await deps.gql(CREAR, { input })) as typeof d; }
    catch (e) { faltan.push(`No sé si se creó «${p.titulo}» (${motivo(e)}): revisá en Shopify antes de crearlo a mano.`); continue; }
    const ue = d?.productSet?.userErrors;
    const pid = d?.productSet?.product?.id;
    if (Array.isArray(ue) && ue.length) { faltan.push(`${aMano} (Shopify: ${errores(ue)}).`); continue; }
    if (!Array.isArray(ue) || !pid) { faltan.push(`No sé si se creó «${p.titulo}»: revisá en Shopify antes de crearlo a mano.`); continue; }
    hecho.push(`Creado «${p.titulo}» con ${p.cantidad} u.`);
    if (grupo.posId) {
      try {
        const r = (await deps.gql(PUBLICAR, { id: pid, input: [{ publicationId: grupo.posId }] })) as { publishablePublish?: { userErrors?: { message?: string }[] } } | null;
        const pe = r?.publishablePublish?.userErrors;
        if (!Array.isArray(pe) || pe.length) faltan.push(`Publicá «${p.titulo}» en Point of Sale a mano.`);
      } catch { faltan.push(`Publicá «${p.titulo}» en Point of Sale a mano.`); }
    } else faltan.push(`Publicá «${p.titulo}» en Point of Sale a mano.`);
  }
  // 4) Al final se sube el stock de los colores que ya estaban.
  const suben = cambios.filter((c) => c.hasta > c.desde);
  const s = await escribirStock(suben, grupo, deps);
  if (!s.ok) faltan.push(`${s.mensaje} Falta sumar: ${suben.map((c) => `«${c.titulo}» de ${c.desde} a ${c.hasta}`).join(', ')}.`);
  else for (const c of suben) hecho.push(`«${c.titulo}»: ${c.desde} → ${c.hasta} u.`);
  return { ok: !faltan.length, hecho, faltan };
}
