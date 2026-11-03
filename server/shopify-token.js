const SHOP = 'indy-com-ar.myshopify.com';
// ---- TOKEN ----
// Preferimos "client credentials": la app pide el token sola con el Client ID +
// Secret y lo renueva cada 24h. Así los permisos nuevos (ej. read_orders) quedan
// activos sin tener que generar tokens a mano.
// Si no están esas variables, usamos el token fijo de siempre.
let tokenCache = { valor: null, vence: 0 };

export async function obtenerToken() {
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
      throw new Error('No se pudo obtener la credencial de Shopify.');
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

