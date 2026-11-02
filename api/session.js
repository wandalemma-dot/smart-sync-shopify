import { allowedOrigin, identity, makeSession, noStore, sameSecret, sessionCookie, validSecret } from '../server/access.js';

export default function handler(req, res) {
  noStore(res);
  if (req.method === 'GET') return res.status(200).json({ authenticated: identity(req) === 'user', readOnly: true });
  if (!['POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method Not Allowed' });
  if (!allowedOrigin(req)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', sessionCookie('', true));
    return res.status(200).json({ authenticated: false });
  }
  if (!validSecret(process.env.APP_ACCESS_KEY)) {
    const missing = !process.env.APP_ACCESS_KEY;
    return res.status(503).json({
      code: missing ? 'APP_ACCESS_KEY_MISSING' : 'APP_ACCESS_KEY_TOO_SHORT',
      error: missing
        ? 'El servidor no recibe la clave de acceso. Guardala en Vercel para Production y actualizá el despliegue.'
        : 'La clave guardada en Vercel tiene menos de 32 caracteres. Guardá una clave más larga y actualizá el despliegue.',
    });
  }
  if (!sameSecret(req.body?.key, process.env.APP_ACCESS_KEY)) return res.status(401).json({ error: 'Clave de acceso incorrecta.' });
  res.setHeader('Set-Cookie', sessionCookie(makeSession()));
  return res.status(200).json({ authenticated: true, readOnly: true });
}
