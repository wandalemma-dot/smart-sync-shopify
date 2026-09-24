import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { shopifyGraphQL, mismaSucursal } from './shopify';
import { normalizarTalle } from './plantillaPedido';
import { converseTablaInfo, talleMatches, talleShopifyLeCoq, STOCK_LOCATION } from './syncLogic';
import { unidadesPorPackId } from './packsId';
import { extraerCodigo } from './reposicionLogic';

export const ORDER_QUERY = `query PedidoIdOrder($id: ID!, $after: String) {
  order(id: $id) { id name cancelledAt closed displayFinancialStatus tags
    fulfillmentOrders(first: 50, after: $after) { pageInfo { hasNextPage endCursor }
      nodes { id status assignedLocation { name location { id } } }
    }
  }
}`;
export const LINES_QUERY = `query PedidoIdLines($id: ID!, $after: String) {
  fulfillmentOrder(id: $id) { lineItems(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id remainingQuantity lineItem { id title sku variantTitle product { id vendor tags } } }
  } }
}`;

export interface PendienteId { orden: string; id: string; titulo: string; sku: string; talle: string; cantidad: number; tags: string[]; vendor: string }
export interface CeldaPedido { raw: string; col: number; disponible: number; tope: boolean }
export interface ArticuloPedido { codigo: string; nombre: string; row: number; celdas: CeldaPedido[]; pack: number }
export interface PlantillaId { original: Uint8Array; articulos: ArticuloPedido[]; sheetPath: string; limpiar: string[]; previas: number }
export interface FilaArmado {
  codigo: string; titulo: string; talle: string; talleProveedor: string; necesaria: number;
  disponible: number; pedir: number; faltante: number; pack: number; excedente: number;
  ordenes: string[]; motivo: string; celda?: string; tope?: boolean;
}
export interface ResultadoArmado { filas: FilaArmado[]; avisos: string[]; ordenes: number; generado: string }

export function idsOrdenes(text: string): string[] {
  const p = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });
  if (p.errors.length || !p.meta.fields?.includes('Id') || !p.meta.fields.includes('Name')) throw new Error('Usá el export CSV de Órdenes de Shopify, con las columnas Id y Name.');
  const ids = new Set<string>();
  for (const row of p.data) {
    const id = String(row.Id || '').trim();
    if (id && !/^\d+$/.test(id)) throw new Error('El CSV contiene un Id de orden inválido. Volvé a exportarlo desde Shopify.');
    if (id) ids.add(`gid://shopify/Order/${id}`);
  }
  if (!ids.size) throw new Error('No encontré identificadores de órdenes en el CSV.');
  return [...ids];
}

function cursor(conn: any, anterior: string | null): string | null {
  if (!conn?.pageInfo || !Array.isArray(conn.nodes)) throw new Error('Shopify no devolvió una respuesta completa. No se generó el pedido.');
  if (!conn.pageInfo.hasNextPage) return null;
  const next = conn.pageInfo.endCursor;
  if (!next || next === anterior) throw new Error('No se pudo completar la lectura de Shopify. Reintentá.');
  return next;
}

