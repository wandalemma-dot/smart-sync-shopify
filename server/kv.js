// Base de datos de la app: Upstash Redis por REST (integración de Vercel).
// Las claves las carga Vercel al conectar la base: KV_REST_API_URL / KV_REST_API_TOKEN
// o UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Nunca van en el código.
import { claveEnv } from './secretos.js';

export function kvConfigurado() {
  return Boolean(kvUrl() && kvToken());
}
// Limpias (claveEnv): un salto de línea pegado en Vercel no puede romper el encabezado (11-nov-2026).
const kvUrl = () => claveEnv('KV_REST_API_URL') || claveEnv('UPSTASH_REDIS_REST_URL');
const kvToken = () => claveEnv('KV_REST_API_TOKEN') || claveEnv('UPSTASH_REDIS_REST_TOKEN');

/** Ejecuta varios comandos en una sola llamada. Devuelve los resultados en orden. */
export async function kv(comandos, fetchImpl = fetch) {
  if (!kvConfigurado()) throw Object.assign(new Error('Falta conectar la base de datos en Vercel.'), { status: 503 });
  let r;
  try {
    r = await fetchImpl(`${kvUrl().replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(comandos),
    });
  } catch (e) {
    // El mensaje de Node puede copiar el encabezado o la dirección con la clave: no se usa.
    // Solo se distingue si es la configuración (no se arregla probando de nuevo).
    const m = e instanceof Error ? e.message : '';
    if (/invalid header value|parse URL|Invalid URL|includes credentials/i.test(m)) {
      throw Object.assign(new Error('KV_REST_API_URL o KV_REST_API_TOKEN en Vercel tienen un formato inválido: revisalos (sin espacios en el medio ni saltos de línea).'), { status: 503 });
    }
    throw Object.assign(new Error('No me pude conectar con la base de datos. Probá de nuevo en un rato.'), { status: 502 });
  }
  if (!r.ok) throw Object.assign(new Error(`La base de datos respondió ${r.status}.`), { status: 502 });
  const datos = await r.json();
  if (!Array.isArray(datos) || datos.length !== comandos.length) throw Object.assign(new Error('Respuesta incompleta de la base de datos.'), { status: 502 });
  const error = datos.find((d) => d && d.error);
  if (error) throw Object.assign(new Error(`Error de la base de datos: ${error.error}`), { status: 502 });
  return datos.map((d) => d.result);
}
