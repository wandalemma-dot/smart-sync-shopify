// ============================================================================
// LECTORES para el control de facturas contra pedidos (10-nov-2026).
// - Pedido: Excel del proveedor, una fila por SKU (modelo + talle), columnas por
//   ENCABEZADO: SKU, Modelo color, Descripción, UDM, Mayorista, Descuento, Pedido.
//   «Pack de 12 Unidades»: el precio es por pack y Pedido cuenta packs; se pasa a
//   pares (pedido × 12, precio / 12), que es como factura el proveedor.
// - Factura: PDF de DISTRINANDO (Reebok / Kappa). Se leen las posiciones del
//   texto (fila por altura, columnas por x) porque el orden interno del PDF no
//   sigue la lectura. Renglones con números en formato 63,982.40 y totales en
//   formato 8.837.577,37.
// ============================================================================
import type { Factura, LineaPedido, Pedido, RenglonFactura, RenglonRemito, Remito } from './controlFacturas';

const sinAcento = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Número en formato argentino o inglés: el último separador seguido de 1-2 dígitos es el decimal. */
export function numero(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const ult = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (ult >= 0 && s.length - ult - 1 <= 2) {
    s = s.slice(0, ult).replace(/[.,]/g, '') + '.' + s.slice(ult + 1);
  } else {
    s = s.replace(/[.,]/g, '');
  }
  return Number(s);
}

// ---------------------------------------------------------------------------
// PEDIDO (Excel)
// ---------------------------------------------------------------------------
export interface LecturaPedido { pedido: Pedido; avisos: string[] }

/**
 * Celdas pintadas de verde en la planilla (12-nov-2026, gax: «lo que está en verde ya entró»).
 * verdes: referencias A1 de la hoja; origen: fila/columna donde empieza la hoja leída
 * (las filas de sheet_to_json arrancan ahí); fecha: la de la copia de la planilla.
 */
export interface HojaMarcada { verdes: Set<string>; origen?: { r: number; c: number }; fecha: string }

/** Referencia A1 de una celda (fila y columna desde 0). */
export function a1(r: number, c: number): string {
  let col = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) col = String.fromCharCode(65 + ((n - 1) % 26)) + col;
  return `${col}${r + 1}`;
}
const refDe = (hoja: HojaMarcada | undefined, fila: number, col: number) => a1(fila + (hoja?.origen?.r ?? 0), col + (hoja?.origen?.c ?? 0));

