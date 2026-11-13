// ============================================================================
// DISTRINANDO — UBICAR EL TALLE QUE LLEGÓ EN SHOPIFY (13-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// El remito de Distrinando trae el talle US del proveedor («11», «8.5»). En Shopify los
// talles están en AR. Distrinando informa en la nota de pedido el AR de cada SKU, y ese AR
// NO siempre sigue las tablas de Wanda (Nanoflex US 8.5 = 41, la tabla Hombre dice 40.5;
// Beatnik US 9 = 41.5). Los productos ya cargados se crearon con el AR del proveedor
// (Sincronización conserva el AR de la descripción). Por eso, en este orden y sin adivinar:
//   1) el SKU del proveedor (código-US, ej. RBK110S236074-11) en una variante: es ese talle;
//   2) el AR que el proveedor informa para ese SKU en la nota de pedido (talleArReebok:
//      «… 43» / «AR 43», o «UK 10» solo si las tablas lo respaldan con el mismo US);
//   3) la tabla de talle que eligió la usuaria para ese modelo (gax: «que haya que elegir
//      la tabla de talle y luego se agregue a etiquetas»).
// Una tabla que contradice lo que informa el proveedor para ese modelo no se puede elegir
// (`tablasDelModelo`): cargaría pares en el talle equivocado o crearía un talle repetido.
// ============================================================================
import type { Pedido } from './controlFacturas';
import { coincideUS, REEBOK_ALIAS, REEBOK_TABLAS, talleArReebok } from './reebokCalzado';

export interface VarianteTalle { id: string; talle: string; sku: string }
/** manual: la usuaria escribió en qué talle de Shopify entra (gax, 13-nov-2026). */
export type FuenteTalle = 'sku' | 'nota' | 'tabla' | 'manual';
export interface TalleUbicado {
  varianteId: string;
  /** Talle de la variante en Shopify (AR). */
  talle: string;
  fuente: FuenteTalle;
  /** SKU del proveedor de ese talle (código-US). */
  skuProveedor: string;
  avisos: string[];
}
export interface TalleSinUbicar {
  error: string;
  /** El AR se sabe pero el talle no existe en Shopify: se puede crear. */
  falta?: { talle: string; skuProveedor: string; fuente: FuenteTalle };
}
/** Una tabla de talle Reebok: US → AR. */
export interface TablaTalle { nombre: string; ar: (us: string) => string | null }

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
const esNumero = (s: string) => /^\d+(\.\d+)?$/.test(s);
/** «8,5» → «8.5», «10.0» → «10», «8.5k» → «8.5K». */
export function talleUS(t: string): string {
  const s = norm(t).replace(',', '.');
  const m = /^(\d+(?:\.\d+)?)(K|W?)$/.exec(s);
  return m ? `${Number(m[1])}${m[2]}` : s;
}
export const mismoTalle = (a: string, b: string) => {
  const A = norm(a).replace(',', '.'), B = norm(b).replace(',', '.');
  return A === B || (esNumero(A) && esNumero(B) && Number(A) === Number(B));
};
export const skuProveedor = (codigo: string, us: string) => `${norm(codigo)}-${talleUS(us)}`;
/** Un talle de calzado en US del proveedor: «11», «8.5», «10.5K», «7W». */
export const esTalleUS = (t: string) => /^\d{1,2}(\.\d)?[KW]?$/.test(talleUS(t)) && Number.parseFloat(talleUS(t)) <= 16;

export const TABLAS_REEBOK = Object.keys(REEBOK_TABLAS);
export const etiquetaTabla = (nombre: string) => `TABLA DE TALLE REEBOK ${nombre}`;
/** La tabla Reebok con ese nombre (1, 2, MUJER, NIÑO). */
export function tablaReebok(nombre: string): TablaTalle | null {
  const tabla = REEBOK_TABLAS[nombre];
  if (!tabla) return null;
  return {
    nombre,
    ar: (us) => {
      const u = talleUS(us);
      const ks = Object.keys(tabla).filter((k) => coincideUS(nombre, k, u));
      return ks.length === 1 ? ks[0] : null;
    },
  };
}

