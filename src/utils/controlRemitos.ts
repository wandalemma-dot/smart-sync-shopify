// ============================================================================
// CONTROL DE REMITOS — ¿lo que se cargó en Shopify coincide con el remito?
// ----------------------------------------------------------------------------
// 1) La foto del remito la lee la IA (api/remito.js) → renglones.
// 2) De Shopify traemos el HISTORIAL DE AJUSTES de stock (quién, cuándo, dónde,
//    qué variante, cuántas unidades) con ShopifyQL (inventory_adjustment_history).
// 3) Asociamos cada artículo del remito a un producto de los que SE CARGARON en
//    esas fechas (primero por código en SKU / código de barras / etiquetas,
//    si no por nombre + color) y comparamos talle por talle.
//
// SOLO LECTURA: esta pantalla no escribe nada en Shopify.
//
// Reglas (ver CLAUDE.md «Control de remitos»):
// - Se cuenta el stock DISPONIBLE (inventory_state = Available).
// - Se descartan los movimientos de ventas / pedidos (no son cargas).
// - Lo cargado es el NETO de la persona en el período: si cargó 3 y después
//   corrigió −1, cuenta 2.
// - Nunca adivinamos: si un artículo del remito puede ser de dos productos,
//   queda «sin asociar» y se avisa.
// ============================================================================
import { shopifyGraphQL } from './shopify';

// ---------- Tipos ----------
export interface RenglonRemito {
  codigo: string;
  descripcion: string;
  color: string;
  talle: string;
  cantidad: number;
  precio_unitario?: number;
  dudoso?: boolean;
}

export interface Remito {
  proveedor: string;
  tipo_comprobante?: string;
  numero: string;
  fecha: string; // AAAA-MM-DD
  cantidad_total_impresa?: number;
  filas_impresas?: number;
  renglones: RenglonRemito[];
  observaciones?: string;
}

export interface Movimiento {
  variantId: string;
  sku: string;
  variantTitle: string;
  persona: string;   // staff_member_name ('' si lo hizo una app o el sistema)
  app: string;       // inventory_app_name
  motivo: string;    // inventory_change_reason
  sucursal: string;  // inventory_location_name
  estado: string;    // inventory_state
  dia: string;       // AAAA-MM-DD
  cambio: number;    // + suma / − resta
}

export interface VarianteInfo {
  id: string;
  sku: string;
  barcode: string;
  talle: string;         // talle normalizado ('' = sin talle)
  talleOriginal: string;
  opciones: string[];    // valores de todas las opciones (color, talle…)
  productId: string;
  productTitle: string;
  vendor: string;
  tags: string[];
}

export interface Carga {
  cantidad: number;
  personas: Record<string, number>;
  dias: string[];
  sucursales: string[];
}

export type TipoFila = 'ok' | 'diferencia' | 'talle' | 'falta' | 'extra';

export interface FilaControl {
  tipo: TipoFila;
  codigo: string;
  descripcion: string;
  color: string;
  talleRemito: string;
  talleCargado: string;
  cantRemito: number;
  cantCargada: number;
  producto: string;
  sku: string;
  personas: Record<string, number>;
  dias: string[];
  sucursales: string[];
  nota?: string;
}

export interface ModeloAsociado {
  codigo: string;
  descripcion: string;
  color: string;
  productId: string | null;
  producto: string;
  por: 'codigo' | 'nombre' | null;
  candidatos: string[]; // títulos, cuando hubo empate o dudas
}

export interface ResultadoControl {
  filas: FilaControl[];
  modelos: ModeloAsociado[];
  otrasCargas: FilaControl[]; // cargas del período que no son de este remito
  totales: {
    unidadesRemito: number;
    unidadesCargadas: number; // de los artículos del remito
    ok: number; diferencia: number; talle: number; falta: number; extra: number;
  };
  porPersona: Record<string, number>; // unidades cargadas de este remito, por persona
}