export function leerPedidoExcel(filas: unknown[][], id: string, nombre: string, fecha: string, hoja?: HojaMarcada): LecturaPedido {
  const avisos: string[] = [];
  const iEnc = filas.findIndex((f) => {
    const h = (f || []).map(sinAcento);
    return h.includes('pedido') && (h.includes('modelo color') || h.includes('modelo-color')) && h.includes('sku');
  });
  if (iEnc < 0) throw new Error(`${nombre}: no encontré los encabezados SKU / Modelo color / Pedido.`);
  const enc = filas[iEnc].map(sinAcento);
  const col = (...nombres: string[]) => enc.findIndex((h) => nombres.includes(h));
  const cSku = col('sku');
  const cMod = col('modelo color', 'modelo-color');
  const cDesc = enc.findIndex((h) => h.startsWith('descripcion'));
  const cUdm = col('udm');
  const cMay = col('mayorista');
  const cDto = col('descuento');
  const cPed = col('pedido');
  if (cMay < 0) throw new Error(`${nombre}: falta la columna «Mayorista» (precio de lista).`);
  const lineas: LineaPedido[] = [];
  for (let i = iEnc + 1; i < filas.length; i++) {
    const f = filas[i] || [];
    const sku = String(f[cSku] ?? '').trim();
    const codigo = String(f[cMod] ?? '').trim();
    if (!sku || !codigo) continue;
    const cant = numero(f[cPed]);
    if (!(cant > 0)) continue;
    const udm = String(f[cUdm] ?? '');
    const pack = /pack\s+de\s+(\d+)/i.exec(udm);
    const porUdm = pack ? Number(pack[1]) : 1;
    const precio = numero(f[cMay]);
    const dto = cDto >= 0 ? numero(f[cDto]) || 0 : 0;
    const desc = String(f[cDesc] ?? '').trim();
    if (!(precio > 0)) { avisos.push(`Fila ${i + 1} (${sku}): sin precio Mayorista, no se puede controlar el precio.`); }
    if (!Number.isInteger(cant)) avisos.push(`Fila ${i + 1} (${sku}): cantidad pedida no entera (${cant}).`);
    const celda = refDe(hoja, i, cPed);
    // Fila en verde (la cantidad pedida o el SKU): ya entró.
    const verde = !!hoja && [cPed, cSku, cMod].some((c) => c >= 0 && hoja.verdes.has(refDe(hoja, i, c)));
    lineas.push({
      sku,
      codigo,
      descripcion: desc,
      talle: pack ? `Pack x${porUdm}${curva(sku)}` : talleDeDescripcion(desc, sku, codigo),
      unidadesPorUdm: porUdm,
      precioLista: porUdm > 1 ? precio / porUdm : precio,
      descuento: dto,
      cantidad: cant * porUdm,
      celda,
      ...(verde ? { entregado: cant * porUdm, entregadoDesde: hoja!.fecha } : {}),
    });
  }
  if (!lineas.length) avisos.push(`${nombre}: no tiene ninguna fila con cantidad en «Pedido».`);
  return { pedido: { id, nombre, fecha, lineas }, avisos };
}

// ---------------------------------------------------------------------------
// PEDIDO de iD (Converse / Le Coq): una fila por artículo, talles en columnas.
// Fila 1 «Pedido N° 0000XXXX»; encabezado con «Código», «Color», columnas de
// talle (035…120 = calzado en US×10, XS…XXL, TU), «Total», «Precio unit.»,
// «Bonif. %». Columnas por NOMBRE, nunca por posición.
// ---------------------------------------------------------------------------
const RE_TALLE_COL = /^(\d{2,3}([.,]\d)?|XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|TU|U)$/i;

