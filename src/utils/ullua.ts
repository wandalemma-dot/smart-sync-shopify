// ============================================================================
// ULLUA (Thrasher, Spitfire, DTS, Good, Pizza) — 19-nov-2026, pedido de gax
// ----------------------------------------------------------------------------
// Marketplace, como Family: la mercadería es de Ullua y el stock se carga en su
// sucursal «🟢ULLUA (Thrasher - Spitfire - DTS)». Cada entrega trae un REMITO o una
// FACTURA (en papel, se lee la foto):
//   · REMITO: el precio INCLUYE IVA (484.000 = 400.000 × 1,21): se divide por 1,21.
//   · FACTURA: el precio es SIN IVA (el 21% se suma en el pie).
// El precio de cada renglón es el de la CURVA entera (código terminado en C): se
// divide por las unidades de la curva, que viene escrita en la descripción
// («CURVA S1 M2 L3 XL2» = 8 u.). Mujer suele ser S2 M2 L2 XL2. El papel corta la
// descripción, así que una curva cortada se completa con la curva conocida que
// coincide con lo que se lee (y se avisa); si no hay una sola, no se adivina.
// Precio c/u sin IVA = precio de la curva (÷ 1,21 si es remito) ÷ unidades.
// Costo = precio c/u sin IVA − 15% (gax lo confirmó el 19-nov-2026: así están
// todos los Ullua en Shopify: remera 22.500 → 19.125, buzo 50.000 → 42.500).
// Precio de venta de los nuevos = c/u × 2 al 999 más cercano (45.000 → 44.999),
// como los cargados a mano; se puede cambiar en la vista previa.
// SKU = código sin la C final ni guiones + talle (580580C → 580580S, 3419-A30C →
// 3419A30S); etiqueta = el código tal cual (580580C).
// ============================================================================
import { fmt } from './controlFacturas';
import type { EntregaFamily, RenglonFamily } from './controlFamily';
import { talleFamily } from './controlFamily';
import { costoFamily, talleAlta, type Marketplace, type OpcionCarga } from './cargaFamily';

export const SUCURSAL_ULLUA = 'ULLUA (Thrasher - Spitfire - DTS)';
export const IVA = 1.21;

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const alnum = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const cent = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// CURVAS
// ---------------------------------------------------------------------------
export interface TalleCurva { talle: string; cantidad: number }
const ORDEN = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const curva = (s: string): TalleCurva[] => s.split(' ').map((t) => { const m = /^([A-Z]+)(\d+)$/.exec(t)!; return { talle: m[1], cantidad: Number(m[2]) }; });
/** Curvas que usa Ullua (de sus listas STOCK DISPONIBLE, DTS y GOOD, y de los remitos). La primera es la de siempre. */
export const CURVAS_CONOCIDAS: TalleCurva[][] = [
  curva('S1 M2 L3 XL2'), // remeras, buzos, manga larga (8)
  curva('S2 M2 L2 XL2'), // mujer (8)
  curva('S1 M2 L2 XL1'), // Good, board shorts (6)
  curva('S1 M3 L3 XL2'), // boxer (9)
  curva('S2 M2 L2 XL1 XXL1'), // jogging (8)
];
export const unidadesCurva = (c: TalleCurva[]) => c.reduce((s, t) => s + t.cantidad, 0);
export const textoCurva = (c: TalleCurva[]) => c.map((t) => `${t.talle}${t.cantidad}`).join(' ');
export const esMujer = (descripcion: string) => /\b(WOMAN|WOMEN|WMNS|MUJER|GIRL)\b/.test(norm(descripcion));

const RE_TALLE_N = /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL)(\d{1,2})$/;
const RE_N_TALLE = /^(\d)(S|M|L|XL)$/; // «2M», «3L», «2XL» de la planilla (cantidad adelante)
const RE_TALLE_SOLO = /^(X{0,3}S|M|L|X{1,3}L|X|XX|XXX|2XL|3XL)$/;

