// ============================================================================
// TARGET (19-nov-2026, pedido de gax: «un nuevo proveedor que se llama Target, pero mandaron facturas de
// diferentes proveedores; una sola solapa que se llama Target»).
// ----------------------------------------------------------------------------
// Target factura con cuatro empresas del mismo grupo: Target, Tendence, Bag Company y All Brands. Todas
// usan el mismo formato y van en la misma solapa; la empresa queda anotada en cada factura.
//   · Nota de pedido: el PDF «Detalle de solicitud» de la web de Target (targetmodaweb), en Trello o subido
//     a mano. Trae el precio por unidad YA con la promoción (riñonera 10.000 − 50% → 5.000).
//   · Factura: en papel. Se saca una foto y se transcribe (api/leer-remito, tipo «factura»). El precio de
//     cada renglón es el de lista y la bonificación (10%, 30%, 50%) va en el pie, una por factura. Las
//     cuentas (renglón, bonificación, IVA, total) se controlan acá: lo que no cierra se avisa.
//   · Precio contra la nota: se compara el NETO (lista − bonificación). Más barato que la nota no es un
//     reclamo (la bonificación de pago suele venir de más); más caro, sí.
//   · Alta (gax): precio de venta = precio de lista × 2 («calculando el margen con el precio sin el
//     descuento»); costo = lista − la bonificación de esa factura, con centavos. Marca (vendor) = la del
//     producto (Discovery, Reebok, NBA…) y la etiqueta «Target» para reconocerlos. SKU = el código.
//     Se crean sin talles (un producto por código); los colores de la curva todavía no se sabe cómo vienen.
// ============================================================================
import type { Factura, LineaPedido, Pedido, RenglonFactura } from './controlFacturas';
import { redondear2 } from './syncLogic';
import { margenPct } from './margen';

export const ETIQUETA_TARGET = 'Target';
export const esDeTarget = (etiquetas: string[]) => etiquetas.some((t) => String(t).trim().toUpperCase() === ETIQUETA_TARGET.toUpperCase());

