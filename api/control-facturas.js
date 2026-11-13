// Control de facturas contra pedidos. Solo sesión humana y mismo origen; nunca el bot.
// Guarda en la base de Vercel (Upstash Redis). No toca Shopify.
import { allowedOrigin, esPersona, identity, noStore } from '../server/access.js';
import { kv, kvConfigurado } from '../server/kv.js';
import { mensajeSeguro } from '../server/secretos.js';
import { aplicar, leerEnlaces, leerRegistro, leerTodo, PROVEEDORES } from '../server/control-facturas.js';

export default async function handler(req, res) {
  noStore(res);
  if (!esPersona(identity(req))) return res.status(401).json({ error: 'Iniciá sesión en la app.' });
  if (req.method !== 'GET' && !allowedOrigin(req)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (!kvConfigurado()) return res.status(503).json({ error: 'Falta conectar la base de datos (Upstash Redis) al proyecto en Vercel.', sinBase: true });
  try {
    if (req.method === 'GET') {
      // Registro de cargas en Shopify: de todos los proveedores juntos.
      if (req.query?.registro === '1') return res.status(200).json(await leerRegistro(kv));
      // Enlaces rápidos a planillas propias (botón arriba a la derecha).
      if (req.query?.enlaces === '1') return res.status(200).json(await leerEnlaces(kv));
      const prov = String(req.query?.proveedor || '');
      if (!PROVEEDORES.includes(prov)) return res.status(400).json({ error: 'Proveedor inválido.' });
      return res.status(200).json(await leerTodo(kv, prov));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ error: 'Se requiere JSON.' });
    }
    return res.status(200).json(await aplicar(kv, req.body));
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? e.status : 400;
    return res.status(status === 503 || status === 502 ? status : 400).json({ error: mensajeSeguro(e, 'Error.') });
  }
}
