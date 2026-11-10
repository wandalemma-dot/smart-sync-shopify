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
import type { Factura, LineaPedido, Pedido, RenglonFactura } from './controlFacturas';

const sinAcento = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

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

export function leerPedidoExcel(filas: unknown[][], id: string, nombre: string, fecha: string): LecturaPedido {
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
    lineas.push({
      sku,
      codigo,
      descripcion: desc,
      talle: pack ? `Pack x${porUdm}${curva(sku)}` : talleDeDescripcion(desc, sku, codigo),
      unidadesPorUdm: porUdm,
      precioLista: porUdm > 1 ? precio / porUdm : precio,
      descuento: dto,
      cantidad: cant * porUdm,
    });
  }
  if (!lineas.length) avisos.push(`${nombre}: no tiene ninguna fila con cantidad en «Pedido».`);
  return { pedido: { id, nombre, fecha, lineas }, avisos };
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
