// Lee la foto del remito (o la planilla de entrega de Family) con IA (11-nov-2026). Solo sesión humana y mismo origen; nunca el bot.
// Necesita ANTHROPIC_API_KEY en Vercel (se paga por uso). No guarda la foto ni toca Shopify.
import { allowedOrigin, identity, noStore } from '../server/access.js';
import { leerRemito } from '../server/remito.js';

export const maxDuration = 120;

export default async function handler(req, res) {
  noStore(res);
  if (identity(req) !== 'user') return res.status(401).json({ error: 'Iniciá sesión en la app.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!allowedOrigin(req)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Se requiere JSON.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'La lectura de fotos no está activada (falta la clave de Anthropic en Vercel). Escribí el remito a mano.', sinClave: true });
  }
  try {
    const tipo = req.body?.tipo === 'entrega' ? 'entrega' : 'remito';
    return res.status(200).json(await leerRemito({ fotos: req.body?.fotos, tipo }));
  } catch (e) {
    if (e && typeof e === 'object' && 'propio' in e) return res.status(400).json({ error: e.message });
    const status = e && typeof e === 'object' && 'status' in e ? e.status : 0;
    if (status === 429) return res.status(429).json({ error: 'Demasiadas lecturas seguidas. Esperá un minuto.' });
    if (status === 401) return res.status(503).json({ error: 'La clave de Anthropic no es válida. Revisala en Vercel.' });
    return res.status(502).json({ error: 'No se pudo leer la foto. Probá de nuevo o escribí el remito a mano.' });
  }
}
