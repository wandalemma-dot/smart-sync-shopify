// ============================================================================
// ENTRANTES EN EL ARMADO DE PEDIDO iD (13-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// «Quiero saber lo que ya tengo por entrar de cada par, para no sobrepedir.»
// Al armar el pedido a iD, cada renglón (código + talle del proveedor) muestra
// cuántas unidades ya están pedidas y todavía no llegaron, según las notas de
// pedido de las listas de pendientes de Trello («PEDIDOS PENDIENTES» y
// «PENDIENDE DE INDUMENTARIA/CALZADO»).
//
// - Las notas y lo pendiente salen del mismo cálculo que «Control de entregas»
//   (analizarFacturas): pedido − lo facturado para esa nota − lo pintado en verde.
// - Solo notas de tarjetas que están HOY en esas listas (o subidas a mano). Las
//   notas de tarjetas que salieron de las listas no cuentan.
// - Si una factura cubrió una parte de un modelo sin decir los talles, el
//   pendiente de cada talle no se sabe: se muestra «hasta N, a confirmar».
// - SOLO INFORMA: no cambia «Pedir» ni el Excel. La usuaria decide.
// ============================================================================
import { analizarFacturas, claveCodigo, type Factura, type Pedido, type Remito } from './controlFacturas';
import { conEstadoTrello, type EstadoTarjeta } from './listasTrello';

export interface NotaEntrante { pedidoId: string; nombre: string; fecha: string; cantidad: number | null; hasta: number }
export interface Entrante {
  /** Unidades seguras por entrar. */
  cantidad: number;
  /** Unidades que pueden estar por entrar (talle sin confirmar porque una factura cubrió parte del modelo). */
  aConfirmar: number;
  notas: NotaEntrante[];
}
export interface DatosEntrantes {
  pedidos: (Pedido & { origen?: string })[];
  facturas: Factura[];
  asignaciones: Record<string, string[]>;
  remitos: Record<string, Remito>;
  tarjetasTrello: Record<string, EstadoTarjeta>;
}

/** Talle de la nota y de la plantilla: mayúsculas, sin espacios; los numéricos sin ceros a la izquierda (055 = 55). */
export function claveTalle(t: string): string {
  const s = String(t ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d+$/.test(s)) return String(Number(s));
  return s;
}
const clave = (codigo: string, talle: string) => `${claveCodigo(codigo)}|${claveTalle(talle)}`;

/** Lo que está por entrar de cada código y talle del proveedor, de las notas pendientes de Trello. */
export function entrantesPorTalle(d: DatosEntrantes, hoy: string): Map<string, Entrante> {
  const pedidos = conEstadoTrello(d.pedidos, d.tarjetasTrello, hoy);
  const res = analizarFacturas(pedidos, d.facturas, d.asignaciones, d.remitos);
  const porId = new Map(pedidos.map((p) => [p.id, p]));
  const out = new Map<string, Entrante>();
  for (const x of res.pendientes) {
    const p = porId.get(x.pedidoId);
    if (!p || p.cerradaDesde) continue; // la tarjeta ya no está en las listas de pendientes
    const seguro = x.pendiente ?? 0;
    const dudoso = x.pendiente === null ? x.pedido : 0;
    if (seguro <= 0 && dudoso <= 0) continue;
    const k = clave(x.codigo, x.talle);
    const e = out.get(k) ?? { cantidad: 0, aConfirmar: 0, notas: [] };
    e.cantidad += seguro;
    e.aConfirmar += dudoso;
    e.notas.push({
      pedidoId: p.id, nombre: p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre, fecha: p.fecha,
      cantidad: x.pendiente, hasta: x.pendiente ?? x.pedido,
    });
    out.set(k, e);
  }
  return out;
}

/** Entrantes de un renglón del armado (código + talle del proveedor), null si no hay nada en camino. */
export function entranteDe(m: Map<string, Entrante>, codigo: string, talleProveedor: string): Entrante | null {
  if (!codigo || !talleProveedor) return null;
  return m.get(clave(codigo, talleProveedor)) ?? null;
}

/** Texto corto de la columna: «2», «hasta 3 (a confirmar)», «2 + hasta 1 (a confirmar)». */
export function textoEntrante(e: Entrante | null): string {
  if (!e) return '—';
  if (!e.aConfirmar) return String(e.cantidad);
  if (!e.cantidad) return `hasta ${e.aConfirmar} (a confirmar)`;
  return `${e.cantidad} + hasta ${e.aConfirmar} (a confirmar)`;
}

/**
 * Excel de las tarjetas de pendientes que la app todavía no leyó (ni como nota ni descartado):
 * lo que tengan no se ve en «Entrantes» hasta buscarlas en Control de entregas.
 */
export function excelSinLeer(
  tarjetas: { id: string; nombre: string; idLista?: string; adjuntos: { id: string }[] }[],
  listasPendientes: Set<string>,
  pedidos: (Pedido & { origen?: string })[],
  vistos: Record<string, unknown>,
): { tarjeta: string; excel: number }[] {
  const leidos = new Set<string>();
  for (const p of pedidos) {
    const m = /^T-(.+)$/.exec(p.id);
    if (m) leidos.add(m[1]);
    for (const c of p.copias ?? []) leidos.add(c.adjunto);
  }
  for (const a of Object.keys(vistos || {})) leidos.add(a);
  return tarjetas
    .filter((t) => !!t.idLista && listasPendientes.has(t.idLista))
    .map((t) => ({ tarjeta: t.nombre, excel: t.adjuntos.filter((a) => !leidos.has(a.id)).length }))
    .filter((x) => x.excel > 0);
}

/**
 * Talle de la nota de iD a partir del talle de pedido que muestra Reposición:
 * Converse calzado en US (4.5) → columna 045 (US × 10); Le Coq calzado en EU (40) → 040;
 * letras tal cual. null si no se sabe el talle de iD (no se adivina).
 */
export function talleNotaDe(marca: 'converse' | 'lecoq', tallePedido: string | null): string | null {
  if (!tallePedido) return null;
  const t = tallePedido.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return t;
  const n = Number(t);
  if (marca === 'converse') return String(Math.round(n * 10));
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10));
}
