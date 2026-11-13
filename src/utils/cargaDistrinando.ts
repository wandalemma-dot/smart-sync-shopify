// ============================================================================
// DISTRINANDO (REEBOK) — CARGAR UNA ENTREGA EN SHOPIFY (13-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Lo que llegó (el remito) se SUMA en DEPOSITO MARTINEZ, como en iD. Reglas de gax:
//   · Talle: el remito trae US. Se ubica por el SKU del proveedor (código-US), si no por el AR
//     que el proveedor informa en la nota y, si no, por la tabla de talle que se elige para el
//     modelo (talleDistrinando.ts). Una tabla que contradice lo que informa el proveedor no se
//     puede elegir. La tabla elegida va a las etiquetas con el nombre del local («TABLA DE TALLE REEBOK 1», «2», «MUJER»):
//     la web muestra la tabla según esa etiqueta. Una etiqueta vieja («REEBOK HOMBRE») se reemplaza por la «1».
//     Producto sin tabla de talle con nombre: se avisa para asociarle una.
//   · Packs «M12 4/7.5 (23322)»: US 4, 5, 6, 7 y 7.5 con 2, 3, 3, 2 y 2 pares por caja, por la
//     cantidad de cajas. Las cantidades se pueden corregir antes de cargar.
//   · Precio: regla de Reebok (Mayorista × 1,8755 al 999 más cercano). Costo: el de la factura
//     (lista − bonificación), con promedio ponderado si el talle ya tenía stock en Martínez.
//     Mismo control de margen que iD (menos de 50% obliga a poner precio a toda la curva).
//   · El SKU de lo que ya existe no se toca. Talle escrito a mano: la variante con el SKU del proveedor de
//     ese US se renombra a ese talle (mismo SKU y stock); con la tabla elegida, también los otros talles con
//     SKU del proveedor (talleFinal). Talles que faltan: se crean con el SKU del proveedor,
//     el precio de la curva y el costo de la factura. Productos que no existen: se crean (gax:
//     «para todos los productos nuevos está bien»), con la tabla elegida en el desplegable.
//   · Solo Reebok calzado por ahora. Kappa, Crocs y ropa: a mano.
// Ejecución, marca «una sola vez» y vista previa: las de iD/Family (cargaFamily.ts).
// ============================================================================
import { claveCodigo, type FilaChecklist, type LineaPedido, type Pedido, type ResultadoFactura } from './controlFacturas';
import { textoCarga, type AltaFamily, type CargaFamily, type ItemCarga, type LineaReposicion, type OpcionCarga, type PlanCarga, type ReposicionFamily, type TablaItem } from './cargaFamily';
import { ajusteDe, etiquetaDelCodigo, formasCodigo, SUCURSAL_CARGA_ID, type EstadoCargaId, type ProductoId } from './cargaId';
import { coincideUS, precioReebokCalzado, REEBOK_TABLAS, tituloReebokCalzado } from './reebokCalzado';
import { niceTitle, redondear2 } from './syncLogic';
import {
  arDeNotas, curvaPack, esTalleUS, etiquetasDeTabla, etiquetaTabla, mismoTalle, skuProveedor, tablaDeEtiquetas, tablaReebok,
  TABLAS_REEBOK, talleUS, ubicarTalleDistrinando, usDelSku, type TablaTalle, type VarianteTalle,
} from './talleDistrinando';

export const VENDOR_REEBOK = 'Reebok';
const GRAMOS_CALZADO = 900;
const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();

/** Tabla elegida por código ('' = ninguna). Cantidades escritas a mano: código → «US 11» → unidades. */
export type TablasCarga = ReadonlyMap<string, string>;
export type CantidadesDis = ReadonlyMap<string, Readonly<Record<string, number>>>;

const etiquetaUS = (us: string) => `US ${us}`;

/** Firma de lo que llegó (la del remito, no la escrita a mano): la misma mercadería no se carga dos veces. */
export function firmaDistrinando(fecha: string, remito: string, codigo: string, llegan: { us: string; cantidad: number }[], pares: number): string {
  const talles = llegan.filter((t) => t.cantidad > 0).map((t) => `${t.us}:${t.cantidad}`).sort().join(',');
  return `${fecha}|${codigo}|${pares}|${talles}|${String(remito || '').replace(/\|/g, '')}`;
}

/** Nombre comercial de un modelo nuevo: «Zapatillas Reebok Nano Court Negro Gris», sin talle ni curva del pack. */
export function tituloDistrinando(descripcion: string): string {
  const d = String(descripcion ?? '')
    .replace(/^\d[^·]*·\s*/, '') // factura de pack: «5/7,5 (3441) · NANO COURT …»
    .replace(/\s*-?\s*M\d{1,2}U?\s+\d.*$/i, '') // «- M12U 5/7,5 (3441)»
    .replace(/\s*(?:-\s*)?(?:AR|UK|US)?\s*-?\s*\d{1,2}(?:[.,]\d)?\s*$/i, '')
    .replace(/\bREEBOK\b/gi, '')
    .replace(/[-\s/]+$/, '').trim();
  return niceTitle(tituloReebokCalzado(`Zapatillas Reebok ${d}`));
}

