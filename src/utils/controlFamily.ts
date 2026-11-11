// ============================================================================
// FAMILY (Familyarg) — control de entregas SIN factura (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Family es marketplace y no factura. Cada entrega trae:
//   · la planilla «ENTREGA MERCADERIA» (código, artículo, modelo, corte, color,
//     PRECIOXMAYOR, PRECIO PUBLICO, cantidades por talle S…3XL y TOTAL), y
//   · el remito (código y total por artículo, sin precios).
// A veces trae productos NUEVOS y a veces REPOSICIÓN: se distingue buscando el
// código en el SKU de Shopify (los SKU de Family empiezan con el código:
// HPRST01S, RMCGA01.NEG.S, WORPT01). Si Family cambió un precio, se AVISA
// (contra Shopify y contra la entrega anterior del mismo código).
// Los precios NUNCA se cambian desde acá. Shopify: SOLO LECTURA.
// ============================================================================
import { fmt, type Remito, type TalleCantidad } from './controlFacturas';
import { numero } from './lectoresFacturas';

export interface RenglonFamily {
  codigo: string;
  descripcion: string;
  precioMayor: number;
  precioPublico: number;
  cantidad: number;          // suma de talles (o el total si no hay talles)
  talles: TalleCantidad[];
  totalImpreso?: number;     // columna TOTAL de la planilla, para controlar la suma
}
/** Un producto de Shopify que corresponde al código de Family. */
export interface ProductoFamily { titulo: string; vendor: string; precios: number[]; costos: number[]; talles: string[] }
/** Lo que había en Shopify cuando se controló la entrega (queda guardado con la entrega). */
export interface ConsultaShopify { fecha: string; error?: string; codigos: Record<string, ProductoFamily[]> }
export interface EntregaFamily {
  id: string;
  nombre: string;
  fecha: string;             // AAAA-MM-DD
  origen?: 'excel' | 'foto' | 'manual';
  renglones: RenglonFamily[];
  dudas?: string[];
  shopify?: ConsultaShopify | null;
  actualizado?: string;
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const centavos = (n: number) => Math.round((Number(n) || 0) * 100);
const RE_TALLE_COL = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|TU|U|\d{1,2})$/;
const RE_CODIGO = /^[A-Z0-9][A-Z0-9._/-]{2,}$/;
const MESES: Record<string, number> = { JAN: 1, ENE: 1, FEB: 2, MAR: 3, APR: 4, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DEC: 12, DIC: 12 };

