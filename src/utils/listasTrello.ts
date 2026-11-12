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

/** Listas de donde salen las notas: las elegidas o, si no se eligió ninguna, las que dicen «pendiente» en el nombre. */
export function listasDePendientes(listas: ListaTrello[], elegidas: string[] = []): ListaTrello[] {
  if (elegidas.length) return listas.filter((l) => elegidas.includes(l.id));
  // «PENDIEN» cubre también «PENDIENDE» (así está escrita una de las listas).
  return listas.filter((l) => norm(l.nombre).includes('PENDIEN'));
}

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
