import hombre from './reebokHombre.json';
import mujer from './reebokMujer.json';
import nino from './reebokNino.json';
import ukTabla from './reebokUK.json';
import type { ReebokProducto } from './reebokLogic';

export type SizeConversion = Record<string, { arg: string; us: string; cm: string }>;
export const REEBOK_TABLAS: Record<string, SizeConversion> = { HOMBRE: hombre, MUJER: mujer, NIÑO: nino };
export const REEBOK_SIN_TABLA = 'TABLA DE TALLE REEBOK SIN IDENTIFICAR';
// Venta sobre el mayorista original, al precio terminado en 999 más cercano.
export function precioReebokCalzado(mayorista: number): number {
  if (!Number.isFinite(mayorista) || mayorista <= 0) throw new Error('Mayorista Reebok inválido.');
  return Math.max(999, Math.round((mayorista * 1.8755 + 1) / 1000) * 1000 - 1);
}
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const num = (s: string) => String(Number(s.replace(',', '.')));
/** Nombre comercial para nuevas cargas. El SKU y el modelo/color no se alteran. */
export function tituloReebokCalzado(nombre: string): string {
  let texto = nombre.replace(/^Zapatillas\s+Reebok\s+/i, '')
    .replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, '')
    .replace(/\bREEBOK\b/gi, '').trim();
  const colores: Record<string, string> = {
    WHITE: 'Blanco', FTWWHT: 'Blanco', 'FTWR WHITE': 'Blanco', 'CLASSIC WHITE': 'Blanco',
    BLACK: 'Negro', CBLACK: 'Negro', 'CORE BLACK': 'Negro', 'NIGHT BLACK': 'Negro',
    CHALK: 'Tiza', GREY: 'Gris', GRAY: 'Gris', PUGRY3: 'Gris', 'PURE GREY': 'Gris',
    'VECTOR NAVY': 'Azul Marino', VECNAV: 'Azul Marino', NAVY: 'Azul Marino',
    BLUE: 'Azul', 'VECTOR BLUE': 'Azul', GREEN: 'Verde', 'DARK GREEN': 'Verde',
    RED: 'Rojo', VECRED: 'Rojo', 'VECTOR RED': 'Rojo', PINK: 'Rosa',
    PURPLE: 'Violeta', BEIGE: 'Beige', YELLOW: 'Amarillo', ORANGE: 'Naranja',
  };
  // Formato con separadores: MODELO - COLOR PRINCIPAL/DETALLES.
  const partes = texto.split(/\s+-\s+/);
  let color = '';
  if (partes.length > 1) {
    color = partes.pop()!.split('/')[0].trim();
    texto = partes.join(' ');
  } else {
    // Formato sin guiones: detectar el comienzo del bloque de colores conocido.
    const keys = Object.keys(colores).sort((a,b) => b.length - a.length);
    const match = texto.match(new RegExp(`\\s+(${keys.join('|')})(?=\\s|/|$)`, 'i'));
    if (match) { color = texto.slice(match.index! + 1).split('/')[0].trim(); texto = texto.slice(0, match.index); }
  }
  const baseColor = color.toUpperCase().replace(/\s+\d+$/, '');
  color = colores[baseColor] || color;
  return `Zapatillas Reebok ${texto} ${color}`.replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function coincideUS(key: string, ar: string, us: string) {
  const dual = us.match(/^M(\d+(?:\.\d+)?)\/W(\d+(?:\.\d+)?)$/);
  const mujer = us.match(/^(\d+(?:\.\d+)?)W$/);
  if (mujer && key !== 'MUJER') return false;
  const valor = mujer ? mujer[1] : dual ? (key === 'HOMBRE' ? dual[1] : key === 'MUJER' ? dual[2] : '') : us;
  return REEBOK_TABLAS[key][ar]?.us === valor;
}

export function tablaReebok(pares: { ar: string; us: string }[], incompleto = false) {
  const candidatas = incompleto || !pares.length ? [] : Object.keys(REEBOK_TABLAS).filter(key =>
    pares.every(({ ar, us }) => coincideUS(key, ar, us)));
  const key = candidatas.length === 1 ? candidatas[0] : null;
  return { tablaTalle: key ? `TABLA DE TALLE REEBOK ${key}` : REEBOK_SIN_TABLA,
    sizeConversion: key ? REEBOK_TABLAS[key] : undefined };
}

export interface ReebokCalzadoProducto extends ReebokProducto {
  tablaTalle?: string;
  sizeConversion?: SizeConversion;
}