interface Llega { us: string; cantidad: number; original: number; /** Talle de Shopify escrito a mano. */ destino?: string; /** SKU escrito o escaneado a mano. */ sku?: string }
/** SKU escrito o escaneado a mano (13-nov-2026, gax: «que yo pueda escanear uno nuevo»): código → «US 11» → SKU. */
export type SkusDis = ReadonlyMap<string, Readonly<Record<string, string>>>;
/** Un SKU escrito a mano: sin espacios, hasta 100 caracteres. null = no sirve. */
export const leerSku = (s: string) => { const t = String(s ?? '').trim(); return /^\S{1,100}$/.test(t) ? t : null; };
/** Un EAN (8, 12, 13 o 14 dígitos): va también como código de barras, como en las altas. */
export const esEan = (s: string) => /^(\d{8}|\d{12,14})$/.test(s);
/** Los talles en orden (gax: «que el US 11 quede arriba del 12»). */
const porTalle = (a: Llega, b: Llega) => (Number(a.us) || 0) - (Number(b.us) || 0);
/** Talle de Shopify escrito a mano: código → «US 11» → AR. */
export type DestinosDis = ReadonlyMap<string, Readonly<Record<string, string>>>;
/** Un talle de calzado de Shopify escrito a mano: «44», «38.5», «38,5». */
export const leerDestino = (s: string) => { const t = String(s ?? '').trim().replace(',', '.'); return /^\d{2}(\.5)?$/.test(t) && Number(t) >= 15 && Number(t) <= 55 ? String(Number(t)) : null; };

/** Un talle de Shopify que se renombra: la misma variante (SKU, stock, precio y costo) con el talle correcto. */
interface Renombre { id: string; talle: string; nuevo: string; sku: string; /** mano: el talle escrito; tabla: la tabla elegida. */ por: 'mano' | 'tabla'; us: string }
const esNumeroTalle = (t: string) => /^\d+(\.\d+)?$/.test(String(t ?? '').trim().replace(',', '.'));
const numTalle = (t: string) => String(Number(String(t).trim().replace(',', '.')));

/**
 * Cómo quedan los talles del producto (13-nov-2026, gax: «el SKU manténelo, pero el talle que está en Shopify hoy lo
 * convertís al talle que yo te voy a escribir»). La variante con el SKU del proveedor de un US pasa a llamarse como el
 * talle escrito a mano para ese US y, con una tabla elegida, las demás variantes con SKU del proveedor pasan al talle
 * de la tabla. Nunca se pisa un talle que queda: si el escrito ya lo tiene otra variante que no se mueve, ese US suma
 * ahí (como antes) y su talle no cambia. `problemas` bloquean el artículo; `choques`, la tabla.
 */
function talleFinal(codigo: string, variantes: VarianteTalle[], llegan: Llega[], tabla: TablaTalle | null):
  { renombrar: Renombre[]; problemas: string[]; choques: string[]; final: (v: VarianteTalle) => string } {
  const delProveedor = new Map<string, VarianteTalle[]>();
  for (const v of variantes) {
    const us = usDelSku(v.sku ?? '', codigo);
    if (us) delProveedor.set(us, [...(delProveedor.get(us) ?? []), v]);
  }
  const problemas: string[] = [], choques: string[] = [];
  const movs = new Map<string, { nuevo: string; por: 'mano' | 'tabla'; us: string }>();
  const escritos = llegan.filter((l) => l.destino);
  for (const l of escritos) {
    const vs = delProveedor.get(talleUS(l.us)) ?? [];
    if (vs.length > 1) problemas.push(`US ${l.us}: hay dos talles con el SKU ${skuProveedor(codigo, l.us)}`);
    else if (vs.length === 1 && !mismoTalle(vs[0].talle, l.destino!)) movs.set(vs[0].id, { nuevo: l.destino!, por: 'mano', us: talleUS(l.us) });
  }
  if (tabla) for (const [us, vs] of delProveedor) {
    if (vs.length !== 1 || !esNumeroTalle(vs[0].talle) || escritos.some((l) => talleUS(l.us) === us)) continue;
    const ar = tabla.ar(us);
    if (ar && !mismoTalle(vs[0].talle, ar)) movs.set(vs[0].id, { nuevo: ar, por: 'tabla', us });
  }
  const final = (v: VarianteTalle) => movs.get(v.id)?.nuevo ?? v.talle;
  const quien = (w: VarianteTalle) => (w.sku ? `el SKU ${w.sku}` : 'un talle sin SKU');
  // Dos talles no pueden quedar con el mismo nombre: se deshace el cambio que choca, hasta que no quede ninguno.
  for (let seguir = true; seguir;) {
    seguir = false;
    for (const [id, m] of movs) {
      const otro = variantes.find((w) => w.id !== id && mismoTalle(final(w), m.nuevo));
      if (!otro) continue;
      const om = movs.get(otro.id);
      if (m.por === 'tabla') { choques.push(`el US ${m.us} iría al ${m.nuevo}, que ya lo tiene ${quien(otro)}`); movs.delete(id); }
      else if (om?.por === 'tabla') { choques.push(`el US ${om.us} iría al ${m.nuevo}, el talle que escribiste para el US ${m.us}`); movs.delete(otro.id); }
      else {
        if (om) problemas.push(`el US ${m.us} y el US ${om.us} van al talle ${m.nuevo}`);
        // Si no, el talle escrito lo tiene otra variante que queda: ese US suma ahí (se avisa al ubicarlo).
        movs.delete(id);
      }
      seguir = true;
      break;
    }
  }
  const renombrar = variantes.filter((v) => movs.has(v.id)).map((v) => ({ id: v.id, talle: v.talle, sku: v.sku ?? '', ...movs.get(v.id)! }));
  return { renombrar, problemas, choques, final };
}

