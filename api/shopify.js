// Proxy autenticado. Fase de revisión: todas las mutaciones están bloqueadas.
import { allowedOrigin, identity, noStore } from '../server/access.js';
import { inspectReadQuery } from '../server/read-policy.js';
const SHOP = 'indy-com-ar.myshopify.com';
const API_VERSION = '2024-04';
const API_VERSION_INFORMES = '2026-07';

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

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const who = identity(req);
  if (!who) return res.status(401).json({ error: 'Autenticación requerida.' });
  if (who === 'user' && !allowedOrigin(req)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Se requiere JSON.' });
  }
  const { query, variables } = req.body || {};
  if (variables != null && (typeof variables !== 'object' || Array.isArray(variables))) return res.status(400).json({ error: 'Variables inválidas.' });
  let policy;
  try { policy = inspectReadQuery(query, who === 'automation'); }
  catch { return res.status(403).json({ error: 'Solo se permite una consulta de lectura autorizada. Escrituras bloqueadas.' }); }
  try {
    const token = await obtenerToken();
    const version = policy.reports ? API_VERSION_INFORMES : API_VERSION;
    const response = await fetch('https://' + SHOP + '/admin/api/' + version + '/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(45000),
      redirect: 'error',
    });
    if (!response.ok) return res.status(502).json({ error: 'Shopify no pudo responder a la consulta.' });
    return res.status(200).json(await response.json());
  } catch {
    return res.status(502).json({ error: 'No se pudo consultar Shopify. Revisá la configuración del servidor.' });
  }
}