// Ambos formatos se leen por encabezado. Género comercial no determina la curva US.
export function parseReebokCalzado(rows: unknown[][]) {
  const h = rows.findIndex(r => r.some(v => norm(v) === 'MODELO COLOR') && r.some(v => norm(v) === 'MAYORISTA'));
  if (h < 0) throw new Error('Reebok Calzado: faltan encabezados Modelo color / Mayorista.');
  const headers = rows[h].map(norm);
  const col = (...names: string[]) => headers.findIndex(v => names.includes(v));
  const skuC = col('SKU', 'NUMERO DE ARTICULO'), modelC = col('MODELO COLOR'), descC = col('DESCRIPCION DEL ARTICULO');
  const stockC = col('STOCK X SKU', 'STOCK'), costC = col('MAYORISTA');
  if ([skuC, modelC, descC, stockC, costC].some(c => c < 0)) throw new Error('Reebok Calzado: faltan columnas de SKU, descripción, stock o costo.');
  const productos: Record<string, ReebokCalzadoProducto> = {}, avisos: string[] = [];
  const evidencias: Record<string, { ar: string; us: string }[]> = {};
  const incompletos = new Set<string>(), vistos = new Set<string>();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i], sku = String(r[skuC] ?? '').trim();
    if (!sku) continue;
    const codigo = String(r[modelC] ?? '').trim().replace(/-+$/, '');
    if (!codigo || !sku.startsWith(codigo + '-')) throw new Error(`Fila ${i + 1}: código y SKU incompatibles (${sku}).`);
    if (vistos.has(sku)) throw new Error(`SKU repetido: ${sku}.`);
    vistos.add(sku);
    const desc = String(r[descC] ?? '').trim();
    const us = sku.slice(codigo.length).replace(/^-+/, '').replace(',', '.').toUpperCase();
    const match = desc.match(/(?:\bAR\s*-?\s*|\s-\s|\s)(\d+(?:[.,]\d+)?)\s*$/i);
    const ukFinal = desc.match(/\bUK\s*-?\s*(\d+(?:[.,]\d+)?)\s*$/i);
    const uk = desc.match(/\bUK\s*-?\s*(\d+(?:[.,]\d+)?)/i);
    const refUK = uk ? (ukTabla as Record<string, { arg: string; cm: string }>)[num(uk[1])] : undefined;
    let ar = match ? num(match[1]) : '';
    if (ukFinal) ar = refUK && Object.keys(REEBOK_TABLAS).some(key => coincideUS(key, refUK.arg, us)) ? refUK.arg : '';
    const individual = /^(?:\d+(?:\.\d+)?[KW]?|M\d+(?:\.\d+)?\/W\d+(?:\.\d+)?)$/.test(us);
    if (!individual || !ar || Number(ar) < 20 || Number(ar) > 55) {
      incompletos.add(codigo);
      avisos.push(`Fila ${i + 1}: ${sku} — ${desc}. Pendiente: ${ukFinal ? 'UK sin equivalencia validada con US' : !individual ? 'no es un talle individual de calzado (ropa o curva/pack)' : 'talle AR sin identificar'}; no se carga esta fila.`);
      continue;
    }
    // AR explícito manda; si UK lo contradice, conservar AR pero no certificar el JSON.
    if (uk && (!refUK || refUK.arg !== ar)) incompletos.add(codigo);
    const qty = Number(r[stockC]), rawCost = Number(r[costC]);
    if (r[stockC] == null || r[stockC] === '' || !Number.isInteger(qty) || qty < 0 || !Number.isFinite(rawCost) || rawCost <= 0) throw new Error(`Fila ${i + 1}: revisar stock o costo de ${sku}.`);
    const costo = Math.round(rawCost * 0.60 * 100) / 100;
    const precio = precioReebokCalzado(rawCost);
    const nombre = `Zapatillas Reebok ${desc.slice(0, ukFinal ? ukFinal.index : match!.index).replace(/\bUK\s*-?\s*\d+(?:[.,]\d+)?\s*[-/]?\s*$/i, '').replace(/\bREEBOK\b/gi, '').replace(/[-\s]+$/, '').trim()}`;
    const old = productos[codigo];
    if (old && (old.nombre !== nombre || old.costo !== costo || old.precio !== precio)) throw new Error(`${codigo}: nombres o precios distintos entre talles; revisar el archivo.`);
    const p = productos[codigo] ??= { codigo, nombre, artType: 'zapatillas', costo, precio, sizes: {}, skuPorTalle: {} };
    if (ar in p.sizes) throw new Error(`${codigo}: dos SKU para AR ${ar}; revisar manualmente.`);
    p.sizes[ar] = qty; p.skuPorTalle[ar] = sku;
    (evidencias[codigo] ??= []).push({ ar, us });
  }
  for (const [code, p] of Object.entries(productos)) {
    Object.assign(p, tablaReebok(evidencias[code], incompletos.has(code)));
    p.nombre = tituloReebokCalzado(p.nombre);
  }
  return { productos, avisos };
}