/** Dónde entra un US, con los talles ya renombrados: lo escrito a mano manda; si no, SKU del proveedor, nota y tabla. */
function ubicar(codigo: string, l: Llega, variantes: VarianteTalle[], pedidos: Pedido[], tabla: TablaTalle | null): ReturnType<typeof ubicarTalleDistrinando> {
  if (!l.destino) return ubicarTalleDistrinando({ codigo, talle: l.us, variantes, pedidos, tabla });
  const sku = skuProveedor(codigo, l.us);
  const vs = variantes.filter((v) => mismoTalle(v.talle, l.destino!));
  if (vs.length > 1) return { error: `hay dos variantes del talle ${l.destino}` };
  if (!vs.length) {
    const conSku = variantes.find((v) => norm(v.sku) === sku);
    if (conSku) return { error: `el SKU ${sku} quedó en el talle ${conSku.talle}` };
    return { error: `no existe el talle ${l.destino}`, falta: { talle: l.destino, skuProveedor: sku, fuente: 'manual' } };
  }
  // Su propia variante (la del SKU del proveedor, ya renombrada): sin aviso; el cambio de talle se ve en la lista.
  const otro = usDelSku(vs[0].sku ?? '', codigo);
  const avisos = otro === talleUS(l.us) ? [] : [`US ${l.us} → talle ${vs[0].talle}: lo elegiste a mano${otro ? ` (ojo: ese talle tiene el SKU del US ${otro})` : ''}.`];
  return { varianteId: vs[0].id, talle: vs[0].talle, fuente: 'manual', skuProveedor: sku, avisos };
}

/** El US de cada talle del checklist (el remito, con los talles ya pasados al de la nota) y los packs por su curva. */
function tallesQueLlegan(c: FilaChecklist, notas: LineaPedido[], pares: number, porUdmFactura: number, descripcion: string):
  { llegan: Llega[]; avisos: string[] } | { error: string } {
  const pack = notas.find((l) => (l.unidadesPorUdm || 1) > 1);
  const esPack = !!pack || (c.talles ?? []).some((t) => /^PACK/i.test(t.talle)) || (!c.talles && porUdmFactura > 1);
  if (esPack) {
    const texto = pack?.talle || pack?.descripcion || descripcion;
    const curva = curvaPack(texto) ?? curvaPack(descripcion);
    if (!curva) return { error: `es un pack y no entiendo su curva («${texto}»): cargalo a mano.` };
    const porCaja = curva.reduce((s, x) => s + x.porCaja, 0);
    const porUdm = pack?.unidadesPorUdm || porUdmFactura || porCaja;
    const avisos: string[] = [];
    if (porUdm !== porCaja) avisos.push(`La curva suma ${porCaja} pares y el pack es de ${porUdm}: revisá las cantidades.`);
    const cajas = pares / porUdm;
    if (!Number.isInteger(cajas) || cajas <= 0) {
      avisos.push(`Llegaron ${pares} pares y no son cajas enteras de ${porUdm}: escribí cuántos pares llegaron de cada talle.`);
      return { llegan: curva.map((x) => ({ us: talleUS(x.us), cantidad: 0, original: 0 })), avisos };
    }
    avisos.push(`Pack: ${cajas} caja${cajas > 1 ? 's' : ''} de la curva ${curva.map((x) => `US ${x.us}×${x.porCaja}`).join(' ')}. Corregí los números si alguna caja vino distinta.`);
    return { llegan: curva.map((x) => ({ us: talleUS(x.us), cantidad: x.porCaja * cajas, original: x.porCaja * cajas })), avisos };
  }
  if (!c.talles) return { error: 'No sé qué talles llegaron: escribí el remito con los talles («✏️ Ver o corregir») y armá la carga de nuevo.' };
  const out = new Map<string, Llega>();
  const problemas: string[] = [];
  for (const t of c.talles) {
    // ajustarRemito pasa el US del remito al talle de la nota («AR 43», «UK 10»): se vuelve al US por el SKU de la nota.
    const deNota = [...new Set(notas.filter((l) => (l.unidadesPorUdm || 1) <= 1 && norm(l.talle) === norm(t.talle)).map((l) => usDelSku(l.sku, l.codigo)).filter(Boolean))];
    let us: string | null = null;
    if (deNota.length === 1) us = deNota[0]!;
    else if (deNota.length > 1) { problemas.push(`el talle ${t.talle} de la nota es de dos US (${deNota.join(' y ')})`); continue; }
    else if (esTalleUS(t.talle)) us = talleUS(t.talle);
    else { problemas.push(`no sé qué US es el talle ${t.talle}`); continue; }
    const ya = out.get(us);
    if (ya) { ya.cantidad += t.cantidad; ya.original += t.cantidad; } else out.set(us, { us, cantidad: t.cantidad, original: t.cantidad });
  }
  if (problemas.length) return { error: `${problemas.join('; ')}. Corregí el remito y armá la carga de nuevo.` };
  return { llegan: [...out.values()], avisos: [] };
}

const esReebok = (vendor: string) => /REEBOK/i.test(vendor);
const NO_CARGAR: OpcionCarga = { clave: 'no', etiqueta: 'No cargar este artículo', accion: null, avisos: [] };

/**
 * Las opciones de tabla de talle del modelo y la que viene elegida. Una tabla no se puede elegir si contradice lo que
 * manda (lo escrito a mano y el AR de la nota de lo que llega sin SKU del proveedor en Shopify), si le falta un US o si
 * pisaría un talle que queda. Los talles con SKU del proveedor que no la siguen se corrigen al elegirla (talleFinal).
 */
