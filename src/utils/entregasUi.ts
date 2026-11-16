// Piezas compartidas de las pantallas de Control de entregas (facturas de iD y
// Distrinando, y entregas de Family): estilos, fotos, fechas y la llamada a la base.
import type { CSSProperties } from 'react';

export interface Foto { media: string; datos: string }

/** Achica las fotos del remito (2000 px, JPG) para mandarlas a leer. */
export async function prepararFotos(files: File[]): Promise<Foto[]> {
  const out: Foto[] = [];
  for (const file of files) {
    if (file.type && !file.type.startsWith('image/')) throw new Error(`${file.name} no es una foto.`);
    const bmp = await createImageBitmap(file).catch(() => { throw new Error(`No pude abrir ${file.name}: subí la foto en JPG o PNG.`); });
    const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    out.push({ media: 'image/jpeg', datos: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] });
  }
  if (out.length > 5) throw new Error('Máximo 5 fotos por vez.');
  if (out.reduce((s, f) => s + f.datos.length, 0) > 4_000_000) throw new Error('Las fotos pesan demasiado juntas: subí menos fotos.');
  return out;
}

export const inputSt: CSSProperties = {
  padding: '5px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '0.85rem',
};
export const boton: CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)',
  color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
};
export const botonChico: CSSProperties = { ...boton, padding: '3px 9px', fontSize: '0.8rem', fontWeight: 500 };
export const botonPrincipal: CSSProperties = { ...boton, background: '#6366f1', border: '1px solid #6366f1', padding: '8px 18px', fontSize: '0.92rem' };
export const enlace: CSSProperties = { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0, fontSize: '0.85rem', textDecoration: 'underline' };
export const th: CSSProperties = { padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap' };
export const td: CSSProperties = { padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)', verticalAlign: 'top' };

export const hoy = () => new Date().toISOString().slice(0, 10);
export const slug = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'x';
export const fechaAr = (iso?: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

/**
 * Nombre del Excel marcado para Trello: N° de nota, nombre de la tarjeta y fecha de la nota, para
 * reconocerla entre varias (12-nov-2026, gax). Ej.: «Nota 00002595 - Reposicion Converse - 05-11-2026 - entregado 12-11.xlsx».
 */
export function nombreArchivoPlanilla(p: { nroProveedor?: string; nombre: string; fecha?: string }, hoy: string): string {
  const limpio = (t: string) => t.replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const nro = limpio(p.nroProveedor || '');
  const nombre = limpio(p.nombre || '').replace(/\.xlsx?$/i, '').slice(0, 60);
  const partes = [
    nro ? `Nota ${nro}` : '',
    // Si la tarjeta se llama igual que la nota, no se repite.
    nombre && !(nro && !nombre.split(nro).join(' ').replace(/\b(pedido|nota|nro)\b|n[°º]/gi, '').replace(/[^A-Za-z0-9]/g, '')) ? nombre : '',
    fechaAr(p.fecha).replace(/\//g, '-'),
    `entregado ${fechaAr(hoy).slice(0, 5).replace('/', '-')}`,
  ];
  return `${partes.filter(Boolean).join(' - ')}.xlsx`;
}

export const mensaje = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado.');

/** Un archivo listo para adjuntar a una tarjeta de Trello (base64, ≤ 3 MB). */
export interface ArchivoTrello {
  nombre: string;
  tipo: 'application/pdf' | 'image/jpeg' | 'image/png' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'application/vnd.ms-excel';
  datos: string;
}
const MAX_TRELLO = 3_000_000;
const base64 = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Prepara la factura (PDF, tal cual) y las fotos del remito (achicadas a 2000 px, JPG) para Trello
 * (14-nov-2026). Nombres: «Factura 0039-00283124.pdf», «Remito 0085-00206200 (1).jpg».
 */
export async function archivosParaTrello(files: File[], factura: string, remito: string): Promise<ArchivoTrello[]> {
  const out: ArchivoTrello[] = [];
  const fotos = files.filter((f) => f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name));
  const pdfs = files.filter((f) => !fotos.includes(f));
  for (const [i, f] of pdfs.entries()) {
    if (f.size > MAX_TRELLO) throw new Error(`${f.name} pesa más de 3 MB: subilo a mano a Trello.`);
    out.push({ nombre: `Factura ${factura}${pdfs.length > 1 ? ` (${i + 1})` : ''}`, tipo: 'application/pdf', datos: base64(await f.arrayBuffer()) });
  }
  const achicadas = fotos.length ? await prepararFotos(fotos) : [];
  for (const [i, f] of achicadas.entries()) {
    if (f.datos.length * 0.75 > MAX_TRELLO) throw new Error('Una foto pesa más de 3 MB: subila a mano a Trello.');
    out.push({ nombre: `Remito ${remito || factura}${achicadas.length > 1 ? ` (${i + 1})` : ''}`, tipo: 'image/jpeg', datos: f.datos });
  }
  return out;
}

/** Adjunta un archivo a una tarjeta del tablero de compras. */
export async function adjuntarATrello(tarjeta: string, archivo: ArchivoTrello): Promise<{ nombre: string; yaEstaba: boolean }> {
  const r = await fetch('/api/trello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'adjuntar', tarjeta, archivo }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

/**
 * Family (16-nov-2026): la planilla de entrega (Excel tal cual, o fotos/PDF) y las fotos del remito, para
 * la tarjeta que crea la app. Nombres «Planilla de entrega 11-11-26.xlsx», «Remito 0001-00002716 (1).jpg».
 */
export async function archivosFamily(planilla: File[], remito: File[], numeroRemito: string, fecha: string): Promise<ArchivoTrello[]> {
  const out: ArchivoTrello[] = [];
  const dia = fechaAr(fecha).replace(/\//g, '-');
  const esXlsx = (f: File) => /\.xlsx$/i.test(f.name), esXls = (f: File) => /\.xls$/i.test(f.name);
  const esPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const tal = async (files: File[], base: string) => {
    for (const [i, f] of files.entries()) {
      if (f.size > MAX_TRELLO) throw new Error(`${f.name} pesa más de 3 MB: subilo a mano a Trello.`);
      const tipo = esPdf(f) ? 'application/pdf' : esXlsx(f) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel';
      out.push({ nombre: `${base}${files.length > 1 ? ` (${i + 1})` : ''}`, tipo, datos: base64(await f.arrayBuffer()) });
    }
  };
  const fotos = async (files: File[], base: string) => {
    const achicadas = files.length ? await prepararFotos(files) : [];
    for (const [i, f] of achicadas.entries()) {
      if (f.datos.length * 0.75 > MAX_TRELLO) throw new Error('Una foto pesa más de 3 MB: subila a mano a Trello.');
      out.push({ nombre: `${base}${achicadas.length > 1 ? ` (${i + 1})` : ''}`, tipo: 'image/jpeg', datos: f.datos });
    }
  };
  const directos = (f: File) => esPdf(f) || esXlsx(f) || esXls(f);
  await tal(planilla.filter(directos), `Planilla de entrega ${dia}`);
  await fotos(planilla.filter((f) => !directos(f)), `Planilla de entrega ${dia}`);
  const nombreRemito = `Remito ${numeroRemito || dia}`;
  await tal(remito.filter(esPdf), nombreRemito);
  await fotos(remito.filter((f) => !esPdf(f)), nombreRemito);
  return out;
}

/** Crea una tarjeta en una lista del tablero de compras (o devuelve la que ya tiene ese nombre). */
export async function crearEnTrello(lista: string, nombre: string, descripcion: string): Promise<{ id: string; enlace: string; yaEstaba: boolean }> {
  const r = await fetch('/api/trello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'crear', lista, nombre, descripcion }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

/** Las listas abiertas del tablero de compras. */
export async function listasDeTrello(): Promise<{ id: string; nombre: string }[]> {
  const r = await fetch('/api/trello?accion=tarjetas', { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return Array.isArray(d.listas) ? d.listas : [];
}

/** Pasa una tarjeta del tablero de compras a otra lista (la app lo hace sola al avanzar la entrega). */
export async function moverEnTrello(tarjeta: string, lista: string): Promise<{ yaEstaba: boolean }> {
  const r = await fetch('/api/trello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'mover', tarjeta, lista }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

/** Deja un comentario en una tarjeta del tablero de compras (lo cargado en Shopify). */
export async function comentarEnTrello(tarjeta: string, texto: string): Promise<void> {
  const r = await fetch('/api/trello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'comentar', tarjeta, texto }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
}

/** Agrega la fila de la carga en la planilla de ingreso (Apps Script de Google, vía /api/planilla). */
export async function anotarEnPlanilla(fila: unknown): Promise<{ fila?: number; yaEstaba?: boolean; sinPlanilla?: boolean }> {
  const r = await fetch('/api/planilla', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'anotar', fila }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 503 && d.sinPlanilla) return { sinPlanilla: true };
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

/** Prueba la conexión con la planilla de ingreso, sin escribir nada. */
export async function probarPlanilla(): Promise<{ hoja?: string; sinPlanilla?: boolean }> {
  const r = await fetch('/api/planilla?accion=probar');
  const d = await r.json().catch(() => ({}));
  if (r.status === 503 && d.sinPlanilla) return { sinPlanilla: true };
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

/** Lee fotos con IA (api/leer-remito.js): el remito, o la planilla de entrega de Family. */
export async function leerFotos<T>(files: File[], tipo: 'remito' | 'entrega' = 'remito'): Promise<T> {
  const fotos = await prepararFotos(files);
  const r = await fetch('/api/leer-remito', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fotos, tipo }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d as T;
}

/** Guarda (con body) o lee (sin body) los datos del control de un proveedor. */
export async function apiControl(body?: object, proveedor?: string) {
  const r = body
    ? await fetch('/api/control-facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await fetch(`/api/control-facturas?proveedor=${proveedor}`, { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { sinBase: d.sinBase === true });
  return d;
}