const iso = (a: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && a >= 2000 && a < 2100
  ? `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');

/** Fecha de una celda: número de Excel, «30-Oct-26», «30/10/2026» o «2026-10-30». '' si no hay. */
export function fechaFamily(v: unknown): string {
  if (typeof v === 'number') return v > 40000 && v < 60000 ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : '';
  const s = norm(v);
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /\b(\d{1,2})[-/ ]([A-Z]{3})[A-Z]*\.?[-/ ](\d{2}|\d{4})\b/.exec(s);
  if (m && MESES[m[2]]) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], MESES[m[2]], +m[1]);
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return '';
}

/** Talle para comparar con Shopify: 2XL = XXL, 3XL = XXXL. */
export function talleFamily(t: string): string {
  const s = norm(t).replace(/\s+/g, '');
  const eq: Record<string, string> = { '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL', U: 'TU', UNICO: 'TU' };
  return eq[s] ?? s;
}

function agregarRenglon(porCodigo: Map<string, RenglonFamily>, r: RenglonFamily, avisos: string[], donde: string) {
  const ya = porCodigo.get(r.codigo);
  if (!ya) { porCodigo.set(r.codigo, r); return; }
  // El mismo código dos veces: se suman las cantidades y se avisa (no debería pasar).
  avisos.push(`${donde}: ${r.codigo} aparece dos veces; se sumaron las cantidades.`);
  for (const t of r.talles) {
    const x = ya.talles.find((y) => talleFamily(y.talle) === talleFamily(t.talle));
    if (x) x.cantidad += t.cantidad; else ya.talles.push({ ...t });
  }
  ya.cantidad += r.cantidad;
  if (ya.totalImpreso !== undefined || r.totalImpreso !== undefined) ya.totalImpreso = (ya.totalImpreso ?? 0) + (r.totalImpreso ?? 0);
  if (centavos(ya.precioMayor) !== centavos(r.precioMayor) || centavos(ya.precioPublico) !== centavos(r.precioPublico)) {
    avisos.push(`${donde}: ${r.codigo} trae dos precios distintos; se usa el primero.`);
  }
}

/**
 * Lee la planilla «ENTREGA MERCADERIA» de Family (Excel). Columnas por NOMBRE:
 * CODIGO, ARTICULO, MODELO, CORTE, COLOR, PRECIOXMAYOR, PRECIO PUBLICO, talles y TOTAL.
 * La fecha sale de las filas de arriba del encabezado (ej. «30-Oct-26»).
 */
export function leerEntregaFamily(filas: unknown[][], nombre: string, fechaPorDefecto: string): { entrega: Omit<EntregaFamily, 'id'>; avisos: string[] } {
  const avisos: string[] = [];
  const h = filas.findIndex((f) => (f ?? []).some((c) => norm(c) === 'CODIGO') && (f ?? []).some((c) => /PUBLICO/.test(norm(c))));
  if (h < 0) throw new Error('No encontré el encabezado de la planilla de Family (CODIGO … PRECIO PUBLICO … TOTAL).');
  const enc = (filas[h] ?? []).map(norm);
  const col = (re: RegExp) => enc.findIndex((c) => re.test(c));
  const cCodigo = enc.indexOf('CODIGO');
  const cArt = col(/^ARTICULO$/), cModelo = col(/^MODELO$/), cCorte = col(/^CORTE$/), cColor = col(/^COLOR$/);
  const cMayor = col(/MAYOR/), cPublico = col(/PUBLICO/), cTotal = enc.indexOf('TOTAL');
  const talles = enc.map((c, i) => ({ c, i })).filter(({ c, i }) => RE_TALLE_COL.test(c.replace(/\s+/g, '')) && ![cCodigo, cArt, cModelo, cCorte, cColor, cMayor, cPublico, cTotal].includes(i));
  if (!talles.length && cTotal < 0) throw new Error('La planilla de Family no tiene columnas de talles ni TOTAL.');
  if (cMayor < 0) avisos.push('La planilla no tiene la columna PRECIOXMAYOR: no se controla ese precio.');
  if (cPublico < 0) avisos.push('La planilla no tiene la columna PRECIO PUBLICO: no se controla ese precio.');

  let fecha = '';
  for (let i = 0; i <= h && !fecha; i++) for (const c of filas[i] ?? []) { fecha = fechaFamily(c); if (fecha) break; }

  const porCodigo = new Map<string, RenglonFamily>();
  for (let i = h + 1; i < filas.length; i++) {
    const f = filas[i] ?? [];
    const codigo = norm(f[cCodigo]).replace(/\s+/g, '');
    if (!codigo) continue;
    if (/^TOTAL/.test(codigo)) continue;
    if (!RE_CODIGO.test(codigo)) { avisos.push(`Fila ${i + 1}: no reconozco el código «${f[cCodigo]}»; no se cargó.`); continue; }
    const ts: TalleCantidad[] = [];
    for (const { c, i: j } of talles) {
      const n = numero(f[j]);
      if (Number.isFinite(n) && n > 0) ts.push({ talle: c.replace(/\s+/g, ''), cantidad: Math.round(n) });
    }
    const suma = ts.reduce((s, t) => s + t.cantidad, 0);
    const total = cTotal >= 0 ? numero(f[cTotal]) : NaN;
    const cantidad = ts.length ? suma : Number.isFinite(total) ? Math.round(total) : 0;
    if (!cantidad) { avisos.push(`Fila ${i + 1}: ${codigo} no tiene cantidades; no se cargó.`); continue; }
    if (ts.length && Number.isFinite(total) && Math.round(total) !== suma) avisos.push(`${codigo}: la suma de talles (${suma}) no coincide con el TOTAL de la planilla (${Math.round(total)}).`);
    const precio = (j: number, que: string) => {
      if (j < 0) return 0;
      const n = numero(f[j]);
      if (!Number.isFinite(n) || n <= 0) { avisos.push(`${codigo}: sin ${que}.`); return 0; }
      return Math.round(n * 100) / 100;
    };
    const descripcion = [cArt, cModelo, cCorte, cColor].filter((j) => j >= 0).map((j) => String(f[j] ?? '').trim()).filter(Boolean).join(' ');
    agregarRenglon(porCodigo, {
      codigo, descripcion, precioMayor: precio(cMayor, 'precio por mayor'), precioPublico: precio(cPublico, 'precio público'),
      cantidad, talles: ts, ...(Number.isFinite(total) ? { totalImpreso: Math.round(total) } : {}),
    }, avisos, 'Planilla');
  }
  if (!porCodigo.size) throw new Error('La planilla de Family no tiene artículos con cantidades.');
  if (!fecha) avisos.push('La planilla no trae la fecha: se usó la de hoy (se puede corregir).');
  return { entrega: { nombre, fecha: fecha || fechaPorDefecto, origen: 'excel', renglones: [...porCodigo.values()] }, avisos };
}

// ---------------------------------------------------------------------------
// FORMATO DE TEXTO (para escribir o corregir la planilla a mano)
//   Fecha 30/10/2026
//   SHBSPEC S/2 M/4 L/4 XL/6 2XL/4 $34500 $69000 Short Spectrum Basket Negro/Multi
// El primer $ es el precio por mayor y el segundo el público. Lo demás es la descripción.
// ---------------------------------------------------------------------------
export function leerTextoEntregaFamily(texto: string): { fecha: string; renglones: RenglonFamily[]; errores: string[] } {
  const errores: string[] = [];
  let fecha = '';
  const porCodigo = new Map<string, RenglonFamily>();
  String(texto ?? '').split(/\r?\n/).forEach((cruda, i) => {
    const linea = cruda.trim();
    if (!linea || linea.startsWith('#')) return;
    if (/^fecha\b/i.test(linea)) { fecha = fechaFamily(linea.replace(/^fecha\s*:?\s*/i, '')) || fecha; return; }
    const tokens = linea.replace(/\s*([/×:=])\s*/g, '$1').split(/[\s;]+/).filter(Boolean);
    const codigo = tokens[0].toUpperCase();
    if (!RE_CODIGO.test(codigo)) { errores.push(`Línea ${i + 1}: no reconozco el código «${tokens[0]}».`); return; }
    const r: RenglonFamily = { codigo, descripcion: '', precioMayor: 0, precioPublico: 0, cantidad: 0, talles: [] };
    const precios: number[] = [];
    const desc: string[] = [];
    let total = 0;
    for (const t of tokens.slice(1)) {
      if (t.startsWith('$')) {
        const n = numero(t);
        if (!Number.isFinite(n) || n <= 0) { errores.push(`Línea ${i + 1}: no entiendo el precio «${t}».`); continue; }
        precios.push(Math.round(n * 100) / 100);
        continue;
      }
      const m = /^([A-Z0-9.]+?)[/×:=](\d+)$/i.exec(t);
      if (m) { r.talles.push({ talle: m[1].toUpperCase(), cantidad: Number(m[2]) }); continue; }
      if (/^\d+$/.test(t)) { total += Number(t); continue; }
      if (/\d/.test(t) && !/\//.test(t)) { errores.push(`Línea ${i + 1}: no entiendo «${t}» (talle/cantidad, por ejemplo XL/6).`); continue; }
      desc.push(t);
    }
    if (precios.length > 2) errores.push(`Línea ${i + 1}: hay más de dos precios (van el por mayor y el público).`);
    [r.precioMayor = 0, r.precioPublico = 0] = precios;
    r.descripcion = desc.join(' ');
    const suma = r.talles.reduce((s, t) => s + t.cantidad, 0);
    r.cantidad = r.talles.length ? suma : total;
    if (r.talles.length && total) { r.totalImpreso = total; if (total !== suma) errores.push(`Línea ${i + 1}: ${codigo} suma ${suma} por talle y dice total ${total}.`); }
    if (!r.cantidad) { errores.push(`Línea ${i + 1}: ${codigo} no tiene cantidades.`); return; }
    agregarRenglon(porCodigo, r, errores, `Línea ${i + 1}`);
  });
  return { fecha, renglones: [...porCodigo.values()], errores };
}

const precioTexto = (n: number) => (n ? `$${Number.isInteger(n) ? n : n.toFixed(2)}` : '');
export function textoEntregaFamily(e: Pick<EntregaFamily, 'fecha' | 'renglones'>): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.fecha || '');
  const lineas = m ? [`Fecha ${m[3]}/${m[2]}/${m[1]}`] : [];
  for (const r of e.renglones) {
    lineas.push([r.codigo, ...(r.talles.length ? r.talles.map((t) => `${t.talle}/${t.cantidad}`) : [String(r.cantidad)]),
      precioTexto(r.precioMayor), precioTexto(r.precioPublico), r.descripcion].filter(Boolean).join(' '));
  }
  return lineas.join('\n');
}

// ---------------------------------------------------------------------------
// SHOPIFY (solo lectura): ¿el código ya existe? → reposición; si no → nuevo.
// ---------------------------------------------------------------------------
const RE_TALLE_PEGADO = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|TU|U)$/;
/** El SKU es de ese código: igual, o el código seguido de separador o de un talle en letras (HPRST01XXL). */
export function skuEsDelCodigo(sku: string, codigo: string): boolean {
  const s = String(sku ?? '').trim().toUpperCase(), c = String(codigo ?? '').trim().toUpperCase();
  if (!s || !c || !s.startsWith(c)) return false;
  const resto = s.slice(c.length);
  return !resto || /^[.\-_/ ]/.test(resto) || RE_TALLE_PEGADO.test(resto);
}

export interface VarianteShopify { sku: string; talle: string; precio: number; costo: number | null; producto: string; vendor: string }

/** Agrupa las variantes de Shopify por código de Family y por producto. */
export function agruparShopify(codigos: string[], variantes: VarianteShopify[]): Record<string, ProductoFamily[]> {
  const out: Record<string, ProductoFamily[]> = {};
  for (const codigo of codigos) {
    const porProducto = new Map<string, ProductoFamily>();
    for (const v of variantes) {
      if (!skuEsDelCodigo(v.sku, codigo)) continue;
      const k = `${v.producto}|${v.vendor}`;
      const p = porProducto.get(k) ?? { titulo: v.producto, vendor: v.vendor, precios: [], costos: [], talles: [] };
      if (!p.precios.some((x) => centavos(x) === centavos(v.precio))) p.precios.push(v.precio);
      if (v.costo !== null && !p.costos.some((x) => centavos(x) === centavos(v.costo!))) p.costos.push(v.costo);
      if (v.talle && !p.talles.includes(v.talle)) p.talles.push(v.talle);
      porProducto.set(k, p);
    }
    out[codigo] = [...porProducto.values()];
  }
  return out;
}

type Gql = (query: string, variables: Record<string, unknown>) => Promise<unknown>;
const QUERY_VARIANTES = `query($q: String!, $cursor: String) {
  productVariants(first: 100, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { sku title price inventoryItem { unitCost { amount } } product { title vendor } }
  }
}`;
interface PaginaVariantes {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { sku: string | null; title: string; price: string; inventoryItem?: { unitCost?: { amount: string } | null } | null; product: { title: string; vendor: string } }[];
  };
}

/** Busca en Shopify los códigos de la entrega (por prefijo de SKU). Solo lectura. */
export async function consultarShopifyFamily(codigos: string[], gql: Gql): Promise<ConsultaShopify> {
  const fecha = new Date().toISOString();
  const validos = [...new Set(codigos.map((c) => c.toUpperCase()))].filter((c) => /^[A-Z0-9._-]+$/.test(c));
  const variantes: VarianteShopify[] = [];
  try {
    for (let i = 0; i < validos.length; i += 20) {
      const q = validos.slice(i, i + 20).map((c) => `sku:${c}*`).join(' OR ');
      let cursor: string | null = null;
      for (let pagina = 0; pagina < 30; pagina++) {
        const d = (await gql(QUERY_VARIANTES, { q, cursor })) as PaginaVariantes;
        for (const n of d.productVariants.nodes) {
          const costo = n.inventoryItem?.unitCost?.amount;
          variantes.push({ sku: n.sku || '', talle: n.title, precio: Number(n.price) || 0, costo: costo == null ? null : Number(costo), producto: n.product.title, vendor: n.product.vendor });
        }
        if (!d.productVariants.pageInfo.hasNextPage) break;
        cursor = d.productVariants.pageInfo.endCursor;
      }
    }
  } catch (e) {
    return { fecha, error: e instanceof Error ? e.message.slice(0, 200) : 'No se pudo consultar Shopify.', codigos: {} };
  }
  return { fecha, codigos: agruparShopify(validos, variantes) };
}

// ---------------------------------------------------------------------------
// CONTROL
// ---------------------------------------------------------------------------
export type SemaforoFamily = 'ok' | 'observaciones' | 'revisar' | 'incompleta';
export interface FilaFamily {
  codigo: string;
  descripcion: string;
  entrega: number;
  remito: number | null;
  tipo: 'nuevo' | 'reposicion' | 'sin-consultar';
  productos: ProductoFamily[];
  precioMayor: number;
  precioPublico: number;
  /** Última entrega anterior con el mismo código. */
  anterior: { fecha: string; precioMayor: number; precioPublico: number } | null;
  cambiosPrecio: string[];
  tallesNuevos: string[];
  sumaMal: boolean;
}
export interface ResultadoFamily {
  entrega: EntregaFamily;
  remito: Remito | null;
  filas: FilaFamily[];
  extrasRemito: { codigo: string; cantidad: number }[];
  semaforo: SemaforoFamily;
  motivos: string[];
  unidades: number;
  nuevos: number;
  reposiciones: number;
}

const fechaAr = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
const antesQue = (a: EntregaFamily, b: EntregaFamily) => a.fecha < b.fecha || (a.fecha === b.fecha && a.id < b.id);

/**
 * Controla una entrega de Family: planilla contra remito, nuevo o reposición
 * (según lo que había en Shopify al controlarla) y cambios de precio.
 * `todas` son todas las entregas guardadas (para comparar con la anterior).
 */
export function controlarEntregaFamily(e: EntregaFamily, remito: Remito | null | undefined, todas: EntregaFamily[]): ResultadoFamily {
  const rem = remito ?? null;
  const enRemito = new Map<string, number>();
  for (const r of rem?.renglones ?? []) {
    const c = r.codigo.toUpperCase().replace(/\s+/g, '');
    enRemito.set(c, (enRemito.get(c) ?? 0) + r.cantidad);
  }
  const previas = todas.filter((x) => x.id !== e.id && antesQue(x, e)).sort((a, b) => (antesQue(a, b) ? 1 : -1));
  const consulta = e.shopify ?? null;
  const filas: FilaFamily[] = e.renglones.map((r) => {
    const productos = consulta && !consulta.error ? consulta.codigos[r.codigo] : undefined;
    const tipo: FilaFamily['tipo'] = productos === undefined ? 'sin-consultar' : productos.length ? 'reposicion' : 'nuevo';
    const cambiosPrecio: string[] = [];
    if (tipo === 'reposicion' && r.precioPublico > 0) {
      const precios = productos!.flatMap((p) => p.precios);
      if (precios.some((p) => centavos(p) !== centavos(r.precioPublico))) {
        cambiosPrecio.push(`Precio público: Family dice ${fmt(r.precioPublico)} y en Shopify está a ${[...new Set(precios.map(fmt))].join(' / ')}.`);
      }
    }
    const prev = previas.find((x) => x.renglones.some((y) => y.codigo === r.codigo));
    const pr = prev?.renglones.find((y) => y.codigo === r.codigo);
    const anterior = prev && pr ? { fecha: prev.fecha, precioMayor: pr.precioMayor, precioPublico: pr.precioPublico } : null;
    if (anterior) {
      const partes: string[] = [];
      if (anterior.precioMayor > 0 && r.precioMayor > 0 && centavos(anterior.precioMayor) !== centavos(r.precioMayor)) partes.push(`por mayor ${fmt(anterior.precioMayor)} → ${fmt(r.precioMayor)}`);
      if (anterior.precioPublico > 0 && r.precioPublico > 0 && centavos(anterior.precioPublico) !== centavos(r.precioPublico)) partes.push(`público ${fmt(anterior.precioPublico)} → ${fmt(r.precioPublico)}`);
      if (partes.length) cambiosPrecio.push(`Family cambió el precio desde la entrega del ${fechaAr(anterior.fecha)}: ${partes.join(', ')}.`);
    }
    const existentes = new Set((productos ?? []).flatMap((p) => p.talles.map(talleFamily)));
    const tallesNuevos = tipo === 'reposicion' ? r.talles.filter((t) => !existentes.has(talleFamily(t.talle))).map((t) => t.talle) : [];
    const suma = r.talles.reduce((s, t) => s + t.cantidad, 0);
    return {
      codigo: r.codigo, descripcion: r.descripcion, entrega: r.cantidad, remito: rem ? enRemito.get(r.codigo) ?? 0 : null,
      tipo, productos: productos ?? [], precioMayor: r.precioMayor, precioPublico: r.precioPublico, anterior, cambiosPrecio, tallesNuevos,
      sumaMal: !!r.talles.length && r.totalImpreso !== undefined && r.totalImpreso > 0 && r.totalImpreso !== suma,
    };
  });
  const codigos = new Set(e.renglones.map((r) => r.codigo));
  const extrasRemito = [...enRemito].filter(([c]) => !codigos.has(c)).map(([codigo, cantidad]) => ({ codigo, cantidad }));

  const rojos: string[] = [], amarillos: string[] = [], info: string[] = [];
  if (!rem) rojos.push('⏳ Falta el remito: subí la foto o escribilo.');
  for (const f of filas) {
    if (f.remito !== null && f.remito !== f.entrega) rojos.push(`❌ ${f.codigo}: la planilla dice ${f.entrega} y el remito ${f.remito}.`);
  }
  for (const x of extrasRemito) rojos.push(`❌ ${x.codigo}: está en el remito (${x.cantidad}) pero no en la planilla de entrega.`);
  for (const f of filas) for (const c of f.cambiosPrecio) amarillos.push(`⚠️ ${f.codigo}: ${c}`);
  for (const f of filas) if (f.sumaMal) amarillos.push(`⚠️ ${f.codigo}: la suma de talles no coincide con el TOTAL de la planilla.`);
  for (const f of filas) if (f.tallesNuevos.length) amarillos.push(`⚠️ ${f.codigo}: el talle ${f.tallesNuevos.join(', ')} todavía no existe en Shopify.`);
  if (consulta?.error) amarillos.push(`⚠️ No pude consultar Shopify (${consulta.error}): no sé cuáles son nuevos. Probá «Consultar Shopify de nuevo».`);
  else if (!consulta) amarillos.push('⚠️ Falta consultar Shopify para saber cuáles son nuevos.');
  const nuevos = filas.filter((f) => f.tipo === 'nuevo');
  const repos = filas.filter((f) => f.tipo === 'reposicion');
  if (nuevos.length) info.push(`🆕 ${nuevos.length} artículo(s) nuevo(s), hay que darlos de alta: ${nuevos.map((f) => f.codigo).join(', ')}.`);
  if (repos.length) info.push(`🔁 ${repos.length} de reposición: ${repos.map((f) => f.codigo).join(', ')}.`);

  const semaforo: SemaforoFamily = !rem ? 'incompleta' : rojos.length ? 'revisar' : amarillos.length ? 'observaciones' : 'ok';
  return {
    entrega: e, remito: rem, filas, extrasRemito, semaforo, motivos: [...rojos, ...amarillos, ...info],
    unidades: filas.reduce((s, f) => s + f.entrega, 0), nuevos: nuevos.length, reposiciones: repos.length,
  };
}

/** Resumen para copiar (a quien carga en Shopify, o a Family si algo no coincide). */
export function resumenFamily(r: ResultadoFamily): string {
  const e = r.entrega;
  const lineas = [`Family — entrega del ${fechaAr(e.fecha)}${r.remito?.numero ? ` — remito ${r.remito.numero}` : ''} — ${r.unidades} u.`];
  const grupo = (titulo: string, filas: FilaFamily[]) => {
    if (!filas.length) return;
    lineas.push('', titulo);
    for (const f of filas) {
      const talles = e.renglones.find((x) => x.codigo === f.codigo)?.talles.map((t) => `${t.talle}:${t.cantidad}`).join(' ') || '';
      lineas.push(`• ${f.codigo} ${f.descripcion} — ${f.entrega} u.${talles ? ` (${talles})` : ''}${f.precioMayor ? ` — por mayor ${fmt(f.precioMayor)}` : ''}${f.precioPublico ? ` — público ${fmt(f.precioPublico)}` : ''}`);
    }
  };
  grupo('NUEVOS (dar de alta):', r.filas.filter((f) => f.tipo === 'nuevo'));
  grupo('REPOSICIÓN:', r.filas.filter((f) => f.tipo === 'reposicion'));
  grupo('SIN CONSULTAR EN SHOPIFY:', r.filas.filter((f) => f.tipo === 'sin-consultar'));
  const avisos = r.motivos.filter((m) => /^(❌|⚠️|⏳)/.test(m));
  if (avisos.length) lineas.push('', 'AVISOS:', ...avisos);
  return lineas.join('\n');
}