function tablaDelItem(codigo: string, pedidos: Pedido[], productos: ProductoId[], llegan: Llega[], elegida: string | undefined): TablaItem {
  const variantes: VarianteTalle[] = productos.flatMap((p) => p.variantes);
  const conSku = (us: string) => variantes.some((v) => norm(v.sku) === skuProveedor(codigo, us));
  const notaDe = (l: Llega) => arDeNotas(pedidos, skuProveedor(codigo, l.us), l.us).ar;
  const escritos = llegan.filter((l) => l.destino);
  // El talle escrito a mano manda (13-nov-2026, gax: «yo le pongo el 44 y ahí sí coincide con la tabla 2»): es donde
  // realmente entra. Lo que llega sin SKU del proveedor en Shopify va al AR de la nota.
  const firmes = [
    ...escritos.map((l) => ({ us: talleUS(l.us), ar: numTalle(l.destino!), de: 'el talle que escribiste a mano' })),
    ...llegan.filter((l) => !l.destino && !conSku(l.us)).flatMap((l) => {
      const ar = notaDe(l);
      return ar ? [{ us: talleUS(l.us), ar: numTalle(ar), de: 'la nota del proveedor' }] : [];
    }),
  ];
  // Talles que solo se ubican con la tabla: sin SKU del proveedor en Shopify y sin AR en la nota.
  const necesarios = llegan.filter((l) => !l.destino && !conSku(l.us) && !notaDe(l)).map((l) => l.us);
  // Los talles con SKU del proveedor que ya están en Shopify (los escritos a mano ya mandan).
  const enShopify = variantes.flatMap((v) => {
    const us = usDelSku(v.sku ?? '', codigo);
    return us && esNumeroTalle(v.talle) && !escritos.some((l) => talleUS(l.us) === us) ? [{ us, ar: numTalle(v.talle) }] : [];
  });
  const evaluadas = TABLAS_REEBOK.map((nombre): { nombre: string; bloqueo?: string; corrige: number; motivo?: string } => {
    const t = tablaReebok(nombre)!;
    const choque = firmes.find((x) => !coincideUS(nombre, x.ar, x.us));
    if (choque) {
      const dice = t.ar(choque.us);
      return { nombre, corrige: 0, bloqueo: `no coincide con ${choque.de}: US ${choque.us} = ${choque.ar}${dice ? `, la tabla dice ${dice}` : `, la tabla no tiene el US ${choque.us}`}` };
    }
    const sin = [...new Set([...necesarios, ...enShopify.map((x) => x.us)].filter((us) => !t.ar(us)))];
    if (sin.length) return { nombre, corrige: 0, bloqueo: `no tiene el US ${sin.join(', ')}` };
    let corrige = 0;
    for (const p of productos) {
      const m = talleFinal(codigo, p.variantes, llegan, t);
      if (m.choques.length) return { nombre, corrige: 0, bloqueo: m.choques[0] };
      corrige += m.renombrar.filter((r) => r.por === 'tabla').length;
    }
    const distinto = enShopify.find((x) => !coincideUS(nombre, x.ar, x.us));
    return { nombre, corrige, ...(distinto ? { motivo: `no coincide con Shopify: US ${distinto.us} = ${distinto.ar}, la tabla dice ${t.ar(distinto.us)}` } : {}) };
  });
  const ev = (n: string) => evaluadas.find((x) => x.nombre === n);
  const ok = (n: string) => !!ev(n) && !ev(n)!.bloqueo;
  const actual = productos.length === 1 ? tablaDeEtiquetas(productos[0].etiquetas) : null;
  const sirven = evaluadas.filter((x) => !x.bloqueo);
  // Con talles escritos a mano y una sola tabla que coincide, esa viene elegida (gax: «me la tiene que recomendar»).
  const recomendada = escritos.length && sirven.length === 1 ? sirven[0].nombre : null;
  // Si no, la que ya tiene el producto, solo si sus talles ya la siguen (elegirla no renombra nada). Una tabla que
  // corrige talles la elige la usuaria.
  const porDefecto = recomendada ?? (actual && ok(actual) && !ev(actual)!.corrige ? actual : '');
  const valida = elegida !== undefined && (elegida === '' || ok(elegida));
  const final = valida ? elegida! : porDefecto;
  const avisos: string[] = [];
  if (recomendada && final === recomendada && recomendada !== actual) {
    avisos.push(`Con los talles que escribiste coincide solo la TABLA DE TALLE REEBOK ${recomendada}: viene elegida y se la agrego al cargar. Si no es la correcta, cambiala.`);
  }
  if (actual && final === '' && !(ok(actual) && !ev(actual)!.corrige)) {
    const e = ev(actual);
    avisos.push(e?.bloqueo || !e
      ? `La etiqueta dice TABLA DE TALLE REEBOK ${actual}, pero sus talles no siguen esa tabla (${e?.bloqueo ?? ''}). No la cambio: revisá qué tabla ve el cliente en la web.`
      : `La etiqueta dice TABLA DE TALLE REEBOK ${actual}, pero sus talles no siguen esa tabla (${e.motivo}). No cambio nada solo: si esa tabla es la correcta, elegila abajo y se corrige${e.corrige > 1 ? 'n' : ''} ${e.corrige} talle${e.corrige > 1 ? 's' : ''}; si no, revisá qué tabla ve el cliente en la web.`);
  }
  if (productos.length === 1 && !actual && final === '') {
    const tiene = etiquetasDeTabla(productos[0].etiquetas);
    avisos.push(`Este producto no tiene tabla de talle${tiene.length ? ` con nombre (tiene ${tiene.join(', ')})` : ''}${sirven.length ? ': elegí una abajo y se la agrego al cargar.' : `, y ninguna de las tablas coincide (${evaluadas.map((x) => `${x.nombre}: ${x.bloqueo}`).join(' · ')}). Los talles van por el SKU y la nota.`}`);
  }
  const opciones = [
    { clave: '', etiqueta: necesarios.length ? 'Elegí la tabla de talle…' : actual ? `Dejar la que tiene (${actual})` : 'Sin tabla (los talles van por el SKU y la nota)' },
    ...evaluadas.map((x) => ({
      clave: x.nombre,
      etiqueta: `TABLA DE TALLE REEBOK ${x.nombre}${x.nombre === recomendada ? ' (recomendada)' : ''}${!x.bloqueo && x.corrige ? ` (corrige ${x.corrige} talle${x.corrige > 1 ? 's' : ''})` : ''}`,
      ...(x.bloqueo ? { bloqueo: x.bloqueo } : {}),
    })),
  ];
  return { elegida: final, opciones, actual, hace: necesarios.length > 0, avisos, ...(recomendada ? { recomendada } : {}) };
}

