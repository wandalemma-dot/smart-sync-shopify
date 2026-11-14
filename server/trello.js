// Lectura del tablero de Trello «COMPRAS Y ENTREGAS» (una tarjeta = un pedido).
// Lee tarjetas y Excel. La ÚNICA escritura es adjuntar la factura o la foto del remito a una tarjeta
// del tablero (adjuntarArchivo, 14-nov-2026, gax); nunca borra, mueve ni edita tarjetas. Para eso el
// token necesita scope=read,write; con uno de solo lectura, adjuntar avisa y lo demás sigue andando. Claves en Vercel:
// TRELLO_KEY y TRELLO_TOKEN (nunca en el código); TRELLO_BOARD opcional.
// Las claves viajan en el encabezado Authorization, no en la URL.
import * as XLSX from 'xlsx';
import { claveEnv, ocultarSecretos } from './secretos.js';

const API = 'https://api.trello.com/1';
const RE_ID = /^[a-f0-9]{24}$/;
export const MAX_ADJUNTO = 3_000_000; // en base64 queda < 4,5 MB (límite de Vercel)
// Los Excel de iD traen las fotos de los productos y suelen pesar más de 3 MB (11-nov-2026):
// se bajan hasta 25 MB y se devuelve una copia liviana, solo con los datos de la hoja.
export const MAX_DESCARGA = 25_000_000;

// Las claves se leen limpias (claveEnv): el 11-nov-2026 TRELLO_TOKEN estaba guardado con un salto
// de línea al final, Node rechazaba el encabezado y no se leía ninguna tarjeta.
export const trelloConfigurado = () => Boolean(claveEnv('TRELLO_KEY') && claveEnv('TRELLO_TOKEN'));
const tablero = () => claveEnv('TRELLO_BOARD') || 'RzHl0YNS';
const CLAVE_VALIDA = /^[A-Za-z0-9]+$/;
function auth() {
  const key = claveEnv('TRELLO_KEY');
  const token = claveEnv('TRELLO_TOKEN');
  // Un carácter raro en el medio (espacio, comilla, signo) no se arregla solo: se avisa cuál
  // de las dos es, SIN mostrarla.
  for (const [nombre, v] of [['TRELLO_KEY', key], ['TRELLO_TOKEN', token]]) {
    if (!CLAVE_VALIDA.test(v)) throw error(`${nombre} en Vercel tiene caracteres que no van (solo puede tener letras y números). Copiala de nuevo desde Trello y pegala sin espacios ni comillas.`, 503);
  }
  return `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`;
}

function error(msg, status = 502) {
  return Object.assign(new Error(ocultarSecretos(msg)), { status });
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
    return ocultarSecretos(msg.replace(/\s+/g, ' ').trim()).slice(0, 120);
  } catch { return ''; }
}

