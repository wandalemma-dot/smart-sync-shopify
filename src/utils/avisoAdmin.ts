// AVISO DE CARGA A ADMINISTRACIÓN Y COMENTARIO EN TRELLO (16-nov-2026, gax: «que la app cargue la carga
// en Trello y avise a administración; tiene que ser un mail a administración»). Con los mismos datos
// que la planilla «CONTROL INGRESO MERCADERIA»: fecha, proveedor, N° factura, N° remito, monto,
// observaciones y fecha de carga de stock, más lo que se cargó. La app no envía el mail: lo abre
// escrito y la persona lo manda. El destinatario se guarda en la base (cf:config), nunca en el código.
import { pesos } from './avisoPrecio';
import type { ResultadoCarga } from './cargaFamily';
import type { ResultadoFactura } from './controlFacturas';

/** 2026-11-10 → 10/11/26, como la planilla. */
export const fechaCorta = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso || '';
};

/** Proveedor como en la planilla: DISTRINANDO, ID CONVERSE, ID LE COQ (o los dos). */
export function proveedorPlanilla(prov: 'id' | 'distrinando', titulos: string[]): string {
  if (prov === 'distrinando') return 'DISTRINANDO';
  const converse = titulos.some((t) => /converse/i.test(t)), lecoq = titulos.some((t) => /le\s*coq/i.test(t));
  if (converse && lecoq) return 'ID CONVERSE / LE COQ';
  if (lecoq) return 'ID LE COQ';
  return 'ID CONVERSE';
}

/** Observaciones: «ok», «Facturado más caro ($ …)», o lo que hay que reclamar. */
export function observacionesPlanilla(r: ResultadoFactura): string {
  const partes: string[] = [];
  if (r.totalDifPrecio > 0) partes.push(`Facturado más caro (${pesos(r.totalDifPrecio)} de más)`);
  if (r.totalSinPedirNeto > 0) partes.push(`Facturado sin pedir (${pesos(r.totalSinPedirNeto)} neto)`);
  if (!partes.length && r.semaforo === 'reclamar') partes.push(...r.motivos.slice(0, 2));
  return partes.length ? partes.join(' · ') : 'ok';
}

export interface DatosAvisoAdmin {
  prov: 'id' | 'distrinando';
  r: ResultadoFactura;
  resultados: ResultadoCarga[];
  sucursal: string;
  /** Fecha de la carga (AAAA-MM-DD, Argentina). */
  hoy: string;
}

function lineasCarga(resultados: ResultadoCarga[], sucursal: string): { lineas: string[]; sumadas: number; pasadas: number; revisar: string[] } {
  const lineas: string[] = [];
  const revisar: string[] = [];
  let sumadas = 0, pasadas = 0;
  for (const x of resultados) {
    const d = x.detalle;
    const u = (d?.sumados ?? []).reduce((s, t) => s + t.suma, 0);
    const p = (d?.pasadas ?? []).reduce((s, v) => s + v.cantidad, 0);
    sumadas += u; pasadas += p;
    if (u || p) {
      const talles = (d?.sumados ?? []).map((t) => `${t.talle} ${t.suma}`).join(', ');
      lineas.push(`• ${x.codigo}${d?.titulo ? ` ${d.titulo}` : ''}: ${u} u.${talles ? ` (${talles})` : ''}${p ? ` · ${p} u. para ventas de iD pasadas a ${sucursal}` : ''}`);
    }
    if (x.estado !== 'cargada') revisar.push(`• ${x.codigo}: ${(d?.notas.filter(Boolean).join(' ') || x.mensaje).slice(0, 200)}`);
  }
  return { lineas, sumadas, pasadas, revisar };
}

const MAX_CUERPO = 1800;

