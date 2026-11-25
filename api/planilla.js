// Planilla «CONTROL INGRESO MERCADERIA»: agrega o corrige la fila de una carga (POST, mismo origen) o prueba la
// conexión (GET). Solo sesión humana: el bot no entra. No toca Shopify.
import { allowedOrigin, identity, noStore } from '../server/access.js';
import { anotarFila, corregirFila, planillaConfigurada, probarPlanilla } from '../server/planilla.js';
import { mensajeSeguro } from '../server/secretos.js';

export default async function handler(req, res) {
  noStore(res);
  if (identity(req) !== 'user') return res.status(401).json({ error: 'Iniciá sesión en la app.' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (req.method === 'POST' && !allowedOrigin(req)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (!planillaConfigurada()) return res.status(503).json({ error: 'Falta conectar la planilla: PLANILLA_URL y PLANILLA_SECRETO en Vercel.', sinPlanilla: true });
  try {
    if (req.method === 'POST') {
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return res.status(415).json({ error: 'Se requiere JSON.' });
      const b = req.body || {};
      if (b.accion === 'anotar') return res.status(200).json(await anotarFila(b.fila));
      if (b.accion === 'corregir') return res.status(200).json(await corregirFila(b.fila));
      return res.status(400).json({ error: 'Acción inválida.' });
    }
    if ((req.query || {}).accion === 'probar') return res.status(200).json(await probarPlanilla());
    return res.status(400).json({ error: 'Acción inválida.' });
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : 502;
    return res.status([400, 503].includes(status) ? status : 502).json({ error: mensajeSeguro(e, 'Error con la planilla.') });
  }
}
