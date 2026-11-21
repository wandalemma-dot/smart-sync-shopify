// AVISO DE CARGA A ADMINISTRACIÓN Y COMENTARIO EN TRELLO (16-nov-2026, gax: «que la app cargue la carga
// en Trello y avise a administración; tiene que ser un mail a administración»). Con los mismos datos
// que la planilla «CONTROL INGRESO MERCADERIA»: fecha, proveedor, N° factura, N° remito, monto,
// observaciones y fecha de carga de stock, más lo que se cargó. La app no envía el mail: lo abre
// escrito y la persona lo manda. El destinatario se guarda en la base (cf:config), nunca en el código.
import { pesos } from './avisoPrecio';
import type { ResultadoCarga } from './cargaFamily';
import { diferenciasInformativas, motivoInformativo, type ResultadoFactura } from './controlFacturas';

/** 2026-11-10 → 10/11/26, como la planilla. */
export const fechaCorta = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso || '';
};

/** Día en Argentina (UTC−3) de un momento ISO: 2026-11-19T02:00:00Z → 2026-11-18. */
export const diaArgentina = (iso?: string): string => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t - 3 * 3600_000).toISOString().slice(0, 10) : '';
};

/**
 * Día que entró la mercadería (21-nov-2026, gax: «la primera fecha tiene que ser la fecha de entrega, la última la
 * fecha en la que lo estás haciendo»; la factura puede ser de días antes). Orden: el escrito a mano; si no, el
 * primer día en que se subió la factura o el remito a la app; si no hay registro (entregas viejas), el de la
 * última vez que se guardó el remito; y recién al final la fecha impresa del papel.
 */
export function fechaIngreso(doc: { ingreso?: string; subida?: string; fecha: string }, remito?: { subida?: string; actualizado?: string } | null):
  { fecha: string; origen: 'escrita' | 'subida' | 'papel' } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(doc.ingreso || '')) return { fecha: doc.ingreso!, origen: 'escrita' };
  const subidas = [doc.subida, remito?.subida].map(diaArgentina).filter(Boolean).sort();
  if (subidas.length) return { fecha: subidas[0], origen: 'subida' };
  const vieja = diaArgentina(remito?.actualizado);
  if (vieja) return { fecha: vieja, origen: 'subida' };
  return { fecha: doc.fecha, origen: 'papel' };
}

/** Proveedor como en la planilla: DISTRINANDO, ID CONVERSE, ID LE COQ (o los dos). */
export function proveedorPlanilla(prov: 'id' | 'distrinando' | 'target', titulos: string[], emisor?: string): string {
  if (prov === 'distrinando') return 'DISTRINANDO';
  // Target factura con cuatro empresas del grupo (19-nov-2026): se aclara cuál, salvo la propia Target.
  if (prov === 'target') return emisor && emisor.toUpperCase() !== 'TARGET' ? `TARGET (${emisor.toUpperCase()})` : 'TARGET';
  const converse = titulos.some((t) => /converse/i.test(t)), lecoq = titulos.some((t) => /le\s*coq/i.test(t));
  if (converse && lecoq) return 'ID CONVERSE / LE COQ';
  if (lecoq) return 'ID LE COQ';
  return 'ID CONVERSE';
}

/** Observaciones: «ok», «Facturado más caro ($ …)», o la diferencia encontrada (solo informa). */
export function observacionesPlanilla(r: ResultadoFactura): string {
  const partes: string[] = [];
  if (r.totalDifPrecio > 0) partes.push(`Facturado más caro (${pesos(r.totalDifPrecio)} de más)`);
  if (r.totalSinPedirNeto > 0) partes.push(`Facturado sin pedir (${pesos(r.totalSinPedirNeto)} neto)`);
  if (!partes.length && r.semaforo === 'reclamar') partes.push(...r.motivos.slice(0, 2).map(motivoInformativo));
  return partes.length ? partes.join(' · ') : 'ok';
}

