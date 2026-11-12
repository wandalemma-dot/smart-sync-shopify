// ============================================================================
// PLANILLAS DE PEDIDO EN VERDE (12-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// El depósito marca en VERDE, en la planilla de la nota de pedido que está en
// Trello, lo que ya entró (y deja sin marcar lo pendiente). La app:
// - lee ese verde como «ya entregado» (celdasVerdes);
// - devuelve la planilla con lo que llegó en cada entrega pintado en verde
//   (marcarPlanilla), para que el empleado la suba a la tarjeta. La app NO
//   escribe en Trello: gax eligió descargar y subir a mano.
// Solo se cambia el color de las celdas elegidas: los valores, fórmulas, fotos y
// el resto del archivo quedan como estaban.
// ============================================================================
import * as XLSX from 'xlsx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** Colores: el verde que usa el depósito (Excel «Verde claro») y amarillo para lo que llegó en parte. */
export const VERDE = 'FF92D050';
export const AMARILLO = 'FFFFFF00';

/** Un color de relleno es verde si el verde manda claramente (92D050, 00B050, C6EFCE, E2EFDA…). */
export function esVerde(rgb: unknown): boolean {
  const m = /^(?:[0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(String(rgb ?? '').trim());
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return g >= 0x80 && g - Math.max(r, b) >= 12;
}

type CeldaConEstilo = XLSX.CellObject & { s?: { patternType?: string; fgColor?: { rgb?: string } } };

/** Celdas con relleno verde de una hoja leída con cellStyles: true. */
export function celdasVerdes(ws: XLSX.WorkSheet | undefined): Set<string> {
  const out = new Set<string>();
  if (!ws) return out;
  for (const [ref, c] of Object.entries(ws)) {
    if (ref.startsWith('!')) continue;
    const s = (c as CeldaConEstilo).s;
    if (s && (s.patternType ?? 'solid') !== 'none' && esVerde(s.fgColor?.rgb)) out.add(ref);
  }
  return out;
}

/** Primera hoja visible (la misma que lee la app). */
export function hojaVisible(wb: XLSX.WorkBook): string {
  return wb.SheetNames.find((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden) || wb.SheetNames[0];
}

export interface CeldaMarca { ref: string; color: 'verde' | 'amarillo' }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ruta dentro del ZIP de la primera hoja visible. */
function rutaHoja(zip: Record<string, Uint8Array>): string {
  const wbXml = strFromU8(zip['xl/workbook.xml'] ?? new Uint8Array());
  const rels = strFromU8(zip['xl/_rels/workbook.xml.rels'] ?? new Uint8Array());
  const hojas = [...wbXml.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*)\/?>/g)].map((m) => m[1]);
  const visible = hojas.find((a) => !/\bstate="(hidden|veryHidden)"/.test(a)) ?? hojas[0];
  const rid = visible && /\br:id="([^"]+)"|\b[\w.-]+:id="([^"]+)"/.exec(visible);
  const id = rid ? rid[1] || rid[2] : '';
  const rel = id ? new RegExp(`<(?:[\\w.-]+:)?Relationship\\b[^>]*\\bId="${esc(id)}"[^>]*>`).exec(rels)?.[0] : '';
  const target = rel ? /\bTarget="([^"]+)"/.exec(rel)?.[1] ?? '' : '';
  if (!target) throw new Error('No encontré la hoja de la planilla.');
  const ruta = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  if (!zip[ruta]) throw new Error('No encontré la hoja de la planilla.');
  return ruta;
}

/**
 * Copia de la planilla con esas celdas pintadas. Antes de pintar se controla que sea la misma
 * planilla: el N° de pedido (si se pasa) y que cada celda de cantidad tenga un número.
 */
