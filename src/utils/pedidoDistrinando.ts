import * as XLSX from 'xlsx';
import { leerPendientesSucursal, type PendienteId } from './pedidoId';
import { REEBOK_LOCATION } from './reebokLogic';
import { talleArReebok } from './reebokCalzado';
import { unzipSync, strFromU8 } from 'fflate';

export const DISTRINANDO_LINES_QUERY = `query PedidoDistrinandoLines($id: ID!, $after: String) {
  fulfillmentOrder(id: $id) { lineItems(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id remainingQuantity lineItem { id title sku variantTitle
      variant { id barcode selectedOptions { name value } }
      product { id vendor tags }
    } }
  } }
}`;

export function leerPendientesDistrinando(ids: string[], progreso?: (n: number) => void) {
  return leerPendientesSucursal(ids, {
    ubicacion: REEBOK_LOCATION, etiqueta: 'DISTRINANDO',
    excluirTags: ['pedido distrinando', 'solucionar'], estadosPago: ['PAID', 'PARTIALLY_REFUNDED'],
    linesQuery: DISTRINANDO_LINES_QUERY,
  }, progreso);
}

export const normalizar = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
export function talleNormalizado(v: string) {
  const t = normalizar(v).replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? String(Number(t)) : t;
}
export interface ArticuloDistrinando {
  id: string; archivoId: string; archivo: string; hoja: string; fila: number; celda: string;
  codigo: string; sku: string; ean: string; titulo: string; talle: string;
  disponible: number; tope: boolean; marca: 'Reebok' | 'Kappa';
}
export interface HojaDistrinando { nombre: string; path: string; limpiar: string[] }
export interface ArchivoDistrinando {
  id: string; nombre: string; original: Uint8Array; hojas: HojaDistrinando[];
  articulos: ArticuloDistrinando[]; avisos: string[]; previas: number;
}
export interface FilaDistrinando {
  id: string; titulo: string; sku: string; talle: string; necesaria: number; ordenes: string[];
  candidatos: ArticuloDistrinando[]; elegido?: ArticuloDistrinando; pedir: number; faltante: number; motivo: string;
}

function rutaHoja(zip: Record<string, Uint8Array>, index: number) {
  const wb = strFromU8(zip['xl/workbook.xml']);
  const sheet = [...wb.matchAll(/<(?:[\w.-]+:)?sheet\b[^>]*>/g)][index]?.[0];
  const rid = sheet?.match(/r:id="([^"]+)"/)?.[1];
  const rel = [...strFromU8(zip['xl/_rels/workbook.xml.rels']).matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)]
    .find(m => m[0].match(/\bId="([^"]+)"/)?.[1] === rid)?.[0];
  const target = rel?.match(/Target="([^"]+)"/)?.[1];
  const path = target?.startsWith('/') ? target.slice(1) : `xl/${target?.replace(/^\.\//, '')}`;
  if (!zip[path]) throw new Error('No se pudo ubicar la hoja original del Excel.');
  return path;
}

