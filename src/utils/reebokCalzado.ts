import { simplificarColores } from './coloresComerciales';
import hombre from './reebokHombre.json';
import mujer from './reebokMujer.json';
import nino from './reebokNino.json';
import ukTabla from './reebokUK.json';
import type { ReebokProducto } from './reebokLogic';

export type SizeConversion = Record<string, { arg: string; us: string | null; eu?: string | null; cm: string }>;
export const REEBOK_TABLAS: Record<string, SizeConversion> = { HOMBRE: hombre, MUJER: mujer, NIÑO: nino };
export const REEBOK_SIN_TABLA = 'TABLA DE TALLE REEBOK SIN IDENTIFICAR';
// Venta sobre el mayorista original, al precio terminado en 999 más cercano.
export function precioReebokCalzado(mayorista: number): number {
  if (!Number.isFinite(mayorista) || mayorista <= 0) throw new Error('Mayorista Reebok inválido.');
  return Math.max(999, Math.round((mayorista * 1.8755 + 1) / 1000) * 1000 - 1);
}
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
const num = (s: string) => String(Number(s.replace(',', '.')));
/** Nombre comercial para nuevas cargas. El SKU y el modelo/color no se alteran. */
export function tituloReebokCalzado(nombre: string): string {
  let texto = nombre.replace(/^Zapatillas\s+Reebok\s+/i, '')
    .replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, '')
    .replace(/\bREEBOK\b/gi, '').trim();
  return simplificarColores(`Zapatillas Reebok ${texto}`).titulo
    .toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function coincideUS(key: string, ar: string, us: string) {
  const dual = us.match(/^M(\d+(?:\.\d+)?)\/W(\d+(?:\.\d+)?)$/);
  const mujer = us.match(/^(\d+(?:\.\d+)?)W$/);
  if (mujer && key !== 'MUJER') return false;
  const valor = mujer ? mujer[1] : dual ? (key === 'HOMBRE' ? dual[1] : key === 'MUJER' ? dual[2] : '') : us;
  return REEBOK_TABLAS[key][ar]?.us === valor;
}

