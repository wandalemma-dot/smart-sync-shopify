import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = '__Host-stock_session';
const TTL = 8 * 60 * 60;
export function validSecret(value) {
  return typeof value === 'string' && value.length >= 32;
}
export function sameSecret(a, b) {
  if (typeof a !== 'string' || !validSecret(b)) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
// Clave del depósito (13-nov-2026, pedido de gax): una segunda clave, aparte de la de Wanda/gax,
// que solo abre «Carga y control de entregas» (ver ROLES_DEPOSITO en los handlers). Su sesión se
// firma con SU clave: si se cambia o se borra APP_ACCESS_KEY_DEPOSITO en Vercel, el depósito queda
// afuera sin tocar la clave principal. Si fuera igual a la principal, no cuenta (manda la principal).
function claveDeRol(rol) {
  if (rol === 'deposito') {
    const k = process.env.APP_ACCESS_KEY_DEPOSITO;
    return validSecret(k) && k !== process.env.APP_ACCESS_KEY ? k : null;
  }
  return validSecret(process.env.APP_ACCESS_KEY) ? process.env.APP_ACCESS_KEY : null;
}
function signature(payload, clave) {
  return createHmac('sha256', clave).update(payload).digest('base64url');
}
export function makeSession(now = Date.now(), rol = 'user') {
  const clave = claveDeRol(rol);
  if (!clave) throw new Error('Clave no configurada');
  const datos = { exp: Math.floor(now / 1000) + TTL, ...(rol === 'deposito' ? { rol } : {}) };
  const payload = Buffer.from(JSON.stringify(datos)).toString('base64url');
  return `${payload}.${signature(payload, clave)}`;
}
// Devuelve 'user', 'deposito' o null.
function sessionRole(value) {
  if (typeof value !== 'string') return null;
  try {
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const datos = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const rol = datos?.rol === undefined ? 'user' : datos.rol === 'deposito' ? 'deposito' : null;
    const clave = rol && claveDeRol(rol);
    if (!clave || !sameSecret(parts[1], signature(parts[0], clave))) return null;
    const now = Math.floor(Date.now() / 1000);
    return Number.isInteger(datos.exp) && datos.exp > now && datos.exp <= now + TTL ? rol : null;
  } catch { return null; }
}
// Qué clave escribió la persona al entrar: 'user', 'deposito' o null.
export function roleForKey(key) {
  if (claveDeRol('user') && sameSecret(key, claveDeRol('user'))) return 'user';
  const deposito = claveDeRol('deposito');
  if (deposito && sameSecret(key, deposito)) return 'deposito';
  return null;
}
export function allowedOrigin(req) {
  const expected = process.env.APP_ORIGIN || 'https://smart-sync-shopify.vercel.app';
  return req.headers?.origin === expected;
}
export function identity(req) {
  const authorization = req.headers?.authorization;
  // A malformed Authorization header must never fall back to a cookie.
  if (authorization !== undefined) {
    return typeof authorization === 'string' && authorization.startsWith('Bearer ') &&
      sameSecret(authorization.slice(7), process.env.AUTOMATION_READ_TOKEN) ? 'automation' : null;
  }
  const cookies = String(req.headers?.cookie || '').split(';').map(c => c.trim());
  const matching = cookies.filter(c => c.startsWith(`${COOKIE}=`));
  return matching.length === 1 ? sessionRole(matching[0].slice(COOKIE.length + 1)) : null;
}
export function sessionCookie(value, clear = false) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : TTL}`;
}
export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
// Personas que pueden usar «Carga y control de entregas» (facturas, notas de Trello, foto del remito).
export function esPersona(rol) {
  return rol === 'user' || rol === 'deposito';
}