// ---------- Normalización ----------
function sinAcentos(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Talle comparable: XXL = 2XL, «Único» = sin talle, 38.0 = 38, 7,5 = 7.5. */
export function normalizarTalle(t: string): string {
  let s = sinAcentos(String(t ?? '')).toUpperCase().trim();
  s = s.replace(/^TALLE\s*/, '').replace(/\s+/g, '');
  if (!s || s === '-' || s === 'U' || s === 'UNICO' || s === 'TU' || s === 'DEFAULTTITLE' || s === 'OS') return '';
  const x = s.match(/^(X{2,5})L$/);
  if (x) return `${x[1].length}XL`;
  s = s.replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(s)) return String(Number(s));
  return s;
}

/** Código comparable: solo letras y números, y la O cuenta como 0 (se confunden en el papel). */
export function normalizarCodigo(c: string): string {
  return sinAcentos(String(c ?? '')).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0');
}

const PALABRAS_VACIAS = new Set(['de', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'del', 'p']);

export function palabras(s: string): string[] {
  return sinAcentos(String(s ?? '')).toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !PALABRAS_VACIAS.has(w));
}

// ---------- Talle de una variante de Shopify ----------
export function talleDeVariante(
  opciones: { name: string; value: string }[],
  titulo: string,
): string {
  const t = opciones.find((o) => /talle|size|tama/i.test(o.name));
  if (t) return t.value;
  const reales = opciones.filter((o) => !/^title$/i.test(o.name));
  if (reales.length === 1 && !/color|colou?r/i.test(reales[0].name)) return reales[0].value;
  if (!titulo || /default title/i.test(titulo)) return '';
  if (reales.length === 0) return '';
  const partes = titulo.split(' / ');
  return partes.length > 1 ? partes[partes.length - 1] : (reales.some((o) => /color/i.test(o.name)) ? '' : titulo);
}

// ---------- Movimientos → neto por variante ----------
// Motivos que NO son cargas de mercadería (ventas, pedidos, devoluciones de
// clientes). Todo lo demás (corrección, reposición, ajuste manual, transferencia
// recibida…) sí cuenta.
export const MOTIVOS_EXCLUIDOS = /order|pedido|venta|sale|fulfil|refund|reembols|devoluc|return|reserv/i;

export function esCarga(m: Movimiento): boolean {
  if (m.estado && !/avail|dispon/i.test(m.estado)) return false;
  if (MOTIVOS_EXCLUIDOS.test(m.motivo || '')) return false;
  return true;
}

export function netoPorVariante(movs: Movimiento[], personas?: Set<string>): Map<string, Carga> {
  const out = new Map<string, Carga>();
  for (const m of movs) {
    if (!esCarga(m)) continue;
    const quien = m.persona || (m.app ? `App: ${m.app}` : 'Sistema');
    if (personas && personas.size && !personas.has(quien)) continue;
    let c = out.get(m.variantId);
    if (!c) { c = { cantidad: 0, personas: {}, dias: [], sucursales: [] }; out.set(m.variantId, c); }
    c.cantidad += m.cambio;
    c.personas[quien] = (c.personas[quien] || 0) + m.cambio;
    if (m.dia && !c.dias.includes(m.dia)) c.dias.push(m.dia);
    if (m.sucursal && !c.sucursales.includes(m.sucursal)) c.sucursales.push(m.sucursal);
  }
  for (const c of out.values()) c.dias.sort();
  return out;
}

export function personasDe(movs: Movimiento[]): { nombre: string; unidades: number }[] {
  const acc: Record<string, number> = {};
  for (const m of movs) {
    if (!esCarga(m)) continue;
    const quien = m.persona || (m.app ? `App: ${m.app}` : 'Sistema');
    acc[quien] = (acc[quien] || 0) + m.cambio;
  }
  return Object.entries(acc).map(([nombre, unidades]) => ({ nombre, unidades }))
    .sort((a, b) => b.unidades - a.unidades);
}

// ---------- Asociar artículo del remito → producto cargado ----------
interface ProductoCargado {
  productId: string;
  titulo: string;
  variantes: VarianteInfo[];
}

function codigoEn(prod: ProductoCargado, cod: string): boolean {
  if (cod.length < 4) return false;
  const donde = [
    prod.titulo,
    ...prod.variantes.flatMap((v) => [v.sku, v.barcode, ...v.tags]),
  ];
  return donde.some((x) => normalizarCodigo(x).includes(cod));
}