/** Sumar lo que llegó en un producto que ya existe: renombra los talles corridos y crea los que faltan. */
function opcionReposicion(codigo: string, p: ProductoId | undefined, llegan: Llega[], pedidos: Pedido[], tabla: string, lista: number, bonif: number, ren: Parameters<typeof ajusteDe>[1] | undefined): OpcionCarga {
  if (!p) return { clave: 'falta', etiqueta: 'Producto que no pude leer', accion: null, bloqueo: 'No pude leer ese producto en Shopify.', avisos: [] };
  const avisos: string[] = [];
  const base = { clave: `repo:${p.id}`, etiqueta: `Sumar el stock en «${p.titulo}»`, avisos };
  if (!esReebok(p.vendor)) return { ...base, accion: null, bloqueo: `«${p.titulo}» es de ${p.vendor || 'otra marca'}: por ahora la carga de Distrinando es solo Reebok. Cargalo a mano.` };
  const t = tabla ? tablaReebok(tabla) : null;
  // Los talles como quedan después de renombrar (el talle escrito a mano y, con tabla, los demás con SKU del proveedor).
  const mov = talleFinal(codigo, p.variantes, llegan, t);
  const finales = p.variantes.map((v) => ({ ...v, talle: mov.final(v) }));
  const lineas: LineaReposicion[] = [];
  const crear: NonNullable<ReposicionFamily['crear']> = [];
  const cambiarSku: NonNullable<ReposicionFamily['cambiarSku']> = [];
  const problemas: string[] = [...mov.problemas, ...mov.choques];
  if (mov.renombrar.length && (p.opciones?.length ?? 1) !== 1) problemas.push('hay que renombrar talles y el producto tiene más de una opción: hacelo a mano');
  const ubicados = llegan.filter((l) => l.cantidad > 0).map((l) => ({ l, u: ubicar(codigo, l, finales, pedidos, t) }));
  // SKU escaneado a mano (13-nov-2026, gax): el talle que lo recibe deja el suyo.
  const nuevoSku = new Map<string, string>();
  for (const { l, u } of ubicados) {
    if ('error' in u || !l.sku) continue;
    const v = finales.find((x) => x.id === u.varianteId);
    if (v && norm(l.sku) !== norm(v.sku)) nuevoSku.set(v.id, l.sku);
  }
  const skuDe = (x: VarianteTalle & { id: string }) => nuevoSku.get(x.id) ?? x.sku;
  // SKU escaneado a mano: no puede estar en otro talle del producto ni repetido en esta carga.
  const skuOcupado = (sku: string, salvo?: string) => {
    const v = finales.find((x) => x.id !== salvo && norm(skuDe(x)) === norm(sku));
    if (v) return `el SKU ${sku} ya lo tiene el talle ${v.talle}`;
    return llegan.filter((x) => x.cantidad > 0 && x.sku && norm(x.sku) === norm(sku)).length > 1 ? `el SKU ${sku} está escrito en dos talles` : '';
  };
  for (const { l, u } of ubicados) {
    if ('error' in u) {
      if (!u.falta) { problemas.push(`US ${l.us}: ${u.error}`); continue; }
      if (crear.some((c) => mismoTalle(c.talle, u.falta!.talle))) { problemas.push(`US ${l.us}: dos US van al talle ${u.falta.talle}`); continue; }
      const manual = l.sku && norm(l.sku) !== norm(u.falta.skuProveedor) ? l.sku : undefined;
      { const o = skuOcupado(manual ?? u.falta.skuProveedor); if (o) { problemas.push(`US ${l.us}: ${o}`); continue; } }
      crear.push({ talle: u.falta.talle, sku: u.falta.skuProveedor, suma: l.cantidad, ...(manual ? { skuShopify: manual, ...(esEan(manual) ? { barcode: manual } : {}) } : {}) });
      continue;
    }
    avisos.push(...u.avisos);
    const v = finales.find((x) => x.id === u.varianteId)!;
    if (l.sku && norm(l.sku) !== norm(v.sku)) {
      const o = skuOcupado(l.sku, v.id);
      if (o) { problemas.push(`US ${l.us}: ${o}`); continue; }
      cambiarSku.push({ id: v.id, talle: v.talle, antes: v.sku ?? '', sku: l.sku, ...(esEan(l.sku) ? { barcode: l.sku } : {}) });
    }
    if (!v.seguimiento || !v.inventoryItemId) { problemas.push(`el talle ${v.talle} no lleva control de stock`); continue; }
    const ya = lineas.find((x) => x.inventoryItemId === v.inventoryItemId);
    if (ya) { problemas.push(`US ${l.us}: el talle ${v.talle} ya recibe otro US`); continue; }
    lineas.push({ talle: v.talle, inventoryItemId: v.inventoryItemId, actual: v.disponible, suma: l.cantidad });
  }
  if (crear.length && (p.opciones?.length ?? 1) !== 1) problemas.push(`hay que crear el talle ${crear.map((c) => c.talle).join(', ')} y el producto tiene más de una opción: crealo a mano`);
  if (crear.length && p.variantes.length + crear.length > 100) problemas.push('el producto llegaría a más de 100 talles');
  if (problemas.length) return { ...base, accion: null, bloqueo: `En «${p.titulo}»: ${problemas.join('; ')}. Corregilo en Shopify (o el remito) y armá la carga de nuevo.` };
  if (!lineas.length && !crear.length) return { ...base, accion: null, bloqueo: 'No hay unidades para cargar.' };
  // El precio y el costo van por variante; los talles se nombran como quedan.
  const ajuste = ren && lista > 0 ? ajusteDe({ ...p, variantes: finales }, ren, lineas, { sugerido: precioReebokCalzado(lista), basico: false }) : null;
  if (crear.length && !ajuste) return { ...base, accion: null, bloqueo: 'La factura no trae el precio de lista: no puedo poner precio ni costo a los talles nuevos. Cargalo a mano.' };
  if (!ajuste) avisos.push('La factura no trae el precio de lista de este artículo: no reviso el margen ni el costo.');
  else for (const c of ajuste.conservan) if (c.motivo) avisos.push(`Talle ${c.talle}: ya tenía ${c.stock} en Martínez y ${c.motivo}. Conserva su costo: revisalo a mano.`);
  for (const l of lineas) if (l.actual === null) avisos.push(`Talle ${l.talle}: no está dado de alta en ${SUCURSAL_CARGA_ID}; se da de alta con ${l.suma}.`);
  for (const x of cambiarSku) avisos.push(`Talle ${x.talle}: el SKU pasa de ${x.antes || 'vacío'} a ${x.sku}${x.barcode ? ' (también como código de barras)' : ''}.`);
  if (crear.length) avisos.push(`Se crea${crear.length > 1 ? 'n' : ''} el talle ${crear.map((c) => `${c.talle} (SKU ${c.skuShopify ?? c.sku})`).join(', ')} con el precio de la curva y costo ${ajuste ? redondear2(lista * (1 - bonif / 100)) : ''}.`);
  if (p.estado !== 'ACTIVE') avisos.push(`El producto está ${p.estado === 'DRAFT' ? 'en borrador' : 'archivado'} en Shopify: se le suma igual el stock.`);
  // Etiquetas: el código del proveedor, la tabla elegida y el SKU del proveedor de los talles nuevos.
  const etiquetas: string[] = [];
  if (!etiquetaDelCodigo(p.etiquetas, codigo)) etiquetas.push(codigo);
  const quitar: string[] = [];
  // La etiqueta exacta del local (la web elige la tabla por ella): si tiene otra o la vieja «HOMBRE», se reemplaza.
  if (tabla && !p.etiquetas.some((x) => norm(x) === norm(etiquetaTabla(tabla)))) {
    etiquetas.push(etiquetaTabla(tabla));
    quitar.push(...etiquetasDeTabla(p.etiquetas));
  }
  for (const c of crear) if (!p.etiquetas.some((x) => norm(x) === norm(c.sku))) etiquetas.push(c.sku);
  const renombrar = mov.renombrar.map(({ id, talle, nuevo, sku }) => ({ id, talle, nuevo, sku }));
  return {
    ...base, accion: {
      tipo: 'reposicion', productoId: p.id, titulo: p.titulo, lineas, etiquetar: false, ...(ajuste ? { ajuste } : {}),
      ...(renombrar.length ? { renombrar } : {}),
      ...(crear.length ? { crear } : {}), ...(cambiarSku.length ? { cambiarSku } : {}), ...(etiquetas.length ? { etiquetas } : {}), ...(quitar.length ? { quitarEtiquetas: quitar } : {}),
    },
  };
}

