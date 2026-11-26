// ============================================================================
// REEF (NEW ARRECIFE S.A.) — 26-nov-2026, pedido de gax
// ----------------------------------------------------------------------------
// Marketplace en consignación, como Ullua: la mercadería es de New Arrecife y el
// stock se carga en su sucursal «🟢NEW ARRECIFE (Reef)». Cada entrega trae un
// REMITO en papel (Código | Descripción | Cantidad | Talles) SIN precios: el precio
// y la curva salen de la LISTA DE PRECIOS de Reef (Excel con hojas CALZADO,
// INDUMENTARIA y OJOTAS), que se sube una vez y queda guardada en la base.
//   · Costo = PMV (sin IVA) − 15% (descuento comercial del contrato: 49.995 → 42.495,75).
//   · Precio de venta de los nuevos = PVP de la lista (se puede cambiar en la vista previa).
//   · Talles: la cantidad del remito ÷ las unidades de la curva = cuántas curvas llegaron;
//     cada talle de la curva × esa cantidad. Talles de EE.UU. (parte del calzado y casi todas
//     las ojotas) NO se convierten solos: falta la tabla de Reef. Se escriben a mano.
// SKU de los nuevos = código.talle (27112280.040, 272222167.S, 27103265.3940), como los
// Reef que ya están en la tienda; etiqueta = el código.
// ============================================================================
import { fechaFamily, type EntregaFamily, type RenglonFamily } from './controlFamily';
import { costoFamily, talleAlta, type Marketplace, type OpcionCarga } from './cargaFamily';

export const SUCURSAL_REEF = 'NEW ARRECIFE (Reef)';
export const VENDOR_REEF = 'Reef';

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const alnum = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------------------------------------------------------------------------
// CURVAS DE LA LISTA
// ---------------------------------------------------------------------------
export interface TalleCurva { talle: string; cantidad: number }
export interface CurvaReef {
  talles: TalleCurva[];
  /** Lo que dice después del «=» (unidades de la curva), si lo trae. */
  total: number | null;
  /** Talle único («Talle único=3»). */
  unico: boolean;
}

const RE_NUM = /(\d{1,3}(?:\s*[-/]\s*\d{1,3})?)\s*\((\d{1,3})\)/y;
const RE_LETRA = /(XXXL|XXL|XXS|XS|[2-5]XL|XL|S|M|L)\s*(?:\((\d{1,3})\)|(\d{1,3}))/y;

/** Talle como se guarda: sin ceros adelante (08 → 8), dobles con guion (36/37 → 36-37), 2XL = XXL. */
export function talleReef(t: string): string {
  const s = norm(t).replace(/\s+/g, '');
  const doble = /^(\d{1,3})[-/](\d{1,3})$/.exec(s);
  if (doble) return `${Number(doble[1])}-${Number(doble[2])}`;
  if (/^\d+$/.test(s)) return String(Number(s));
  return talleAlta(s);
}

/**
 * La curva de la columna «Curva» de la lista. Acepta las formas de la lista Summer 2027:
 * «40 (1) / 41 (2) … 45 (1)= 12», «S 1 / M 2 / L 2/ XL 1 / XXL1 = 7», «S (1) M (2) L (2) XL (1) = 6»,
 * «28(1) - 30(2) - …», «39-40 (2) / 41-42 (4) …», «36/37 (3)  -  38/39(3) = 6», «Talle único=3».
 * Devuelve null si no la entiende (no se adivina).
 */
export function curvaReef(texto: string): CurvaReef | null {
  const s = norm(texto);
  if (!s) return null;
  const [izq, der = ''] = s.split('=');
  const totalN = /^\s*(\d{1,3})\s*$/.exec(der);
  const total = totalN ? Number(totalN[1]) : null;
  if (/^TALLE UNICO\b|^UNICO\b|^TU\b/.test(izq.trim())) return total ? { talles: [{ talle: 'TU', cantidad: total }], total, unico: true } : null;
  const talles: TalleCurva[] = [];
  let i = 0;
  while (i < izq.length) {
    const c = izq[i];
    if (/[\s/-]/.test(c)) { i++; continue; }
    RE_NUM.lastIndex = i; RE_LETRA.lastIndex = i;
    const n = /\d/.test(c) ? RE_NUM.exec(izq) : null;
    if (n) { talles.push({ talle: talleReef(n[1]), cantidad: Number(n[2]) }); i = RE_NUM.lastIndex; continue; }
    const l = RE_LETRA.exec(izq);
    if (l) { talles.push({ talle: talleReef(l[1]), cantidad: Number(l[2] ?? l[3]) }); i = RE_LETRA.lastIndex; continue; }
    return null;
  }
  if (!talles.length || talles.some((t) => !(t.cantidad > 0))) return null;
  if (new Set(talles.map((t) => t.talle)).size !== talles.length) return null;
  return { talles, total, unico: false };
}