/** Lee filas originales, sin aplicar las exclusiones de nuevas altas por pocos pares. */
export function leerExcelDistrinando(original: Uint8Array, nombre: string, id: string): ArchivoDistrinando {
  if (!/\.xlsx$/i.test(nombre)) throw new Error(`${nombre}: guardá la planilla como Libro de Excel (.xlsx) para conservar fotos y formato al completar el pedido.`);
  const zip = unzipSync(original);
  if (!zip['xl/workbook.xml']) throw new Error(`${nombre}: no es un libro .xlsx compatible.`);
  const wb = XLSX.read(original, { type: 'array', cellFormula: true });
  const p: ArchivoDistrinando = { id, nombre, original, hojas: [], articulos: [], avisos: [], previas: 0 };
  wb.SheetNames.forEach((hoja, index) => {
    if (wb.Workbook?.Sheets?.[index]?.Hidden) return;
    const ws = wb.Sheets[hoja];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 0, defval: '' });
    const h = rows.findIndex(r => r.some(v => normalizar(v) === 'MODELO COLOR') && r.some(v => normalizar(v) === 'PEDIDO'));
    if (h < 0) return;
    const hs = rows[h].map(normalizar);
    const col = (...names: string[]) => names.map(n => hs.indexOf(n)).find(i => i >= 0) ?? -1;
    const skuC = col('SKU', 'NUMERO DE ARTICULO'), modelC = col('MODELO COLOR'), descC = col('DESCRIPCION DEL ARTICULO');
    const stockC = col('DISPONIBLE (INMEDIATO)', 'DISPONIBLE', 'STOCK X SKU', 'STOCK');
    const udmC = col('UDM', 'UNI. MEDIDA', 'UNIDAD DE MEDIDA'), pedidoC = col('PEDIDO'), eanC = col('EAN');
    if ([skuC, modelC, descC, stockC, udmC, pedidoC].some(c => c < 0)) throw new Error(`${nombre}, ${hoja}: faltan columnas de SKU, modelo, descripción, disponibilidad, UDM o Pedido.`);
    const info: HojaDistrinando = { nombre: hoja, path: rutaHoja(zip, index), limpiar: [] };
    p.hojas.push(info);
    const vistos = new Map<string, string>(), eans = new Set<string>();
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i], sku = normalizar(r[skuC]);
      const celda = XLSX.utils.encode_cell({ r: i, c: pedidoC });
      // Limpiar también cantidades viejas en packs, filas inválidas y filas sin SKU.
      if (ws[celda]?.f) throw new Error(`${nombre}, ${hoja}, ${celda}: Pedido contiene una fórmula. Revisá la plantilla antes de reemplazarla.`);
      if (sku || r[pedidoC] !== '') info.limpiar.push(celda);
      if (r[pedidoC] !== '' && r[pedidoC] != null && Number(r[pedidoC]) !== 0) p.previas++;
      if (!sku) continue;
      const desc = String(r[descC] ?? '').trim(), udm = normalizar(r[udmC]);
      const aviso = (s: string) => p.avisos.push(`${nombre} · ${hoja} · fila ${i + 1}: ${sku} — ${s}`);
      if (/PACK|CURVA/.test(udm) || /(?:^|[\s-])(?:PACK|CURVA|M\d+U?)(?:[\s-]|$)/.test(sku + ' ' + normalizar(desc))) { aviso('pack/curva excluido.'); continue; }
      const marca = sku.startsWith('RBK') ? 'Reebok' : /^K\d/.test(sku) ? 'Kappa' : null;
      if (!marca) { aviso('marca sin identificar; excluido.'); continue; }
      const codigo = normalizar(r[modelC]).replace(/-+$/, '');
      if (!codigo || !sku.startsWith(codigo + '-')) { aviso('SKU y Modelo Color incompatibles; excluido.'); continue; }
      const suffix = sku.slice(codigo.length + 1).replace(',', '.');
      const ropa = /^(?:X{0,4}[SML]|[2-6]XL|TU|UNICO)$/.test(suffix);
      const calzado = /^(?:\d+(?:\.\d+)?[KW]?|M\d+(?:\.\d+)?\/W\d+(?:\.\d+)?)$/.test(suffix);
      if (!ropa && !calzado) { aviso('no tiene un talle individual; excluido.'); continue; }
      let talle = '';
      if (ropa || marca === 'Kappa') {
        if (normalizar(desc).endsWith(' ' + suffix)) talle = talleNormalizado(suffix);
      } else talle = talleArReebok(desc, suffix);
      if (calzado && talle && (Number(talle) < 20 || Number(talle) > 55)) talle = '';
      const rawEAN = r[eanC], eanText = String(rawEAN ?? '').trim();
      const ean = /^0*$/.test(eanText) ? '' : eanText;
      if (ean && (!/^\d{8,14}$/.test(ean) || (typeof rawEAN === 'number' && !Number.isSafeInteger(rawEAN)))) throw new Error(`${nombre}, fila ${i + 1}: EAN inválido; no se redondea.`);
      const stockText = String(r[stockC] ?? '').trim();
      const disponible = stockText === '-' ? 0 : Number(stockText.replace(/^\+\s*/, ''));
      if (!stockText || !Number.isInteger(disponible) || disponible < 0) { aviso('disponibilidad inválida; excluido.'); continue; }
      const firma = JSON.stringify([codigo, desc, ean, udm, stockText, r[col('MAYORISTA CON DESCUENTO')]]);
      if (vistos.has(sku)) {
        if (vistos.get(sku) !== firma) throw new Error(`${nombre}, ${hoja}: SKU repetido ${sku} con datos diferentes. Revisá las filas.`);
        aviso('fila duplicada idéntica omitida; no se suma disponibilidad.'); continue;
      }
      vistos.set(sku, firma);
      if (ean && eans.has(ean)) throw new Error(`${nombre}, ${hoja}: EAN repetido ${ean}.`);
      if (ean) eans.add(ean);
      if (!talle) aviso('sin talle AR validado: solo se puede asociar por EAN o SKU de variante exacto.');
      p.articulos.push({ id: `${id}:${index}:${i + 1}`, archivoId: id, archivo: nombre, hoja, fila: i + 1, celda,
        codigo, sku, ean, titulo: desc, talle, disponible, tope: stockText.startsWith('+'), marca });
    }
    const ultima = Math.max(0, ...p.articulos.filter(a => a.hoja === hoja).map(a => a.fila));
    const valorC = col('VALORIZADO');
    for (const [ref, cell] of Object.entries(ws)) {
      const subtotal = cell?.f?.replace(/\$/g, '').match(/^SUBTOTAL\((?:9|109),([A-Z]+\d+:[A-Z]+\d+)\)$/i);
      if (!subtotal) continue;
      const rango = XLSX.utils.decode_range(subtotal[1]);
      if (rango.s.c === valorC && rango.e.r + 1 < ultima) p.avisos.push(`${nombre} · ${hoja}: el subtotal original de ${ref} termina en fila ${rango.e.r + 1}, antes de la última fila de artículos (${ultima}). Revisá el total valorizado en Excel; las cantidades de Pedido se completan en todas las filas.`);
    }
  });
  if (!p.hojas.length) throw new Error(`${nombre}: no encontré una hoja visible con Modelo Color y Pedido.`);
  if (!p.articulos.length) throw new Error(`${nombre}: no encontré artículos individuales compatibles.`);
  return p;
}