export interface LecturaCurva {
  /** La curva elegida (vacía si no se sabe). */
  talles: TalleCurva[];
  /** Cómo salió: leída entera, completada (cortada en el papel), supuesta (no figura) o desconocida. */
  como: 'leida' | 'completada' | 'supuesta' | 'desconocida';
  /** Lo que se leyó (para los avisos). */
  leido: string;
}

/**
 * La curva de la descripción. «CURVA S1 M2 L3 XL2» → leída; «CURVA S1 M2 L3 XL» (cortada) → completada con la
 * curva conocida que empieza igual; sin curva escrita → la de siempre (mujer: S2 M2 L2 XL2), «supuesta».
 * Si lo que se lee no coincide con ninguna curva conocida y está cortado, «desconocida» (no se adivina).
 */
export function leerCurva(descripcion: string, conCurva = true): LecturaCurva {
  const d = norm(descripcion);
  const i = d.search(/\bCURVA\b/);
  const resto = i >= 0 ? d.slice(i + 5) : '';
  const tokens = resto.replace(/[,;]/g, ' ').split(' ').map((t) => t.trim()).filter(Boolean);
  const leidos: TalleCurva[] = [];
  let cortada = i >= 0 && !tokens.length;
  for (const [k, t] of tokens.entries()) {
    let m = RE_TALLE_N.exec(t);
    if (m) { leidos.push({ talle: talleFamily(m[1]), cantidad: Number(m[2]) }); continue; }
    m = RE_N_TALLE.exec(t);
    if (m) { leidos.push({ talle: m[2], cantidad: Number(m[1]) }); continue; }
    // Lo último sin número («XL», «S») es la curva cortada por el ancho de la columna.
    if (k === tokens.length - 1 && RE_TALLE_SOLO.test(t)) { cortada = true; break; }
    if (leidos.length) { cortada = true; break; }
    cortada = true; break;
  }
  const leido = textoCurva(leidos);
  const defecto = esMujer(descripcion) ? CURVAS_CONOCIDAS[1] : CURVAS_CONOCIDAS[0];
  // Sin curva escrita se supone la de siempre solo en remeras, buzos y parecidos (no en medias, ojotas, accesorios).
  const tipo = tipoUllua(descripcion);
  const deRopa = !tipo || ['Remeras', 'Buzos', 'Musculosas', 'Camisas'].includes(tipo.productType);
  if (i < 0) return conCurva && deRopa ? { talles: defecto, como: 'supuesta', leido } : { talles: [], como: 'desconocida', leido };
  const empieza = CURVAS_CONOCIDAS.filter((c) => leidos.every((t, k) => c[k]?.talle === t.talle && c[k].cantidad === t.cantidad));
  if (leidos.length && !cortada) {
    const repetido = leidos.some((t, k) => leidos.findIndex((x) => x.talle === t.talle) !== k);
    if (repetido) return { talles: [], como: 'desconocida', leido };
    // «CURVA S1 M2 L3» justo cortada entre talles: es el principio de una curva conocida, no una curva entera.
    const igual = empieza.some((c) => c.length === leidos.length);
    if (igual || !empieza.length) return { talles: leidos, como: 'leida', leido };
  }
  // Cortada: las curvas conocidas que empiezan con lo que se leyó.
  if (empieza.includes(defecto)) return { talles: defecto, como: 'completada', leido };
  if (empieza.length === 1) return { talles: empieza[0], como: 'completada', leido };
  return { talles: [], como: 'desconocida', leido };
}

/** La descripción sin la curva: «SP HOODIE OG CLASSIC MELANGE CURVA S1 M2 L3» → «SP HOODIE OG CLASSIC MELANGE». */
export const sinCurva = (descripcion: string) => String(descripcion ?? '').replace(/\s*\bCURVA\b.*$/i, '').replace(/\s+/g, ' ').trim();

/** El código es de una curva (termina en C después de un número: 364480C, 5108-A23C). */
export const esCodigoCurva = (codigo: string) => /\dC$/.test(alnum(codigo));

