// ============================================================================
// ETIQUETA «pedido id» AL DESCARGAR EL PEDIDO (18-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// «Cuando descargo el pedido de iD, que en Shopify se les agregue la etiqueta
// pedido id a todas, con la fecha.» Antes se hacía a mano en la lista de órdenes.
//
// - Se etiqueta SOLO la orden cuyos artículos pendientes en iD quedaron TODOS en
//   el Excel, completos: sin destildar, con código y talle en esta plantilla y
//   sin faltante en su renglón. Si algo no se pudo pedir (sin stock, otra marca,
//   otra plantilla, talle dudoso), la orden NO se etiqueta: la etiqueta excluye
//   la orden entera del próximo armado y eso que falta no se volvería a pedir.
// - Etiquetas SEPARADAS (19-nov-2026, gax): «pedido id» (la que ya usa el armado
//   para excluir) y la fecha sola «dd/mm/aaaa» (Argentina). El número de pedido de
//   iD lo da la web de iD después de subir el Excel: se escribe en la app y va como
//   otra etiqueta sola («00002616») a las órdenes que se etiquetaron en esa descarga.
// - Escribe con tagsAdd (agrega, nunca reemplaza ni borra etiquetas).
//   Necesita el permiso write_orders de la app de Shopify.
// ============================================================================
import { shopifyGraphQL } from './shopify';
import { cruzarPedido, type PendienteId, type PlantillaId } from './pedidoId';

export const ETIQUETA_PEDIDO_ID = 'pedido id';

/** Fecha de hoy en Argentina, dd/mm/aaaa. */
export function hoyArgentina(ahora = new Date()): string {
  const d = new Date(ahora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export const etiquetasPedidoId = (fecha: string) => [ETIQUETA_PEDIDO_ID, fecha];

/** Número de pedido de iD tal cual lo da su web (solo dígitos, conserva los ceros). Vacío si no es válido. */
export function numeroPedidoId(texto: string): string {
  const t = String(texto ?? '').trim().replace(/^(n[°º.]?|nro\.?|pedido)\s*/i, '').trim();
  return /^\d{1,12}$/.test(t) ? t : '';
}

export interface OrdenEtiqueta { orden: string; ordenId: string }
export interface OrdenSinEtiqueta { orden: string; motivos: string[] }

/** Qué órdenes se etiquetan al descargar y cuáles no (con el motivo). */
export function ordenesAEtiquetar(lineas: PendienteId[], plantilla: PlantillaId, omitidas: string[] = []): { etiquetar: OrdenEtiqueta[]; noEtiquetar: OrdenSinEtiqueta[] } {
  const total = cruzarPedido(lineas, plantilla, [], 0, omitidas);
  const porCelda = new Map(total.filas.filter(f => f.celda).map(f => [f.celda!, f]));
  const fuera = new Set(omitidas);
  const ordenes = new Map<string, { ordenId: string; motivos: string[] }>();
  for (const l of lineas) {
    let o = ordenes.get(l.orden);
    if (!o) { o = { ordenId: l.ordenId || '', motivos: [] }; ordenes.set(l.orden, o); }
    const art = `${l.titulo}${l.talle ? ` talle ${l.talle}` : ''}`;
    if (fuera.has(l.id)) { o.motivos.push(`${art}: lo destildaste`); continue; }
    const sola = cruzarPedido([l], plantilla).filas[0];
    const fila = sola?.celda ? porCelda.get(sola.celda) : undefined;
    if (!sola?.celda || !fila) { o.motivos.push(`${art}: ${sola?.motivo || 'no está en esta plantilla'}`); continue; }
    if (fila.faltante > 0) o.motivos.push(`${art}: ${fila.motivo || 'no alcanzó el stock de iD'}`);
  }
  const etiquetar: OrdenEtiqueta[] = [];
  const noEtiquetar: OrdenSinEtiqueta[] = [];
  for (const [orden, o] of ordenes) {
    if (!o.ordenId) o.motivos.push('no se sabe el identificador de la orden');
    if (o.motivos.length) noEtiquetar.push({ orden, motivos: o.motivos });
    else etiquetar.push({ orden, ordenId: o.ordenId });
  }
  return { etiquetar, noEtiquetar };
}

export interface ResultadoEtiquetas { ok: string[]; fallidas: { orden: string; error: string }[]; sinPermiso?: boolean }

const TAGS_ADD = `mutation EtiquetaPedidoId($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } } }`;

/** Agrega las etiquetas a cada orden. Una orden que falla no frena las demás. */
export async function etiquetarOrdenes(ordenes: OrdenEtiqueta[], tags: string[]): Promise<ResultadoEtiquetas> {
  const res: ResultadoEtiquetas = { ok: [], fallidas: [] };
  if (!ordenes.length) return res;
  const permisos: any = await shopifyGraphQL(`query PedidoIdPermisoEtiqueta { currentAppInstallation { accessScopes { handle } } }`);
  const scopes = new Set((permisos?.currentAppInstallation?.accessScopes || []).map((s: any) => s.handle));
  if (!scopes.has('write_orders')) return { ...res, sinPermiso: true, fallidas: ordenes.map(o => ({ orden: o.orden, error: 'falta el permiso write_orders' })) };
  if (!tags.length) return res;
  for (const o of ordenes) {
    try {
      const d: any = await shopifyGraphQL(TAGS_ADD, { id: o.ordenId, tags });
      const r = d?.tagsAdd;
      const err = (r?.userErrors || []).map((e: any) => e.message).filter(Boolean).join('; ');
      if (err) res.fallidas.push({ orden: o.orden, error: err });
      else if (r?.node?.id !== o.ordenId) res.fallidas.push({ orden: o.orden, error: 'Shopify no confirmó la etiqueta; revisala a mano' });
      else res.ok.push(o.orden);
    } catch (e) {
      res.fallidas.push({ orden: o.orden, error: (e as Error)?.message?.slice(0, 160) || 'error' });
    }
  }
  return res;
}
