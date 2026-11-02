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
function signature(payload) {
  return createHmac('sha256', process.env.APP_ACCESS_KEY).update(payload).digest('base64url');
}
export function makeSession(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + TTL })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}
function validSession(value) {
  if (!validSecret(process.env.APP_ACCESS_KEY) || typeof value !== 'string') return false;
  try {
    const parts = value.split('.');
    if (parts.length !== 2 || !sameSecret(parts[1], signature(parts[0]))) return false;
    const { exp } = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    return Number.isInteger(exp) && exp > now && exp <= now + TTL;
  } catch { return false; }
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
  return matching.length === 1 && validSession(matching[0].slice(COOKIE.length + 1)) ? 'user' : null;
}
export function sessionCookie(value, clear = false) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : TTL}`;
}
export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