function puntajeNombre(prod: ProductoCargado, descripcion: string, color: string): { nombre: number; color: number } {
  const bolsa = new Set(palabras([prod.titulo, ...prod.variantes.flatMap((v) => v.opciones)].join(' ')));
  const d = palabras(descripcion);
  const c = palabras(color);
  const nombre = d.length ? d.filter((w) => bolsa.has(w)).length / d.length : 0;
  const col = c.length ? c.filter((w) => bolsa.has(w)).length / c.length : 1;
  return { nombre, color: col };
}

export function asociarModelo(
  codigo: string, descripcion: string, color: string, productos: ProductoCargado[],
): ModeloAsociado {
  const base = { codigo, descripcion, color };
  const cod = normalizarCodigo(codigo);

  // 1) Por código (SKU, código de barras, etiquetas o título)
  const porCodigo = productos.filter((p) => codigoEn(p, cod));
  if (porCodigo.length === 1) {
    return { ...base, productId: porCodigo[0].productId, producto: porCodigo[0].titulo, por: 'codigo', candidatos: [] };
  }
  const universo = porCodigo.length > 1 ? porCodigo : productos;

  // 2) Por nombre + color (tiene que estar todo el nombre, o casi)
  const puntuados = universo
    .map((p) => ({ p, ...puntajeNombre(p, descripcion, color) }))
    .filter((x) => x.nombre >= 0.75)
    .map((x) => ({ ...x, total: x.nombre * 0.7 + x.color * 0.3 }))
    .sort((a, b) => b.total - a.total);

  if (puntuados.length === 0) {
    return { ...base, productId: null, producto: '', por: null, candidatos: porCodigo.map((p) => p.titulo) };
  }
  const mejor = puntuados[0];
  const empatados = puntuados.filter((x) => Math.abs(x.total - mejor.total) < 1e-9);
  if (empatados.length > 1 || mejor.color < 0.5) {
    return { ...base, productId: null, producto: '', por: null, candidatos: puntuados.slice(0, 4).map((x) => x.p.titulo) };
  }
  return {
    ...base, productId: mejor.p.productId, producto: mejor.p.titulo,
    por: porCodigo.length > 1 ? 'codigo' : 'nombre', candidatos: [],
  };
}

// ---------- Comparación ----------
function claveModelo(r: RenglonRemito): string {
  return `${normalizarCodigo(r.codigo)}|${palabras(r.color).join(' ')}|${palabras(r.descripcion).join(' ')}`;
}

