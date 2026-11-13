// AVISO DE TALLES DISTINTOS AL REMITO (13-nov-2026, gax: «al final del todo que me deje un mail para
// mandar qué es lo que pasó con los talles, en referencia al remito»). Cuando en la carga se escribió
// a mano otra cantidad o se agregó un talle que no figura en el remito (caso real: no llegó un talle
// y vino otro, el US 13), la app arma el texto del mail. No lo envía: lo abre escrito y la persona
// elige a quién mandarlo.
import type { ItemCarga, ResultadoCarga } from './cargaFamily';
import { pesos } from './avisoPrecio';
import { claveCodigo, type RenglonFactura } from './controlFacturas';

export interface DiferenciaTalles {
  codigo: string;
  descripcion: string;
  /** Talle → lo que dice el remito y lo que se cargó. */
  talles: { talle: string; remito: number; llego: number }[];
  /** Precio de lista unitario de la factura menos la bonificación (0 si no se sabe). */
  neto: number;
  /** Se sacó de la carga: no llegó nada. */
  noLlego?: boolean;
  /** iD: viene en packs de estas unidades (las cantidades y el neto ya son por unidad). */
  pack?: number;
}

/**
 * Neto de la factura (lista − bonificación) de cada artículo de la carga, por lo que se cargó: en los packs de iD
 * el precio es del pack entero y lo cargado son unidades, así que va por unidad.
 */
export function netosDeCarga(items: ItemCarga[], renglones: RenglonFactura[]): Record<string, number> {
  return Object.fromEntries(items.map((it) => {
    const ren = renglones.find((x) => claveCodigo(x.codigo) === claveCodigo(it.codigo));
    const pack = it.pack && !it.pack.error ? it.pack.unidades : 1;
    return [it.codigo, ren ? Math.round(((Number(ren.precioUnitario) || 0) / pack) * (1 - (Number(ren.bonificacion) || 0) / 100) * 100) / 100 : 0];
  }));
}

/**
 * Los artículos cargados cuyo talle o cantidad no coincide con el remito, y los que se sacaron de la carga
 * porque no llegaron (13-nov-2026, gax: «que se pueda eliminar… y cómo impacta en el mail»).
 */
export function diferenciasDeTalles(items: ItemCarga[], resultados: ResultadoCarga[], netos: Record<string, number>, quitados: ReadonlySet<string> = new Set()): DiferenciaTalles[] {
  const estado = new Map(resultados.map((r) => [r.codigo, r.estado]));
  const out: DiferenciaTalles[] = [];
  for (const it of items) {
    if (quitados.has(it.codigo)) {
      const talles = (it.talles ?? []).filter((t) => t.original > 0).map((t) => ({ talle: t.talle, remito: t.original, llego: 0 }));
      out.push({ codigo: it.codigo, descripcion: it.descripcion, talles: talles.length ? talles : [{ talle: 'sin talle', remito: it.unidades, llego: 0 }], neto: netos[it.codigo] ?? 0, noLlego: true });
      continue;
    }
    const e = estado.get(it.codigo);
    if (e !== 'cargada' && e !== 'parcial' && e !== 'dudosa') continue;
    const talles = (it.talles ?? []).filter((t) => t.cantidad !== t.original).map((t) => ({ talle: t.talle, remito: t.original, llego: t.cantidad }));
    if (!talles.length) continue;
    const pack = it.pack && !it.pack.error && it.pack.unidades > 1 ? { pack: it.pack.unidades } : {};
    out.push({ codigo: it.codigo, descripcion: it.descripcion, talles, neto: netos[it.codigo] ?? 0, ...pack });
  }
  return out;
}

const pares = (n: number) => `${n} par${n === 1 ? '' : 'es'}`;
const unidades = (n: number) => `${n} unidad${n === 1 ? '' : 'es'}`;

/** Asunto y texto del mail. */
export function textoAvisoTalles(difs: DiferenciaTalles[], ctx: { proveedor: string; factura?: string; remito?: string; fecha?: string }): { asunto: string; cuerpo: string } {
  const doc = [ctx.remito ? `remito ${ctx.remito}` : '', ctx.factura ? `factura ${ctx.factura}` : ''].filter(Boolean).join(', ');
  const asunto = `Diferencia de talles — ${ctx.proveedor}${ctx.remito ? ` remito ${ctx.remito}` : ctx.factura ? ` factura ${ctx.factura}` : ''}`;
  const lineas: string[] = [];
  for (const d of difs) {
    lineas.push(`• ${d.codigo} — ${d.descripcion}`);
    const remito = d.talles.filter((t) => t.remito > 0).map((t) => `${t.talle} ×${t.remito}`);
    const llego = d.talles.filter((t) => t.llego > 0).map((t) => `${t.talle} ×${t.llego}`);
    // Packs (iD): se cuenta en unidades, como se cargó; el remito cuenta packs.
    const enPacks = d.pack ? ` (en unidades: viene en packs de ${d.pack})` : '';
    const cuantas = d.pack ? unidades : pares;
    lineas.push(d.noLlego ? `   Según el remito: ${remito.join(', ') || 'nada'}${enPacks}. No llegó.` : `   Según el remito: ${remito.join(', ') || 'nada'}${enPacks}. Llegó: ${llego.join(', ') || 'nada'}.`);
    const dif = d.talles.reduce((s, t) => s + t.llego - t.remito, 0);
    if (!dif) lineas.push(`   Misma cantidad de ${d.pack ? 'unidades' : 'pares'}: ${d.neto > 0 ? 'mismo modelo y mismo precio, el importe se compensa' : 'el importe se compensa'}.`);
    else {
      const plata = d.neto > 0 ? ` (${pesos(Math.abs(dif) * d.neto)} neto a precio de factura)` : '';
      lineas.push(`   ${dif < 0 ? `${dif === -1 ? 'Falta' : 'Faltan'} ${cuantas(-dif)}` : `${dif === 1 ? 'Llegó' : 'Llegaron'} ${cuantas(dif)} de más`}${plata}.`);
    }
  }
  const cuerpo = [
    'Hola,', '',
    `En la entrega de ${ctx.proveedor}${doc ? ` (${doc})` : ''}${ctx.fecha ? ` que cargamos el ${ctx.fecha}` : ''} hay diferencias con el remito:`, '',
    ...lineas, '',
    'Por favor, tenerlo en cuenta para corregir el remito o la factura.',
    'Gracias.',
  ].join('\n');
  return { asunto, cuerpo };
}
