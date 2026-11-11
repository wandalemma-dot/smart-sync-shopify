// Claves de Vercel: leerlas limpias y no mostrarlas NUNCA en un mensaje.
// 11-nov-2026: TRELLO_TOKEN estaba guardado con un salto de línea al final. Node rechazó el
// encabezado («… is an invalid header value») y ese mensaje, que copia el encabezado entero
// con la clave y el token, llegó a la pantalla. Por eso: se limpian al leerlas y todo texto de
// error que vuelve al navegador pasa por ocultarSecretos().

/** Valor de una clave de Vercel sin los espacios, saltos de línea o comillas que se pegan al copiarla. */
export function claveEnv(nombre) {
  let v = String(process.env[nombre] ?? '').trim();
  const m = /^(["'])([\s\S]*)\1$/.exec(v);
  if (m) v = m[2].trim();
  return v;
}

// Todas las claves que la app usa para hablar con otros servicios (o para entrar).
const NOMBRES = [
  'TRELLO_KEY', 'TRELLO_TOKEN',
  'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL',
  'ANTHROPIC_API_KEY',
  'SHOPIFY_ADMIN_TOKEN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET',
  'APP_ACCESS_KEY', 'AUTOMATION_READ_TOKEN',
];
const TAPADO = '•••';

/**
 * Copia del texto sin ninguna clave: los valores de las variables de arriba (tal cual y
 * limpios), los formatos conocidos de tokens y lo que va detrás de un encabezado de autorización.
 */
export function ocultarSecretos(texto, extras = []) {
  let s = String(texto ?? '');
  const valores = new Set();
  for (const n of NOMBRES) {
    const crudo = String(process.env[n] ?? '');
    for (const v of [crudo, crudo.trim(), claveEnv(n)]) if (v.trim().length >= 6) valores.add(v);
  }
  for (const v of extras) if (typeof v === 'string' && v.trim().length >= 6) valores.add(v);
  // Primero los más largos: el valor con el salto de línea antes que el mismo valor limpio.
  for (const v of [...valores].sort((a, b) => b.length - a.length)) s = s.split(v).join(TAPADO);
  return s
    .replace(/(oauth_[a-z_]+\s*=\s*)"[^"]*"/gi, `$1"${TAPADO}"`)
    .replace(/(oauth_[a-z_]+\s*=\s*)[^",\s"]+/gi, `$1${TAPADO}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${TAPADO}`)
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&\s"']+/gi, `$1${TAPADO}`)
    .replace(/\bATTA[A-Za-z0-9]{20,}/g, TAPADO) // token de Trello
    .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}/g, TAPADO) // clave de Anthropic
    .replace(/\bshp(?:at|ss|ca|pa)_[A-Za-z0-9]{10,}/g, TAPADO) // tokens de Shopify
    .replace(/\b(rediss?:\/\/)[^@\s/]*@/gi, `$1${TAPADO}@`); // usuario:clave en una dirección
}

/** Mensaje de un error, listo para mandar al navegador. */
export const mensajeSeguro = (e, porDefecto = 'Error interno.') =>
  ocultarSecretos(e instanceof Error ? e.message : typeof e === 'string' ? e : porDefecto) || porDefecto;
