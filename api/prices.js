// Escritura manual exclusiva de precio/costo. Nunca acepta el acceso del bot.
// El costo de una variante con stock en Martínez está protegido. Única excepción (12-nov-2026,
// gax eligió promedio ponderado al cargar una entrega de iD): `ponderado` con el stock y el costo
// que la app leyó; el servidor los vuelve a leer en vivo y solo acepta el promedio exacto.
import { allowedOrigin, identity, noStore } from '../server/access.js';
import { obtenerToken } from '../server/shopify-token.js';

export const maxDuration = 120;
const URL = 'https://indy-com-ar.myshopify.com/admin/api/2026-07/graphql.json';
const LOCATIONS = `query SucursalCostos {
  locations(first: 100) { nodes { id name } pageInfo { hasNextPage } }
}`;
const READ = `query VariantesPrecios($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id product { id } } }
}`;
const READ_COST = `query VariantesCostos($ids: [ID!]!, $locationId: ID!) {
  nodes(ids: $ids) { ... on ProductVariant { id product { id }
    inventoryItem { unitCost { amount } inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } } }
  } }
}`;
const UPDATE = `mutation PreciosManuales($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: false) {
    productVariants { id price inventoryItem { unitCost { amount } } }
    userErrors { field message }
  }
}`;
class PriceError extends Error {}
function object(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key));
}
function gid(value, type) {
  return typeof value === 'string' && new RegExp(`^gid://shopify/${type}/[1-9][0-9]*$`).test(value);
}
function money(value, positive = false) {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/.test(value) &&
    (!positive || Number(value) > 0);
}
function payload(body) {
  if (!object(body, ['productId', 'variants']) || !gid(body.productId, 'Product') ||
    !Array.isArray(body.variants) || !body.variants.length || body.variants.length > 250) {
    throw new PriceError('La selección de precios no es válida. Volvé a analizar.');
  }
  const ids = new Set();
  const variants = body.variants.map(v => {
    if (!object(v, ['id', 'price', 'inventoryItem', 'ponderado']) || !gid(v.id, 'ProductVariant') || ids.has(v.id) ||
      (Object.hasOwn(v, 'ponderado') && (!v.inventoryItem || !ponderadoValido(v.ponderado))) ||
      (!Object.hasOwn(v, 'price') && !Object.hasOwn(v, 'inventoryItem')) ||
      (Object.hasOwn(v, 'price') && !money(v.price)) ||
      (Object.hasOwn(v, 'inventoryItem') && (!object(v.inventoryItem, ['cost']) || !money(v.inventoryItem.cost, true)))) {
      throw new PriceError('Solo se permiten variantes únicas con precio o costo válidos.');
    }
    ids.add(v.id);
    // Construir los campos explícitamente: no reenviar otros atributos de Shopify.
    return { id: v.id, ...(Object.hasOwn(v, 'price') ? { price: v.price } : {}),
      ...(v.inventoryItem ? { inventoryItem: { cost: v.inventoryItem.cost } } : {}) };
  });
  const ponderados = new Map(body.variants.filter(v => v.ponderado).map(v => [v.id, { ...v.ponderado }]));
  return { productId: body.productId, variants, ponderados };
}
const entero = (n, max) => Number.isInteger(n) && n > 0 && n <= max;
function ponderadoValido(p) {
  return object(p, ['stock', 'costoAnterior', 'unidades', 'costoNuevo']) && entero(p.stock, 100000) && entero(p.unidades, 100000) &&
    money(p.costoAnterior, true) && money(p.costoNuevo, true);
}
const centavos = value => Math.round(Number(value) * 100);
/** El costo pedido es el promedio de lo que hay y lo que llega, redondeado a centavos. */
function esPromedio(cost, p) {
  const exacto = (p.stock * centavos(p.costoAnterior) + p.unidades * centavos(p.costoNuevo)) / (p.stock + p.unidades);
  return Math.abs(centavos(cost) - exacto) <= 0.5 + 1e-9;
}
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Se requiere POST.' });
  // Un Bearer válido del bot tampoco puede usar este endpoint, incluso con OIDC.
  if (identity(req) !== 'user') return res.status(401).json({ error: 'Ingresá a la app para actualizar precios manualmente.' });
  if (!allowedOrigin(req)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Se requiere JSON.' });
  }
  let input, ponderados;
  try { ({ ponderados, ...input } = payload(req.body)); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  async function query(document, variables = {}) {
    const token = await obtenerToken();
    const response = await fetch(URL, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: document, variables }), redirect: 'error', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('Shopify API');
    const json = await response.json();
    if (json.errors?.length || !json.data) throw new Error('Shopify response');
    return json.data;
  }
  try {
    const withCost = input.variants.some(v => v.inventoryItem);
    let locationId;
    if (withCost) {
      const { locations } = await query(LOCATIONS);
      const matches = locations?.nodes?.filter(l => normalize(l.name) === 'DEPOSITOMARTINEZ');
      if (locations?.pageInfo?.hasNextPage !== false || matches?.length !== 1 || !gid(matches[0].id, 'Location')) {
        throw new PriceError('No se pudo comprobar la sucursal Martínez. No se modificaron estos precios ni costos.');
      }
      locationId = matches[0].id;
    }
    // Leer en lotes pequeños y validar todo el producto antes de escribir nada.
    for (let offset = 0; offset < input.variants.length; offset += 25) {
      const batch = input.variants.slice(offset, offset + 25);
      const { nodes } = await query(withCost ? READ_COST : READ, {
        ids: batch.map(v => v.id), ...(withCost ? { locationId } : {}) });
      if (!Array.isArray(nodes) || nodes.length !== batch.length || new Set(nodes.map(n => n?.id)).size !== batch.length) {
        throw new PriceError('No se pudieron verificar las variantes. Volvé a analizar.');
      }
      for (const v of batch) {
        const current = nodes.find(n => n?.id === v.id);
        if (current?.product?.id !== input.productId) throw new PriceError('Una variante cambió o ya no pertenece al producto. Volvé a analizar.');
        if (v.inventoryItem) {
          const level = current.inventoryItem?.inventoryLevel;
          const quantity = level?.quantities?.find(q => q.name === 'available')?.quantity;
          if (level !== null && !Number.isInteger(quantity)) throw new PriceError('No se pudo verificar el stock de Martínez. Volvé a analizar.');
          const p = ponderados.get(v.id);
          if (p) {
            // Promedio ponderado: el stock y el costo de Martínez tienen que seguir siendo los que leyó la app.
            const actual = current.inventoryItem?.unitCost?.amount;
            if (quantity !== p.stock || actual == null || centavos(actual) !== centavos(p.costoAnterior) || !esPromedio(v.inventoryItem.cost, p)) {
              throw new PriceError('El stock o el costo de Martínez cambió desde que armaste la carga. No se modificaron estos precios ni costos: armala de nuevo.');
            }
          } else if (quantity > 0) throw new PriceError('Hay stock en Martínez y su costo está protegido. Volvé a analizar para conservarlo.');
        }
      }
    }
    const data = await query(UPDATE, input);
    const result = data?.productVariantsBulkUpdate;
    if (!Array.isArray(result?.userErrors)) throw new Error('Unconfirmed update');
    if (result.userErrors.length) return res.status(200).json({ data });
    const written = result.productVariants;
    if (!Array.isArray(written) || written.length !== input.variants.length || new Set(written.map(v => v.id)).size !== written.length ||
      input.variants.some(v => {
        const actual = written.find(n => n.id === v.id);
        return !actual || (v.price !== undefined && Number(actual.price) !== Number(v.price)) ||
          (v.inventoryItem && (actual.inventoryItem?.unitCost?.amount == null || Number(actual.inventoryItem.unitCost.amount) !== Number(v.inventoryItem.cost)));
      })) throw new Error('Unconfirmed update');
    return res.status(200).json({ data });
  } catch (e) {
    return res.status(e instanceof PriceError ? 409 : 502).json({ error: e instanceof PriceError ? e.message :
      'Shopify no confirmó la actualización. Volvé a analizar antes de reintentar.' });
  }
}
