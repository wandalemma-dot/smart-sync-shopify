// Base de datos de la app: Upstash Redis por REST (integración de Vercel).
// Las claves las carga Vercel al conectar la base: KV_REST_API_URL / KV_REST_API_TOKEN
// o UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Nunca van en el código.
export function kvConfigurado() {
  return Boolean(kvUrl() && kvToken());
}
const kvUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const kvToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

/** Ejecuta varios comandos en una sola llamada. Devuelve los resultados en orden. */
export async function kv(comandos, fetchImpl = fetch) {
  if (!kvConfigurado()) throw Object.assign(new Error('Falta conectar la base de datos en Vercel.'), { status: 503 });
  const r = await fetchImpl(`${kvUrl().replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comandos),
  });
  if (!r.ok) throw Object.assign(new Error(`La base de datos respondió ${r.status}.`), { status: 502 });
  const datos = await r.json();
  if (!Array.isArray(datos) || datos.length !== comandos.length) throw Object.assign(new Error('Respuesta incompleta de la base de datos.'), { status: 502 });
  const error = datos.find((d) => d && d.error);
  if (error) throw Object.assign(new Error(`Error de la base de datos: ${error.error}`), { status: 502 });
  return datos.map((d) => d.result);
}