const sinAcento = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const num = (s: string) => Number(s.replace(/[$\s.]/g, '').replace(',', '.'));
const fechaIso = (s: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/** Las empresas con las que factura Target (el nombre que se ve en la factura y en la planilla). */
export const EMPRESAS_TARGET = ['TARGET', 'TENDENCE', 'BAG COMPANY', 'ALL BRANDS'] as const;
export function empresaTarget(s: string): string {
  const t = sinAcento(s).toUpperCase().replace(/\s+/g, ' ');
  return EMPRESAS_TARGET.find((e) => t.includes(e)) ?? t.replace(/\b(S\.?R\.?L|S\.?A|S\.?A\.?S)\.?\s*$/, '').trim().slice(0, 40);
}

/** «A000300172534» → «0003-00172534» (punto de venta y número). Lo que no tiene esa forma queda como está. */
export function numeroFacturaTarget(s: string): string {
  const t = String(s ?? '').toUpperCase().replace(/[\s°º]/g, '').replace(/^N/, '');
  const m = /^[A-C]?(\d{4,5})-?(\d{8})$/.exec(t);
  if (m) return `${m[1].slice(-4)}-${m[2]}`;
  const m2 = /^[A-C]?(\d{12,13})$/.exec(t);
  if (m2) return `${m2[1].slice(-12, -8)}-${m2[1].slice(-8)}`;
  return String(s ?? '').trim();
}

// ---------------------------------------------------------------------------
// FACTURA (foto)
// ---------------------------------------------------------------------------
/** Lo que devuelve la lectura de la foto (server/remito.js, normalizarFactura). */
export interface FacturaFoto {
  empresa: string; numero: string; fecha: string; pedido: string;
  renglones: { codigo: string; descripcion: string; unidad: string; cantidad: number; precioUnitario: number; importe: number }[];
  subtotal: number; bonificacionPct: number; bonificacion: number; neto: number; percepciones: number; iva: number; total: number;
  dudas?: string[];
}

const fmt = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const c = (n: number) => Math.round(n * 100);

/**
 * Arma la factura de Target a partir de la foto, con las cuentas controladas. Cada renglón lleva la lista y la
 * bonificación del pie; su total es el neto (así la suma da el neto, que es sobre lo que se cobra el IVA).
 */
export function facturaTargetDeFoto(f: FacturaFoto): { factura: Factura; avisos: string[] } {
  const avisos: string[] = [...(f.dudas ?? []).map((d) => `Duda al leer la foto: ${d}`)];
  const b = Number(f.bonificacionPct) || 0;
  const renglones: RenglonFactura[] = [];
  let bruto = 0;
  for (const r of f.renglones) {
    const calc = c(r.cantidad * r.precioUnitario);
    if (r.importe && Math.abs(calc - c(r.importe)) > 2) avisos.push(`${r.codigo}: ${r.cantidad} × ${fmt(r.precioUnitario)} da ${fmt(calc / 100)} y la factura dice ${fmt(r.importe)}. Revisá la foto.`);
    if (!(r.cantidad > 0) || !(r.precioUnitario > 0)) avisos.push(`${r.codigo}: no se leyó bien la cantidad o el precio. Revisá la foto.`);
    bruto += calc;
    renglones.push({
      codigo: r.codigo, descripcion: r.descripcion, cantidad: r.cantidad, precioUnitario: r.precioUnitario, bonificacion: b,
      total: redondear2(r.cantidad * r.precioUnitario * (1 - b / 100)),
    });
  }
  if (f.subtotal && Math.abs(bruto - c(f.subtotal)) > 50) avisos.push(`Los renglones suman ${fmt(bruto / 100)} y el subtotal impreso es ${fmt(f.subtotal)}: puede faltar un renglón o haber un número mal leído.`);
  const bonif = Math.round(bruto * b / 100);
  if (f.bonificacion && Math.abs(bonif - c(f.bonificacion)) > 50) avisos.push(`La bonificación del ${b}% da ${fmt(bonif / 100)} y la factura dice ${fmt(f.bonificacion)}.`);
  const neto = f.neto || (bruto - bonif) / 100;
  if (f.neto && Math.abs(bruto - bonif - c(f.neto)) > 100) avisos.push(`Subtotal menos bonificación da ${fmt((bruto - bonif) / 100)} y el neto impreso es ${fmt(f.neto)}.`);
  const numero = numeroFacturaTarget(f.numero);
  if (!numero) avisos.push('No se leyó el número de factura: escribilo a mano.');
  if (!f.fecha) avisos.push('No se leyó la fecha de la factura.');
  const emisor = empresaTarget(f.empresa);
  return {
    factura: {
      id: '', numero, fecha: f.fecha, remito: '', pedidoProveedor: f.pedido ? `P ${f.pedido}` : '', condicionVenta: '', vencimiento: '',
      renglones, subtotal: neto, iva: f.iva, percepcionCaba: f.percepciones, percepcionBsAs: 0, total: f.total,
      emisor, soloNeto: true,
    },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// NOTA DE PEDIDO (PDF «Detalle de solicitud»)
// ---------------------------------------------------------------------------
const RE_PESOS = /\$\s?[\d.]+,\d{2}/g;
const ENCABEZADO = /^\s*Producto\s+Foto\s+Cantidad/i;

export const esPedidoTarget = (lineas: string[]) => lineas.some((l) => /Detalle de solicitud/i.test(l)) && lineas.some((l) => /Orden n[uú]mero/i.test(l));

/**
 * Lee el PDF de la nota de pedido de Target, ya pasado a renglones de texto (pdf.js por altura, o pdftotext).
 * Cada artículo: «16043 - Mochila Camping» (el nombre puede seguir en el renglón de abajo), la cantidad, el
 * precio unitario y el total, y al final «SKU: 16043B». El código es el número de antes del guion.
 */
export function leerPedidoTarget(lineas: string[], nombre: string, fechaPorDefecto: string): { pedido: Omit<Pedido, 'id'>; nroProveedor: string; fechaArchivo: string; avisos: string[] } {
  const avisos: string[] = [];
  let nro = '', fecha = '', totalImpreso = NaN;
  const out: LineaPedido[] = [];
  let actual: { codigo: string; desc: string[]; cantidad: number; precio: number; importe: number } | null = null;
  const cerrar = () => {
    if (!actual) return;
    const a = actual;
    actual = null;
    const descripcion = a.desc.join(' ').replace(/\s+/g, ' ').trim();
    if (!(a.cantidad > 0) || !(a.precio > 0)) { avisos.push(`${a.codigo} ${descripcion}: no encontré la cantidad o el precio.`); return; }
    if (a.importe && Math.abs(c(a.cantidad * a.precio) - c(a.importe)) > 2) avisos.push(`${a.codigo}: ${a.cantidad} × ${fmt(a.precio)} no da ${fmt(a.importe)}.`);
    const ya = out.find((l) => l.codigo === a.codigo);
    if (ya) {
      if (Math.abs(ya.precioLista - a.precio) > 0.005) avisos.push(`${a.codigo} está dos veces con precios distintos (${fmt(ya.precioLista)} y ${fmt(a.precio)}): se toma el primero.`);
      ya.cantidad += a.cantidad;
      return;
    }
    out.push({ sku: a.codigo, codigo: a.codigo, descripcion, talle: '', unidadesPorUdm: 1, precioLista: a.precio, descuento: 0, cantidad: a.cantidad });
  };
  for (const crudo of lineas) {
    const l = String(crudo ?? '').replace(/\s+/g, ' ').trim();
    if (!l) continue;
    const o = /Orden n[uú]mero:?\s*(\d+)/i.exec(l);
    if (o) { nro = o[1]; continue; }
    if (/Fecha de pedido/i.test(l)) { fecha = fechaIso(l) || fecha; continue; }
    const t = /^Total:?\s*(\$\s?[\d.]+,\d{2})/i.exec(l);
    if (t) { cerrar(); totalImpreso = num(t[1]); continue; }
    if (ENCABEZADO.test(l)) continue;
    if (/^SKU:/i.test(l)) { cerrar(); continue; }
    const ini = /^(\d{3,8})\s*-\s*(.*)$/.exec(l);
    let resto = l;
    if (ini) { cerrar(); actual = { codigo: ini[1], desc: [], cantidad: 0, precio: 0, importe: 0 }; resto = ini[2]; }
    if (!actual) continue;
    const pesos = resto.match(RE_PESOS) ?? [];
    let texto = resto;
    const p0 = pesos[0];
    if (p0) {
      // La cantidad es el número suelto justo antes del primer importe.
      const antes = resto.slice(0, resto.indexOf(p0)).trim();
      const m = /(?:^|\s)(\d{1,6})$/.exec(antes);
      if (m && !actual.cantidad) actual.cantidad = Number(m[1]);
      if (!actual.precio) actual.precio = num(p0);
      if (pesos[1] && !actual.importe) actual.importe = num(pesos[1]);
      texto = m ? antes.slice(0, antes.length - m[0].length) : antes;
    }
    if (texto.trim()) actual.desc.push(texto.trim());
  }
  cerrar();
  if (!out.length) throw new Error('No encontré artículos en el PDF. ¿Es la nota de pedido («Detalle de solicitud») de Target?');
  const suma = out.reduce((s, x) => s + x.cantidad * x.precioLista, 0);
  if (Number.isFinite(totalImpreso) && Math.abs(c(suma) - c(totalImpreso)) > 100) avisos.push(`Los artículos leídos suman ${fmt(suma)} y el total de la nota es ${fmt(totalImpreso)}: puede faltar un artículo.`);
  if (!nro) avisos.push('No encontré el número de orden.');
  return {
    pedido: { nombre: nro ? `Target N° ${nro}` : nombre, fecha: fecha || fechaPorDefecto, lineas: out },
    nroProveedor: nro, fechaArchivo: fecha, avisos,
  };
}

// ---------------------------------------------------------------------------
// ALTA DE PRODUCTOS
// ---------------------------------------------------------------------------
/** Marcas que trae Target (las que se vieron en las facturas). La que no está, va como «Target» con aviso. */
export const MARCAS_TARGET = ['Alpine Skate', 'F Addict', 'Discovery', 'Reebok', 'NBA', 'Head', 'Trendy'];

/** La marca del producto, por la descripción (palabra completa). null = no la conozco. */
export function marcaTarget(descripcion: string): string | null {
  const d = ` ${sinAcento(descripcion).toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  let mejor: { m: string; i: number } | null = null;
  for (const m of MARCAS_TARGET) {
    const i = d.indexOf(` ${sinAcento(m).toUpperCase()} `);
    if (i >= 0 && (!mejor || m.length > mejor.m.length)) mejor = { m, i };
  }
  return mejor?.m ?? null;
}

/** Tipo de producto (el de Shopify) y peso de envío, por la primera palabra. */
const TIPOS: { re: RegExp; tipo: string; gramos: number }[] = [
  { re: /^MOCHILA/, tipo: 'Mochila', gramos: 800 },
  { re: /^RINONERA/, tipo: 'Riñonera', gramos: 300 },
  { re: /^(MATERA|BOLSO MATER[OA])\b/, tipo: 'Bolso Matero', gramos: 500 },
  { re: /^BOLSO/, tipo: 'Bolso', gramos: 800 },
  { re: /^MORRAL/, tipo: 'Morral', gramos: 400 },
  { re: /^BILLETERA/, tipo: 'Billetera', gramos: 150 },
  { re: /^(GORRA|CAP)\b/, tipo: 'Gorra', gramos: 150 },
  { re: /^(GORRO|PILUSO|SOMBRERO)\b/, tipo: 'Piluso', gramos: 150 },
  { re: /^TERMO/, tipo: 'Termo', gramos: 600 },
  { re: /^BOTELLA/, tipo: 'Botella Térmica', gramos: 400 },
  { re: /^CARPA/, tipo: 'Carpa', gramos: 3000 },
  { re: /^BASTON/, tipo: 'Bastón de Trekking', gramos: 500 },
  { re: /^TOALLA/, tipo: 'Toalla', gramos: 200 },
];
export function tipoTarget(descripcion: string): { tipo: string; gramos: number } | null {
  const d = sinAcento(descripcion).toUpperCase().trim();
  const t = TIPOS.find((x) => x.re.test(d));
  return t ? { tipo: t.tipo, gramos: t.gramos } : null;
}

/** Título de la tienda: la descripción de la factura con los acentos que faltan. */
export function tituloTarget(descripcion: string): string {
  return String(descripcion ?? '').replace(/\s+/g, ' ').trim()
    .replace(/\bBaston\b/gi, 'Bastón').replace(/\bTrecking\b/gi, 'Trekking').replace(/\bTermica\b/gi, 'Térmica')
    .replace(/\bRinonera\b/gi, 'Riñonera')
    // gax (19-nov): «Cap» va como «Gorra» y «Gorro» como «Piluso». Primero el gorro, así la gorra nueva no cambia.
    .replace(/\bGorros\b/gi, 'Pilusos').replace(/\bGorro\b/gi, 'Piluso')
    .replace(/\bCaps\b/gi, 'Gorras').replace(/\bCap\b/gi, 'Gorra')
    // gax (19-nov): la «Matera» va como «Bolso Matero», como los que ya tiene en la tienda.
    .replace(/\b(?:Bolsos?\s+)?Materas\b/gi, 'Bolsos Materos').replace(/\b(?:Bolso\s+)?Matera\b/gi, 'Bolso Matero');
}

/** Lista × 2, sin la bonificación (gax, 19-nov-2026: «siempre por 2 el markup»). */
export const listaX2 = (lista: number) => Math.round(lista * 2);
/** Costo: la lista menos la bonificación de esa factura, con centavos. */
export const costoTarget = (lista: number, bonificacion: number) => redondear2(lista * (1 - (bonificacion || 0) / 100));
/**
 * Precio más bajo que deja 50% de margen con ese costo (sin el IVA de la venta, como iD: precio ≥ costo × 2,42),
 * redondeado PARA ARRIBA a los $100. Cuenta en centavos para no perder el 50% por un decimal.
 */
export function precioMinimo50(costo: number): number {
  const c = Math.round(costo * 100);
  if (!(c > 0)) return 0;
  return Math.ceil((c * 242) / 1_000_000) * 100;
}
/**
 * Precio de venta de Target: la lista × 2, y si con el descuento de la factura eso no llega al 50% de margen,
 * se sube hasta llegar (gax, 19-nov-2026: «todos los que no lleguen al margen 50% vamos a hacerlos llegar»).
 * Facturas con 30% o 50% de descuento quedan en lista × 2; con 10% o sin descuento, se suben.
 */
export function precioTarget(lista: number, bonificacion = 0): number {
  return Math.max(listaX2(lista), precioMinimo50(costoTarget(lista, bonificacion)));
}
/**
 * Margen que deja la lista × 2 con el descuento de la factura (sin el IVA de la venta, mismo cálculo que iD).
 * 50% → 69,7% · 30% → 57,6% · 10% → 45,5% (ahí el precio se sube al 50%, ver `precioTarget`).
 */
export const margenTarget = (bonificacion: number): number | null => margenPct(200, 100 - (bonificacion || 0));
