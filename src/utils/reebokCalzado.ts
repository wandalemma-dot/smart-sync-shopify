import hombre from './reebokHombre.json';
import mujer from './reebokMujer.json';
import nino from './reebokNino.json';
import ukTabla from './reebokUK.json';
import type { ReebokProducto } from './reebokLogic';

export type SizeConversion = Record<string, { arg: string; us: string; cm: string }>;
export const REEBOK_TABLAS: Record<string, SizeConversion> = { HOMBRE: hombre, MUJER: mujer, NIÑO: nino };
export const REEBOK_SIN_TABLA = 'TABLA DE TALLE REEBOK SIN IDENTIFICAR';
// Precios separados por $5.000 y terminados en 990. Margen sobre venta con costo ×1,21.
export function precioReebokCalzado(costo: number): number {
  if (!Number.isFinite(costo) || costo <= 0) throw new Error('Costo Reebok inválido.');
  const centavos = Math.round(costo * 100);
  let precio = Math.max(990, Math.round((costo * 2.5 - 990) / 5000) * 5000 + 990);
  while (precio * 10000 <= centavos * 242) precio += 5000;
  return precio;
}
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const num = (s: string) => String(Number(s.replace(',', '.')));
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
  const h = rows.findIndex(r => r.some(v => norm(v) === 'MODELO COLOR') && r.some(v => norm(v) === 'MAYORISTA CON DESCUENTO'));
  if (h < 0) throw new Error('Reebok Calzado: faltan encabezados Modelo color / Mayorista con descuento.');
  const headers = rows[h].map(norm);
  const col = (...names: string[]) => headers.findIndex(v => names.includes(v));
  const skuC = col('SKU', 'NUMERO DE ARTICULO'), modelC = col('MODELO COLOR'), descC = col('DESCRIPCION DEL ARTICULO');
  const stockC = col('STOCK X SKU', 'STOCK'), costC = col('MAYORISTA CON DESCUENTO');
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
    const costo = Math.round(rawCost * 100) / 100;
    const precio = precioReebokCalzado(costo);
    const nombre = `Zapatillas Reebok ${desc.slice(0, ukFinal ? ukFinal.index : match!.index).replace(/\bUK\s*-?\s*\d+(?:[.,]\d+)?\s*[-/]?\s*$/i, '').replace(/\bREEBOK\b/gi, '').replace(/[-\s]+$/, '').trim()}`;
    const old = productos[codigo];
    if (old && (old.nombre !== nombre || old.costo !== costo || old.precio !== precio)) throw new Error(`${codigo}: nombres o precios distintos entre talles; revisar el archivo.`);
    const p = productos[codigo] ??= { codigo, nombre, artType: 'zapatillas', costo, precio, sizes: {}, skuPorTalle: {} };
    if (ar in p.sizes) throw new Error(`${codigo}: dos SKU para AR ${ar}; revisar manualmente.`);
    p.sizes[ar] = qty; p.skuPorTalle[ar] = sku;
    (evidencias[codigo] ??= []).push({ ar, us });
  }
  for (const [code, p] of Object.entries(productos)) Object.assign(p, tablaReebok(evidencias[code], incompletos.has(code)));
  return { productos, avisos };
}