/** El AR que informa el proveedor para ese SKU en las notas de pedido; null si no lo informa o se contradice. */
export function arDeNotas(pedidos: Pedido[], sku: string, us: string): { ar: string | null; contradice?: string[] } {
  const ars = new Set<string>();
  for (const p of pedidos) for (const l of p.lineas) {
    if (norm(l.sku) !== norm(sku)) continue;
    const ar = talleArReebok(String(l.descripcion ?? ''), talleUS(us));
    if (ar) ars.add(String(Number(ar)));
  }
  if (ars.size > 1) return { ar: null, contradice: [...ars] };
  return { ar: ars.size ? [...ars][0] : null };
}

/** Las etiquetas «TABLA DE TALLE REEBOK …» del producto (cualquiera: con nombre, «2», «SIN IDENTIFICAR»). */
export const etiquetasDeTabla = (etiquetas: string[]) => etiquetas.filter((t) => norm(t).startsWith('TABLA DE TALLE REEBOK'));
/** La tabla con nombre de la etiqueta del producto, si tiene una sola etiqueta de tabla y es Hombre, Mujer o Niño. */
export function tablaDeEtiquetas(etiquetas: string[]): string | null {
  // «REEBOK HOMBRE» (etiqueta vieja) es la «REEBOK 1»: con las dos etiquetas, igual es una sola.
  const nombres = [...new Set(etiquetasDeTabla(etiquetas).map((t) => {
    const n = norm(t).slice('TABLA DE TALLE REEBOK'.length).trim().replace('NINO', 'NIÑO');
    return REEBOK_ALIAS[n] ?? n;
  }))];
  if (nombres.length !== 1) return null;
  return nombres[0] in REEBOK_TABLAS ? nombres[0] : null;
}

/** SKU con formato del proveedor para ese código: devuelve el talle US que lleva (o null si es EAN u otro). */
export function usDelSku(sku: string, codigo: string): string | null {
  const s = norm(sku), c = norm(codigo);
  return s.startsWith(c + '-') ? talleUS(s.slice(c.length + 1)) : null;
}

/** Lo que se sabe del modelo: US → AR según el proveedor (notas) y los SKU del proveedor ya cargados en Shopify. */
export function paresConocidos(codigo: string, pedidos: Pedido[], variantes: VarianteTalle[]): { us: string; ar: string; de: string }[] {
  const out = new Map<string, { us: string; ar: string; de: string }>();
  for (const v of variantes) {
    const us = usDelSku(v.sku, codigo);
    if (us && esNumero(norm(v.talle).replace(',', '.'))) out.set(`${us}|${Number(norm(v.talle).replace(',', '.'))}`, { us, ar: String(Number(norm(v.talle).replace(',', '.'))), de: 'Shopify' });
  }
  for (const p of pedidos) for (const l of p.lineas) {
    if (norm(l.codigo) !== norm(codigo) || (l.unidadesPorUdm || 1) > 1) continue;
    const us = usDelSku(l.sku, codigo);
    if (!us) continue;
    const ar = talleArReebok(String(l.descripcion ?? ''), us);
    if (ar) out.set(`${us}|${Number(ar)}`, { us, ar: String(Number(ar)), de: 'la nota del proveedor' });
  }
  return [...out.values()];
}

/**
 * Qué tablas se pueden elegir para un modelo: las que coinciden con todo lo que informa el proveedor
 * (y los SKU del proveedor ya cargados) y tienen los US que hacen falta.
 */
export function tablasDelModelo(pares: { us: string; ar: string; de: string }[], usNecesarios: string[]): { nombre: string; bloqueo?: string }[] {
  return TABLAS_REEBOK.map((nombre) => {
    const t = tablaReebok(nombre)!;
    const choque = pares.find((p) => !coincideUS(nombre, p.ar, p.us));
    if (choque) {
      const dice = t.ar(choque.us);
      return { nombre, bloqueo: `no coincide con ${choque.de}: US ${choque.us} = ${choque.ar}${dice ? `, la tabla dice ${dice}` : `, la tabla no tiene el US ${choque.us}`}` };
    }
    const sin = usNecesarios.filter((us) => !t.ar(us));
    if (sin.length) return { nombre, bloqueo: `no tiene el US ${sin.join(', ')}` };
    return { nombre };
  });
}

