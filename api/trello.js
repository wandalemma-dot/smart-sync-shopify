// Trello para el control de facturas: lista las tarjetas del tablero de compras y
// baja sus Excel. Solo sesión humana; solo lectura. No toca Shopify.
import { identity, noStore } from '../server/access.js';
import { bajarAdjunto, listarTarjetas, trelloConfigurado } from '../server/trello.js';

export const maxDuration = 60; // un Excel grande de iD (con fotos) se baja y se aliviana acá

export default async function handler(req, res) {
  noStore(res);
  if (identity(req) !== 'user') return res.status(401).json({ error: 'Iniciá sesión en la app.' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!trelloConfigurado()) return res.status(503).json({ error: 'Faltan TRELLO_KEY y TRELLO_TOKEN en Vercel.', sinTrello: true });
  try {
    const q = req.query || {};
    if (q.accion === 'tarjetas') return res.status(200).json(await listarTarjetas());
    if (q.accion === 'adjunto') return res.status(200).json(await bajarAdjunto(q.tarjeta, q.adjunto));
    return res.status(400).json({ error: 'Acción inválida.' });
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : 502;
    return res.status([400, 403, 404, 413, 503].includes(status) ? status : 502).json({ error: e instanceof Error ? e.message : 'Error con Trello.' });
  }
}
