// Asistente de IA. Solo sesión humana y mismo origen; nunca el bot.
// Necesita ANTHROPIC_API_KEY en Vercel. Modelo: ANTHROPIC_MODEL (opcional).
import { allowedOrigin, identity, noStore } from '../server/access.js';
import { conversar, marcasDisponibles } from '../server/asistente.js';

export const maxDuration = 300;

export default async function handler(req, res) {
  noStore(res);
  if (identity(req) !== 'user') return res.status(401).json({ error: 'Iniciá sesión en la app.' });
  if (!allowedOrigin(req) && req.method !== 'GET') return res.status(403).json({ error: 'Origen no permitido.' });
  if (req.method === 'GET') {
    return res.status(200).json({ configurado: Boolean(process.env.ANTHROPIC_API_KEY), marcas: marcasDisponibles() });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Se requiere JSON.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Falta la clave ANTHROPIC_API_KEY en Vercel. Cargala y actualizá el despliegue.' });
  }
  const { marca, turnos } = req.body || {};
  try {
    const r = await conversar({ marca, turnos });
    return res.status(200).json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    // Errores de validación propios: se muestran tal cual. Los de la API, genéricos.
    if (/inválid|Marca no habilitada|demasiado larga/.test(msg)) return res.status(400).json({ error: msg });
    const status = e && typeof e === 'object' && 'status' in e ? e.status : 0;
    if (status === 429) return res.status(429).json({ error: 'Demasiadas consultas seguidas. Esperá un minuto.' });
    if (status === 401) return res.status(503).json({ error: 'La clave de Anthropic no es válida. Revisala en Vercel.' });
    return res.status(502).json({ error: 'El asistente no pudo responder. Probá de nuevo.' });
  }
}