function candidatosPara(l: PendienteId, articulos: ArticuloDistrinando[]) {
  const sku = normalizar(l.sku), barcode = String(l.barcode || '').trim();
  const tags = l.tags.map(normalizar), talle = talleNormalizado(l.talle);
  // Tags son del producto entero: un SKU en tags nunca identifica por sí solo un talle.
  const exactos = articulos.filter(a => (sku && (sku === a.sku || sku === a.ean)) || (barcode && barcode === a.ean));
  if (exactos.length) {
    if (new Set(exactos.map(a => a.sku)).size > 1) return { candidatos: [], motivo: 'SKU y EAN apuntan a variantes diferentes; revisar identificadores.' };
    if (exactos.some(a => a.talle && talle && a.talle !== talle)) return { candidatos: [], motivo: 'El identificador coincide pero el talle de Shopify y la planilla difieren; revisar.' };
    return { candidatos: exactos, motivo: '' };
  }
  // Sin EAN en listas antiguas, código exacto del producto + talle AR confirmado.
  // No recurrir a tags si hay un SKU de proveedor explícito que contradice la fila.
  const proveedorExplicito = /^(RBK|K\d)/.test(sku);
  const candidatos = articulos.filter(a => !proveedorExplicito && !!talle && a.talle === talle &&
    (tags.includes(a.codigo) || tags.includes(a.sku) || sku === a.codigo) &&
    (!l.vendor || normalizar(l.vendor).includes(normalizar(a.marca))));
  return { candidatos, motivo: candidatos.length ? '' : 'No se encontró una coincidencia segura en los Excel cargados.' };
}

/** Elecciones por grupo: vacío = dejar pendiente; ID = una única fila candidata. */
export function cruzarDistrinando(lineas: PendienteId[], archivos: ArchivoDistrinando[], elecciones: Record<string, string> = {}): FilaDistrinando[] {
  const articulos = archivos.flatMap(p => p.articulos), grupos = new Map<string, FilaDistrinando>();
  const vistas = new Set<string>();
  for (const l of lineas) {
    if (vistas.has(l.id)) continue;
    vistas.add(l.id);
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) throw new Error('Cantidad pendiente inválida.');
    const { candidatos, motivo } = candidatosPara(l, articulos);
    const key = JSON.stringify([l.variantId || normalizar(l.sku), talleNormalizado(l.talle), candidatos.map(a => a.id), motivo, candidatos.length ? '' : l.titulo]);
    let f = grupos.get(key);
    if (!f) {
      const elegido = Object.hasOwn(elecciones, key) ? candidatos.find(a => a.id === elecciones[key]) : candidatos.length === 1 ? candidatos[0] : undefined;
      f = { id: key, titulo: l.titulo, sku: l.sku, talle: l.talle, necesaria: 0, ordenes: [], candidatos, elegido, pedir: 0, faltante: 0,
        motivo: motivo || (!elegido ? candidatos.length > 1 ? 'Aparece en varias filas/listas: elegí dónde pedirlo.' : 'Dejado pendiente de revisión.' : '') };
      grupos.set(key, f);
    }
    f.necesaria += l.cantidad;
    if (!f.ordenes.includes(l.orden)) f.ordenes.push(l.orden);
  }
  // Una variante del proveedor no se pide en dos listas, aunque venga de dos variantes Shopify.
  const destinos = new Map<string, Set<string>>();
  for (const f of grupos.values()) if (f.elegido) {
    const set = destinos.get(f.elegido.sku) || new Set<string>();
    set.add(f.elegido.id); destinos.set(f.elegido.sku, set);
  }
  const usados = new Map<string, number>();
  for (const f of grupos.values()) {
    const a = f.elegido;
    if (a && destinos.get(a.sku)!.size > 1) { f.motivo = 'La misma variante está elegida en más de una lista. Elegí una sola para todas sus órdenes.'; }
    else if (a) {
      f.pedir = Math.min(f.necesaria, Math.max(0, a.disponible - (usados.get(a.id) || 0)));
      usados.set(a.id, (usados.get(a.id) || 0) + f.pedir);
      if (f.pedir < f.necesaria) f.motivo = 'Stock insuficiente en la planilla.';
    }
    f.faltante = f.necesaria - f.pedir;
  }
  return [...grupos.values()].sort((a, b) => (a.elegido?.codigo || a.sku).localeCompare(b.elegido?.codigo || b.sku, 'es', { numeric: true }) || a.talle.localeCompare(b.talle, 'es', { numeric: true }));
}