// ---------------------------------------------------------------------------
// DOCUMENTO (remito o factura leído de la foto) → ENTREGA
// ---------------------------------------------------------------------------
export interface RenglonDocUllua { codigo: string; descripcion: string; cantidad: number; precio: number; total: number }
export interface DocumentoUllua {
  tipo: 'remito' | 'factura';
  numero: string;
  fecha: string;
  /** Factura: el remito al que corresponde («REMITO: 7680»). */
  remito: string;
  renglones: RenglonDocUllua[];
  subtotal: number;
  iva: number;
  total: number;
  dudas: string[];
}

const fmtCurva = (c: TalleCurva[]) => `${textoCurva(c)} (${unidadesCurva(c)} u.)`;
const casi = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

/**
 * Pasa el remito o la factura a la entrega: talles = curva × cantidad de curvas, precio c/u sin IVA en
 * «precioMayor» (de ahí sale el costo, − 15%). Controla las cuentas del papel y avisa lo que no cierra.
 */
export function entregaDeDocumentoUllua(doc: DocumentoUllua, hoy: string): { entrega: Omit<EntregaFamily, 'id'>; avisos: string[] } {
  const dudas = [...(doc.dudas ?? [])];
  const avisos: string[] = [];
  const conIva = doc.tipo === 'remito';
  const porCodigo = new Map<string, RenglonFamily>();
  for (const r of doc.renglones) {
    const codigo = String(r.codigo ?? '').toUpperCase().replace(/\s+/g, '');
    if (!codigo) continue;
    const curvas = Number(r.cantidad) || 0;
    if (!(curvas > 0)) { dudas.push(`${codigo}: no tiene cantidad.`); continue; }
    if (!Number.isInteger(curvas)) dudas.push(`${codigo}: la cantidad ${curvas} no es entera.`);
    if (r.precio > 0 && r.total > 0 && !casi(r.precio * curvas, r.total)) dudas.push(`${codigo}: ${curvas} × ${fmt(r.precio)} no da el total del renglón (${fmt(r.total)}).`);
    const precioSinIva = conIva ? r.precio / IVA : r.precio;
    const deCurva = esCodigoCurva(codigo);
    const lc = deCurva ? leerCurva(r.descripcion) : { talles: [], como: 'desconocida' as const, leido: '' };
    const unidadesPorCurva = deCurva ? unidadesCurva(lc.talles) : 1;
    if (deCurva && lc.como === 'completada') dudas.push(`${codigo}: la curva está cortada en el papel (se lee «${lc.leido || 'CURVA'}…»): usé ${fmtCurva(lc.talles)}. Revisala.`);
    if (deCurva && lc.como === 'supuesta') dudas.push(`${codigo}: la descripción no trae la curva: usé la de siempre${esMujer(r.descripcion) ? ' de mujer' : ''}, ${fmtCurva(lc.talles)}. Revisala.`);
    if (deCurva && lc.como === 'desconocida') dudas.push(`${codigo}: no pude saber la curva (se lee «${lc.leido || '?'}»). Escribí los talles y el precio c/u sin IVA (la curva sin IVA sale ${fmt(cent(precioSinIva))}, dividila por las unidades) en «✏️ Ver o corregir».`);
    const talles = deCurva ? lc.talles.map((t) => ({ talle: t.talle, cantidad: t.cantidad * Math.round(curvas) })) : [];
    const cantidad = deCurva ? (talles.length ? talles.reduce((s, t) => s + t.cantidad, 0) : 0) : Math.round(curvas);
    const precioMayor = precioSinIva > 0 && unidadesPorCurva > 0 ? cent(precioSinIva / unidadesPorCurva) : 0;
    if (!(precioSinIva > 0)) dudas.push(`${codigo}: sin precio.`);
    const renglon: RenglonFamily = { codigo, descripcion: sinCurva(r.descripcion), precioMayor, precioPublico: 0, cantidad, talles };
    const ya = porCodigo.get(codigo);
    if (ya) {
      avisos.push(`${codigo} está dos veces en ${doc.tipo === 'remito' ? 'el remito' : 'la factura'}: se sumaron las cantidades.`);
      for (const t of talles) {
        const x = ya.talles.find((y) => y.talle === t.talle);
        if (x) x.cantidad += t.cantidad; else ya.talles.push({ ...t });
      }
      ya.cantidad += cantidad;
      continue;
    }
    porCodigo.set(codigo, renglon);
  }
  const suma = doc.renglones.reduce((s, r) => s + (Number(r.total) || 0), 0);
  if (doc.tipo === 'factura') {
    if (doc.subtotal > 0 && !casi(suma, doc.subtotal, 2)) dudas.push(`Los renglones suman ${fmt(suma)} y el subtotal de la factura dice ${fmt(doc.subtotal)}.`);
    if (doc.subtotal > 0 && doc.iva > 0 && !casi(doc.subtotal * 0.21, doc.iva, 2)) dudas.push(`El IVA (${fmt(doc.iva)}) no es el 21% del subtotal (${fmt(cent(doc.subtotal * 0.21))}).`);
    if (doc.subtotal > 0 && doc.total > 0 && doc.iva > 0 && !casi(doc.subtotal + doc.iva, doc.total, 2)) dudas.push(`Subtotal + IVA (${fmt(doc.subtotal + doc.iva)}) no da el total (${fmt(doc.total)}): puede tener percepciones.`);
  } else if (doc.total > 0 && !casi(suma, doc.total, 2)) dudas.push(`Los renglones suman ${fmt(suma)} y el total del remito dice ${fmt(doc.total)}.`);
  if (!porCodigo.size) throw new Error(`No encontré artículos en ${doc.tipo === 'remito' ? 'el remito' : 'la factura'}.`);
  if (!doc.fecha) avisos.push('El papel no trae la fecha (o no se leyó): se usó la de hoy (se puede corregir).');
  const nombre = doc.tipo === 'remito' ? `Remito ${doc.numero || ''}`.trim() : `Factura ${doc.numero || ''}`.trim();
  avisos.push(conIva
    ? 'Es un remito: los precios traen IVA, así que los dividí por 1,21.'
    : 'Es una factura: los precios ya vienen sin IVA.');
  return {
    entrega: {
      nombre, fecha: doc.fecha || hoy, origen: 'foto', renglones: [...porCodigo.values()], dudas,
      documento: { tipo: doc.tipo, numero: doc.numero, remito: doc.tipo === 'remito' ? doc.numero : doc.remito, total: doc.total || 0 },
    },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// SHOPIFY: reconocer los productos del código
// ---------------------------------------------------------------------------
/** El código sin la C de la curva ni guiones: 580580C → 580580, 5101-A80C → 5101A80, 251451 → 251451. */
export function baseUllua(codigo: string): string {
  const c = alnum(codigo);
  return esCodigoCurva(codigo) ? c.slice(0, -1) : c;
}
const RE_TALLE_SKU = /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|TU|U)$/;

/**
 * El SKU es de ese código: el código sin la C y el talle (580580S, 5101a80s, 5104'A80S, 3362!01!S), el código solo,
 * o el código con la C y un separador (910280C.NEG.36.37). 5101 no es de 510101S.
 */
export function skuEsDeUllua(sku: string, codigo: string): boolean {
  const base = baseUllua(codigo);
  const n = alnum(sku);
  if (!base || !n.startsWith(base)) return false;
  const resto = n.slice(base.length);
  if (!resto || RE_TALLE_SKU.test(resto)) return true;
  if (!resto.startsWith('C')) return false;
  if (resto === 'C') return true;
  // «910280C.NEG…»: después de la C viene un separador en el SKU original.
  const up = String(sku).toUpperCase();
  let vistos = 0;
  for (let i = 0; i < up.length; i++) {
    if (/[A-Z0-9]/.test(up[i])) vistos++;
    if (vistos === base.length + 1) return i + 1 < up.length && !/[A-Z0-9]/.test(up[i + 1]);
  }
  return false;
}

/** La etiqueta del código (580580C, 5162a01c para 5162-A01C). */
export function etiquetaEsDeUllua(etiquetas: string[] | undefined, codigo: string): boolean {
  const c = alnum(codigo);
  const base = baseUllua(codigo);
  return !!c && (etiquetas ?? []).some((t) => { const x = alnum(t); return x === c || (esCodigoCurva(codigo) && x === base); });
}

/** Búsqueda de Shopify: SKU que empieza con los números del código o etiqueta igual al código. */
export function busquedaUllua(codigos: string[]): string {
  return codigos.map((c) => {
    const numeros = /^\d+/.exec(alnum(c))?.[0] || baseUllua(c);
    const tags = [...new Set([c.toUpperCase(), `${baseUllua(c)}${esCodigoCurva(c) ? 'C' : ''}`])];
    return [`sku:${numeros}*`, ...tags.map((t) => `tag:"${t}"`)].join(' OR ');
  }).join(' OR ');
}

// ---------------------------------------------------------------------------
// ALTAS: título, marca, tipo, precio
// ---------------------------------------------------------------------------
interface Marca { vendor: string; nombre: string; etiqueta: string }
const MARCAS: [RegExp, Marca][] = [
  [/^(TH|THRASHER)\b/, { vendor: 'THRASHER', nombre: 'Thrasher', etiqueta: 'thrasher' }],
  [/^(SP|SPITFIRE)\b/, { vendor: 'Spitfire', nombre: 'Spitfire', etiqueta: 'spitfire' }],
  [/^GOODD? GOD\b|^GOOD\b/, { vendor: 'Good', nombre: 'Good', etiqueta: 'good' }],
  [/^DTS\b/, { vendor: 'DTS', nombre: 'DTS', etiqueta: 'dts' }],
  [/^PIZZA\b/, { vendor: 'Pizza', nombre: 'Pizza', etiqueta: 'pizza' }],
];
interface Tipo { re: RegExp; prefijo: string; productType: string; etiquetas: string[]; gramos: number }
const ROPA = ['Indumentaria', 'Ropa'];
const TIPOS: Tipo[] = [
  { re: /\b(HOODIE|CANGURO)\b/, prefijo: 'Buzo', productType: 'Buzos', etiquetas: [...ROPA, 'Buzos', 'buzo canguro'], gramos: 600 },
  { re: /\b(CREW|CREWNECK|CUELLO REDONDO|BUZO|SWEAT)\b/, prefijo: 'Buzo', productType: 'Buzos', etiquetas: [...ROPA, 'Buzos'], gramos: 600 },
  { re: /\bLONG SLEEVE\b|\bMANGA LARGA\b/, prefijo: 'Remera Manga Larga', productType: 'Remeras', etiquetas: [...ROPA, 'remeras'], gramos: 300 },
  { re: /\b(T-?SHIRT|TEE|REMMERA|REMERA)\b/, prefijo: 'Remera', productType: 'Remeras', etiquetas: [...ROPA, 'remeras'], gramos: 300 },
  { re: /\bMUSCULOSA\b|\bTANK\b/, prefijo: 'Musculosa', productType: 'Musculosas', etiquetas: ROPA, gramos: 250 },
  { re: /\bCAMISA\b/, prefijo: 'Camisa', productType: 'Camisas', etiquetas: ROPA, gramos: 350 },
  { re: /\bBOARD\b/, prefijo: 'Malla', productType: 'Bermudas', etiquetas: ROPA, gramos: 400 },
  { re: /\bJOGG(ING|ER)?\b/, prefijo: 'Pantalón Jogging', productType: 'Pantalones', etiquetas: [...ROPA, 'Pantalones'], gramos: 600 },
  { re: /\bSHORT\b/, prefijo: 'Short', productType: 'Short', etiquetas: ROPA, gramos: 400 },
  { re: /\bBOXER\b/, prefijo: 'Boxer', productType: 'Boxer', etiquetas: ROPA, gramos: 150 },
  { re: /\b(MEDIAS?|MEEDIAS|SOQUETES?|SOCKS)\b/, prefijo: 'Medias', productType: 'Medias', etiquetas: ['Accesorios', 'Medias'], gramos: 100 },
  { re: /\bSLIDER(E)?S\b|\bOJOTAS?\b/, prefijo: 'Ojota', productType: 'Ojotas', etiquetas: ['Calzado', 'Ojotas'], gramos: 500 },
  { re: /\bRI(N|Ñ)ONERA\b/, prefijo: 'Riñonera', productType: 'Riñoneras', etiquetas: ['Accesorios'], gramos: 300 },
  { re: /\bBANDANA\b/, prefijo: 'Bandana', productType: 'Bandanas', etiquetas: ['Accesorios'], gramos: 100 },
  { re: /\bCINTURON\b/, prefijo: 'Cinturón', productType: 'Cinturones', etiquetas: ['Accesorios'], gramos: 200 },
  { re: /\bBILLETERA\b/, prefijo: 'Billetera', productType: 'Billeteras', etiquetas: ['Accesorios'], gramos: 150 },
];
// Palabras del tipo que no van en el título (ya están en el prefijo) y ruido del papel.
const QUITAR = /\b(TH|THRASHER|SP|SPITFIRE|GOODD?|GOD|DTS|PIZZA|HOODIE|HOODIES|T-?SHIRT|TEE|REMMERA|REMERA|LONG SLEEVE|MEN|MAN|HOMBRE|WOMAN|WOMEN|WMNS|MUJER|MUSCULOSA|CAMISA|BOARD|JOGG(ING|ER)?|SHORT|BOXER|MEDIAS?|MEEDIAS|SOQUETES?|SOCKS|SLIDER(E)?S|OJOTAS?|RI(N|Ñ)ONERA|BANDANA|CINTURON|BILLETERA|CUELLO REDONDO|PACK)\b/g;
const COLORES: [RegExp, string][] = [
  [/\bMELANGE OSCURO\b/, 'GRIS OSCURO'], [/\bGRIS MELANGE\b/, 'GRIS MELANGE'], [/\bMELANGE\b/, 'GRIS MELANGE'],
  [/\bMARINO\b/, 'AZUL MARINO'], [/\bBLANCA\b/, 'BLANCO'], [/\bNEGRA\b/, 'NEGRO'], [/\bROJA\b/, 'ROJO'], [/\bAMARILLA\b/, 'AMARILLO'],
];
const capital = (w: string) => (/^(OG|BBQ|LSD|DTS|BTH|II|III)$/.test(w) ? w : /\d/.test(w) ? w.toUpperCase() : w.charAt(0) + w.slice(1).toLowerCase());

export function marcaUllua(descripcion: string): Marca | null {
  const d = norm(descripcion).replace(/^(\w+)-/, '$1 ');
  return MARCAS.find(([re]) => re.test(d))?.[1] ?? null;
}
export function tipoUllua(descripcion: string): Tipo | null {
  const d = norm(descripcion).replace(/^(\w+)-/, '$1 ');
  return TIPOS.find((t) => t.re.test(d)) ?? null;
}

/**
 * Título como los cargados a mano: «Tipo Marca Modelo [Mujer] Color».
 * «SP HOODIE OG CLASSIC MELANGE» → «Buzo Spitfire OG Classic Gris Melange»;
 * «TH T-SHIRT WOMEN SKATEMAG NEGRO» → «Remera Thrasher Skatemag Mujer Negro».
 */
export function tituloUllua(descripcion: string): string {
  let d = norm(sinCurva(descripcion)).replace(/^(\w+)-/, '$1 ');
  const marca = marcaUllua(d);
  const tipo = tipoUllua(d);
  const mujer = esMujer(d);
  const crew = /\bCREW(NECK)?\b|\bCUELLO REDONDO\b/.test(d) && !/\bHOODIE\b/.test(d);
  for (const [re, x] of COLORES) d = d.replace(re, x);
  const palabras = d.replace(QUITAR, ' ').replace(/\bCREW(NECK)?\b/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  // El color va al final (después de «Mujer»): las palabras de color del final.
  const COLOR = /^(NEGRO|BLANCO|GRIS|MELANGE|OSCURO|AZUL|MARINO|AMARILLO|ROJO|VERDE|ROSA|NARANJA|VIOLETA|CELESTE|BEIGE|MARRON|BORDO|TURQUESA|FRANCIA|CAMUFLADO|MILITAR|LILA|FUCSIA|CHOCOLATE|CRUDO|NATURAL)$/;
  let k = palabras.length;
  while (k > 0 && COLOR.test(palabras[k - 1])) k--;
  const modelo = palabras.slice(0, k).map(capital), color = palabras.slice(k).map(capital);
  return [tipo?.prefijo ?? '', marca?.nombre ?? '', ...(crew ? ['Crew'] : []), ...modelo, ...(mujer ? ['Mujer'] : []), ...color].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Precio de venta sugerido: c/u sin IVA × 2 al 999 más cercano (22.500 → 44.999; 50.000 → 99.999). */
export function precioUllua(precioSinIva: number): number {
  if (!(precioSinIva > 0)) return 0;
  return Math.max(999, Math.round((precioSinIva * 2) / 1000) * 1000 - 1);
}
/** Costo = c/u sin IVA − 15%, con centavos (22.500 → 19.125). Igual que Family. */
export const costoUllua = costoFamily;

/** SKU de una variante nueva: código sin la C ni guiones + talle (580580C, M → 580580M). */
export const skuUllua = (codigo: string, talle: string) => `${baseUllua(codigo)}${talle === 'Default Title' ? '' : talleAlta(talle).replace(/[^A-Z0-9]/g, '')}`;

/** Opción «crear producto nuevo» de un artículo de Ullua. */
export function altaUllua(r: RenglonFamily): OpcionCarga {
  const titulo = tituloUllua(r.descripcion);
  const avisos: string[] = [];
  const base = { clave: 'alta', etiqueta: `Crear producto nuevo «${titulo}»`, avisos };
  if (esCodigoCurva(r.codigo) && !r.talles.length) return { ...base, accion: null, bloqueo: 'No sé la curva (los talles) ni, por eso, el precio c/u: escribí los talles y el precio c/u sin IVA en «✏️ Ver o corregir».' };
  if (!(r.precioMayor > 0)) return { ...base, accion: null, bloqueo: 'Falta el precio: no puedo calcular el costo ni el precio de venta. Corregilo en «✏️ Ver o corregir».' };
  const variantes = r.talles.length
    ? r.talles.map((t) => ({ talle: talleAlta(t.talle), sku: skuUllua(r.codigo, t.talle), cantidad: t.cantidad }))
    : [{ talle: 'Default Title', sku: baseUllua(r.codigo), cantidad: r.cantidad }];
  const repetidos = variantes.filter((v, i) => variantes.findIndex((x) => x.talle === v.talle) !== i).map((v) => v.talle);
  if (repetidos.length) return { ...base, accion: null, bloqueo: `El talle ${[...new Set(repetidos)].join(', ')} está dos veces.` };
  const marca = marcaUllua(r.descripcion);
  const tipo = tipoUllua(r.descripcion);
  if (!marca) avisos.push(`No reconozco la marca en «${r.descripcion}»: se crea con la marca «Ullua». Cambiala en Shopify si corresponde.`);
  if (!tipo) avisos.push(`No conozco el tipo de producto de «${r.descripcion}»: revisá el título y el tipo.`);
  const ordenados = variantes.slice().sort((a, b) => ORDEN.indexOf(a.talle) - ORDEN.indexOf(b.talle));
  return {
    ...base,
    accion: {
      tipo: 'alta', titulo, productType: tipo?.productType ?? 'Indumentaria',
      etiquetas: [r.codigo, ...(tipo?.etiquetas ?? ROPA), ...(marca ? [marca.etiqueta] : [])],
      gramos: tipo?.gramos ?? 400, precio: precioUllua(r.precioMayor), costo: costoUllua(r.precioMayor), vendor: marca?.vendor ?? 'Ullua',
      variantes: ordenados, ...(r.talles.length ? {} : { opcion: 'Title' }), precioEditable: true, precioBase: r.precioMayor,
    },
  };
}

export const ULLUA: Marketplace = {
  id: 'ullua', nombre: 'Ullua', sucursal: SUCURSAL_ULLUA, consultaNombre: null,
  busqueda: busquedaUllua,
  esDelCodigo: (sku, etiquetas, codigo) => skuEsDeUllua(sku, codigo) || etiquetaEsDeUllua(etiquetas, codigo),
  alta: altaUllua,
  costoEsperado: (r) => (r.precioMayor > 0 ? costoUllua(r.precioMayor) : null),
};
