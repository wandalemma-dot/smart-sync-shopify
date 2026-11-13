// ============================================================================
// DISTRINANDO — UBICAR EL TALLE QUE LLEGÓ EN SHOPIFY (13-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// El remito de Distrinando trae el talle US del proveedor («11», «8.5»). En Shopify los
// talles están en AR, y las etiquetas de tabla de los productos ya cargados NO sirven
// para convertir: hay «REEBOK 2» (vieja), «SIN IDENTIFICAR», y la Club C Cardi dice MUJER
// pero sus talles siguen el AR que informa el proveedor (US 5 = 36.5), no esa tabla (34.5).
// Por eso, en este orden y sin adivinar:
//   1) el SKU del proveedor (código-US, ej. RBK110S236074-11) en una variante: es ese talle;
//   2) el AR que el proveedor informa para ese SKU en la nota de pedido (talleArReebok:
//      «… 43» / «AR 43», o «UK 10» solo si las tablas lo respaldan con el mismo US);
//   3) la tabla de la etiqueta TABLA DE TALLE REEBOK HOMBRE / MUJER / NIÑO del producto.
// Si ninguno da un AR, o el AR no existe, o choca con el SKU de otra variante, no se carga
// ese talle y se dice por qué. Kappa y Crocs: solo por SKU exacto o el AR de la nota.
// ============================================================================
import type { Pedido } from './controlFacturas';
import { REEBOK_TABLAS, talleArReebok } from './reebokCalzado';

export interface VarianteTalle { id: string; talle: string; sku: string }
export type FuenteTalle = 'sku' | 'nota' | 'tabla';
export interface TalleUbicado {
  varianteId: string;
  /** Talle de la variante en Shopify (AR). */
  talle: string;
  fuente: FuenteTalle;
  /** SKU del proveedor de ese talle (código-US). */
  skuProveedor: string;
  /** La variante tiene otro SKU (EAN o vacío): se puede pasar al SKU del proveedor. */
  skuDistinto: boolean;
  avisos: string[];
}
export interface TalleSinUbicar {
  error: string;
  /** El AR se sabe pero el talle no existe en Shopify: se podría crear. */
  falta?: { talle: string; skuProveedor: string };
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
const esNumero = (s: string) => /^\d+(\.\d+)?$/.test(s);
/** «8,5» → «8.5», «10.0» → «10», «8.5k» → «8.5K». */
export function talleUS(t: string): string {
  const s = norm(t).replace(',', '.');
  const m = /^(\d+(?:\.\d+)?)(K?)$/.exec(s);
  return m ? `${Number(m[1])}${m[2]}` : s;
}
const mismoTalle = (a: string, b: string) => {
  const A = norm(a).replace(',', '.'), B = norm(b).replace(',', '.');
  return A === B || (esNumero(A) && esNumero(B) && Number(A) === Number(B));
};
export const skuProveedor = (codigo: string, us: string) => `${norm(codigo)}-${talleUS(us)}`;

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

/** La tabla de la etiqueta del producto (solo las tres con nombre; «REEBOK 2» o «SIN IDENTIFICAR» no sirven). */
export function tablaDeEtiquetas(etiquetas: string[]): { nombre: string; ar: (us: string) => string | null } | null {
  const tabs = etiquetas.map(norm).filter((t) => t.startsWith('TABLA DE TALLE REEBOK '));
  const nombres = [...new Set(tabs.map((t) => t.slice('TABLA DE TALLE REEBOK '.length).replace('NINO', 'NIÑO')))].filter((n) => n in REEBOK_TABLAS);
  if (nombres.length !== 1 || tabs.length !== 1) return null;
  const tabla = REEBOK_TABLAS[nombres[0]];
  return {
    nombre: nombres[0],
    ar: (us) => {
      const u = talleUS(us);
      const ks = Object.keys(tabla).filter((k) => tabla[k].us !== null && talleUS(String(tabla[k].us)) === u);
      return ks.length === 1 ? ks[0] : null;
    },
  };
}

/** SKU con formato del proveedor para ese código: devuelve el talle US que lleva (o null si es EAN u otro). */
function usDelSku(sku: string, codigo: string): string | null {
  const s = norm(sku), c = norm(codigo);
  return s.startsWith(c + '-') ? talleUS(s.slice(c.length + 1)) : null;
}

/**
 * Dónde va en Shopify el talle US que llegó de un código de Distrinando. `reebok` habilita la
 * tabla de la etiqueta como último recurso (Kappa y Crocs no usan tablas de Reebok).
 */
export function ubicarTalleDistrinando(a: {
  codigo: string; talle: string; variantes: VarianteTalle[]; etiquetas: string[]; pedidos: Pedido[]; reebok: boolean;
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
    return { varianteId: v.id, talle: v.talle, fuente: 'sku', skuProveedor: sku, skuDistinto: false, avisos };
  }
  if (nota.contradice) return { error: `las notas de pedido dan dos AR distintos para ${sku} (${nota.contradice.join(' y ')})` };
  let ar = nota.ar;
  let fuente: FuenteTalle = 'nota';
  const tabla = tablaDeEtiquetas(a.etiquetas);
  if (ar && tabla) {
    const segunTabla = tabla.ar(us);
    if (segunTabla && !mismoTalle(segunTabla, ar)) avisos.push(`la etiqueta dice tabla ${tabla.nombre} (US ${us} = ${segunTabla}), pero el proveedor informa AR ${ar}: va al ${ar}`);
  }
  if (!ar && a.reebok && tabla) { ar = tabla.ar(us); fuente = 'tabla'; }
  if (!ar) {
    return { error: `no sé qué AR es el US ${us}: la nota de pedido no lo informa y el producto no tiene una tabla de talle Reebok con nombre (Hombre, Mujer o Niño)` };
  }
  const vs = a.variantes.filter((v) => mismoTalle(v.talle, ar!));
  if (!vs.length) return { error: `no existe el talle ${ar} (US ${us})`, falta: { talle: ar, skuProveedor: sku } };
  if (vs.length > 1) return { error: `hay dos variantes del talle ${ar}` };
  const v = vs[0];
  const otroUs = usDelSku(v.sku, a.codigo);
  if (otroUs && otroUs !== us) return { error: `el talle ${ar} tiene el SKU ${v.sku} (US ${otroUs}), no el US ${us}: revisá ese producto` };
  if (fuente === 'tabla') avisos.push(`US ${us} = AR ${ar} por la tabla ${tabla!.nombre} de la etiqueta (la nota no informa el AR)`);
  return { varianteId: v.id, talle: v.talle, fuente, skuProveedor: sku, skuDistinto: norm(v.sku) !== sku, avisos };
}