// Compartido con el armado de pedidos: UK solo se convierte con respaldo US.
export function talleArReebok(desc: string, us: string): string {
  const match = desc.match(/(?:\bAR\s*-?\s*|\s-\s|\s)(\d+(?:[.,]\d+)?)\s*$/i);
  const ukFinal = desc.match(/\bUK\s*-?\s*(\d+(?:[.,]\d+)?)\s*$/i);
  const ref = ukFinal ? (ukTabla as Record<string, { arg: string }>)[num(ukFinal[1])] : undefined;
  return ukFinal ? (ref && Object.keys(REEBOK_TABLAS).some(key => coincideUS(key, ref.arg, us)) ? ref.arg : '') : match ? num(match[1]) : '';
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
  const h = rows.findIndex(r => r.some(v => norm(v) === 'MODELO COLOR') && r.some(v => ['MAYORISTA', 'MAYORISTA UNITARIO'].includes(norm(v))));
  if (h < 0) throw new Error('Reebok Calzado: faltan encabezados Modelo color / Mayorista o Mayorista Unitario.');
  const headers = rows[h].map(norm);
  const col = (...names: string[]) => headers.findIndex(v => names.includes(v));
  const skuC = col('SKU', 'NUMERO DE ARTICULO'), modelC = col('MODELO COLOR'), descC = col('DESCRIPCION DEL ARTICULO');
  const inmediato = col('MAYORISTA UNITARIO') >= 0;
  const stockC = inmediato ? col('DISPONIBLE (INMEDIATO)') : col('STOCK X SKU', 'STOCK');
  const costC = inmediato ? col('MAYORISTA UNITARIO') : col('MAYORISTA');
  const eanC = col('EAN'), udmC = col('UDM', 'UNI. MEDIDA', 'UNIDAD DE MEDIDA');
  if ([skuC, modelC, descC, stockC, costC].some(c => c < 0)) throw new Error('Reebok Calzado: faltan columnas de SKU, descripción, stock o costo.');
  const productos: Record<string, ReebokCalzadoProducto> = {}, avisos: string[] = [];
  const evidencias: Record<string, { ar: string; us: string }[]> = {};
  const incompletos = new Set<string>(), vistos = new Set<string>(), eans = new Set<string>();
  const modelosPresentes = new Set<string>(), modelosProtegidos = new Set<string>();
  const identificadoresPresentes = new Set<string>();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i], sku = String(r[skuC] ?? '').trim();
    const codigo = String(r[modelC] ?? '').trim().replace(/-+$/, '');
    // Presencia se registra ANTES de excluir packs o talles sin conversión.
    if (codigo) modelosPresentes.add(codigo);
    if (!sku) {
      if (codigo) { modelosProtegidos.add(codigo); avisos.push(`Fila ${i + 1}: ${codigo} sin SKU; modelo protegido de ceros por ausencia.`); }
      continue;
    }
    identificadoresPresentes.add(sku);
    if (eanC >= 0 && r[eanC]) identificadoresPresentes.add(String(r[eanC]).trim());
    if (/PACK|CURVA/.test(norm(r[udmC]))) {
      if (codigo) modelosProtegidos.add(codigo);
      avisos.push(`Fila ${i + 1}: ${sku} — ${r[udmC]}; pack excluido, no se carga.`);
      continue;
    }
    if (!codigo || !sku.startsWith(codigo + '-')) throw new Error(`Fila ${i + 1}: código y SKU incompatibles (${sku}).`);
    if (vistos.has(sku)) throw new Error(`SKU repetido: ${sku}.`);
    vistos.add(sku);
    const desc = String(r[descC] ?? '').trim();
    const us = sku.slice(codigo.length).replace(/^-+/, '').replace(',', '.').toUpperCase();
    const match = desc.match(/(?:\bAR\s*-?\s*|\s-\s|\s)(\d+(?:[.,]\d+)?)\s*$/i);
    const ukFinal = desc.match(/\bUK\s*-?\s*(\d+(?:[.,]\d+)?)\s*$/i);
    const uk = desc.match(/\bUK\s*-?\s*(\d+(?:[.,]\d+)?)/i);
    const refUK = uk ? (ukTabla as Record<string, { arg: string; cm: string }>)[num(uk[1])] : undefined;
    const ar = talleArReebok(desc, us);
    const individual = /^(?:\d+(?:\.\d+)?[KW]?|M\d+(?:\.\d+)?\/W\d+(?:\.\d+)?)$/.test(us);
    if (!individual || !ar || Number(ar) < 20 || Number(ar) > 55) {
      modelosProtegidos.add(codigo);
      incompletos.add(codigo);
      avisos.push(`Fila ${i + 1}: ${sku} — ${desc}. Pendiente: ${ukFinal ? 'UK sin equivalencia validada con US' : !individual ? 'no es un talle individual de calzado (ropa o curva/pack)' : 'talle AR sin identificar'}; no se carga esta fila.`);
      continue;
    }
    // AR explícito manda; si UK lo contradice, conservar AR pero no certificar el JSON.
    if (uk && (!refUK || refUK.arg !== ar)) incompletos.add(codigo);
    const rawEAN = eanC >= 0 ? r[eanC] : undefined;
    const ean = /^0+$/.test(String(rawEAN ?? '').trim()) ? '' : String(rawEAN ?? '').trim();
    if (ean && (!/^\d{8,14}$/.test(ean) || (typeof rawEAN === 'number' && !Number.isSafeInteger(rawEAN)))) throw new Error(`Fila ${i + 1}: EAN inválido (${ean}); revisar sin redondear ni inventar dígitos.`);
    if (ean && eans.has(ean)) throw new Error(`Fila ${i + 1}: EAN repetido (${ean}); revisar antes de cargar.`);
    if (ean) eans.add(ean);
    const qty = Number(String(r[stockC] ?? '').replace(/^\+\s*(?=\d+$)/, '')), rawCost = Number(r[costC]);
    if (r[stockC] == null || r[stockC] === '' || !Number.isInteger(qty) || qty < 0 || !Number.isFinite(rawCost) || rawCost <= 0) throw new Error(`Fila ${i + 1}: revisar stock o costo de ${sku}.`);
    const costo = Math.round(rawCost * 0.60 * 100) / 100;
    const precio = precioReebokCalzado(rawCost);
    const nombre = `Zapatillas Reebok ${desc.slice(0, ukFinal ? ukFinal.index : match!.index).replace(/\bUK\s*-?\s*\d+(?:[.,]\d+)?K?\s*[-/]?\s*$/i, '').replace(/\bREEBOK\b/gi, '').replace(/[-\s]+$/, '').trim()}`;
    const old = productos[codigo];
    if (old && (old.nombre !== nombre || old.costo !== costo || old.precio !== precio)) throw new Error(`${codigo}: nombres o precios distintos entre talles; revisar el archivo.`);
    const p = productos[codigo] ??= { codigo, nombre, artType: 'zapatillas', costo, precio, sizes: {}, skuPorTalle: {}, skuProveedorPorTalle: {} };
    if (ar in p.sizes) throw new Error(`${codigo}: dos SKU para AR ${ar}; revisar manualmente.`);
    p.sizes[ar] = qty; p.skuPorTalle[ar] = ean || sku;
    p.skuProveedorPorTalle![ar] = sku;
    (evidencias[codigo] ??= []).push({ ar, us });
  }
  for (const [code, p] of Object.entries(productos)) {
    Object.assign(p, tablaReebok(evidencias[code], incompletos.has(code)));
    const revision = simplificarColores(p.nombre);
    if (revision.pendientes.length) avisos.push(`${code}: revisar colores sin equivalencia: ${revision.pendientes.join(', ')}.`);
    p.nombre = tituloReebokCalzado(p.nombre);
  }
  return { productos, avisos, modelosPresentes: [...modelosPresentes], modelosProtegidos: [...modelosProtegidos], identificadoresPresentes: [...identificadoresPresentes] };
}