export async function leerPendientesId(ids: string[], progreso?: (n: number) => void): Promise<{ lineas: PendienteId[]; avisos: string[] }> {
  // Sin este permiso Shopify puede devolver solo una parte de las asignaciones.
  const access: any = await shopifyGraphQL(`query PedidoIdPermisos { currentAppInstallation { accessScopes { handle } } }`);
  const scopes = new Set((access?.currentAppInstallation?.accessScopes || []).map((s: any) => s.handle));
  if (!scopes.has('read_merchant_managed_fulfillment_orders') && !scopes.has('write_merchant_managed_fulfillment_orders')) {
    throw new Error('Falta habilitar en la conexión de la app el permiso de lectura read_merchant_managed_fulfillment_orders. Sin él no se puede comprobar la sucursal iD.');
  }
  const lineas: PendienteId[] = [], avisos: string[] = [];
  const vistos = new Set<string>();
  let n = 0;
  for (const id of [...new Set(ids)]) {
    let after: string | null = null;
    let idEncontrado = false;
    do {
      const data: any = await shopifyGraphQL(ORDER_QUERY, { id, after });
      const o = data?.order;
      if (!o) throw new Error(`No pude leer la orden ${id.split('/').pop()}. Revisá permisos o antigüedad; no se descarga un pedido incompleto.`);
      const tags = (o.tags || []).map((t: string) => t.trim().toLowerCase());
      if (o.cancelledAt || o.closed || o.displayFinancialStatus !== 'PAID' || tags.some((t: string) => ['pedido id', 'solucionar'].includes(t))) {
        avisos.push(`${o.name}: excluida por estar cancelada/cerrada, no pagada o etiquetada pedido id/solucionar.`); break;
      }
      const conn = o.fulfillmentOrders;
      const next = cursor(conn, after);
      for (const fo of conn.nodes) {
        if (!mismaSucursal(fo.assignedLocation?.name, STOCK_LOCATION.converse)) continue;
        idEncontrado = true;
        if (!['OPEN', 'IN_PROGRESS'].includes(fo.status)) { avisos.push(`${o.name}: preparación de iD en estado ${fo.status}; revisar, no incluida.`); continue; }
        let page: string | null = null;
        do {
          const d: any = await shopifyGraphQL(LINES_QUERY, { id: fo.id, after: page });
          const c = d?.fulfillmentOrder?.lineItems;
          const siguiente = cursor(c, page);
          for (const item of c.nodes) {
            if (vistos.has(item.id)) continue;
            vistos.add(item.id);
            if (!Number.isInteger(item.remainingQuantity) || item.remainingQuantity < 0) throw new Error('Cantidad pendiente inválida en Shopify.');
            if (!item.remainingQuantity) continue;
            const l = item.lineItem;
            lineas.push({ orden: o.name, id: item.id, titulo: l.title, sku: l.sku || '', talle: l.variantTitle || '', cantidad: item.remainingQuantity, tags: l.product?.tags || [], vendor: l.product?.vendor || '' });
          }
          page = siguiente;
        } while (page);
      }
      after = next;
      if (!after && !idEncontrado) avisos.push(`${o.name}: sin preparación visible asignada a iD; no incluida.`);
    } while (after);
    progreso?.(++n);
  }
  return { lineas, avisos };
}

export function leerPlantillaId(original: Uint8Array): PlantillaId {
  const wb = XLSX.read(original, { type: 'array' });
  const nombres = wb.SheetNames.filter(n => {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1 });
    return rows.slice(0, 8).some(r => /art.culo/i.test(String(r[1])) && String(r[3]).toLowerCase() === 'precio');
  });
  if (nombres.length !== 1) throw new Error('La plantilla debe tener una única hoja de pedido iD reconocible.');
  const sheetIndex = wb.SheetNames.indexOf(nombres[0]);
  const zip = unzipSync(original);
  const workbook = strFromU8(zip['xl/workbook.xml']);
  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)][sheetIndex]?.[0];
  const rid = sheet?.match(/r:id="([^"]+)"/)?.[1];
  const rels = strFromU8(zip['xl/_rels/workbook.xml.rels']);
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].find(m => m[0].includes(`Id="${rid}"`))?.[0];
  const target = rel?.match(/Target="([^"]+)"/)?.[1];
  const sheetPath = target?.startsWith('/') ? target.slice(1) : `xl/${target}`;
  if (!zip[sheetPath]) throw new Error('No se pudo ubicar la hoja original dentro del Excel.');
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[nombres[0]], { header: 1 });
  const h = rows.findIndex(r => /art.culo/i.test(String(r[1])) && String(r[3]).toLowerCase() === 'precio');
  const fin = rows[h].findIndex(x => String(x).toLowerCase() === 'unidades');
  if (fin <= 5) throw new Error('No se encontraron las columnas de talles de iD.');
  const articulos: ArticuloPedido[] = [], limpiar: string[] = [];
  let previas = 0;
  for (let r = h + 1; r < rows.length; r++) {
    if (String(rows[r][4]).trim().toLowerCase() !== 'disponible') continue;
    if (String(rows[r + 1]?.[4]).trim().toLowerCase() !== 'cantidad') throw new Error(`Falta la fila Cantidad debajo de la fila ${r + 1}.`);
    const codigo = String(rows[r][1] || '').trim().toUpperCase();
    if (!codigo || articulos.some(a => a.codigo === codigo)) throw new Error(`Código vacío o repetido en la plantilla: ${codigo}.`);
    const celdas: CeldaPedido[] = [];
    for (let c = 5; c < fin; c++) {
      const raw = String(rows[h][c] ?? '').trim();
      if (!raw) continue;
      const val = String(rows[r][c] ?? '').trim();
      const cantidad = val === '-' || val === '' ? 0 : Number(val.replace(/^\+/, ''));
      if (!Number.isInteger(cantidad) || cantidad < 0) throw new Error(`${codigo}: disponibilidad inválida en ${raw}.`);
      celdas.push({ raw, col: c, disponible: cantidad, tope: val.startsWith('+') });
      limpiar.push(XLSX.utils.encode_cell({ r: r + 1, c }));
      if (Number(rows[r + 1]?.[c]) > 0) previas++;
    }
    const nombre = String(rows[r + 1]?.[1] || '');
    articulos.push({ codigo, nombre, row: r + 1, celdas, pack: unidadesPorPackId(nombre) });
    r++;
  }
  if (!articulos.length) throw new Error('La plantilla no contiene artículos.');
  return { original, articulos, sheetPath, limpiar, previas };
}

