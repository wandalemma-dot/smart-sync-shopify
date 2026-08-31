// Proxy hacia Shopify.
//
// SEGURIDAD:
// 1) El token de admin YA NO está escrito acá. Se lee de la variable de entorno
//    SHOPIFY_ADMIN_TOKEN (la "caja fuerte" de Vercel).
// 2) La puerta está cerrada: este endpoint SOLO deja pasar lecturas (queries).
//    Cualquier mutación (crear, borrar, cambiar precios/stock) se rechaza.
//    Cuando agreguemos "escribir stock", sumamos esa única operación a
//    ALLOWED_MUTATIONS y nada más.

const ALLOWED_MUTATIONS = [
  'inventorySetQuantities', // escribir stock (cantidades)
  'productSet',                // crear productos nuevos
  'publishablePublish',        // publicar productos en un canal (Point of Sale)
  // Actualiza precio y costo de variantes y, desde el 29-ago-2026, también
  // RENOMBRA el talle de las variantes con el talle corrido (botón aparte, con
  // su confirmación). Renombrar no mueve stock: la mercadería se queda en la
  // misma variante, que pasa a llamarse como corresponde.
  'productVariantsBulkUpdate',
  // Da de alta una variante en una sucursal (y le pone la cantidad). Sin esto,
  // Shopify rechaza escribirle stock: "The specified inventory item is not
  // stocked at the location". Se usa SOLO desde el botón aparte que Wanda
  // confirma a mano; nunca dentro de la escritura normal de stock.
  'inventoryActivate',
  // Crea talles que faltan en un producto que YA existe ("No ubicados"): el
  // proveedor tiene el talle y en Shopify la variante no está. Se usa SOLO
  // desde el botón aparte, con las filas que Wanda dejó tildadas.
  // ⚠ Los productos con el TALLE CORRIDO nunca llegan ahí (se apartan antes),
  // que es lo que evita crear duplicados: el 36 corrido y el 35 nuevo.
  'productVariantsBulkCreate',
];

const SHOP = 'indy-com-ar.myshopify.com';

// ---- TOKEN ----
// Preferimos "client credentials": la app pide el token sola con el Client ID +
// Secret y lo renueva cada 24h. Así los permisos nuevos (ej. read_orders) quedan
// activos sin tener que generar tokens a mano.
// Si no están esas variables, usamos el token fijo de siempre.
let tokenCache = { valor: null, vence: 0 };

async function obtenerToken() {
  const id = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;

  if (id && secret) {
    // Reusamos el token cacheado hasta 5 minutos antes de que venza.
    if (tokenCache.valor && Date.now() < tokenCache.vence - 5 * 60 * 1000) {
      return tokenCache.valor;
    }
    const r = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: id,
        client_secret: secret,
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) {
      throw new Error('No pude obtener el token con Client ID/Secret: ' + JSON.stringify(data).slice(0, 200));
    }
    const duraSeg = Number(data.expires_in) || 24 * 60 * 60;
    tokenCache = { valor: data.access_token, vence: Date.now() + duraSeg * 1000 };
    return tokenCache.valor;
  }

  const fijo = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!fijo) {
    throw new Error('Falta configurar SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (o SHOPIFY_ADMIN_TOKEN) en Vercel.');
  }
  return fijo;
}

function isAllowed(query) {
  if (typeof query !== 'string' || !query.trim()) return false;
  const hasMutation = /\bmutation\b/i.test(query);
  if (!hasMutation) return true; // las lecturas siempre están permitidas
  // Si es una mutación, solo se permite si es una de las de la lista blanca.
  return ALLOWED_MUTATIONS.length > 0 && ALLOWED_MUTATIONS.some((m) => query.includes(m));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let token;
  try {
    token = await obtenerToken();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const { query, variables } = req.body || {};
  if (!isAllowed(query)) {
    return res.status(403).json({ error: 'Operación no permitida por seguridad (solo lectura).' });
  }

  try {
    const response = await fetch(`https://${SHOP}/admin/api/2024-04/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Shopify API Error:', error);
    return res.status(500).json({ error: 'Failed to fetch from Shopify' });
  }
}
