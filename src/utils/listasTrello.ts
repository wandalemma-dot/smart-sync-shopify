// ============================================================================
// LISTAS DE PEDIDOS PENDIENTES EN TRELLO (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// «Solo tené en cuenta esto»: las listas «PEDIDOS PENDIENTES» y «PENDIENDE DE
// INDUMENTARIA/CALZADO» del tablero COMPRAS Y ENTREGAS. Las demás tarjetas del
// tablero (pedidos ya recibidos, otros temas) no traen notas.
//
// - Las notas se cargan solo de tarjetas que están en esas listas.
// - Una nota ya cargada cuya tarjeta no está en esas listas no se elige sola para
//   una factura nueva. Para no romper las facturas que ya se controlaron con ella,
//   se guarda desde cuándo salió (la primera vez que la app la vio afuera): sigue
//   valiendo para las facturas de hasta esa fecha. Si nunca estuvo en esas listas
//   (las tarjetas viejas que se bajaron todas juntas el 11-nov), no se elige nunca.
//   Tildada a mano en la entrega, se usa igual.
// - Si la tarjeta vuelve a una lista de pendientes, la nota vuelve a contar.
// ============================================================================
import { NUNCA_PENDIENTE, type Pedido } from './controlFacturas';

export interface ListaTrello { id: string; nombre: string }
export interface EstadoTarjeta {
  /** La tarjeta está ahora en una lista de pedidos pendientes. */
  pendiente: boolean;
  /** Alguna vez la app la vio en una lista de pendientes. */
  visto: boolean;
  /** Primera fecha en que la app la vio fuera de esas listas ('' si está adentro). */
  fuera: string;
  /** Nombre de la lista donde está (para mostrarlo). */
  lista: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * Listas de donde salen las notas: las elegidas o, si no se eligió ninguna, las que dicen «pendiente» en el nombre.
 * La lista «RECIBIDO / CONTROL / CARGA» cuenta siempre (14-nov-2026): la app pasa ahí la tarjeta al subir la
 * factura, y la nota sigue abierta hasta que la entrega se termina de cargar.
 */
export function listasDePendientes(listas: ListaTrello[], elegidas: string[] = []): ListaTrello[] {
  const recibido = listaRecibido(listas);
  // «PENDIEN» cubre también «PENDIENDE» (así está escrita una de las listas).
  return listas.filter((l) => (elegidas.length ? elegidas.includes(l.id) : norm(l.nombre).includes('PENDIEN')) || l.id === recibido?.id);
}

/** Una sola lista cuyo nombre cumple la condición (con dos o más no se adivina). */
function unica(listas: ListaTrello[], cumple: (n: string) => boolean): ListaTrello | undefined {
  const xs = listas.filter((l) => cumple(norm(l.nombre)));
  return xs.length === 1 ? xs[0] : undefined;
}
/** «RECIBIDO / CONTROL / CARGA»: la mercadería llegó y se está controlando y cargando. No es «RECIBIDOS» a secas. */
export const listaRecibido = (listas: ListaTrello[]) => unica(listas, (n) => n.includes('RECIBIDO') && (n.includes('CONTROL') || n.includes('CARGA')));
/** «FINALIZADO»: llegó todo y se cargó. */
export const listaFinalizado = (listas: ListaTrello[]) => unica(listas, (n) => n.includes('FINALIZ'));

/** La lista de entregas parciales («PENDIENDE DE INDUMENTARIA/CALZADO»), '' si no hay. */
export function listaDeParciales(listas: ListaTrello[]): string {
  return listaParciales(listas)?.nombre || '';
}
const listaParciales = (listas: ListaTrello[]) => listas.find((x) => { const n = norm(x.nombre); return n.includes('PENDIEN') && (n.includes('INDUMENTARIA') || n.includes('CALZADO')); });

/** Tarjeta de Trello de una nota importada desde ahí ('' si se subió a mano). */
export const tarjetaDeNota = (p?: { origen?: string }) => /^trello:([a-f0-9]{24})$/.exec(p?.origen || '')?.[1] || '';

/**
 * Cambios de estado de las tarjetas con notas, según dónde están ahora.
 * `tarjetas` es la lista completa de tarjetas abiertas del tablero (una tarjeta archivada
 * o borrada no aparece: queda fuera de las listas de pendientes).
 */
export function estadosTarjetas(
  notas: { origen?: string }[],
  tarjetas: { id: string; idLista?: string; lista?: string }[],
  pendientes: Set<string>,
  previos: Record<string, EstadoTarjeta | undefined>,
  hoy: string,
): Record<string, EstadoTarjeta> {
  const porId = new Map(tarjetas.map((t) => [t.id, t]));
  const cambios: Record<string, EstadoTarjeta> = {};
  for (const id of new Set(notas.map(tarjetaDeNota).filter(Boolean))) {
    const t = porId.get(id);
    const pendiente = !!t && !!t.idLista && pendientes.has(t.idLista);
    const prev = previos[id];
    const nuevo: EstadoTarjeta = {
      pendiente,
      visto: pendiente || !!prev?.visto,
      fuera: pendiente ? '' : (prev && !prev.pendiente && prev.fuera) || hoy,
      lista: t ? String(t.lista || '') : 'archivada o borrada',
    };
    if (!prev || prev.pendiente !== nuevo.pendiente || !!prev.visto !== nuevo.visto || (prev.fuera || '') !== nuevo.fuera || (prev.lista || '') !== nuevo.lista) cambios[id] = nuevo;
  }
  return cambios;
}

/** Las notas con cerradaDesde si su tarjeta salió de las listas de pendientes (para el control). */
export function conEstadoTrello<T extends Pedido & { origen?: string }>(pedidos: T[], estados: Record<string, EstadoTarjeta | undefined>, hoy: string): T[] {
  return pedidos.map((p) => {
    const e = estados[tarjetaDeNota(p)];
    if (!e || e.pendiente) return p;
    return { ...p, cerradaDesde: e.visto ? e.fuera || hoy : NUNCA_PENDIENTE };
  });
}

// ============================================================================
// MOVER LAS TARJETAS SOLAS (14-nov-2026, gax: «que haga todo automático, que no haya un botón»)
// ----------------------------------------------------------------------------
// Tres etapas del tablero:
//  1) Pedidos pendientes («PEDIDOS PENDIENTES» o «PENDIENDE DE INDUMENTARIA/CALZADO»).
//  2) «RECIBIDO / CONTROL / CARGA»: al subir la factura de esa nota.
//  3) Al cerrarse la entrega (se terminó de cargar o se dio por cerrada):
//     - llegó todo lo de la tarjeta → «FINALIZADO»;
//     - llegó una parte (por ejemplo, la ropa sí y las zapatillas no) → «PENDIENDE DE INDUMENTARIA/CALZADO».
// Solo se mueven hacia adelante y desde esas listas: una tarjeta que alguien puso en otra lista no se toca.
// ============================================================================
export interface MovimientoTarjeta { tarjeta: string; nombre: string; desde: string; hacia: ListaTrello; motivo: string }
export type TipoConsejo = 'finalizar' | 'parcial' | 'nada';

export function movimientosTarjetas(o: {
  /** Tarjetas de las notas de esta entrega. */
  tarjetasEntrega: string[];
  /** Tarjetas abiertas del tablero, con su lista. */
  tarjetas: { id: string; nombre?: string; idLista?: string; lista?: string }[];
  listas: ListaTrello[];
  /** Listas de pedidos pendientes (las de las notas, sin «RECIBIDO / CONTROL / CARGA»). */
  pendientes: Set<string>;
  /** La entrega ya se cerró (cargada o dada por cerrada). */
  cerrada: boolean;
  /** Cómo quedó cada nota de la tarjeta (todas las notas de esa tarjeta, no solo las de esta entrega). */
  consejos: (tarjeta: string) => TipoConsejo[];
}): { mover: MovimientoTarjeta[]; avisos: string[] } {
  const recibido = listaRecibido(o.listas);
  const final = listaFinalizado(o.listas);
  const parciales = listaParciales(o.listas);
  const porId = new Map(o.tarjetas.map((t) => [t.id, t]));
  const mover: MovimientoTarjeta[] = [];
  const avisos: string[] = [];
  const falta = (que: string) => avisos.push(`Trello: no encontré la lista ${que} en el tablero (o hay más de una con ese nombre); movela a mano.`);
  for (const id of new Set(o.tarjetasEntrega.filter(Boolean))) {
    const t = porId.get(id);
    if (!t?.idLista) continue; // archivada o borrada
    const nombre = t.nombre || id;
    const enPendientes = o.pendientes.has(t.idLista) && t.idLista !== recibido?.id;
    const enRecibido = !!recibido && t.idLista === recibido.id;
    if (!o.cerrada) {
      if (!enPendientes) continue;
      if (!recibido) { falta('«RECIBIDO / CONTROL / CARGA»'); continue; }
      mover.push({ tarjeta: id, nombre, desde: t.lista || '', hacia: recibido, motivo: 'llegó la factura' });
      continue;
    }
    if (!enPendientes && !enRecibido) continue;
    const tipos = o.consejos(id);
    if (!tipos.length || tipos.every((x) => x === 'nada')) continue;
    if (tipos.every((x) => x === 'finalizar')) {
      if (!final) { falta('«FINALIZADO»'); continue; }
      mover.push({ tarjeta: id, nombre, desde: t.lista || '', hacia: final, motivo: 'llegó todo y se cargó' });
    } else {
      if (!parciales) { falta('de pendientes de indumentaria/calzado'); continue; }
      if (t.idLista === parciales.id) continue;
      mover.push({ tarjeta: id, nombre, desde: t.lista || '', hacia: parciales, motivo: 'llegó una parte; falta lo demás' });
    }
  }
  return { mover, avisos };
}
