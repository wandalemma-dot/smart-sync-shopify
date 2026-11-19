// Confirmar una escritura de stock releyendo Shopify (18-nov-2026).
//
// Desde el 17/18-nov Shopify a veces responde a inventorySetQuantities sin
// errores pero con inventoryAdjustmentGroup vacío, aunque el cambio SÍ quedó
// hecho (caso real: «Escritos 0 · fallidos 115» y en Shopify estaban los 115).
// Una respuesta incompleta sigue sin contar como éxito por sí sola: se relee el
// disponible de cada artículo y solo cuenta como escrito el que quedó EXACTAMENTE
// en la cantidad pedida. No se reintenta nada.

export type Gql = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

const LEER = `query ConfirmarStock($ids: [ID!]!, $loc: ID!) {
  nodes(ids: $ids) { ... on InventoryItem { id inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { name quantity } } } }
}`;

/** Disponible de cada artículo en la sucursal (null si no se pudo leer o no está dado de alta). */
export async function leerDisponibles(ids: string[], loc: string, gql: Gql): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(ids.map((id) => [id, null]));
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    try {
      const d = (await gql(LEER, { ids: lote, loc })) as { nodes?: ({ id?: string; inventoryLevel?: { quantities?: { name?: string; quantity?: number }[] } | null } | null)[] } | null;
      for (const n of d?.nodes ?? []) {
        const q = n?.inventoryLevel?.quantities?.find((x) => x.name === 'available');
        if (n?.id && out.has(n.id) && Number.isInteger(q?.quantity)) out.set(n.id, q!.quantity!);
      }
    } catch { /* quedan null: no confirmados */ }
  }
  return out;
}

/** Artículos que quedaron exactamente en la cantidad pedida. */
export async function confirmarCantidades(
  esperado: { inventoryItemId: string; quantity: number }[],
  loc: string,
  gql: Gql,
): Promise<Set<string>> {
  const leidos = await leerDisponibles(esperado.map((e) => e.inventoryItemId), loc, gql);
  return new Set(esperado.filter((e) => leidos.get(e.inventoryItemId) === e.quantity).map((e) => e.inventoryItemId));
}