/** Crear el producto (no existe en Shopify). */
function opcionAlta(codigo: string, llegan: Llega[], pedidos: Pedido[], tabla: string, lista: number, bonif: number, descripcion: string): OpcionCarga {
  const avisos: string[] = [];
  const base = { clave: 'alta', etiqueta: 'Crear el producto', avisos };
  if (!/^RBK/i.test(codigo)) return { ...base, accion: null, bloqueo: 'No está en Shopify y no es Reebok: por ahora se crea desde Sincronización.' };
  if (!(lista > 0)) return { ...base, accion: null, bloqueo: 'La factura no trae el precio de lista: no puedo calcular precio ni costo. Crealo desde Sincronización.' };
  const t = tabla ? tablaReebok(tabla) : null;
  const variantes: AltaFamily['variantes'] = [];
  const proveedor: string[] = [];
  const problemas: string[] = [];
  for (const l of llegan) {
    if (!(l.cantidad > 0)) continue;
    const u = ubicar(codigo, l, [], pedidos, t);
    if ('error' in u && !u.falta) { problemas.push(`US ${l.us}: ${u.error}`); continue; }
    const f = 'falta' in u ? u.falta! : null;
    if (!f) continue;
    if (variantes.some((v) => mismoTalle(v.talle, f.talle))) { problemas.push(`dos US van al talle ${f.talle}`); continue; }
    const manual = l.sku && norm(l.sku) !== norm(f.skuProveedor) ? l.sku : undefined;
    if (manual && llegan.filter((x) => x.cantidad > 0 && x.sku && norm(x.sku) === norm(manual)).length > 1) { problemas.push(`el SKU ${manual} está escrito en dos talles`); continue; }
    variantes.push({ talle: f.talle, sku: manual ?? f.skuProveedor, cantidad: l.cantidad, ...(manual && esEan(manual) ? { barcode: manual } : {}) });
    proveedor.push(f.skuProveedor);
  }
  if (problemas.length) return { ...base, accion: null, bloqueo: `${problemas.join('; ')}.` };
  if (!variantes.length) return { ...base, accion: null, bloqueo: 'No hay unidades para cargar.' };
  variantes.sort((a, b) => Number(a.talle) - Number(b.talle));
  const costo = redondear2(lista * (1 - bonif / 100));
  const precio = precioReebokCalzado(lista);
  // En etiquetas va siempre el SKU del proveedor (aunque se haya escaneado otro para el talle).
  const etiquetas = [codigo, ...proveedor, ...(tabla ? [etiquetaTabla(tabla)] : [])];
  if (!tabla) avisos.push('Se crea sin tabla de talle (los AR salen de la nota del proveedor). Si querés, elegí una arriba.');
  return {
    ...base, accion: {
      tipo: 'alta', titulo: tituloDistrinando(descripcion), productType: 'Zapatillas', etiquetas, gramos: GRAMOS_CALZADO, precio, costo, variantes, vendor: VENDOR_REEBOK,
      ...(tabla ? { tabla: { nombre: tabla, json: REEBOK_TABLAS[tabla] } } : {}),
    },
  };
}