export const unidadesCurva = (c: TalleCurva[]) => c.reduce((s, t) => s + t.cantidad, 0);
export const textoCurva = (c: TalleCurva[]) => c.map((t) => `${t.talle}(${t.cantidad})`).join(' ');

// ---------------------------------------------------------------------------
// LISTA DE PRECIOS (Excel) → artículos
// ---------------------------------------------------------------------------
export interface ArticuloReef {
  codigo: string;
  hoja: string;
  linea: string;
  descripcion: string;
  /** La curva tal cual la lista (para mostrar). */
  curva: string;
  /** La curva leída (vacía si no se entendió o es talle único). */
  talles: TalleCurva[];
  /** PMV sin IVA (de ahí sale el costo, − 15%). */
  pvm: number;
  /** Precio de venta sugerido por Reef. */
  pvp: number;
  /** «Unid Cva» de la lista. */
  unidades: number;
  /** Calzado u ojota con talles de EE.UU. (7, 8 … 13): no se convierten solos. */
  us?: boolean;
}
export interface ListaReef { nombre: string; articulos: ArticuloReef[]; guardada?: string }

const num = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? '').replace(/[$\s]/g, '');
  if (!s) return NaN;
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/[.,](?=\d{3}\b)/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** Talles numéricos chicos (≤ 15) en calzado u ojotas: son de EE.UU. Los dobles (39-40) y los de 30+ son argentinos. */
export function esTalleUs(hoja: string, talles: TalleCurva[]): boolean {
  const h = norm(hoja);
  if (!/CALZADO|OJOTA|SANDAL/.test(h) || !talles.length) return false;
  return talles.every((t) => /^\d+$/.test(t.talle) && Number(t.talle) <= 15);
}

/**
 * Lee la lista de precios de Reef: en cada hoja busca las filas de encabezado (Linea, Artículo, Descripción,
 * Curva, PVM o PMV, PVP, Unid Cva; se repiten por sección) y toma los artículos de abajo. Las hojas sin esos
 * encabezados (apertura de cuenta, resumen) se ignoran: no se guarda ningún dato del cliente.
 */