export function compararRemito(
  remito: Remito,
  variantes: VarianteInfo[],        // info de las variantes que tuvieron movimientos
  cargas: Map<string, Carga>,       // neto por variante (ya filtrado por persona)
): ResultadoControl {
  // Productos que tuvieron carga en el período
  const porProducto = new Map<string, ProductoCargado>();
  for (const v of variantes) {
    const c = cargas.get(v.id);
    if (!c || c.cantidad === 0) continue;
    let p = porProducto.get(v.productId);
    if (!p) { p = { productId: v.productId, titulo: v.productTitle, variantes: [] }; porProducto.set(v.productId, p); }
    p.variantes.push(v);
  }
  const productos = [...porProducto.values()];

  // Agrupar renglones del remito por modelo y talle (sumando repetidos)
  const modelosMap = new Map<string, { codigo: string; descripcion: string; color: string; talles: Map<string, { talle: string; cant: number }> }>();
  for (const r of remito.renglones) {
    const k = claveModelo(r);
    let m = modelosMap.get(k);
    if (!m) { m = { codigo: r.codigo, descripcion: r.descripcion, color: r.color, talles: new Map() }; modelosMap.set(k, m); }
    const t = normalizarTalle(r.talle);
    const e = m.talles.get(t);
    if (e) e.cant += Number(r.cantidad) || 0;
    else m.talles.set(t, { talle: r.talle || '', cant: Number(r.cantidad) || 0 });
  }

  const filas: FilaControl[] = [];
  const modelos: ModeloAsociado[] = [];
  const usadas = new Set<string>(); // variantes ya explicadas por el remito
  const vacio = { personas: {}, dias: [] as string[], sucursales: [] as string[] };

  for (const m of modelosMap.values()) {
    const asoc = asociarModelo(m.codigo, m.descripcion, m.color, productos);
    modelos.push(asoc);
    const base = { codigo: m.codigo, descripcion: m.descripcion, color: m.color };

    if (!asoc.productId) {
      for (const t of m.talles.values()) {
        filas.push({
          ...base, ...vacio, tipo: 'falta', talleRemito: t.talle, talleCargado: '', cantRemito: t.cant, cantCargada: 0,
          producto: '', sku: '',
          nota: asoc.candidatos.length
            ? `No pude decidir entre: ${asoc.candidatos.join(' · ')}`
            : 'No encontré cargas de este artículo en esas fechas',
        });
      }
      continue;
    }

    const prod = porProducto.get(asoc.productId)!;
    const disponibles = new Map<string, VarianteInfo>();
    for (const v of prod.variantes) if (!usadas.has(v.id)) disponibles.set(v.talle, v);

    const faltantes: FilaControl[] = [];
    for (const t of m.talles.values()) {
      const tn = normalizarTalle(t.talle);
      const v = disponibles.get(tn);
      if (v) {
        const c = cargas.get(v.id)!;
        usadas.add(v.id);
        disponibles.delete(tn);
        filas.push({
          ...base, tipo: c.cantidad === t.cant ? 'ok' : 'diferencia',
          talleRemito: t.talle, talleCargado: v.talleOriginal, cantRemito: t.cant, cantCargada: c.cantidad,
          producto: prod.titulo, sku: v.sku, personas: c.personas, dias: c.dias, sucursales: c.sucursales,
        });
      } else {
        faltantes.push({
          ...base, ...vacio, tipo: 'falta', talleRemito: t.talle, talleCargado: '', cantRemito: t.cant, cantCargada: 0,
          producto: prod.titulo, sku: '',
        });
      }
    }

    // Talles cargados de este producto que el remito NO trae
    const sobrantes = [...disponibles.values()];
    for (const v of sobrantes) usadas.add(v.id);

    // ¿Talle cambiado? Emparejamos un faltante con un sobrante del mismo producto
    // (primero los de igual cantidad).
    const libres = [...sobrantes];
    for (const f of faltantes) {
      let i = libres.findIndex((v) => cargas.get(v.id)!.cantidad === f.cantRemito);
      if (i < 0) i = libres.findIndex((v) => cargas.get(v.id)!.cantidad > 0);
      if (i >= 0) {
        const v = libres.splice(i, 1)[0];
        const c = cargas.get(v.id)!;
        filas.push({
          ...f, tipo: 'talle', talleCargado: v.talleOriginal, cantCargada: c.cantidad, sku: v.sku,
          personas: c.personas, dias: c.dias, sucursales: c.sucursales,
          nota: `El remito dice talle ${f.talleRemito}, se cargó talle ${v.talleOriginal}`,
        });
      } else {
        filas.push({ ...f, nota: 'Está en el remito y no se cargó' });
      }
    }
    for (const v of libres) {
      const c = cargas.get(v.id)!;
      filas.push({
        ...base, tipo: 'extra', talleRemito: '', talleCargado: v.talleOriginal, cantRemito: 0, cantCargada: c.cantidad,
        producto: prod.titulo, sku: v.sku, personas: c.personas, dias: c.dias, sucursales: c.sucursales,
        nota: 'Se cargó este talle y no está en el remito',
      });
    }
  }

  // Cargas del período que no pertenecen a ningún artículo del remito
  const otrasCargas: FilaControl[] = [];
  for (const v of variantes) {
    if (usadas.has(v.id)) continue;
    const c = cargas.get(v.id);
    if (!c || c.cantidad === 0) continue;
    otrasCargas.push({
      tipo: 'extra', codigo: '', descripcion: v.productTitle, color: '', talleRemito: '', talleCargado: v.talleOriginal,
      cantRemito: 0, cantCargada: c.cantidad, producto: v.productTitle, sku: v.sku,
      personas: c.personas, dias: c.dias, sucursales: c.sucursales,
    });
  }
  otrasCargas.sort((a, b) => a.producto.localeCompare(b.producto));

  const orden: Record<TipoFila, number> = { falta: 0, talle: 1, diferencia: 2, extra: 3, ok: 4 };
  filas.sort((a, b) => orden[a.tipo] - orden[b.tipo]);

  const totales = { unidadesRemito: 0, unidadesCargadas: 0, ok: 0, diferencia: 0, talle: 0, falta: 0, extra: 0 };
  const porPersona: Record<string, number> = {};
  for (const f of filas) {
    totales.unidadesRemito += f.cantRemito;
    totales.unidadesCargadas += f.cantCargada;
    totales[f.tipo]++;
    for (const [p, n] of Object.entries(f.personas)) porPersona[p] = (porPersona[p] || 0) + n;
  }
  return { filas, modelos, otrasCargas, totales, porPersona };
}

