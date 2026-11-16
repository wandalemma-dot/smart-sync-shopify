// PLANILLA «CONTROL INGRESO MERCADERIA» (16-nov-2026, gax: «la app agregue la fila sola»).
// Al terminar una carga de iD, Distrinando o Family, la app manda UNA fila a un Apps Script pegado en la
// planilla de Google (automation/planilla-ingreso.gs), que la agrega abajo. La dirección del script
// (PLANILLA_URL) y la clave compartida (PLANILLA_SECRETO) están en Vercel, nunca en el código.
// Solo escribe esa fila: no lee la planilla ni toca Shopify.
import { claveEnv, ocultarSecretos } from './secretos.js';

const RE_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
const RE_FECHA = /^\d{2}\/\d{2}\/\d{2}$/;

function error(mensaje, status) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

export const planillaConfigurada = () => Boolean(claveEnv('PLANILLA_URL') && claveEnv('PLANILLA_SECRETO'));

function texto(v, max, campo, obligatorio = true) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s && obligatorio) throw error(`Falta ${campo}.`, 400);
  if (s.length > max) throw error(`${campo} es demasiado largo.`, 400);
  if (/^[=+@-]/.test(s)) throw error(`${campo} no puede empezar con «${s[0]}».`, 400);
  return s;
}

/** Revisa y limpia la fila que manda el navegador. */
export function validarFila(f) {
  if (!f || typeof f !== 'object') throw error('Fila inválida.', 400);
  const fecha = String(f.fecha ?? '');
  const carga = String(f.carga ?? '');
  if (!RE_FECHA.test(fecha) || !RE_FECHA.test(carga)) throw error('Fecha inválida.', 400);
  const numero = String(f.numero ?? '').trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z.-]{3,30}$/.test(numero)) throw error('N° de factura o remito inválido.', 400);
  let monto = null;
  if (f.monto !== null && f.monto !== undefined) {
    monto = Number(f.monto);
    if (!Number.isFinite(monto) || monto < 0 || monto > 1e11) throw error('Monto inválido.', 400);
    monto = Math.round(monto * 100) / 100;
  }
  // Family no factura: la fila va sin N° de factura, con el remito (y el script no la repite por el remito).
  const factura = texto(f.factura, 60, 'N° de factura', false);
  const remito = texto(f.remito, 60, 'N° de remito', !factura);
  if (!factura && !remito.includes(numero)) throw error('Sin factura, el número tiene que ser el del remito.', 400);
  return {
    fecha, carga, numero, monto, factura, remito,
    proveedor: texto(f.proveedor, 40, 'Proveedor'),
    observaciones: texto(f.observaciones, 300, 'Observaciones'),
    ok: f.ok === true,
  };
}

async function llamar(cuerpo, fetchImpl) {
  const url = claveEnv('PLANILLA_URL');
  const clave = claveEnv('PLANILLA_SECRETO');
  if (!url || !clave) throw error('Faltan PLANILLA_URL y PLANILLA_SECRETO en Vercel.', 503);
  if (!RE_URL.test(url)) throw error('PLANILLA_URL no es la dirección de una implementación de Apps Script (termina en /exec).', 503);
  let r;
  try {
    // Apps Script responde con una redirección a googleusercontent.com, que se sigue con GET.
    r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...cuerpo, clave }), redirect: 'follow' });
  } catch {
    throw error('No me pude comunicar con la planilla de Google.', 502);
  }
  const crudo = await r.text().catch(() => '');
  let d = null;
  try { d = JSON.parse(crudo); } catch { /* una página de Google en vez de la respuesta */ }
  if (!d || typeof d !== 'object') {
    throw error('La planilla no respondió como se esperaba. Revisá que la implementación del Apps Script tenga acceso «Cualquier usuario».', 502);
  }
  if (d.error) throw error(`La planilla dijo: ${ocultarSecretos(String(d.error), [clave, url]).slice(0, 200)}`, 502);
  return d;
}

/** Agrega la fila de la carga. Si esa factura ya está anotada, no la repite. */
export async function anotarFila(fila, fetchImpl = fetch) {
  const f = validarFila(fila);
  const d = await llamar({ accion: 'anotar', fila: f }, fetchImpl);
  const n = Number(d.fila);
  return { ok: true, yaEstaba: d.yaEstaba === true, ...(Number.isInteger(n) && n > 0 ? { fila: n } : {}) };
}

/** Prueba la conexión sin escribir nada. */
export async function probarPlanilla(fetchImpl = fetch) {
  const d = await llamar({ accion: 'probar' }, fetchImpl);
  return { ok: true, hoja: String(d.hoja ?? '').slice(0, 100) };
}