/** Fecha dd/mm/aaaa (o número de serie de Excel) a AAAA-MM-DD; '' si no hay. */
function fechaDeCelda(v: unknown): string {
  if (typeof v === 'number' && v > 40000 && v < 60000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(String(v ?? ''));
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function leerPedidoId(filas: unknown[][], id: string, nombre: string, fecha: string, hoja?: HojaMarcada): LecturaPedido & { nroProveedor: string; fechaArchivo: string } {
  const avisos: string[] = [];
  let nroProveedor = '';
  let fechaArchivo = '';
  // Fila 1: «Pedido N° 00002576 | 2059 — ELEVE SAS | 27/10/2026»: número y fecha de la nota.
  for (const f of filas.slice(0, 8)) {
    const m = /pedido\s*n[°ºo.]*\s*:?\s*(\d{3,})/i.exec((f || []).map((x) => String(x ?? '')).join(' '));
    if (m) {
      nroProveedor = m[1];
      fechaArchivo = (f || []).map(fechaDeCelda).find(Boolean) || '';
      break;
    }
  }
  fecha = fechaArchivo || fecha;
  const iEnc = filas.findIndex((f) => (f || []).some((x) => sinAcento(String(x ?? '')) === 'codigo'));
  if (iEnc < 0) throw new Error(`${nombre}: no encontré el encabezado «Código».`);
  const crudo = filas[iEnc].map((x) => String(x ?? '').trim());
  const enc = crudo.map(sinAcento);
  const cCod = enc.indexOf('codigo');
  const cColor = enc.indexOf('color');
  const cDesc = enc.findIndex((h) => h.startsWith('descripcion') || h === 'articulo' || h === 'nombre' || h === 'modelo');
  const cTotal = enc.findIndex((h, i) => i > cCod && /^total/.test(h));
  const cPrecio = enc.findIndex((h) => /^precio/.test(h));
  const cBonif = enc.findIndex((h) => /^bonif/.test(h) || /^desc/.test(h) && h.includes('%'));
  if (cPrecio < 0) throw new Error(`${nombre}: falta la columna «Precio unit.».`);
  const desde = Math.max(cCod, cColor, cDesc) + 1;
  const hasta = cTotal >= 0 ? cTotal : enc.length;
  const talles: { col: number; talle: string }[] = [];
  for (let i = desde; i < hasta; i++) if (RE_TALLE_COL.test(crudo[i])) talles.push({ col: i, talle: crudo[i].toUpperCase() });
  if (!talles.length) throw new Error(`${nombre}: no encontré columnas de talle entre «Código» y «Total».`);
  const lineas: LineaPedido[] = [];
  for (let i = iEnc + 1; i < filas.length; i++) {
    const f = filas[i] || [];
    const codigo = String(f[cCod] ?? '').trim();
    if (!codigo || /^total/i.test(codigo)) continue;
    const precio = numero(f[cPrecio]);
    const bonif = cBonif >= 0 ? numero(f[cBonif]) || 0 : 0;
    const color = cColor >= 0 ? String(f[cColor] ?? '').trim() : '';
    const desc = [cDesc >= 0 ? String(f[cDesc] ?? '').trim() : '', color].filter(Boolean).join(' · ');
    let suma = 0;
    // Verde: la celda del talle. Si ningún talle de la fila está en verde pero sí el código o el
    // total, llegó la fila entera (así marca a veces el depósito).
    const verde = (c: number) => !!hoja && c >= 0 && hoja.verdes.has(refDe(hoja, i, c));
    const tallesVerdes = talles.some((t) => numero(f[t.col]) > 0 && verde(t.col));
    const filaVerde = !tallesVerdes && (verde(cCod) || verde(cTotal));
    const celdaTotal = cTotal >= 0 ? refDe(hoja, i, cTotal) : undefined;
    for (const t of talles) {
      const cant = numero(f[t.col]);
      if (!(cant > 0)) continue;
      if (!Number.isInteger(cant)) avisos.push(`Fila ${i + 1} (${codigo}): cantidad no entera en talle ${t.talle}.`);
      suma += cant;
      const llego = filaVerde || verde(t.col);
      lineas.push({
        sku: `${codigo}-${t.talle}`, codigo, descripcion: desc, talle: t.talle, unidadesPorUdm: 1, precioLista: precio, descuento: bonif, cantidad: cant,
        celda: refDe(hoja, i, t.col), ...(celdaTotal ? { celdaTotal } : {}),
        ...(llego ? { entregado: cant, entregadoDesde: hoja!.fecha } : {}),
      });
    }
    if (suma > 0 && !(precio > 0)) avisos.push(`Fila ${i + 1} (${codigo}): sin precio unitario, no se puede controlar el precio.`);
    const tot = cTotal >= 0 ? numero(f[cTotal]) : NaN;
    if (suma > 0 && !Number.isNaN(tot) && tot !== suma) avisos.push(`Fila ${i + 1} (${codigo}): los talles suman ${suma} y «Total» dice ${tot}.`);
  }
  if (!lineas.length) avisos.push(`${nombre}: no tiene cantidades pedidas.`);
  return { pedido: { id, nombre, fecha, lineas }, avisos, nroProveedor, fechaArchivo };
}

/** Elige el lector según los encabezados: Distrinando (SKU / Modelo color / Pedido) o iD (Código + talles). */
export function leerPedidoAuto(filas: unknown[][], id: string, nombre: string, fecha: string, hoja?: HojaMarcada): LecturaPedido & { nroProveedor: string; fechaArchivo: string; proveedor: 'distrinando' | 'id' } {
  const esDistri = filas.some((f) => {
    const h = (f || []).map(sinAcento);
    return h.includes('pedido') && h.includes('sku') && (h.includes('modelo color') || h.includes('modelo-color'));
  });
  if (esDistri) return { ...leerPedidoExcel(filas, id, nombre, fecha, hoja), nroProveedor: '', fechaArchivo: '', proveedor: 'distrinando' };
  return { ...leerPedidoId(filas, id, nombre, fecha, hoja), proveedor: 'id' };
}

function curva(sku: string): string {
  const m = /---(.+)$/.exec(sku);
  return m ? ` (${m[1].trim()})` : '';
}

/** Talle para el depósito: el final de la descripción (43, AR43.5, UK 10…); si no, el sufijo del SKU. */
function talleDeDescripcion(desc: string, sku: string, codigo: string): string {
  const m = /(?:\b(AR|UK|US)\s*)?(\d{1,2}(?:[.,]\d)?)\s*$/i.exec(desc);
  if (m) return `${m[1] ? m[1].toUpperCase() + ' ' : ''}${m[2].replace(',', '.')}`;
  const m2 = /\s([A-Z0-9]{1,4})\s*$/i.exec(desc);
  if (m2 && /^(XXS|XS|S|M|L|XL|XXL|XXXL|\dXL)$/i.test(m2[1])) return m2[1].toUpperCase();
  return sku.startsWith(codigo + '-') ? sku.slice(codigo.length + 1) : sku;
}

// ---------------------------------------------------------------------------
// FACTURA (PDF)
// ---------------------------------------------------------------------------
export interface ItemPdf { str: string; transform: number[] }
interface Celda { x: number; s: string }
type Fila = Celda[];

/** Agrupa los textos de una página en filas (misma altura ±2) ordenadas de arriba hacia abajo y por x. */
export function filasPdf(items: ItemPdf[]): Fila[] {
  const xs = items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ x: i.transform[4], y: i.transform[5], s: i.str.replace(/\s+/g, ' ').trim() }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const filas: { y: number; celdas: Celda[] }[] = [];
  for (const it of xs) {
    const ultima = filas[filas.length - 1];
    if (ultima && Math.abs(ultima.y - it.y) <= 2) ultima.celdas.push({ x: it.x, s: it.s });
    else filas.push({ y: it.y, celdas: [{ x: it.x, s: it.s }] });
  }
  return filas.map((f) => f.celdas.sort((a, b) => a.x - b.x));
}

const RE_NUM = /^-?[\d.,]+$/;
const texto = (f: Fila) => f.map((c) => c.s).join(' ');
const fechaIso = (s: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

export interface LecturaFactura { factura: Factura; avisos: string[] }

/** Factura PDF de DISTRINANDO. `paginas` = items de pdf.js de cada página. */
export function leerFacturaDistrinando(paginas: ItemPdf[][], id: string): LecturaFactura {
  const avisos: string[] = [];
  const filasPag = paginas.map(filasPdf);
  // Si el PDF trae copias (Original / Duplicado), usar solo la primera.
  const copia = (fs: Fila[]) => (fs.flat().find((c) => /^(original|duplicado|triplicado)$/i.test(c.s))?.s || '').toLowerCase();
  const primera = filasPag.map(copia).find(Boolean) || '';
  const usadas = filasPag.filter((fs) => copia(fs) === primera);

  let numeroFac = '', fecha = '', remito = '', vto = '', cond = '', pedidoProv = '';
  let subtotal = NaN, iva = NaN, caba = 0, bsas = 0, total = NaN, descuentoGlobal = 0, pares = NaN;
  const renglones: RenglonFactura[] = [];
  let xDesc2 = Infinity; // columna de la segunda descripción (código de color en Reebok/Kappa)

  for (const filas of usadas) {
    for (const f of filas) {
      const t = texto(f);
      const hdr = f.find((c) => sinAcento(c.s) === 'descripcion');
      if (hdr && f.some((c) => sinAcento(c.s) === 'codigo')) xDesc2 = hdr.x - 5;
      const valorDe = (etiqueta: RegExp) => {
        const i = f.findIndex((c) => etiqueta.test(c.s));
        return i >= 0 ? f.slice(i + 1).map((c) => c.s).join(' ').trim() : '';
      };
      if (!numeroFac && /^N°:?$/.test(f[0]?.s || '') ) numeroFac = (/\d{4}-\d{8}/.exec(t) || [''])[0];
      if (!fecha && f.some((c) => /^Fecha:$/.test(c.s))) fecha = fechaIso(valorDe(/^Fecha:$/));
      if (!remito && /Remito Nro/i.test(t)) remito = (/\d{4}-\d{8}/.exec(valorDe(/Remito Nro/i)) || [''])[0];
      if (!vto && /Fecha Vto/i.test(t)) vto = fechaIso(valorDe(/Fecha Vto/i));
      if (!cond && /Cond\. de Venta/i.test(t)) cond = (valorDe(/Cond\. de Venta/i).split(/Fecha Vto/i)[0] || '').trim();
      const ped = /Pedidos? de cliente\s+([\d ,y]+)/i.exec(t);
      if (ped && !pedidoProv) pedidoProv = ped[1].replace(/\.$/, '').trim();
      if (/^Subtotal:$/.test(f.find((c) => /Subtotal:/.test(c.s))?.s || '')) subtotal = numero(valorDe(/^Subtotal:$/));
      if (/^Descuento:$/.test(f.find((c) => /Descuento:/.test(c.s))?.s || '')) descuentoGlobal = numero(f[f.length - 1].s) || 0;
      if (/^Perc IIBB CABA/i.test(f[0]?.s || '')) caba = numero(f[f.length - 1].s);
      if (/^Perc IIBB Buenos Aires/i.test(f[0]?.s || '')) bsas = numero(f[f.length - 1].s);
      if (/^IVA_?21/i.test(f[0]?.s || '')) iva = numero(f[f.length - 1].s);
      if (f.some((c) => /^▌?\s*Total:$/.test(c.s))) total = numero(valorDe(/^▌?\s*Total:$/));
      const mp = /Pares:\s*(\d+)/.exec(t);
      if (mp) pares = Number(mp[1]);

      // Renglón: empieza con un código y termina con precio, bonif., cantidad y total.
      if (f.length < 5) continue;
      const ult = f.slice(-4);
      if (!ult.every((c) => RE_NUM.test(c.s))) continue;
      const primeraCelda = f[0].s;
      const cod = /^([A-Z0-9][A-Z0-9-]{4,})(?:\s|$)/i.exec(primeraCelda);
      if (!cod || /^\d{2}\/\d{2}/.test(primeraCelda)) continue;
      let codigo = cod[1].split('---')[0].replace(/-+$/, '');
      const medio = f.slice(1, -4).filter((c) => c.x >= xDesc2);
      const color = medio.map((c) => c.s).join(' ').trim();
      const codColor = /^([A-Z]{2,}[A-Z0-9]*\d[A-Z0-9]*)\b/.exec(color);
      if (codColor && !/---/.test(cod[1])) codigo = `${codigo}-${codColor[1]}`;
      const descripcion = [primeraCelda.slice(cod[0].length).trim(), color && color !== '- -' ? color : ''].filter(Boolean).join(' · ');
      const [precio, bonif, cant, tot] = ult.map((c) => numero(c.s));
      renglones.push({ codigo, descripcion, precioUnitario: precio, bonificacion: bonif, cantidad: cant, total: tot });
    }
  }
  if (!numeroFac) avisos.push('No encontré el número de factura.');
  if (!fecha) avisos.push('No encontré la fecha de la factura.');
  if (!renglones.length) throw new Error('No encontré renglones en la factura. ¿Es una factura de DISTRINANDO?');
  if (Number.isNaN(subtotal) || Number.isNaN(total) || Number.isNaN(iva)) avisos.push('No pude leer subtotal, IVA o total: revisalos a mano.');
  if (descuentoGlobal) avisos.push(`La factura trae un descuento general de ${descuentoGlobal}%: no está contemplado en el control.`);
  const suma = renglones.reduce((s, r) => s + r.cantidad, 0);
  if (!Number.isNaN(pares) && pares !== suma) avisos.push(`La factura dice ${pares} pares y los renglones leídos suman ${suma}: puede faltar un renglón.`);
  return {
    factura: {
      id, numero: numeroFac, fecha, remito, vencimiento: vto, condicionVenta: cond, pedidoProveedor: pedidoProv,
      renglones, subtotal: subtotal || 0, iva: iva || 0, percepcionCaba: caba || 0, percepcionBsAs: bsas || 0, total: total || 0,
    },
    avisos,
  };
}

/**
 * Factura PDF de iD ARGENTINA (FA 0011-…). Renglones: código · descripción ·
 * cantidad · precio de lista · bonificación «10%» · importe bonificado.
 * Totales sin etiqueta para el subtotal (primer «$ importe»), luego I.V.A,
 * Perc. IIBB CABA, Perc. IIBB BS.AS. y el total (último «$ importe»).
 * Vencimiento = fecha + días de la condición («30 DIAS»).
 */
export function leerFacturaId(paginas: ItemPdf[][], id: string): LecturaFactura {
  const avisos: string[] = [];
  let numeroFac = '', fecha = '', remito = '', cond = '', vto = '';
  let subtotal = NaN, iva = NaN, caba = 0, bsas = 0, total = NaN, cantTotal = NaN;
  const renglones: RenglonFactura[] = [];
  const montos: { etiqueta: string; valor: number }[] = [];
  const vistos = new Set<string>();
  for (const filas of paginas.map(filasPdf)) {
    // Si el PDF repite la factura (copias), no duplicar renglones.
    const firma = filas.map(texto).join('\n');
    if (vistos.has(firma)) continue;
    vistos.add(firma);
    for (const f of filas) {
      const t = texto(f);
      if (!numeroFac && /factura/i.test(t)) numeroFac = (/\d{4}-\d{8}/.exec(t) || [''])[0];
      if (!numeroFac && /^\d{4}-\d{8}$/.test(f[f.length - 1]?.s || '')) numeroFac = f[f.length - 1].s;
      if (!fecha && /Fecha:/.test(t)) {
        const m = /(\d{2})[-/](\d{2})[-/](\d{2,4})/.exec(t);
        if (m) fecha = `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2]}-${m[1]}`;
      }
      const d = /(\d{1,3})\s*D[IÍ]AS/i.exec(t);
      if (!cond && d) cond = `${d[1]} días`;
      if (!remito && /Comprobante Ref/i.test(t)) remito = (/Comprobante Ref:?\s*(\S+)/i.exec(t) || ['', ''])[1];
      const ct = /Cantidad total:?\s*(\d+)/i.exec(t);
      if (ct) cantTotal = Number(ct[1]);
      // Montos del pie: «$ 11.726.807,96», con o sin etiqueta a la izquierda.
      const iPeso = f.findIndex((c) => c.s === '$');
      if (iPeso >= 0 && iPeso === f.length - 2 && RE_NUM.test(f[f.length - 1].s)) {
        montos.push({ etiqueta: f.slice(0, iPeso).map((c) => c.s).join(' '), valor: numero(f[f.length - 1].s) });
        continue;
      }
      // Renglón.
      if (f.length < 5) continue;
      const [cCant, cPrecio, cBonif, cImp] = f.slice(-4);
      const cod = /^[A-Z0-9]{5,}$/i.exec(f[0].s);
      if (!cod || !/^\d+$/.test(cCant.s) || !RE_NUM.test(cPrecio.s) || !/^\d+([.,]\d+)?%$/.test(cBonif.s) || !RE_NUM.test(cImp.s)) continue;
      renglones.push({
        codigo: f[0].s.toUpperCase(),
        descripcion: f.slice(1, -4).map((c) => c.s).join(' '),
        cantidad: Number(cCant.s),
        precioUnitario: numero(cPrecio.s),
        bonificacion: numero(cBonif.s),
        total: numero(cImp.s),
      });
    }
  }
  for (const m of montos) {
    if (/I\.?V\.?A/i.test(m.etiqueta)) iva = m.valor;
    else if (/CABA/i.test(m.etiqueta)) caba = m.valor;
    else if (/BS\.?\s*AS|BUENOS/i.test(m.etiqueta)) bsas = m.valor;
    else if (Number.isNaN(subtotal) && Number.isNaN(iva)) subtotal = m.valor;
  }
  if (montos.length) total = montos[montos.length - 1].valor;
  // El importe del renglón a veces sale cortado en el PDF (1.267.363,5): si coincide
  // con la cuenta al decimal impreso, se usa la cuenta exacta.
  for (const r of renglones) {
    const calc = Math.round(r.precioUnitario * (1 - r.bonificacion / 100) * r.cantidad * 100) / 100;
    if (Math.abs(calc - r.total) < 0.1 && Math.abs(calc - r.total) > 0.005) r.total = calc;
  }
  if (cond && fecha) {
    const dt = new Date(`${fecha}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + Number(/\d+/.exec(cond)![0]));
    vto = dt.toISOString().slice(0, 10);
  }
  if (!numeroFac) avisos.push('No encontré el número de factura.');
  if (!fecha) avisos.push('No encontré la fecha de la factura.');
  if (!renglones.length) throw new Error('No encontré renglones en la factura. ¿Es una factura de iD?');
  if (Number.isNaN(subtotal) || Number.isNaN(iva) || Number.isNaN(total)) avisos.push('No pude leer subtotal, IVA o total: revisalos a mano.');
  const suma = renglones.reduce((s, r) => s + r.cantidad, 0);
  if (!Number.isNaN(cantTotal) && cantTotal !== suma) avisos.push(`La factura dice cantidad total ${cantTotal} y los renglones leídos suman ${suma}: puede faltar un renglón.`);
  return {
    factura: {
      id, numero: numeroFac, fecha, remito, vencimiento: vto, condicionVenta: cond, pedidoProveedor: '',
      renglones, subtotal: subtotal || 0, iva: iva || 0, percepcionCaba: caba || 0, percepcionBsAs: bsas || 0, total: total || 0,
    },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// REMITO EN TEXTO (11-nov-2026). Es lo que devuelve la lectura de la foto y lo
// que se puede escribir o corregir a mano, una línea por artículo:
//   Remito 0016-00125246
//   Fecha 04/11/2026
//   571818C 5.0/1 6.0/2 6.5/3 7.5/2
//   A10520C 3            ← solo el total, sin talles
// ---------------------------------------------------------------------------
const RE_COD_REMITO = /^[A-Z0-9][A-Z0-9._/-]{2,}$/;

export function leerTextoRemito(texto: string, opciones: { codigoSinNumeros?: boolean } = {}): { remito: Pick<Remito, 'numero' | 'fecha' | 'renglones'>; errores: string[] } {
  const errores: string[] = [];
  let numero = '';
  let fecha = '';
  const porCodigo = new Map<string, RenglonRemito>();
  String(texto ?? '').split(/\r?\n/).forEach((cruda, i) => {
    const linea = cruda.trim();
    if (!linea || linea.startsWith('#')) return;
    const mNum = /^remito\b\s*(?:n[°ºo.]*)?\s*:?\s*([0-9][0-9 -]*)$/i.exec(linea);
    if (mNum) { numero = mNum[1].replace(/\s+/g, ''); return; }
    if (/^fecha\b/i.test(linea)) { fecha = fechaDeCelda(linea) || fecha; return; }
    // «L/3-1» o «L/3 -1»: llegaron 3 y salió 1 para órdenes (marca a mano del depósito).
    const tokens = linea.replace(/[−–]/g, '-').replace(/\s*([/×:=])\s*/g, '$1').replace(/\s+x\s+/gi, 'x').replace(/(\d)\s+-\s*(\d)/g, '$1-$2').split(/[\s,;]+/).filter(Boolean);
    const codigo = tokens[0].toUpperCase();
    // Family usa códigos sin números (SHBSPEC); los demás proveedores siempre traen alguno.
    if (!RE_COD_REMITO.test(codigo) || (!opciones.codigoSinNumeros && !/\d/.test(codigo))) { errores.push(`Línea ${i + 1}: no reconozco el código «${tokens[0]}».`); return; }
    const resto = tokens.slice(1);
    const r: RenglonRemito = porCodigo.get(codigo) ?? { codigo, cantidad: 0, talles: [] };
    const mTotal = resto.length === 1 ? /^(\d+)(?:-(\d+))?$/.exec(resto[0]) : null;
    if (mTotal) {
      const cant = Number(mTotal[1]), ret = Number(mTotal[2] || 0);
      if (ret > cant) { errores.push(`Línea ${i + 1}: ${codigo} no pueden salir ${ret} para órdenes si llegaron ${cant}.`); return; }
      r.cantidad += cant;
      if (ret) r.retirado = (r.retirado ?? 0) + ret;
    } else if (!resto.length) {
      errores.push(`Línea ${i + 1}: ${codigo} no tiene cantidades.`); return;
    } else {
      for (const t of resto) {
        const m = /^([A-Z0-9.]+?)[/×:=x](\d+)(?:-(\d+))?$/i.exec(t);
        if (!m) { errores.push(`Línea ${i + 1}: no entiendo «${t}» (escribí talle/cantidad, por ejemplo 7.5/2; si salió uno para órdenes, 7.5/2-1).`); continue; }
        const talle = m[1].toUpperCase();
        const cant = Number(m[2]);
        const ret = Number(m[3] || 0);
        if (ret > cant) { errores.push(`Línea ${i + 1}: ${codigo} talle ${talle}: no pueden salir ${ret} para órdenes si llegaron ${cant}.`); continue; }
        const ya = r.talles.find((x) => x.talle === talle);
        if (ya) { ya.cantidad += cant; if (ret) ya.retirado = (ya.retirado ?? 0) + ret; } else r.talles.push(ret ? { talle, cantidad: cant, retirado: ret } : { talle, cantidad: cant });
        r.cantidad += cant;
      }
    }
    porCodigo.set(codigo, r);
  });
  return { remito: { numero, fecha, renglones: [...porCodigo.values()] }, errores };
}

/** El remito en el mismo formato de texto, para mostrarlo y corregirlo. */
export function textoRemito(r: Pick<Remito, 'numero' | 'fecha' | 'renglones'>): string {
  const lineas: string[] = [];
  if (r.numero) lineas.push(`Remito ${r.numero}`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.fecha || '');
  if (m) lineas.push(`Fecha ${m[3]}/${m[2]}/${m[1]}`);
  for (const x of r.renglones) {
    const menos = (n?: number) => (n ? `-${n}` : '');
    lineas.push(x.talles.length ? `${x.codigo} ${x.talles.map((t) => `${t.talle}/${t.cantidad}${menos(t.retirado)}`).join(' ')}` : `${x.codigo} ${x.cantidad}${menos(x.retirado)}`);
  }
  return lineas.join('\n');
}