export function marcarPlanilla(original: Uint8Array, celdas: CeldaMarca[], opts: { nro?: string; cantidades?: string[] } = {}): Uint8Array {
  if (!celdas.length) throw new Error('No hay nada para marcar.');
  const wb = XLSX.read(original, { type: 'array' });
  const ws = wb.Sheets[hojaVisible(wb)];
  if (opts.nro) {
    const nro = opts.nro.replace(/^0+/, '');
    const arriba = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false }).slice(0, 8).flat().map((x) => String(x ?? '')).join(' ');
    const m = /pedido\s*n[°ºo.]*\s*:?\s*(\d{3,})/i.exec(arriba);
    if (!m || m[1].replace(/^0+/, '') !== nro) throw new Error(`Esta planilla no es la nota N° ${opts.nro}.`);
  }
  for (const ref of opts.cantidades ?? []) {
    const v = ws[ref]?.v;
    if (!(typeof v === 'number' ? v > 0 : Number(String(v ?? '').replace(',', '.')) > 0)) {
      throw new Error(`La planilla cambió: la celda ${ref} ya no tiene la cantidad pedida. Bajá la última de Trello y probá de nuevo.`);
    }
  }

  const zip = unzipSync(original);
  // 1. Estilos: un relleno por color y, por cada estilo de celda usado, una copia con ese relleno.
  let estilos = strFromU8(zip['xl/styles.xml'] ?? new Uint8Array());
  const p = /<([\w.-]+:)?styleSheet\b/.exec(estilos)?.[1] ?? '';
  const reFills = new RegExp(`<${esc(p)}fills\\b([^>]*)>([\\s\\S]*?)</${esc(p)}fills>`);
  const fills = reFills.exec(estilos);
  const reXfs = new RegExp(`<${esc(p)}cellXfs\\b([^>]*)>([\\s\\S]*?)</${esc(p)}cellXfs>`);
  const cellXfs = reXfs.exec(estilos);
  if (!fills || !cellXfs) throw new Error('La planilla no tiene estilos que se puedan editar.');
  const cantFills = [...fills[2].matchAll(new RegExp(`<${esc(p)}fill\\b`, 'g'))].length;
  const xfs = [...cellXfs[2].matchAll(new RegExp(`<${esc(p)}xf\\b[^>]*?(?:/>|>[\\s\\S]*?</${esc(p)}xf>)`, 'g'))].map((m) => m[0]);
  const colores = [...new Set(celdas.map((c) => c.color))];
  const idFill = new Map(colores.map((c, i) => [c, cantFills + i]));
  const nuevosFills = colores.map((c) => `<${p}fill><${p}patternFill patternType="solid"><${p}fgColor rgb="${c === 'verde' ? VERDE : AMARILLO}"/><${p}bgColor indexed="64"/></${p}patternFill></${p}fill>`).join('');
  estilos = estilos.replace(reFills, (_m, attrs: string, cuerpo: string) =>
    `<${p}fills${attrs.replace(/\bcount="\d+"/, `count="${cantFills + colores.length}"`)}>${cuerpo}${nuevosFills}</${p}fills>`);

  // 2. Hoja: a cada celda se le pone su estilo con relleno.
  const ruta = rutaHoja(zip);
  let hoja = strFromU8(zip[ruta]);
  const color = new Map(celdas.map((c) => [c.ref.toUpperCase(), c.color]));
  const nuevosXfs: string[] = [];
  const clon = new Map<string, number>();
  const estiloCon = (s: number, c: CeldaMarca['color']) => {
    const k = `${s}|${c}`;
    if (!clon.has(k)) {
      const base = xfs[s] ?? xfs[0] ?? `<${p}xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`;
      const conFill = /\bfillId="\d+"/.test(base) ? base.replace(/\bfillId="\d+"/, `fillId="${idFill.get(c)}"`) : base.replace(new RegExp(`<${esc(p)}xf\\b`), `<${p}xf fillId="${idFill.get(c)}"`);
      const final = /\bapplyFill="[^"]*"/.test(conFill) ? conFill.replace(/\bapplyFill="[^"]*"/, 'applyFill="1"') : conFill.replace(new RegExp(`<${esc(p)}xf\\b`), `<${p}xf applyFill="1"`);
      clon.set(k, xfs.length + nuevosXfs.length);
      nuevosXfs.push(final);
    }
    return clon.get(k)!;
  };
  const hechas = new Set<string>();
  hoja = hoja.replace(/<((?:[\w.-]+:)?)c\b([^>]*?)(\/?)>/g, (todo, pre: string, attrs: string, cierre: string) => {
    const ref = /\br="([^"]+)"/.exec(attrs)?.[1]?.toUpperCase();
    const c = ref ? color.get(ref) : undefined;
    if (!ref || !c) return todo;
    hechas.add(ref);
    const s = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0);
    const id = estiloCon(s, c);
    const nuevos = /\bs="\d+"/.test(attrs) ? attrs.replace(/\bs="\d+"/, `s="${id}"`) : `${attrs} s="${id}"`;
    return `<${pre}c${nuevos}${cierre}>`;
  });
  const faltan = [...color.keys()].filter((r) => !hechas.has(r));
  if (faltan.length) throw new Error(`La planilla cambió: no encontré las celdas ${faltan.slice(0, 5).join(', ')}. Bajá la última de Trello y probá de nuevo.`);
  estilos = estilos.replace(reXfs, (_m, attrs: string, cuerpo: string) =>
    `<${p}cellXfs${attrs.replace(/\bcount="\d+"/, `count="${xfs.length + nuevosXfs.length}"`)}>${cuerpo}${nuevosXfs.join('')}</${p}cellXfs>`);

  zip['xl/styles.xml'] = strToU8(estilos);
  zip[ruta] = strToU8(hoja);
  return zipSync(zip, { level: 6 });
}