/** Asunto y texto del mail a administración. */
export function textoAvisoAdmin(o: DatosAvisoAdmin): { asunto: string; cuerpo: string; filas: [string, string][] } {
  const f = o.r.factura;
  const proveedor = proveedorPlanilla(o.prov, o.resultados.map((x) => x.detalle?.titulo ?? ''));
  const filas: [string, string][] = [
    ['FECHA', fechaCorta(f.fecha)],
    ['PROVEEDOR', proveedor],
    ['N° FACTURA', f.numero],
    ['N° REMITO', o.r.remito?.numero || f.remito || '—'],
    ['MONTO', f.total ? pesos(f.total) : '—'],
    ['OBSERVACIONES', observacionesPlanilla(o.r)],
    ['CARGA STOCK', fechaCorta(o.hoy)],
  ];
  const c = lineasCarga(o.resultados, o.sucursal);
  const asunto = `Carga de mercadería — ${proveedor} factura ${f.numero}`;
  const cabeza = ['Hola,', '', 'Se cargó en Shopify la mercadería de esta entrega:', '', ...filas.map(([k, v]) => `${k}: ${v}`), '',
    `Cargado en ${o.sucursal}: ${c.sumadas} u.${c.pasadas ? ` (${c.pasadas} u. para ventas de iD que pasaron a ${o.sucursal})` : ''}.`];
  const pie = c.revisar.length ? ['', 'Para revisar:', ...c.revisar] : [];
  // Los enlaces de mail tienen un largo máximo: el detalle por artículo se corta con aviso.
  const usadas: string[] = [];
  let largo = [...cabeza, ...pie].join('\n').length;
  for (const l of c.lineas) {
    if (largo + l.length + 1 > MAX_CUERPO) break;
    usadas.push(l); largo += l.length + 1;
  }
  if (usadas.length < c.lineas.length) usadas.push(`… y ${c.lineas.length - usadas.length} artículo(s) más.`);
  const cuerpo = [...cabeza, ...(usadas.length ? ['', ...usadas] : []), ...pie].join('\n');
  return { asunto, cuerpo, filas };
}

/** Fila para la planilla «CONTROL INGRESO MERCADERIA» (la agrega el Apps Script de la planilla). */
export interface FilaPlanilla {
  fecha: string; proveedor: string; numero: string; factura: string; remito: string;
  monto: number | null; observaciones: string; ok: boolean; carga: string;
}

/** Como las filas que ya están: «FAC.OK - 0011-…» si está todo bien, «FAC. - …» si hay algo; observaciones «APP - …». */
export function filaPlanilla(o: DatosAvisoAdmin): FilaPlanilla {
  const f = o.r.factura;
  const obs = observacionesPlanilla(o.r);
  const ok = obs === 'ok';
  const remito = o.r.remito?.numero || f.remito || '';
  return {
    fecha: fechaCorta(f.fecha),
    proveedor: proveedorPlanilla(o.prov, o.resultados.map((x) => x.detalle?.titulo ?? '')),
    numero: f.numero,
    factura: `${ok ? 'FAC.OK' : 'FAC.'} - ${f.numero}`,
    remito,
    monto: f.total ? f.total : null,
    observaciones: `APP - ${obs}`.slice(0, 290),
    ok,
    carga: fechaCorta(o.hoy),
  };
}

/** Comentario para la tarjeta de Trello (sin saludo; Trello admite textos largos). */
export function comentarioTrello(o: DatosAvisoAdmin): string {
  const c = lineasCarga(o.resultados, o.sucursal);
  const fil = textoAvisoAdmin(o).filas;
  const lineas = [
    `**Cargado en Shopify el ${fechaCorta(o.hoy)}**: ${c.sumadas} u. en ${o.sucursal}${c.pasadas ? ` (${c.pasadas} u. para ventas de iD pasadas a ${o.sucursal})` : ''}.`,
    fil.filter(([k]) => k !== 'CARGA STOCK').map(([k, v]) => `${k}: ${v}`).join(' · '),
    '', ...c.lineas,
    ...(c.revisar.length ? ['', 'Para revisar:', ...c.revisar] : []),
  ];
  const texto = lineas.join('\n');
  return texto.length > 8000 ? `${texto.slice(0, 7990)}…` : texto;
}