export function leerListaReef(hojas: { nombre: string; filas: unknown[][] }[], nombre = ''): { lista: ListaReef; avisos: string[] } {
  const avisos: string[] = [];
  const porCodigo = new Map<string, ArticuloReef>();
  for (const h of hojas) {
    let col: Record<string, number> | null = null;
    for (const [i, fila] of h.filas.entries()) {
      const celdas = (fila ?? []).map((c) => norm(c));
      const a = celdas.indexOf('ARTICULO');
      if (a >= 0 && celdas.includes('CURVA')) {
        const idx = (re: RegExp) => celdas.findIndex((c) => re.test(c));
        col = { linea: idx(/^LINEA$/), codigo: a, desc: idx(/^DESCRIPCION$/), curva: idx(/^CURVA$/), pvm: idx(/^(PVM|PMV)$/), pvp: idx(/^PVP$/), unid: idx(/^UNID\.? ?CVA\.?$/) };
        if (col.pvm < 0 || col.pvp < 0 || col.desc < 0) { avisos.push(`Hoja ${h.nombre}, fila ${i + 1}: falta la columna PVM, PVP o Descripción; salteo esa sección.`); col = null; }
        continue;
      }
      if (!col) continue;
      const codigo = alnum(fila[col.codigo]);
      if (!/^[A-Z0-9]{3,30}$/.test(codigo) || !/\d/.test(codigo)) continue;
      const pvm = num(fila[col.pvm]), pvp = num(fila[col.pvp]);
      const curvaTxt = String(fila[col.curva] ?? '').replace(/\s+/g, ' ').trim();
      const c = curvaReef(curvaTxt);
      const unidades = col.unid >= 0 ? num(fila[col.unid]) : NaN;
      const hoja = norm(h.nombre);
      const art: ArticuloReef = {
        codigo, hoja, linea: String(fila[col.linea] ?? '').replace(/\s+/g, ' ').trim(), descripcion: String(fila[col.desc] ?? '').replace(/\s+/g, ' ').trim(),
        curva: curvaTxt, talles: c && !c.unico ? c.talles : [], pvm: pvm > 0 ? Math.round(pvm * 100) / 100 : 0, pvp: pvp > 0 ? Math.round(pvp) : 0,
        unidades: unidades > 0 ? Math.round(unidades) : c ? unidadesCurva(c.talles) : 0,
      };
      if (esTalleUs(hoja, art.talles)) art.us = true;
      if (!c) avisos.push(`${codigo} (${art.descripcion}): no entiendo la curva «${curvaTxt}».`);
      if (!art.pvm) avisos.push(`${codigo} (${art.descripcion}): sin PVM.`);
      const ya = porCodigo.get(codigo);
      if (ya) {
        if (ya.pvm !== art.pvm || ya.curva !== art.curva) avisos.push(`${codigo} está dos veces con datos distintos; uso el primero.`);
        continue;
      }
      porCodigo.set(codigo, art);
    }
  }
  if (!porCodigo.size) throw new Error('No encontré artículos en el Excel. ¿Es la lista de precios de Reef (hojas con Artículo, Curva, PVM y PVP)?');
  return { lista: { nombre, articulos: [...porCodigo.values()] }, avisos };
}

// ---------------------------------------------------------------------------
// REMITO (leído de la foto) + LISTA → ENTREGA
// ---------------------------------------------------------------------------
export interface RenglonRemitoReef { codigo: string; descripcion: string; cantidad: number; talles: string; importe?: number }
export interface RemitoReef { numero: string; fecha: string; renglones: RenglonRemitoReef[]; dudas: string[]; total?: number }

/**
 * Remito digital de Reef (26-nov-2026, «Detalle Remit …xlsx»): una hoja «Estadísticas de Ventas» con
 * Artículo («27112280 - SHAKA BLACK/WHITE») | Comprobante («RTTO-R 0067-00003073») | Fecha | Clnte | Razón Social | Cant.Mov. | Importe.
 * Trae cantidades por artículo (sin talles) y el importe a costo (PMV − 15%, sin IVA). La fila de totales se ignora.
 * Si trae más de un remito, se pide bajar uno por remito.
 */
export function remitoReefDeExcel(filas: unknown[][]): RemitoReef {
  const txt = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const sin = (v: unknown) => txt(v).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const enc = filas.findIndex((f) => (f ?? []).some((c) => /^ARTICULO/.test(sin(c))) && (f ?? []).some((c) => /^COMPROBANTE/.test(sin(c))));
  if (enc < 0) throw new Error('No es el remito digital de Reef: no encontré las columnas «Artículo» y «Comprobante».');
  const col = (re: RegExp) => (filas[enc] ?? []).findIndex((c) => re.test(sin(c)));
  const cArt = col(/^ARTICULO/), cComp = col(/^COMPROBANTE/), cFecha = col(/^FECHA/), cCant = col(/^CANT/), cImp = col(/^IMPORTE/);
  if (cCant < 0) throw new Error('El remito digital no tiene la columna «Cant.Mov.».');
  const renglones: RenglonRemitoReef[] = [];
  const comprobantes = new Set<string>();
  let fecha = '';
  let total = 0;
  for (const f of filas.slice(enc + 1)) {
    const m = /^([A-Z0-9][A-Z0-9.-]*)\s+-\s*(.*)$/i.exec(txt(f?.[cArt]));
    if (!m) continue;
    const comp = txt(f?.[cComp]);
    const num = /(\d{4}-\d{8})/.exec(comp)?.[1] || comp;
    if (num) comprobantes.add(num);
    fecha ||= cFecha >= 0 ? fechaFamily(f?.[cFecha]) : '';
    const importe = cImp >= 0 ? Number(f?.[cImp]) || 0 : 0;
    total += importe;
    renglones.push({ codigo: m[1], descripcion: m[2], cantidad: Number(f?.[cCant]) || 0, talles: '', ...(importe ? { importe } : {}) });
  }
  if (comprobantes.size > 1) throw new Error(`El Excel trae ${comprobantes.size} remitos distintos (${[...comprobantes].join(', ')}): bajá uno por remito.`);
  if (!renglones.length) throw new Error('No encontré artículos en el remito digital.');
  return { numero: [...comprobantes][0] ?? '', fecha, renglones, dudas: [], ...(total ? { total: Math.round(total * 100) / 100 } : {}) };
}

