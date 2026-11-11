// Lectura del tablero de Trello «COMPRAS Y ENTREGAS» (una tarjeta = un pedido).
// SOLO LECTURA: el token se generó con scope=read. Claves en Vercel:
// TRELLO_KEY y TRELLO_TOKEN (nunca en el código); TRELLO_BOARD opcional.
// Las claves viajan en el encabezado Authorization, no en la URL.
import * as XLSX from 'xlsx';

const API = 'https://api.trello.com/1';
const RE_ID = /^[a-f0-9]{24}$/;
export const MAX_ADJUNTO = 3_000_000; // en base64 queda < 4,5 MB (límite de Vercel)
// Los Excel de iD traen las fotos de los productos y suelen pesar más de 3 MB (11-nov-2026):
// se bajan hasta 25 MB y se devuelve una copia liviana, solo con los datos de la hoja.
export const MAX_DESCARGA = 25_000_000;

export const trelloConfigurado = () => Boolean(process.env.TRELLO_KEY && process.env.TRELLO_TOKEN);
const tablero = () => process.env.TRELLO_BOARD || 'RzHl0YNS';
const auth = () => `OAuth oauth_consumer_key="${process.env.TRELLO_KEY}", oauth_token="${process.env.TRELLO_TOKEN}"`;

function error(msg, status = 502) {
  return Object.assign(new Error(msg), { status });
}

// Solo a Trello se le mandan las claves. La descarga de un adjunto puede redirigir a otro
// servidor (el archivo guardado): ahí se sigue la redirección SIN las claves, porque ese
// servidor ya trae su propia firma en la dirección y rechaza el pedido si llega otra.
const HOSTS_TRELLO = new Set(['api.trello.com', 'trello.com']);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Texto corto de un error de Trello (o del servidor de archivos), para mostrar el motivo. */
async function detalle(r) {
  try {
    const t = String(await r.text());
    const msg = /<Message>([^<]*)<\/Message>/i.exec(t)?.[1] ?? t.replace(/<[^>]*>/g, ' ');
    return msg.replace(/\s+/g, ' ').trim().slice(0, 120);
  } catch { return ''; }
}

async function get(ruta, fetchImpl, comoBinario = false) {
  let url = `${API}${ruta}`;
  for (let saltos = 0, esperas = 0; ;) {
    const destino = new URL(url);
    const headers = { Accept: comoBinario ? '*/*' : 'application/json' };
    if (HOSTS_TRELLO.has(destino.hostname)) headers.Authorization = auth();
    const r = await fetchImpl(url, { headers, redirect: 'manual' });
    // Trello limita la cantidad de pedidos seguidos (100 cada 10 s): se espera y se reintenta.
    // Si no dice cuánto esperar, 2, 4 y 8 segundos (alcanza para que se libere la ventana).
    if (r.status === 429 && esperas < 3) {
      esperas++;
      const h = r.headers?.get?.('retry-after');
      const pide = h == null || String(h).trim() === '' ? NaN : Number(h);
      try { await r.body?.cancel?.(); } catch { /* sin cuerpo */ }
      await esperar(Math.min(8000, Number.isFinite(pide) && pide >= 0 ? pide * 1000 : 1000 * 2 ** esperas));
      continue;
    }
    if (r.status >= 300 && r.status < 400) {
      const sig = r.headers?.get?.('location');
      if (!sig || saltos >= 5) throw error('Trello respondió con una redirección inválida.');
      const nueva = new URL(sig, url);
      if (nueva.protocol !== 'https:') throw error('Trello redirigió a una dirección no segura.');
      url = nueva.href;
      saltos++;
      continue;
    }
    if (!r.ok) {
      const por = await detalle(r);
      const y = por ? ` (${por})` : '';
      if (r.status === 401) throw error(`Trello rechazó el pedido: 401${y}. Si pasa con todo, revisá TRELLO_KEY y TRELLO_TOKEN en Vercel.`, 503);
      if (r.status === 404) throw error(`Trello no encontró el tablero, la tarjeta o el adjunto${y}.`, 404);
      throw error(`Trello respondió ${r.status}${y}.`);
    }
    return comoBinario ? Buffer.from(await r.arrayBuffer()) : r.json();
  }
}

const esExcel = (nombre) => /\.(xlsx|xls)$/i.test(String(nombre || ''));
/** Fecha de creación de la tarjeta: los primeros 8 caracteres del id son un timestamp. */
export const fechaCreacion = (id) => new Date(parseInt(String(id).slice(0, 8), 16) * 1000).toISOString().slice(0, 10);