/**
 * Dónde va en Shopify el talle US que llegó de un código de Distrinando. `tabla`: la que eligió la
 * usuaria para el modelo (solo se usa para los talles que el proveedor no informa).
 */
export function ubicarTalleDistrinando(a: {
  codigo: string; talle: string; variantes: VarianteTalle[]; pedidos: Pedido[]; tabla: TablaTalle | null;
}): TalleUbicado | TalleSinUbicar {
  const us = talleUS(a.talle);
  const sku = skuProveedor(a.codigo, us);
  const avisos: string[] = [];
  const nota = arDeNotas(a.pedidos, sku, us);
  const porSku = a.variantes.filter((v) => norm(v.sku) === sku);
  if (porSku.length > 1) return { error: `hay dos variantes con el SKU ${sku}` };
  if (porSku.length === 1) {
    const v = porSku[0];
    if (nota.ar && !mismoTalle(v.talle, nota.ar)) avisos.push(`el SKU ${sku} está en el talle ${v.talle} y la nota dice AR ${nota.ar}: va al ${v.talle} (manda el SKU)`);
    return { varianteId: v.id, talle: v.talle, fuente: 'sku', skuProveedor: sku, avisos };
  }
  if (nota.contradice) return { error: `las notas de pedido dan dos AR distintos para ${sku} (${nota.contradice.join(' y ')})` };
  let ar = nota.ar;
  let fuente: FuenteTalle = 'nota';
  if (!ar && a.tabla) { ar = a.tabla.ar(us); fuente = 'tabla'; }
  if (!ar) {
    return { error: a.tabla
      ? `la tabla ${a.tabla.nombre} no tiene el US ${us}`
      : `no sé qué AR es el US ${us}: la nota de pedido no lo informa. Elegí la tabla de talle del modelo` };
  }
  const vs = a.variantes.filter((v) => mismoTalle(v.talle, ar!));
  if (vs.length > 1) return { error: `hay dos variantes del talle ${ar}` };
  if (!vs.length) return { error: `no existe el talle ${ar} (US ${us})`, falta: { talle: ar, skuProveedor: sku, fuente } };
  const v = vs[0];
  const otroUs = usDelSku(v.sku, a.codigo);
  if (otroUs && otroUs !== us) return { error: `el talle ${ar} tiene el SKU ${v.sku} (US ${otroUs}), no el US ${us}: revisá ese producto` };
  if (fuente === 'tabla') avisos.push(`US ${us} = AR ${ar} por la tabla ${a.tabla!.nombre} (la nota no informa el AR)`);
  return { varianteId: v.id, talle: v.talle, fuente, skuProveedor: sku, avisos };
}

/**
 * La curva de un pack (gax, 13-nov-2026): «M12 4/7.5 (23322)» = US 4, 5, 6, 7 y 7.5 con 2, 3, 3, 2 y 2
 * pares por caja. Primero talles enteros (más el último si es medio); si los números no alcanzan, de medio
 * en medio. Si no cierra, null (las cantidades se escriben a mano).
 */
export function curvaPack(texto: string): { us: string; porCaja: number }[] | null {
  const m = /\b(\d{1,2}(?:[.,]5)?)\s*\/\s*(\d{1,2}(?:[.,]5)?)\s*\((\d{2,12})\)/.exec(String(texto ?? ''));
  if (!m) return null;
  const a = Number(m[1].replace(',', '.')), b = Number(m[2].replace(',', '.'));
  const digitos = m[3].split('').map(Number);
  if (!(b > a)) return null;
  const enteros: number[] = [];
  if (!Number.isInteger(a)) enteros.push(a);
  for (let x = Math.ceil(a); x <= b; x++) enteros.push(x);
  if (!Number.isInteger(b)) enteros.push(b);
  const medios: number[] = [];
  for (let x = a; x <= b + 1e-9; x += 0.5) medios.push(x);
  const talles = enteros.length === digitos.length ? enteros : medios.length === digitos.length ? medios : null;
  if (!talles) return null;
  return talles.map((t, i) => ({ us: String(t), porCaja: digitos[i] }));
}
