// Trello para el control de facturas: lista las tarjetas del tablero de compras y baja sus
// Excel. Escribe solo dos cosas (POST, mismo origen): adjuntar la factura o la foto del remito a una
// tarjeta del tablero, y pasar una tarjeta a otra lista del tablero. Solo sesión humana. No toca Shopify.
import { allowedOrigin, identity, noStore } from '../server/access.js';
import { adjuntarArchivo, bajarAdjunto, listarTarjetas, moverTarjeta, trelloConfigurado } from '../server/trello.js';
import { mensajeSeguro } from '../server/secretos.js';

export const maxDuration = 60; // un Excel grande de iD (con fotos) se baja y se aliviana acá

export default async function handler(req, res) {
  noStore(res);
  if (identity(req) !== 'user') return res.status(401).json({ error: 'Iniciá sesión en la app.' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (req.method === 'POST' && !allowedOrigin(req)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (!trelloConfigurado()) return res.status(503).json({ error: 'Faltan TRELLO_KEY y TRELLO_TOKEN en Vercel.', sinTrello: true });
  try {
    if (req.method === 'POST') {
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return res.status(415).json({ error: 'Se requiere JSON.' });
      const b = req.body || {};
      if (b.accion === 'adjuntar') return res.status(200).json(await adjuntarArchivo(b.tarjeta, b.archivo));
      if (b.accion === 'mover') return res.status(200).json(await moverTarjeta(b.tarjeta, b.lista));
      return res.status(400).json({ error: 'Acción inválida.' });
    }
    const q = req.query || {};
    if (q.accion === 'tarjetas') return res.status(200).json(await listarTarjetas());
    if (q.accion === 'adjunto') return res.status(200).json(await bajarAdjunto(q.tarjeta, q.adjunto));
    return res.status(400).json({ error: 'Acción inválida.' });
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : 502;
    return res.status([400, 403, 404, 413, 503].includes(status) ? status : 502).json({ error: mensajeSeguro(e, 'Error con Trello.') });
  }
}