/** Talles impresos en el remito («040 041 042» → 40 41 42). Un número de 3 cifras que termina en 0 puede ser ×10 (070 = 7). */
function tallesImpresos(s: string): string[] {
  return norm(s).split(/[\s,;/]+/).filter(Boolean).map((t) => (/^\d+$/.test(t) ? String(Number(t)) : talleReef(t)));
}
function coincideImpreso(impreso: string, talle: string): boolean {
  if (impreso === talle) return true;
  return /^\d+$/.test(impreso) && /^\d+$/.test(talle) && Number(impreso) === Number(talle) * 10;
}

/**
 * Pasa el remito a la entrega con la lista: descripción, PMV, PVP y talles (curva × cantidad de curvas).
 * Lo que no se puede saber (código fuera de la lista, talles de EE.UU., cantidad que no es múltiplo de la curva)
 * queda sin talles y con una duda: se completa en «✏️ Ver o corregir».
 */
const pesosReef = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function entregaDeRemitoReef(doc: RemitoReef, lista: ListaReef | null, hoy: string, origen: 'foto' | 'excel' = 'foto'): { entrega: Omit<EntregaFamily, 'id'>; avisos: string[] } {
  const dudas = [...(doc.dudas ?? [])];
  const avisos: string[] = [];
  const arts = new Map((lista?.articulos ?? []).map((a) => [a.codigo, a]));
  if (!arts.size) avisos.push('Todavía no está cargada la lista de precios de Reef: los artículos quedan sin precio ni talles. Subí la lista y volvé a leer el remito.');
  const porCodigo = new Map<string, RenglonFamily>();
  for (const r of doc.renglones) {
    const codigo = alnum(r.codigo);
    if (!codigo) continue;
    const cantidad = Math.round(Number(r.cantidad) || 0);
    if (!(cantidad > 0)) { dudas.push(`${codigo}: no tiene cantidad.`); continue; }
    const a = arts.get(codigo);
    // Remito digital: el importe es a costo (PMV − 15%). Si no da, se avisa (no se cambia el costo).
    if (a?.pvm && r.importe) {
      const unidad = r.importe / cantidad, esperado = costoFamily(a.pvm);
      if (Math.abs(unidad - esperado) > 1) dudas.push(`${codigo}: el remito dice ${pesosReef(r.importe)} por ${cantidad} u. (${pesosReef(unidad)} c/u) y PMV − 15% da ${pesosReef(esperado)}. Revisá el precio con Reef.`);
    }
    const renglon: RenglonFamily = { codigo, descripcion: a?.descripcion || String(r.descripcion ?? '').replace(/\s+/g, ' ').trim(), precioMayor: a?.pvm ?? 0, precioPublico: a?.pvp ?? 0, cantidad, talles: [] };
    if (!a) {
      if (arts.size) dudas.push(`${codigo}: no está en la lista de precios. Escribí los talles y los precios (PMV y PVP) en «✏️ Ver o corregir».`);
    } else if (a.us) {
      dudas.push(`${codigo} (${a.descripcion}): viene en talle de EE.UU. (curva ${a.curva}). Escribí los talles argentinos en «✏️ Ver o corregir» (por ejemplo 40/2 41/3).`);
    } else if (!a.talles.length) {
      const c = curvaReef(a.curva);
      if (!c?.unico) dudas.push(`${codigo} (${a.descripcion}): no entiendo la curva de la lista («${a.curva}»). Escribí los talles en «✏️ Ver o corregir».`);
      // Talle único: sin talles (el producto se crea sin variantes).
    } else {
      const u = unidadesCurva(a.talles);
      if (cantidad % u) {
        dudas.push(`${codigo} (${a.descripcion}): llegaron ${cantidad} y la curva de la lista es de ${u} (${textoCurva(a.talles)}): no es una cantidad justa de curvas. Escribí los talles en «✏️ Ver o corregir».`);
      } else {
        const k = cantidad / u;
        renglon.talles = a.talles.map((t) => ({ talle: t.talle, cantidad: t.cantidad * k }));
        if (a.unidades && a.unidades !== u) dudas.push(`${codigo}: la lista dice ${a.unidades} unidades por curva pero los talles suman ${u}; usé los talles (${textoCurva(a.talles)}). Revisalo.`);
        const impresos = tallesImpresos(r.talles);
        const faltan = impresos.filter((x) => !a.talles.some((t) => coincideImpreso(x, t.talle)));
        if (impresos.length && faltan.length) dudas.push(`${codigo}: el remito dice talles «${r.talles}» y la curva de la lista es ${textoCurva(a.talles)}. Revisá los talles.`);
      }
    }
    const ya = porCodigo.get(codigo);
    if (ya) {
      avisos.push(`${codigo} está dos veces en el remito: se sumaron las cantidades.`);
      for (const t of renglon.talles) {
        const x = ya.talles.find((y) => y.talle === t.talle);
        if (x) x.cantidad += t.cantidad; else ya.talles.push({ ...t });
      }
      ya.cantidad += renglon.cantidad;
      continue;
    }
    porCodigo.set(codigo, renglon);
  }
  if (!porCodigo.size) throw new Error('No encontré artículos en el remito.');
  if (!doc.fecha) avisos.push('El remito no trae la fecha (o no se leyó): se usó la de hoy (se puede corregir).');
  const numero = String(doc.numero ?? '').trim();
  return {
    entrega: {
      nombre: `Remito ${numero}`.trim(), fecha: doc.fecha || hoy, origen, renglones: [...porCodigo.values()], dudas,
      documento: { tipo: 'remito', numero, remito: numero, total: doc.total ?? 0 },
    },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// SHOPIFY: reconocer los productos del código
// ---------------------------------------------------------------------------
/** El SKU es de ese código: el código solo, o seguido de un separador (27111871.005, 27112280-40). 2711187 no es de 27111871. */
export function skuEsDeReef(sku: string, codigo: string): boolean {
  const c = alnum(codigo);
  const s = String(sku ?? '').trim().toUpperCase();
  if (!c || !s.startsWith(c)) return false;
  return s.length === c.length || /^[.\-_/ ]/.test(s.slice(c.length));
}
export const etiquetaEsDeReef = (etiquetas: string[] | undefined, codigo: string) => (etiquetas ?? []).some((t) => alnum(t) === alnum(codigo));
export const busquedaReef = (codigos: string[]) => codigos.map((c) => `sku:${alnum(c)}* OR tag:"${alnum(c)}"`).join(' OR ');

// ---------------------------------------------------------------------------
// ALTAS: título, tipo, precio
// ---------------------------------------------------------------------------
interface Tipo { re: RegExp; prefijo: string; productType: string; etiquetas: string[]; gramos: number }
const ROPA = ['Indumentaria', 'Ropa'];
// Por la «Línea» de la lista (y, si no hay, por la descripción).
const TIPOS: Tipo[] = [
  { re: /\bOJOTA|\bSANDAL|\bSLIDE\b/, prefijo: 'Ojota', productType: 'Ojotas', etiquetas: ['Calzado', 'Ojotas'], gramos: 500 },
  { re: /\bCALZADO\b|\bSHOES?\b/, prefijo: 'Zapatillas', productType: 'Zapatillas', etiquetas: ['Calzado', 'Zapatillas'], gramos: 900 },
  { re: /\bREMERAS?\b|\bTEE\b/, prefijo: 'Remera', productType: 'Remeras', etiquetas: [...ROPA, 'remeras'], gramos: 300 },
  { re: /\bMUSCULOSAS?\b|\bTANK\b/, prefijo: 'Musculosa', productType: 'Musculosas', etiquetas: ROPA, gramos: 250 },
  { re: /\bCAMISAS?\b/, prefijo: 'Camisa', productType: 'Camisas', etiquetas: ROPA, gramos: 350 },
  { re: /\bPOLOS?\b/, prefijo: 'Chomba', productType: 'Chombas', etiquetas: ROPA, gramos: 300 },
  { re: /\bBUZOS?\b|\bHOODIE\b/, prefijo: 'Buzo', productType: 'Buzos', etiquetas: [...ROPA, 'Buzos'], gramos: 600 },
  { re: /\bSWEATERS?\b/, prefijo: 'Sweater', productType: 'Sweaters', etiquetas: ROPA, gramos: 500 },
  { re: /\bBOARDSHORTS?\b/, prefijo: 'Malla', productType: 'Malla', etiquetas: ROPA, gramos: 300 },
  { re: /\bWALKSHORTS?\b/, prefijo: 'Bermuda', productType: 'Bermudas', etiquetas: [...ROPA, 'Pantalones'], gramos: 500 },
  { re: /\bDENIM (LOOSE|REGULAR)\b/, prefijo: 'Jean', productType: 'Pantalon', etiquetas: [...ROPA, 'Pantalones'], gramos: 750 },
  { re: /\bPANTS?\b/, prefijo: 'Pantalón', productType: 'Pantalon', etiquetas: [...ROPA, 'Pantalones'], gramos: 600 },
  { re: /\bSHORTS?\b/, prefijo: 'Short', productType: 'Short', etiquetas: ROPA, gramos: 300 },
  { re: /\bLYCRAS?\b|\bRASHGUARD\b/, prefijo: 'Lycra', productType: 'Lycras', etiquetas: ROPA, gramos: 250 },
  { re: /\bBIKINIS?\b/, prefijo: 'Bikini', productType: 'Bikinis', etiquetas: ROPA, gramos: 200 },
  { re: /\bTOPS?\b/, prefijo: 'Top', productType: 'Tops', etiquetas: ROPA, gramos: 200 },
  { re: /\bVESTIDOS?\b|\bDRESS\b/, prefijo: 'Vestido', productType: 'Vestidos', etiquetas: ROPA, gramos: 300 },
  { re: /\bPOLLERAS?\b|\bSKIRT\b/, prefijo: 'Pollera', productType: 'Polleras', etiquetas: ROPA, gramos: 250 },
  { re: /\bBILLETERAS?\b/, prefijo: 'Billetera', productType: 'Billeteras', etiquetas: ['Accesorios'], gramos: 150 },
  { re: /\bCAPS?\b|\bGORRAS?\b/, prefijo: 'Gorra', productType: 'Gorras', etiquetas: ['Accesorios'], gramos: 150 },
  { re: /\bHATS PAJA\b|\bSOMBRERO\b/, prefijo: 'Sombrero', productType: 'Sombreros', etiquetas: ['Accesorios'], gramos: 200 },
  { re: /\bHATS PILUSO\b|\bBUCKET\b/, prefijo: 'Piluso', productType: 'Pilusos', etiquetas: ['Accesorios'], gramos: 150 },
  { re: /\bCINTURON(ES)?\b/, prefijo: 'Cinturón', productType: 'Cinturones', etiquetas: ['Accesorios'], gramos: 200 },
  { re: /\bRI(N|Ñ)ONERAS?\b/, prefijo: 'Riñonera', productType: 'Riñoneras', etiquetas: ['Accesorios'], gramos: 300 },
  { re: /\bBOLSOS?\b/, prefijo: 'Bolso', productType: 'Bolsos', etiquetas: ['Accesorios'], gramos: 600 },
  { re: /\bMOCHILAS?\b|\bBACKPACK\b/, prefijo: 'Mochila', productType: 'Mochila', etiquetas: ['Accesorios', 'Mochilas'], gramos: 700 },
];
export function tipoReef(linea: string, descripcion = ''): Tipo | null {
  return TIPOS.find((t) => t.re.test(norm(linea))) ?? TIPOS.find((t) => t.re.test(norm(descripcion))) ?? null;
}
// Palabras del tipo que no van en el título (ya están en el prefijo).
const QUITAR = /\b(REEF|TEE|TANK|SLEEVELESS|MUSCLE|POLO|HOODIE|RASHGUARD|DRESS|SKIRT|PANT|BUCKET HAT|HAT|SOMBRERO|CINTURON|RIÑONERA|RINONERA|BERMUDA|WALK|WLK|SLIDE|SANDALS?|SHOES?|MC|JR|BIKINI|SHIRT|BOARDSHORT|SHORT|WALLET|CAP|GORRO)\b/g;
const COLORES: [RegExp, string][] = [
  [/\bALL BLACK\b/, 'NEGRO TOTAL'], [/\bDARK BROWN\b/, 'MARRON OSCURO'], [/\bOFF ?\/ ?WHITE\b|\bOFF WHITE\b/, 'BLANCO HUESO'], [/\bLIGHT BLUE\b/, 'CELESTE'],
  [/\bBLACK\b/, 'NEGRO'], [/\bWHITE\b/, 'BLANCO'], [/\bGR[AE]Y\b/, 'GRIS'], [/\bBROWN\b/, 'MARRON'], [/\bNAVY\b/, 'AZUL MARINO'],
  [/\bBLUE\b/, 'AZUL'], [/\bRED\b/, 'ROJO'], [/\bGREEN\b/, 'VERDE'], [/\bOLIVE\b/, 'OLIVA'], [/\bSAND\b/, 'ARENA'], [/\bTAN\b/, 'HABANO'],
  [/\bPINK\b/, 'ROSA'], [/\bORANGE\b/, 'NARANJA'], [/\bYELLOW\b/, 'AMARILLO'], [/\bPURPLE\b/, 'VIOLETA'], [/\bCREAM\b/, 'CREMA'],
  [/\bSILVER\b/, 'PLATEADO'], [/\bGOLD\b/, 'DORADO'], [/\bCOFFEE\b/, 'CAFE'], [/\bCHARCOAL\b/, 'GRIS OSCURO'], [/\bKHAKI\b/, 'CAQUI'],
];
const COLOR = /^(TOTAL|NEGRO|BLANCO|HUESO|GRIS|OSCURO|MARRON|AZUL|MARINO|ROJO|VERDE|OLIVA|ARENA|HABANO|ROSA|NARANJA|AMARILLO|VIOLETA|CREMA|PLATEADO|DORADO|CAFE|CAQUI|CELESTE|BEIGE|CAMEL|MILITAR|CHOCOLATE|TOSTADO|AZULINO|NATURAL|CRUDO|BORDO|LILA|AQUA|PASTEL|ACID|NUT|VINTAGE|CLARO)$/;
const capital = (w: string) => (/\d/.test(w) || /^(II|III|IV)$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
const esMujer = (linea: string) => /\bGIRLS?\b|\bWOMEN\b|\bMUJER\b/.test(norm(linea));
const esNino = (linea: string, descripcion: string) => /\bJUNIOR\b|\bKIDS?\b|\bBOYS?\b/.test(norm(linea)) || /\bJR\b|\bGROM\b/.test(norm(descripcion));

/**
 * Título como los Reef de la tienda: «Tipo Reef Modelo [Mujer|Niño] Color».
 * «SHAKA BLACK/WHITE» (CALZADO WALL SHOES GUYS) → «Zapatillas Reef Shaka Negro Blanco»;
 * «ROCKER ALL BLACK» (… GIRLS) → «Zapatillas Reef Rocker Mujer Negro Total» (distinto de «AGGY BLACK» → «… Negro»).
 */
export function tituloReef(descripcion: string, linea = ''): string {
  const tipo = tipoReef(linea, descripcion);
  let d = norm(descripcion).replace(/\//g, ' ');
  for (const [re, x] of COLORES) d = d.replace(re, x);
  const palabras = d.replace(QUITAR, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (tipo) { const p = norm(tipo.prefijo).split(' ')[0]; if (palabras[0] === p) palabras.shift(); }
  let k = palabras.length;
  while (k > 0 && COLOR.test(palabras[k - 1])) k--;
  const modelo = palabras.slice(0, k).map(capital), color = palabras.slice(k).map(capital);
  const quien = esNino(linea, descripcion) ? ['Niño'] : esMujer(linea) ? ['Mujer'] : [];
  return [tipo?.prefijo ?? '', VENDOR_REEF, ...modelo, ...quien, ...color].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Parte del SKU para el talle, como los Reef de la tienda: 40 → 040, 39-40 → 3940, S → S. */
export function talleSkuReef(talle: string): string {
  const t = talleReef(talle);
  if (/^\d+$/.test(t)) return t.padStart(3, '0');
  return t.replace(/[^A-Z0-9]/g, '');
}
/** Talle de la variante nueva: los dobles van «39 / 40», como en la tienda. */
export const talleVarianteReef = (talle: string) => talleReef(talle).replace(/^(\d+)-(\d+)$/, '$1 / $2');
export const costoReef = costoFamily;

/** Opción «crear producto nuevo» de un artículo de Reef. La línea de la lista (para el tipo) viaja aparte. */
export function altaReef(r: RenglonFamily, lista: ListaReef | null): OpcionCarga {
  const art = lista?.articulos.find((a) => a.codigo === alnum(r.codigo));
  const titulo = tituloReef(r.descripcion, art?.linea ?? '');
  const avisos: string[] = [];
  const base = { clave: 'alta', etiqueta: `Crear producto nuevo «${titulo}»`, avisos };
  const unico = !!art && !!curvaReef(art.curva)?.unico;
  if (!r.talles.length && !unico) return { ...base, accion: null, bloqueo: art?.us ? 'Viene en talle de EE.UU.: escribí los talles argentinos en «✏️ Ver o corregir».' : 'No sé los talles: escribilos en «✏️ Ver o corregir».' };
  if (!(r.precioMayor > 0)) return { ...base, accion: null, bloqueo: 'Falta el PMV (de ahí sale el costo). Corregilo en «✏️ Ver o corregir» o subí la lista de precios.' };
  if (!(r.precioPublico > 0)) return { ...base, accion: null, bloqueo: 'Falta el PVP (precio de venta). Corregilo en «✏️ Ver o corregir» o subí la lista de precios.' };
  const variantes = r.talles.length
    ? r.talles.map((t) => ({ talle: talleVarianteReef(t.talle), sku: `${alnum(r.codigo)}.${talleSkuReef(t.talle)}`, cantidad: t.cantidad }))
    : [{ talle: 'Default Title', sku: alnum(r.codigo), cantidad: r.cantidad }];
  const repetidos = variantes.filter((v, i) => variantes.findIndex((x) => x.talle === v.talle) !== i).map((v) => v.talle);
  if (repetidos.length) return { ...base, accion: null, bloqueo: `El talle ${[...new Set(repetidos)].join(', ')} está dos veces.` };
  const tipo = tipoReef(art?.linea ?? '', r.descripcion);
  if (!tipo) avisos.push(`No conozco el tipo de producto de «${r.descripcion}»: revisá el título y el tipo.`);
  if (!art) avisos.push('No está en la lista de precios: revisá el título y los precios.');
  return {
    ...base,
    accion: {
      tipo: 'alta', titulo, productType: tipo?.productType ?? 'Indumentaria', etiquetas: [alnum(r.codigo), ...(tipo?.etiquetas ?? ROPA), 'reef'],
      gramos: tipo?.gramos ?? 400, precio: Math.round(r.precioPublico), costo: costoReef(r.precioMayor), vendor: VENDOR_REEF,
      variantes, ...(r.talles.length ? {} : { opcion: 'Title' }), precioEditable: true, origenPrecio: 'PVP de la lista',
    },
  };
}

/** El marketplace de Reef. La lista de precios se pasa para el tipo de producto de las altas. */
export function marketplaceReef(lista: ListaReef | null): Marketplace {
  return {
    id: 'reef', nombre: 'Reef', sucursal: SUCURSAL_REEF, consultaNombre: null,
    busqueda: busquedaReef,
    esDelCodigo: (sku, etiquetas, codigo) => skuEsDeReef(sku, codigo) || etiquetaEsDeReef(etiquetas, codigo),
    alta: (r) => altaReef(r, lista),
    costoEsperado: (r) => (r.precioMayor > 0 ? costoReef(r.precioMayor) : null),
  };
}