export interface DatosAvisoAdmin {
  prov: 'id' | 'distrinando' | 'target';
  r: ResultadoFactura;
  resultados: ResultadoCarga[];
  sucursal: string;
  /** Fecha de la carga (AAAA-MM-DD, Argentina). */
  hoy: string;
  /** Día que entró la mercadería (AAAA-MM-DD); sin dato, la fecha de la factura. */
  ingreso?: string;
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
  const proveedor = proveedorPlanilla(o.prov, o.resultados.map((x) => x.detalle?.titulo ?? ''), o.r.factura.emisor);
  const filas: [string, string][] = [
    ['FECHA', fechaCorta(o.ingreso || f.fecha)],
    ['PROVEEDOR', proveedor],
    ['N° FACTURA', f.numero],
    ['N° REMITO', o.r.remito?.numero || f.remito || '—'],
    ['MONTO', f.total ? pesos(f.total) : '—'],
    ['OBSERVACIONES', observacionesPlanilla(o.r)],
    ['CARGA STOCK', fechaCorta(o.hoy)],
  ];
  const c = lineasCarga(o.resultados, o.sucursal);
  // Como el mail que mandaba el depósito («Fac. OK ID»), pero escrito: solo informa (gax, 16-nov-2026).
  // Las dos fechas (21-nov-2026, gax): el día que entró la mercadería y el día que se cargó en stock.
  const ok = observacionesPlanilla(o.r) === 'ok';
  const corto = o.prov === 'distrinando' ? 'Distrinando' : o.prov === 'target' ? 'Target' : 'ID';
  const asunto = `Fac. ${ok ? 'OK ' : ''}${corto} - ${f.numero}${ok ? '' : ' (con diferencias)'}`;
  const remito = o.r.remito?.numero || f.remito;
  const datos = [`de ${proveedor}`, `del ${fechaCorta(f.fecha)}`, f.total ? `por ${pesos(f.total)}` : '', remito ? `(remito ${remito})` : ''].filter(Boolean).join(' ');
  const entro = o.ingreso || '';
  const cuando = !entro ? [] : [entro === o.hoy ? `Entró hoy, ${fechaCorta(entro)}, y se cargó en stock en el día.`
    : `Entró el ${fechaCorta(entro)} y se cargó en stock el ${fechaCorta(o.hoy)}.`];
  const cargado = `Se cargaron ${c.sumadas} u. en ${o.sucursal}${c.pasadas ? `, ${c.pasadas} de ellas para ventas de iD que pasaron a ${o.sucursal}` : ''}.`;
  const cabeza = ['Hola,', '',
    `Les informo que llegó y se cargó en stock la mercadería de la factura ${f.numero} ${datos}.`, ...cuando, '',
    ...(ok ? ['La factura coincide con la nota de pedido: OK.']
      : ['La factura no coincide con la nota de pedido. Esto es lo que se encontró:', ...diferenciasInformativas(o.r.motivos)]),
    '', cargado];
  const pie = c.revisar.length ? ['', 'Para revisar:', ...c.revisar] : [];
  // Los enlaces de mail tienen un largo máximo: el detalle por artículo se corta con aviso.
  const usadas: string[] = [];
  let largo = [...cabeza, ...pie].join('\n').length;
  for (const l of c.lineas) {
    if (largo + l.length + 1 > MAX_CUERPO) break;
    usadas.push(l); largo += l.length + 1;
  }
  if (usadas.length < c.lineas.length) usadas.push(`… y ${c.lineas.length - usadas.length} artículo(s) más.`);
  const cuerpo = [...cabeza, ...(usadas.length ? ['', 'Detalle:', ...usadas] : []), ...pie, '', 'Saludos.'].join('\n');
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
    fecha: fechaCorta(o.ingreso || f.fecha),
    proveedor: proveedorPlanilla(o.prov, o.resultados.map((x) => x.detalle?.titulo ?? ''), o.r.factura.emisor),
    numero: f.numero,
    factura: `${ok ? 'FAC.OK' : 'FAC.'} - ${f.numero}`,
    remito,
    monto: f.total ? f.total : null,
    observaciones: `APP - ${obs}`.slice(0, 290),
    ok,
    carga: fechaCorta(o.hoy),
  };
}

/**
 * Fila de una carga de Family (16-nov-2026, gax, con captura de la planilla): Family no factura, así que va
 * como las que se anotaban a mano: FECHA del día que entró (21-nov-2026; antes, la de la planilla de entrega), «Familyarg», sin N° de factura ni monto,
 * el N° de remito y CARGA STOCK hoy. Solo se carga si la planilla coincide con el remito: «APP - ok».
 */
export function filaPlanillaFamily(o: { fecha: string; remito: string; hoy: string; proveedor?: string; factura?: string; monto?: number | null }): FilaPlanilla {
  const remito = o.remito.trim();
  // Ullua (19-nov-2026): a veces trae factura en lugar del remito; va con su número y su total.
  const factura = (o.factura ?? '').trim();
  return {
    fecha: fechaCorta(o.fecha), proveedor: o.proveedor ?? 'Familyarg', numero: factura || remito, factura: factura ? `FAC.OK - ${factura}` : '', remito,
    monto: o.monto && o.monto > 0 ? o.monto : null, observaciones: 'APP - ok', ok: true, carga: fechaCorta(o.hoy),
  };
}

/** Comentario para la tarjeta de Trello (sin saludo; Trello admite textos largos). */
export function comentarioTrello(o: DatosAvisoAdmin): string {
  const c = lineasCarga(o.resultados, o.sucursal);
  const fil = textoAvisoAdmin(o).filas;
  const lineas = [
    `**Cargado en Shopify el ${fechaCorta(o.hoy)}**: ${c.sumadas} u. en ${o.sucursal}${c.pasadas ? ` (${c.pasadas} u. para ventas de iD pasadas a ${o.sucursal})` : ''}.`,
    fil.filter(([k]) => k !== 'CARGA STOCK').map(([k, v]) => `${k === 'FECHA' ? 'ENTRÓ' : k}: ${v}`).join(' · '),
    '', ...c.lineas,
    ...(c.revisar.length ? ['', 'Para revisar:', ...c.revisar] : []),
  ];
  const texto = lineas.join('\n');
  return texto.length > 8000 ? `${texto.slice(0, 7990)}…` : texto;
}