export async function listarTarjetas(fetchImpl = fetch) {
  const b = tablero();
  const [info, listas, tarjetas] = await Promise.all([
    get(`/boards/${encodeURIComponent(b)}?fields=name`, fetchImpl),
    get(`/boards/${encodeURIComponent(b)}/lists?fields=id,name&filter=all`, fetchImpl),
    get(`/boards/${encodeURIComponent(b)}/cards?fields=id,name,desc,idList,dateLastActivity,due,start,labels,closed,shortUrl&attachments=true&attachment_fields=id,name,bytes,isUpload,date`, fetchImpl),
  ]);
  const nombreLista = new Map((Array.isArray(listas) ? listas : []).map((l) => [l.id, l.name]));
  return {
    tablero: String(info?.name || ''),
    tarjetas: (Array.isArray(tarjetas) ? tarjetas : []).filter((t) => !t.closed && RE_ID.test(t.id)).map((t) => ({
      id: t.id,
      nombre: String(t.name || '').slice(0, 200),
      enlace: /^https:\/\/trello\.com\/c\/[A-Za-z0-9]+$/.test(String(t.shortUrl || '')) ? t.shortUrl : '',
      descripcion: String(t.desc || '').slice(0, 500),
      lista: String(nombreLista.get(t.idList) || ''),
      creada: fechaCreacion(t.id),
      inicio: t.start ? String(t.start).slice(0, 10) : '',
      vence: t.due ? String(t.due).slice(0, 10) : '',
      etiquetas: (t.labels || []).map((l) => String(l.name || l.color || '')).filter(Boolean),
      adjuntos: (t.attachments || [])
        .filter((a) => a.isUpload && esExcel(a.name) && RE_ID.test(a.id))
        .map((a) => ({ id: a.id, nombre: String(a.name), bytes: Number(a.bytes) || 0, fecha: String(a.date || '').slice(0, 10) })),
      // Lo que no se puede leer como nota (un enlace, un PDF, una foto): solo para avisarlo.
      otrosAdjuntos: (t.attachments || [])
        .filter((a) => !(a.isUpload && esExcel(a.name) && RE_ID.test(a.id)))
        .slice(0, 5)
        .map((a) => `${String(a.name || 'sin nombre').slice(0, 80)}${a.isUpload ? '' : ' (enlace)'}`),
    })),
  };
}

// El id del tablero no cambia: se guarda mientras la función sigue viva (menos pedidos a Trello).
const cacheTablero = new Map();
async function idTablero(fetchImpl) {
  const b = tablero();
  if (cacheTablero.has(b)) return cacheTablero.get(b);
  const tab = await get(`/boards/${encodeURIComponent(b)}?fields=id`, fetchImpl);
  const v = RE_ID.test(String(tab?.id || '')) ? tab.id : '';
  if (v) cacheTablero.set(b, v);
  return v;
}

/** Baja un Excel adjunto, verificando que la tarjeta sea del tablero configurado. */
export async function bajarAdjunto(tarjetaId, adjuntoId, fetchImpl = fetch) {
  if (!RE_ID.test(String(tarjetaId)) || !RE_ID.test(String(adjuntoId))) throw error('Identificador inválido.', 400);
  const [tarjeta, idTab] = await Promise.all([
    get(`/cards/${tarjetaId}?fields=idBoard,closed`, fetchImpl),
    idTablero(fetchImpl),
  ]);
  if (!tarjeta || !idTab || tarjeta.idBoard !== idTab) throw error('La tarjeta no es del tablero de compras.', 403);
  const adj = await get(`/cards/${tarjetaId}/attachments/${adjuntoId}?fields=id,name,bytes,isUpload`, fetchImpl);
  if (!adj?.isUpload || !esExcel(adj.name)) throw error('El adjunto no es un Excel subido a la tarjeta.', 400);
  if (Number(adj.bytes) > MAX_DESCARGA) throw error('El Excel pesa más de 25 MB: subilo a mano.', 413);
  const datos = await get(`/cards/${tarjetaId}/attachments/${adjuntoId}/download/${encodeURIComponent(adj.name)}`, fetchImpl, true);
  if (datos.length > MAX_DESCARGA) throw error('El Excel pesa más de 25 MB: subilo a mano.', 413);
  const liviano = datos.length > MAX_ADJUNTO ? sinFotos(datos) : datos;
  if (liviano.length > MAX_ADJUNTO) throw error('El Excel tiene demasiados datos para leerlo desde Trello: subilo a mano.', 413);
  return { nombre: String(adj.name), datos: liviano.toString('base64') };
}

/**
 * Copia del Excel con SOLO los valores de la primera hoja visible (sin fotos ni estilos).
 * Las fechas y números quedan como en el original, así el lector de pedidos lo lee igual.
 */
export function sinFotos(datos) {
  let wb;
  try { wb = XLSX.read(datos, { type: 'buffer', cellStyles: false }); }
  catch { throw error('El adjunto no se pudo abrir como Excel.', 400); }
  const hoja = wb.SheetNames.find((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden) || wb.SheetNames[0];
  if (!hoja) throw error('El Excel no tiene hojas.', 400);
  const nuevo = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(nuevo, wb.Sheets[hoja], hoja.slice(0, 31));
  return Buffer.from(XLSX.write(nuevo, { type: 'buffer', bookType: 'xlsx', compression: true }));
}