/**
 * Vista previa de la carga de una entrega de Distrinando. No escribe nada.
 * `pedidos`: todas las notas de Distrinando (dan el AR que informa el proveedor y la curva de los packs).
 */
export function planCargaDistrinando(r: ResultadoFactura, estado: EstadoCargaId, cargas: Record<string, CargaFamily>, pedidos: Pedido[],
  tablas: TablasCarga = new Map(), cantidades: CantidadesDis = new Map(), destinos: DestinosDis = new Map(), skus: SkusDis = new Map()): PlanCarga {
  const f = r.factura;
  const avisos: string[] = [];
  const remito = r.remito?.numero || f.remito || '';
  const enFactura = new Set(r.checklist.map((c) => claveCodigo(c.codigo)));
  const fuera = (r.remito?.renglones ?? []).filter((x) => !enFactura.has(claveCodigo(x.codigo))).map((x) => x.codigo);
  if (fuera.length) avisos.push(`En el remito y no en la factura: ${[...new Set(fuera)].join(', ')}. No se cargan desde acá: revisalo y cargalo a mano.`);
  if (r.difRemito.length) avisos.push('El remito y la factura no coinciden en algún artículo: se carga lo del remito (lo que llegó).');
  const items = r.checklist.map((c): ItemCarga => {
    const ren = f.renglones.find((x) => claveCodigo(x.codigo) === claveCodigo(c.codigo));
    const descripcion = ren?.descripcion || c.descripcion;
    const notas = pedidos.flatMap((p) => p.lineas).filter((l) => claveCodigo(l.codigo) === claveCodigo(c.codigo));
    const delRemito = (r.remito?.renglones ?? []).filter((x) => claveCodigo(x.codigo) === claveCodigo(c.codigo));
    const pares = delRemito.length ? delRemito.reduce((s, x) => s + (Number(x.cantidad) || 0) - (Number(x.retirado) || 0), 0) : c.cantidad;
    const porUdmFactura = Number(/\bM(\d{1,2})U?\s+\d/.exec(descripcion)?.[1] || 0);
    const llegada = tallesQueLlegan(c, notas, pares, porUdmFactura, descripcion);
    const firmaBase = 'error' in llegada ? firmaDistrinando(f.fecha, remito, c.codigo, [], pares) : firmaDistrinando(f.fecha, remito, c.codigo, llegada.llegan.map((l) => ({ us: l.us, cantidad: l.original })), pares);
    const unidadesBase = 'error' in llegada ? pares : llegada.llegan.reduce((s, l) => s + l.cantidad, 0);
    const bloqueado = (motivo: string, extra: Partial<ItemCarga> = {}): ItemCarga => ({ codigo: c.codigo, descripcion, unidades: unidadesBase, firma: firmaBase, estado: 'bloqueado', motivo, opciones: [], ...extra });
    const carga = cargas[`${f.id}|${c.codigo}`];
    if (carga) return { codigo: c.codigo, descripcion, unidades: unidadesBase, firma: firmaBase, estado: 'cargado', motivo: textoCarga(carga), opciones: [], carga };
    const otra = Object.entries(cargas).find(([k, x]) => !k.startsWith(`${f.id}|`) && x.firma === firmaBase);
    if (otra) return bloqueado(`Esta misma mercadería (mismo día, remito, código y talles) ya se cargó desde otra entrega (${textoCarga(otra[1])}).`);
    if ('error' in llegada) return bloqueado(llegada.error);
    // Cantidades escritas a mano (por US).
    const escritas = cantidades.get(c.codigo) ?? {};
    const aMano = destinos.get(c.codigo) ?? {};
    const skusAMano = skus.get(c.codigo) ?? {};
    // Talles agregados a mano que no están en el remito (13-nov-2026, gax: «me entró en otro talle, en 13 americano»).
    const agregados: Llega[] = Object.keys(escritas)
      .filter((k) => /^US /.test(k) && esTalleUS(k.slice(3)) && !llegada.llegan.some((l) => etiquetaUS(l.us) === etiquetaUS(talleUS(k.slice(3)))))
      .map((k) => ({ us: talleUS(k.slice(3)), cantidad: 0, original: 0 }))
      .filter((l, i, xs) => xs.findIndex((x) => x.us === l.us) === i);
    const llegan = [...llegada.llegan, ...agregados].map((l) => {
      const x = escritas[etiquetaUS(l.us)] !== undefined ? { ...l, cantidad: escritas[etiquetaUS(l.us)] } : { ...l };
      const d = aMano[etiquetaUS(l.us)] ? leerDestino(aMano[etiquetaUS(l.us)]) : null;
      const k = skusAMano[etiquetaUS(l.us)] ? leerSku(skusAMano[etiquetaUS(l.us)]) : null;
      return { ...x, ...(d ? { destino: d } : {}), ...(k ? { sku: k } : {}) };
    }).sort(porTalle);
    const unidades = llegan.reduce((s, l) => s + l.cantidad, 0);
    const cambiadas = llegan.filter((l) => l.cantidad !== l.original);
    const base = { codigo: c.codigo, descripcion, unidades, firma: firmaBase, talles: llegan.map((l) => ({ talle: etiquetaUS(l.us), cantidad: l.cantidad, original: l.original })) };
    const noUS = llegan.filter((l) => !esTalleUS(l.us));
    if (noUS.length) return { ...base, estado: 'bloqueado', motivo: `Talle ${noUS.map((l) => l.us).join(', ')}: por ahora la carga de Distrinando es solo calzado Reebok. Cargalo a mano.`, opciones: [] };
    if (!unidades) return { ...base, estado: 'bloqueado', motivo: cambiadas.length ? 'Pusiste 0 en todos los talles: no hay nada para cargar.' : 'Escribí cuántos pares llegaron de cada talle.', opciones: [] };
    if (!formasCodigo(c.codigo).length) return { ...base, estado: 'bloqueado', motivo: 'El código tiene caracteres que no puedo buscar en Shopify: cargalo a mano.', opciones: [] };
    const ids = estado.porCodigo[c.codigo.toUpperCase()] ?? [];
    const productos = ids.map((id) => estado.productos[id]).filter(Boolean);
    const tabla = tablaDelItem(c.codigo, pedidos, productos, llegan, tablas.get(c.codigo));
    // En qué talle de Shopify entra cada US (del primer producto, con los talles ya renombrados; si no existe, el que se crearía).
    const tElegida = tabla.elegida ? tablaReebok(tabla.elegida) : null;
    const mov0 = productos[0] ? talleFinal(c.codigo, productos[0].variantes, llegan, tElegida) : null;
    const finales0 = productos[0] && mov0 ? productos[0].variantes.map((v) => ({ ...v, talle: mov0.final(v) })) : [];
    const talles = llegan.map((l) => {
      const u = ubicar(c.codigo, l, finales0, pedidos, tElegida);
      const destino = 'error' in u ? u.falta?.talle ?? '' : u.talle;
      // SKU que tiene hoy ese talle en Shopify (gax: «para escanearlo o saber qué SKU tiene»); si se crea, el que va a llevar.
      const vDestino = 'error' in u ? undefined : finales0.find((v) => v.id === u.varianteId);
      const auto = 'error' in u ? u.falta?.skuProveedor : vDestino?.sku ?? '';
      const sku = auto !== undefined && l.sku ? l.sku : auto;
      // El talle que tiene hoy, si se renombra (gax: «el SKU manténelo… ponerle el talle correcto»).
      const renombra = vDestino ? mov0?.renombrar.find((r) => r.id === vDestino.id)?.talle : undefined;
      return {
        talle: etiquetaUS(l.us), cantidad: l.cantidad, original: l.original, destino, ...(sku !== undefined ? { sku } : {}),
        ...(l.destino ? { destinoManual: true } : {}), ...('error' in u && u.falta ? { nuevo: true } : {}),
        ...(auto !== undefined && l.sku && norm(l.sku) !== norm(auto) ? { skuManual: true } : {}),
        ...(renombra ? { renombra } : {}),
      };
    });
    const lista = Number(ren?.precioUnitario) || 0, bonif = Number(ren?.bonificacion) || 0;
    const opciones = ids.length
      ? ids.map((id) => opcionReposicion(c.codigo, estado.productos[id], llegan, pedidos, tabla.elegida, lista, bonif, ren))
      : [opcionAlta(c.codigo, llegan, pedidos, tabla.elegida, lista, bonif, notas.find((l) => (l.unidadesPorUdm || 1) <= 1)?.descripcion || notas[0]?.descripcion || descripcion)];
    for (const o of opciones) {
      if (llegada.avisos.length) o.avisos.push(...llegada.avisos);
      if (cambiadas.length) o.avisos.push(`Distinto del remito: ${cambiadas.map((l) => (l.original ? `US ${l.us} ${l.original}→${l.cantidad}` : `US ${l.us} +${l.cantidad} (no está en el remito)`)).join(' · ')}. Al terminar te armo el mail para avisar.`);
    }
    const conTabla = { ...base, talles, tabla };
    if (tabla.hace && !tabla.elegida) return { ...conTabla, estado: 'bloqueado', motivo: 'Elegí la tabla de talle: hay talles que el proveedor no informa en la nota.', opciones: [] };
    if (opciones.length === 1) return opciones[0].bloqueo ? { ...conTabla, estado: 'bloqueado', motivo: opciones[0].bloqueo, opciones: [] } : { ...conTabla, estado: 'listo', motivo: '', opciones };
    return { ...conTabla, estado: 'elegir', motivo: `El código está en ${ids.length} productos de Shopify: elegí en cuál sumar el stock.`, opciones: [NO_CARGAR, ...opciones] };
  });
  return { entregaId: f.id, locationId: estado.locationId, posId: estado.posId ?? null, items, avisos, sucursal: SUCURSAL_CARGA_ID };
}