export function cruzarPedido(lineas: PendienteId[], plantilla: PlantillaId, avisos: string[] = [], ordenes = 0): ResultadoArmado {
  const groups = new Map<string, FilaArmado>();
  for (const l of lineas) {
    const sku = l.sku.trim().toUpperCase();
    const tags = l.tags.map(t => t.trim().toUpperCase());
    const candidatos = plantilla.articulos.filter(a => tags.includes(a.codigo) || sku === a.codigo || sku.startsWith(`${a.codigo}-`));
    const a = candidatos.length === 1 ? candidatos[0] : null;
    const codigo = a?.codigo || extraerCodigo(tags.join(',')) || sku || 'Sin código';
    const marca = /converse/i.test(l.vendor) ? 'converse' : /coq/i.test(l.vendor) ? 'lecoq' : null;
    let motivo = candidatos.length > 1 ? 'Más de un código coincide: revisar.' : !a ? 'Código no encontrado en esta plantilla.' : !marca ? 'Marca no identificada: revisar.' : '';
    let cell: CeldaPedido | undefined;
    if (a && marca && !motivo) {
      let matches: CeldaPedido[];
      if (marca === 'converse' && /^\d+(?:[.,]\d+)?$/.test(l.talle.trim())) {
        const info = converseTablaInfo(codigo, tags.join(','));
        if (info.origen === 'default') { motivo = 'Falta confirmar la tabla de talle Converse.'; matches = []; }
        else matches = a.celdas.filter(c => talleMatches(info.tabla[normalizarTalle(c.raw, marca)] ?? '__sin_equivalencia__', l.talle));
      } else {
        matches = a.celdas.filter(c => {
          const size = normalizarTalle(c.raw, marca);
          return talleMatches(marca === 'lecoq' ? talleShopifyLeCoq(size, a.nombre) : size, l.talle);
        });
      }
      if (matches.length !== 1) motivo ||= 'Talle sin equivalencia única en la plantilla.';
      else cell = matches[0];
    }
    const celda = a && cell ? XLSX.utils.encode_cell({ r: a.row, c: cell.col }) : undefined;
    const key = celda || `${codigo}|${l.talle}|${motivo}`;
    let f = groups.get(key);
    if (!f) {
      f = { codigo, titulo: l.titulo, talle: l.talle, talleProveedor: cell?.raw || '—', necesaria: 0, disponible: cell?.disponible || 0,
        pedir: 0, faltante: 0, pack: a?.pack || 1, excedente: 0, ordenes: [], motivo, celda, tope: cell?.tope };
      groups.set(key, f);
    }
    f.necesaria += l.cantidad;
    if (!f.ordenes.includes(l.orden)) f.ordenes.push(l.orden);
  }
  for (const f of groups.values()) {
    f.pedir = f.motivo ? 0 : Math.min(Math.ceil(f.necesaria / f.pack), f.disponible);
    f.faltante = Math.max(0, f.necesaria - f.pedir * f.pack);
    f.excedente = Math.max(0, f.pedir * f.pack - f.necesaria);
    if (!f.motivo && f.faltante) f.motivo = f.disponible === 0 ? 'Sin stock en la plantilla.' : 'Stock insuficiente.';
  }
  return { filas: [...groups.values()], avisos, ordenes, generado: new Date().toISOString() };
}