async function get(ruta, fetchImpl, comoBinario = false) {
  let url = `${API}${ruta}`;
  for (let saltos = 0, esperas = 0; ;) {
    const destino = new URL(url);
    const headers = { Accept: comoBinario ? '*/*' : 'application/json' };
    if (HOSTS_TRELLO.has(destino.hostname)) headers.Authorization = auth();
    let r;
    try { r = await fetchImpl(url, { headers, redirect: 'manual' }); }
    catch (e) {
      // El mensaje de Node puede copiar el encabezado con las claves: nunca se manda tal cual.
      const m = e instanceof Error ? e.message : String(e);
      if (/header/i.test(m)) throw error('Las claves de Trello en Vercel tienen un carácter que no va. Copialas de nuevo y pegalas sin espacios ni saltos de línea.', 503);
      throw error(`No me pude conectar con Trello (${m.slice(0, 120)}). Probá de nuevo en un rato.`);
    }
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
    get(`/boards/${encodeURIComponent(b)}/lists?fields=id,name,closed&filter=all`, fetchImpl),
    get(`/boards/${encodeURIComponent(b)}/cards?fields=id,name,desc,idList,dateLastActivity,due,start,labels,closed,shortUrl&attachments=true&attachment_fields=id,name,bytes,isUpload,date`, fetchImpl),
  ]);
  const todasListas = (Array.isArray(listas) ? listas : []).filter((l) => l && typeof l === 'object');
  const nombreLista = new Map(todasListas.map((l) => [l.id, l.name]));
  const listaCerrada = new Set(todasListas.filter((l) => l.closed).map((l) => l.id));
  return {
    tablero: String(info?.name || ''),
    // Listas abiertas del tablero, en su orden: para elegir de cuáles se toman las notas pendientes.
    listas: todasListas.filter((l) => !l.closed && RE_ID.test(String(l.id || ''))).map((l) => ({ id: l.id, nombre: String(l.name || '').slice(0, 100) })),
    tarjetas: (Array.isArray(tarjetas) ? tarjetas : []).filter((t) => !t.closed && RE_ID.test(t.id)).map((t) => ({
      id: t.id,
      nombre: String(t.name || '').slice(0, 200),
      enlace: /^https:\/\/trello\.com\/c\/[A-Za-z0-9]+$/.test(String(t.shortUrl || '')) ? t.shortUrl : '',
      descripcion: String(t.desc || '').slice(0, 500),
      lista: String(nombreLista.get(t.idList) || ''),
      // Una tarjeta de una lista archivada no cuenta como de esa lista.
      idLista: RE_ID.test(String(t.idList || '')) && !listaCerrada.has(t.idList) ? t.idList : '',
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
  const adj = await get(`/cards/${tarjetaId}/attachments/${adjuntoId}?fields=id,name,bytes,isUpload,date`, fetchImpl);
  if (!adj?.isUpload || !esExcel(adj.name)) throw error('El adjunto no es un Excel subido a la tarjeta.', 400);
  if (Number(adj.bytes) > MAX_DESCARGA) throw error('El Excel pesa más de 25 MB: subilo a mano.', 413);
  const datos = await get(`/cards/${tarjetaId}/attachments/${adjuntoId}/download/${encodeURIComponent(adj.name)}`, fetchImpl, true);
  if (datos.length > MAX_DESCARGA) throw error('El Excel pesa más de 25 MB: subilo a mano.', 413);
  // Lo pintado en verde se lee del archivo original: la copia liviana no lleva colores.
  const hoja = verdesDe(datos);
  const completo = datos.length <= MAX_ADJUNTO;
  const liviano = completo ? datos : sinFotos(datos);
  if (liviano.length > MAX_ADJUNTO) throw error('El Excel tiene demasiados datos para leerlo desde Trello: subilo a mano.', 413);
  return {
    nombre: String(adj.name),
    fecha: /^\d{4}-\d{2}-\d{2}/.test(String(adj.date || '')) ? String(adj.date).slice(0, 10) : '',
    // completo: es el archivo tal cual (con fotos y colores), sirve para devolverlo marcado.
    completo,
    ...hoja,
    datos: liviano.toString('base64'),
  };
}

/**
 * Celdas con relleno verde de la primera hoja visible (12-nov-2026, gax: «lo que está en verde ya
 * entró»), y dónde empieza la hoja (las filas que lee la app arrancan ahí). Si no se puede leer, sin verdes.
 */
export function verdesDe(datos) {
  try {
    const wb = XLSX.read(datos, { type: 'buffer', cellStyles: true });
    const nombre = wb.SheetNames.find((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden) || wb.SheetNames[0];
    const ws = wb.Sheets[nombre];
    if (!ws) return { verdes: [], origen: { r: 0, c: 0 } };
    const verdes = Object.keys(ws).filter((k) => !k.startsWith('!') && esVerde(ws[k]?.s?.fgColor?.rgb) && (ws[k]?.s?.patternType ?? 'solid') !== 'none').slice(0, 5000);
    const r = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s : { r: 0, c: 0 };
    return { verdes, origen: { r: r.r, c: r.c } };
  } catch { return { verdes: [], origen: { r: 0, c: 0 } }; }
}

/** Mismo criterio que src/utils/planillaVerde.ts: el verde manda claramente (92D050, 00B050, C6EFCE…). */
export function esVerde(rgb) {
  const m = /^(?:[0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(String(rgb ?? '').trim());
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return g >= 0x80 && g - Math.max(r, b) >= 12;
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

// ---------------------------------------------------------------------------
// ADJUNTAR A UNA TARJETA (14-nov-2026, gax: «que escriba las tarjetas y ponga las fotos de los
// remitos y la factura»). Solo PDF, JPG o PNG, de hasta 3 MB, a tarjetas del tablero de compras.
// Si la tarjeta ya tiene un adjunto con el mismo nombre, no se sube otra vez.
// ---------------------------------------------------------------------------
const TIPOS_ADJUNTO = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Nombre prolijo para el adjunto: sin caracteres raros, con la extensión del tipo. */
export function nombreAdjunto(nombre, tipo) {
  const ext = TIPOS_ADJUNTO[tipo];
  const base = String(nombre ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[^\p{L}\p{N} ._()-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'archivo';
  return `${base}.${ext}`;
}

async function post(ruta, cuerpo, fetchImpl) {
  for (let esperas = 0; ;) {
    let r;
    try { r = await fetchImpl(`${API}${ruta}`, { method: 'POST', headers: { Authorization: auth(), Accept: 'application/json' }, body: cuerpo(), redirect: 'error' }); }
    catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/header/i.test(m)) throw error('Las claves de Trello en Vercel tienen un carácter que no va. Copialas de nuevo y pegalas sin espacios ni saltos de línea.', 503);
      throw error(`No me pude conectar con Trello (${m.slice(0, 120)}). Probá de nuevo en un rato.`);
    }
    if (r.status === 429 && esperas < 3) { esperas++; await esperar(1000 * 2 ** esperas); continue; }
    if (!r.ok) {
      const por = await detalle(r);
      // Con el token de solo lectura Trello contesta 401 «unauthorized permission requested».
      if (r.status === 401) throw error('Trello no deja adjuntar: la clave TRELLO_TOKEN de Vercel es de solo lectura. Generá una con permiso de escritura y cambiala en Vercel.', 403);
      if (r.status === 404) throw error('Trello no encontró la tarjeta.', 404);
      throw error(`Trello respondió ${r.status}${por ? ` (${por})` : ''}.`);
    }
    return r.json();
  }
}

/** Adjunta un archivo (base64) a una tarjeta del tablero de compras. */
export async function adjuntarArchivo(tarjetaId, archivo, fetchImpl = fetch) {
  if (!RE_ID.test(String(tarjetaId))) throw error('Identificador inválido.', 400);
  const tipo = String(archivo?.tipo || '');
  if (!TIPOS_ADJUNTO[tipo]) throw error('Solo se pueden adjuntar PDF, JPG o PNG.', 400);
  const b64 = String(archivo?.datos || '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw error('Archivo inválido.', 400);
  const datos = Buffer.from(b64, 'base64');
  if (!datos.length) throw error('Archivo vacío.', 400);
  if (datos.length > MAX_ADJUNTO) throw error('El archivo pesa más de 3 MB: subilo a mano a Trello.', 413);
  const nombre = nombreAdjunto(archivo?.nombre, tipo);
  const [tarjeta, idTab, previos] = await Promise.all([
    get(`/cards/${tarjetaId}?fields=idBoard,closed`, fetchImpl),
    idTablero(fetchImpl),
    get(`/cards/${tarjetaId}/attachments?fields=name`, fetchImpl),
  ]);
  if (!tarjeta || !idTab || tarjeta.idBoard !== idTab) throw error('La tarjeta no es del tablero de compras.', 403);
  if (Array.isArray(previos) && previos.some((a) => String(a?.name) === nombre)) return { nombre, yaEstaba: true };
  const adj = await post(`/cards/${tarjetaId}/attachments`, () => {
    const form = new FormData();
    form.append('name', nombre);
    form.append('mimeType', tipo);
    form.append('file', new Blob([datos], { type: tipo }), nombre);
    return form;
  }, fetchImpl);
  return { nombre, yaEstaba: false, ...(RE_ID.test(String(adj?.id || '')) ? { id: adj.id } : {}) };
}