// ---------- Remito desde EXCEL (camino gratis) ----------
// Wanda le pasa las fotos a Claude en el chat, Claude le devuelve un Excel y
// ella lo sube acá. Formato de ese Excel (el que arma Claude):
//   Fila 1: «Proveedor — Tipo Número — dd/mm/aaaa — 79 renglones / 87 unidades»
//   Después, una fila de encabezados con al menos Talle y Cantidad, y el código
//   (Código / Artículo / SKU) y/o la descripción. Color es opcional.
// Se acepta cualquier Excel con esos encabezados; lo que no esté se completa a mano.
function norm(s: unknown): string {
  return sinAcentos(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function remitoDesdeFilas(filas: unknown[][]): Remito {
  const iEnc = filas.findIndex((f) => {
    const c = (f || []).map(norm);
    return c.some((x) => x === 'talle' || x === 'talles') && c.some((x) => /^(cantidad|cant|unidades|cant remito)$/.test(x));
  });
  if (iEnc < 0) throw new Error('No encontré la fila de encabezados (tiene que tener «Talle» y «Cantidad»).');
  const enc = filas[iEnc].map(norm);
  const col = (re: RegExp, salvo: number[] = []) => enc.findIndex((x, i) => re.test(x) && !salvo.includes(i));
  const cTalle = col(/^talles?$/);
  const cCant = col(/^(cantidad|cant|unidades|cant remito)$/);
  const cColor = col(/^colou?r$/);
  let cDesc = col(/^(descripcion|detalle|producto|nombre)$/);
  let cCod = col(/^(codigo|cod|sku|codigo articulo|cod articulo)$/);
  const cArt = col(/^articulo$/);
  if (cCod < 0 && cArt >= 0 && cDesc >= 0) cCod = cArt;
  else if (cDesc < 0 && cArt >= 0 && cArt !== cCod) cDesc = cArt;
  if (cCod < 0 && cDesc < 0) throw new Error('Falta la columna del código o de la descripción del artículo.');
  const cPrecio = col(/^(precio|precio unit|precio unitario)$/);

  const txt = (f: unknown[], c: number) => (c >= 0 && f[c] != null ? String(f[c]).trim() : '');
  const renglones: RenglonRemito[] = [];
  for (const f of filas.slice(iEnc + 1)) {
    if (!f) continue;
    const codigo = txt(f, cCod);
    const descripcion = txt(f, cDesc);
    if (!codigo && !descripcion) continue;
    if (/^total/i.test(codigo) || /^total/i.test(descripcion)) continue;
    const cantidad = Number(String(f[cCant] ?? '').replace(',', '.'));
    if (!Number.isFinite(cantidad) || cantidad === 0) continue;
    const talle = txt(f, cTalle);
    renglones.push({
      codigo, descripcion, color: txt(f, cColor), talle: talle === '—' ? '' : talle, cantidad,
      precio_unitario: cPrecio >= 0 ? Number(f[cPrecio]) || 0 : undefined,
    });
  }
  if (!renglones.length) throw new Error('El Excel no tiene renglones con cantidad.');

  // Encabezado: lo que haya arriba de la tabla
  const arriba = filas.slice(0, iEnc).map((f) => (f || []).map((x) => String(x ?? '')).join(' ')).join(' — ');
  const partes = String(filas[0]?.[0] ?? '').split(/\s+[—–-]\s+/);
  let fecha = '';
  const f1 = arriba.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  const f2 = arriba.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (f2) fecha = f2[0];
  else if (f1) fecha = `${f1[3].length === 2 ? '20' + f1[3] : f1[3]}-${f1[2].padStart(2, '0')}-${f1[1].padStart(2, '0')}`;
  const nro = arriba.match(/\b(\d{4,5}-\d{6,8})\b/);
  const tipo = arriba.match(/\b(Remito|Factura\s*[ABCM]?|Nota de cr[eé]dito)\b/i);
  const filasImp = arriba.match(/(\d+)\s*renglones/i);
  const unidImp = arriba.match(/(\d+)\s*unidades/i);
  return {
    proveedor: partes.length > 1 ? partes[0].replace(/^proveedor:\s*/i, '').trim() : '',
    tipo_comprobante: tipo ? tipo[1] : '',
    numero: nro ? nro[1] : '',
    fecha,
    filas_impresas: filasImp ? Number(filasImp[1]) : 0,
    cantidad_total_impresa: unidImp ? Number(unidImp[1]) : 0,
    renglones,
  };
}

// ---------- Chequeos del remito leído ----------
export function chequeosRemito(r: Remito): string[] {
  const avisos: string[] = [];
  const unidades = r.renglones.reduce((s, x) => s + (Number(x.cantidad) || 0), 0);
  if (r.cantidad_total_impresa && Math.abs(unidades - r.cantidad_total_impresa) > 0.001) {
    avisos.push(`La suma de cantidades leídas (${unidades}) no coincide con la «Cantidad total» impresa (${r.cantidad_total_impresa}). Revisá los renglones.`);
  }
  if (r.filas_impresas && r.filas_impresas !== r.renglones.length) {
    avisos.push(`Leí ${r.renglones.length} renglones y el comprobante dice ${r.filas_impresas} filas. Puede faltar una foto o un renglón.`);
  }
  const dudosos = r.renglones.filter((x) => x.dudoso).length;
  if (dudosos) avisos.push(`${dudosos} renglón(es) marcados como dudosos por la IA: revisalos (en amarillo).`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha || '')) avisos.push('No pude leer bien la fecha del comprobante: cargala a mano.');
  return avisos;
}

// ---------- Shopify ----------
function aGid(id: unknown, tipo: string): string {
  const s = String(id ?? '');
  if (!s) return '';
  return s.startsWith('gid://') ? s : `gid://shopify/${tipo}/${s}`;
}

const COLUMNAS = [
  'product_variant_id', 'product_variant_sku', 'product_variant_title', 'staff_member_name',
  'inventory_app_name', 'inventory_change_reason', 'inventory_location_name', 'inventory_state', 'day',
];

export function consultaHistorial(desde: string, hasta: string, limite?: number): string {
  return `FROM inventory_adjustment_history
  SHOW inventory_adjustment_change
  GROUP BY ${COLUMNAS.join(', ')}
  SINCE ${desde} UNTIL ${hasta}${limite ? `\n  LIMIT ${limite}` : ''}`;
}

/** Convierte las filas de ShopifyQL (objetos o arreglos) en movimientos. */
export function filasAMovimientos(columnas: { name: string }[], filas: unknown[]): Movimiento[] {
  const nombres = columnas.map((c) => c.name);
  return filas.map((f) => {
    const o: Record<string, unknown> = Array.isArray(f)
      ? Object.fromEntries(nombres.map((n, i) => [n, (f as unknown[])[i]]))
      : (f as Record<string, unknown>);
    const txt = (k: string) => (o[k] == null ? '' : String(o[k]));
    return {
      variantId: aGid(o.product_variant_id, 'ProductVariant'),
      sku: txt('product_variant_sku'),
      variantTitle: txt('product_variant_title'),
      persona: txt('staff_member_name'),
      app: txt('inventory_app_name'),
      motivo: txt('inventory_change_reason'),
      sucursal: txt('inventory_location_name'),
      estado: txt('inventory_state'),
      dia: txt('day').slice(0, 10),
      cambio: Number(o.inventory_adjustment_change) || 0,
    };
  }).filter((m) => m.variantId);
}

export async function traerMovimientos(desde: string, hasta: string): Promise<{ movimientos: Movimiento[]; posibleCorte: boolean }> {
  const q = `query($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name } rows } parseErrors } }`;
  type R = { shopifyqlQuery: { tableData: { columns: { name: string }[]; rows: unknown[] } | null; parseErrors: unknown } };
  let data: R;
  try {
    data = await shopifyGraphQL<R>(q, { q: consultaHistorial(desde, hasta, 10000) });
    const pe = data.shopifyqlQuery?.parseErrors;
    if (Array.isArray(pe) && pe.length) throw new Error(JSON.stringify(pe));
  } catch (e: any) {
    // Si Shopify rechaza el LIMIT, probamos sin él.
    if (/access|denied|scope|permis/i.test(String(e?.message))) throw e;
    data = await shopifyGraphQL<R>(q, { q: consultaHistorial(desde, hasta) });
  }
  const pe = data.shopifyqlQuery?.parseErrors;
  if (Array.isArray(pe) && pe.length) throw new Error('Shopify no entendió la consulta del historial: ' + JSON.stringify(pe));
  const td = data.shopifyqlQuery?.tableData;
  if (!td) return { movimientos: [], posibleCorte: false };
  const filas = Array.isArray(td.rows) ? td.rows : [];
  return { movimientos: filasAMovimientos(td.columns || [], filas), posibleCorte: filas.length === 1000 || filas.length === 10000 };
}

export async function traerVariantes(ids: string[]): Promise<VarianteInfo[]> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out: VarianteInfo[] = [];
  const q = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant {
    id sku barcode title selectedOptions { name value }
    product { id title vendor tags }
  } } }`;
  type N = { id: string; sku: string | null; barcode: string | null; title: string;
    selectedOptions: { name: string; value: string }[];
    product: { id: string; title: string; vendor: string; tags: string[] } } | null;
  for (let i = 0; i < unicos.length; i += 100) {
    const d = await shopifyGraphQL<{ nodes: N[] }>(q, { ids: unicos.slice(i, i + 100) });
    for (const n of d.nodes || []) {
      if (!n || !n.product) continue;
      const t = talleDeVariante(n.selectedOptions || [], n.title);
      out.push({
        id: n.id, sku: n.sku || '', barcode: n.barcode || '',
        talle: normalizarTalle(t), talleOriginal: t,
        opciones: (n.selectedOptions || []).map((o) => o.value),
        productId: n.product.id, productTitle: n.product.title, vendor: n.product.vendor || '',
        tags: n.product.tags || [],
      });
    }
  }
  return out;
}

/** Variantes que tuvieron movimiento pero ya no existen (borradas): las mostramos por SKU/título del historial. */
export function variantesHuerfanas(movs: Movimiento[], conocidas: VarianteInfo[]): VarianteInfo[] {
  const ya = new Set(conocidas.map((v) => v.id));
  const out = new Map<string, VarianteInfo>();
  for (const m of movs) {
    if (ya.has(m.variantId) || out.has(m.variantId)) continue;
    const partes = m.variantTitle.split(' - ');
    const talle = partes.length > 1 ? partes[partes.length - 1] : '';
    out.set(m.variantId, {
      id: m.variantId, sku: m.sku, barcode: '', talle: normalizarTalle(talle), talleOriginal: talle, opciones: [talle],
      productId: 'borrado:' + (partes.length > 1 ? partes.slice(0, -1).join(' - ') : m.variantTitle),
      productTitle: (partes.length > 1 ? partes.slice(0, -1).join(' - ') : m.variantTitle) + ' (borrado)',
      vendor: '', tags: [],
    });
  }
  return [...out.values()];
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + 'T12:00:00');
  if (isNaN(d.getTime())) return fecha;
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