// Editar solo celdas de Cantidad dentro del ZIP conserva fotos, UUIDs, estilos,
// validaciones y todas las otras hojas; no reserializamos el libro con SheetJS.
export function generarExcelPedido(p: PlantillaId, r: ResultadoArmado): Uint8Array {
  const zip = unzipSync(p.original);
  let xml = strFromU8(zip[p.sheetPath]);
  const valores = new Map(p.limpiar.map(c => [c, 0]));
  for (const f of r.filas) if (f.celda && f.pedir > 0) valores.set(f.celda, f.pedir);
  const encontradas = new Set<string>();
  xml = xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (whole, attrs: string) => {
    const ref = attrs.match(/\br="([^"]+)"/)?.[1];
    if (!ref || !valores.has(ref)) return whole;
    encontradas.add(ref);
    const limpio = attrs.replace(/\s+t="[^"]*"/g, '');
    return `<c${limpio}><v>${valores.get(ref)}</v></c>`;
  });
  // En plantillas que omiten celdas vacías, insertar ordenadas dentro de su fila.
  for (const [ref, qty] of valores) if (!encontradas.has(ref) && qty > 0) {
    const row = ref.match(/\d+$/)![0];
    const re = new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
    if (!re.test(xml)) throw new Error(`No se encontró la fila de pedido ${row}.`);
    xml = xml.replace(re, (_m, start, body, end) => {
      const cells = [...body.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)].map((m: RegExpMatchArray) => m[0]);
      cells.push(`<c r="${ref}"><v>${qty}</v></c>`);
      cells.sort((a, b) => XLSX.utils.decode_cell(a.match(/\br="([^"]+)"/)![1]).c - XLSX.utils.decode_cell(b.match(/\br="([^"]+)"/)![1]).c);
      return start + cells.join('') + end;
    });
  }
  // Actualizar también los resultados de SUM y multiplicación que usa iD,
  // para que el importador vea totales correctos aun sin abrir antes Excel.
  const wbValues = XLSX.read(p.original, { type: 'array', cellFormula: true });
  const valuesSheet = wbValues.Sheets[wbValues.SheetNames.find(n => {
    const rs = XLSX.utils.sheet_to_json<any[]>(wbValues.Sheets[n], { header: 1 });
    return rs.slice(0, 8).some(row => /art.culo/i.test(String(row[1])) && String(row[3]).toLowerCase() === 'precio');
  })!];
  function value(ref: string, seen = new Set<string>()): number {
    ref = ref.replace(/\$/g, '').trim();
    if (valores.has(ref)) return valores.get(ref)!;
    if (seen.has(ref)) throw new Error('Fórmula circular en la plantilla.');
    const cell = valuesSheet[ref];
    if (!cell?.f) return Number(cell?.v) || 0;
    const visited = new Set(seen).add(ref);
    const f = cell.f.replace(/\$/g, '').trim();
    if (/^SUM\(/i.test(f)) return f.slice(4, -1).split(',').reduce((total: number, arg: string) => {
      if (!arg.includes(':')) return total + value(arg, visited);
      const range = XLSX.utils.decode_range(arg);
      let sum = 0;
      for (let r = range.s.r; r <= range.e.r; r++) for (let c = range.s.c; c <= range.e.c; c++) sum += value(XLSX.utils.encode_cell({ r, c }), visited);
      return total + sum;
    }, 0);
    if (/^[A-Z]+\d+\*[A-Z]+\d+$/i.test(f)) return f.split('*').reduce((n: number, part: string) => n * value(part, visited), 1);
    throw new Error('Fórmula no compatible');
  }
  xml = xml.replace(/<c\b([^>]*?)>([\s\S]*?)<\/c>/g, (whole, attrs: string, body: string) => {
    if (!/<f\b/.test(body)) return whole;
    const ref = attrs.match(/\br="([^"]+)"/)?.[1];
    const clean = body.replace(/<v>[^<]*<\/v>/g, '');
    try { return `<c${attrs}>${clean}<v>${value(ref!)}</v></c>`; }
    catch { return `<c${attrs}>${clean}</c>`; }
  });
  zip[p.sheetPath] = strToU8(xml);
  let wb = strFromU8(zip['xl/workbook.xml']);
  wb = wb.replace(/<calcPr\b[^>]*\/>/g, '');
  wb = wb.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
  zip['xl/workbook.xml'] = strToU8(wb);
  return zipSync(zip);
}
