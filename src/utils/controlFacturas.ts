// ============================================================================
// CONTROL DE FACTURAS CONTRA PEDIDOS (10-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Motor de cuentas, independiente del formato de los archivos. Los lectores de
// cada proveedor (Excel de pedidos, PDF de facturas, remitos) arman estos tipos.
//
// Reglas:
// - El código de artículo (modelo + color) se compara EXACTO. El mismo modelo en
//   otro color tiene otro código y el mismo precio: nunca son equivalentes.
// - Lo facturado se acumula entre TODAS las facturas, en orden de fecha, y se
//   descuenta de lo pedido por orden de pedido (el más viejo primero). Lo que
//   supera lo pedido es FACTURADO SIN PEDIR (alerta roja).
// - Si una factura toma unidades de un pedido posterior al suyo, es un ADELANTO;
//   si después se vuelven a facturar, se marca como posible DOBLE COBRO.
// - El precio se controla contra la lista del Excel DEL PEDIDO al que se asignó
//   cada unidad, nunca contra una lista más nueva.
// - Las facturas no traen talles: si un código del pedido quedó facturado
//   completo, los talles se deducen; si es parcial, «talle a confirmar».
// - Montos en centavos para comparar. SOLO LECTURA.
// ============================================================================

export const IVA = 0.21;
export const PERCEPCION_CABA = 0.05;
export const PERCEPCION_BSAS = 0.06;
/** Tolerancias de redondeo, en centavos. El proveedor calcula los packs con el
 *  precio por pack y lo imprime por par redondeado: unos centavos por renglón. */
const TOL_PRECIO = 1;
const tolRenglon = (cantidad: number) => 5 + Math.ceil(Math.abs(cantidad));
const TOL_TOTAL = 100;

export interface LineaPedido {
  sku: string;              // SKU completo (modelo + talle)
  codigo: string;           // código de artículo (Modelo color), sin talle
  descripcion: string;
  talle: string;
  unidadesPorUdm: number;   // 1, o 12 si la UDM es «Pack de 12 Unidades»
  precioLista: number;      // Mayorista, por UDM
  descuento: number;        // %, ej. 40
  cantidad: number;         // pedida, en UDM
}

export interface Pedido {
  id: string;
  nombre: string;
  fecha: string;            // AAAA-MM-DD, la del día que se mandó
  lineas: LineaPedido[];
}

export interface RenglonFactura {
  codigo: string;
  descripcion: string;
  precioUnitario: number;
  bonificacion: number;     // %
  cantidad: number;         // en la misma UDM que el pedido
  total: number;            // impreso
}

export interface Factura {
  id: string;
  numero: string;
  fecha: string;            // AAAA-MM-DD
  remito?: string;
  pedidoProveedor?: string;
  condicionVenta?: string;
  vencimiento?: string;
  renglones: RenglonFactura[];
  subtotal: number;
  iva: number;
  percepcionCaba: number;
  percepcionBsAs: number;
  total: number;
}

export interface Asignacion {
  pedidoId: string;
  cantidad: number;
  adelanto: boolean;        // pedido posterior al principal de la factura
}

export interface ControlRenglon {
  codigo: string;
  descripcion: string;
  cantidad: number;
  asignaciones: Asignacion[];
  sinPedir: number;                 // unidades facturadas que superan lo pedido
  posibleDobleCobro: boolean;       // el código ya tuvo un adelanto antes
  netoSinPedir: number;             // $ neto de lo facturado sin pedir
  conImpuestosSinPedir: number;     // con IVA y percepciones
  difPrecio: DiferenciaPrecio[];
  totalCalculado: number;
  totalImpreso: number;
  totalOk: boolean;
}

export interface DiferenciaPrecio {
  pedidoId: string;
  cantidad: number;
  precioPedido: number;
  descuentoPedido: number;
  precioFactura: number;
  bonificacionFactura: number;
  diferencia: number;               // $ neto: (factura - pedido) × cantidad; + = cobran de más
}

export interface ControlAritmetico {
  subtotalCalculado: number;
  ivaCalculado: number;
  caba: number;
  bsas: number;
  totalCalculado: number;
  errores: string[];
}

export interface ResultadoFactura {
  factura: Factura;
  pedidoPrincipal: string | null;
  pedidosCubiertos: string[];
  renglones: ControlRenglon[];
  aritmetica: ControlAritmetico;
  totalSinPedirNeto: number;
  totalSinPedirConImpuestos: number;
  totalDifPrecio: number;
  estado: 'ok' | 'revisar';
  motivos: string[];
  checklist: FilaChecklist[];
}

export interface PendienteTalle {
  pedidoId: string;
  codigo: string;
  descripcion: string;
  talle: string;
  pedido: number;
  /** null = el código está facturado en parte: el talle lo confirma el depósito. */
  facturado: number | null;
  pendiente: number | null;
}

export interface FilaChecklist {
  codigo: string;
  descripcion: string;
  cantidad: number;
  talles: { talle: string; cantidad: number }[] | null; // null = a confirmar
  nota: string;
}

export interface ResultadoGeneral {
  facturas: ResultadoFactura[];
  pendientes: PendienteTalle[];
  estado: 'ok' | 'revisar';
}

export const normCodigo = (s: string) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
const c = (n: number) => Math.round((Number(n) || 0) * 100);
const p = (cent: number) => cent / 100;
const neto = (precio: number, bonif: number) => precio * (1 - (Number(bonif) || 0) / 100);

interface LineaCodigo {
  pedido: Pedido;
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioLista: number;
  descuento: number;
  porTalle: { talle: string; cantidad: number }[];
  facturado: number;
}

function ordenarPorFecha<T extends { fecha: string }>(xs: T[]): T[] {
  return xs.map((x, i) => ({ x, i }))
    .sort((a, b) => (a.x.fecha || '').localeCompare(b.x.fecha || '') || a.i - b.i)
    .map(({ x }) => x);
}

/** Agrupa las líneas de cada pedido por código (suma talles). Avisa precios distintos dentro de un código. */
function porCodigo(pedidos: Pedido[]): Map<string, LineaCodigo[]> {
  const mapa = new Map<string, LineaCodigo[]>();
  for (const pedido of ordenarPorFecha(pedidos)) {
    const propio = new Map<string, LineaCodigo>();
    for (const l of pedido.lineas) {
      if (!(l.cantidad > 0)) continue;
      const cod = normCodigo(l.codigo);
      let g = propio.get(cod);
      if (!g) {
        g = { pedido, codigo: cod, descripcion: l.descripcion, cantidad: 0, precioLista: l.precioLista, descuento: l.descuento, porTalle: [], facturado: 0 };
        propio.set(cod, g);
      }
      g.cantidad += l.cantidad;
      g.porTalle.push({ talle: l.talle, cantidad: l.cantidad });
    }
    for (const [cod, g] of propio) {
      if (!mapa.has(cod)) mapa.set(cod, []);
      mapa.get(cod)!.push(g);
    }
  }
  return mapa;
}

export function controlAritmetico(f: Factura): ControlAritmetico {
  const errores: string[] = [];
  const sub = f.renglones.reduce((s, r) => s + c(r.total), 0);
  const subtotal = c(f.subtotal);
  if (Math.abs(sub - subtotal) > TOL_TOTAL) errores.push(`Subtotal: la suma de los renglones da ${fmt(p(sub))} y figura ${fmt(f.subtotal)}.`);
  const iva = Math.round(subtotal * IVA);
  const caba = Math.round(subtotal * PERCEPCION_CABA);
  const bsas = Math.round(subtotal * PERCEPCION_BSAS);
  if (Math.abs(iva - c(f.iva)) > TOL_TOTAL) errores.push(`IVA 21%: corresponde ${fmt(p(iva))}, impreso ${fmt(f.iva)}.`);
  if (f.percepcionCaba && Math.abs(caba - c(f.percepcionCaba)) > TOL_TOTAL) errores.push(`Percepción IIBB CABA 5%: corresponde ${fmt(p(caba))}, impreso ${fmt(f.percepcionCaba)}.`);
  if (f.percepcionBsAs && Math.abs(bsas - c(f.percepcionBsAs)) > TOL_TOTAL) errores.push(`Percepción IIBB Bs.As. 6%: corresponde ${fmt(p(bsas))}, impreso ${fmt(f.percepcionBsAs)}.`);
  const total = subtotal + c(f.iva) + c(f.percepcionCaba) + c(f.percepcionBsAs);
  if (Math.abs(total - c(f.total)) > TOL_TOTAL) errores.push(`Total: subtotal + impuestos da ${fmt(p(total))}, impreso ${fmt(f.total)}.`);
  return { subtotalCalculado: p(sub), ivaCalculado: p(iva), caba: p(caba), bsas: p(bsas), totalCalculado: p(total), errores };
}

/** Cuánto suman IVA y percepciones sobre el neto, según lo que cobra esa factura. */
function factorImpuestos(f: Factura): number {
  return 1 + IVA + (f.percepcionCaba ? PERCEPCION_CABA : 0) + (f.percepcionBsAs ? PERCEPCION_BSAS : 0);
}

/**
 * Analiza todas las facturas en orden de fecha contra todos los pedidos.
 * `asignacionManual` (factura id → pedidos) fija a qué pedidos se imputa primero.
 */
export function analizarFacturas(
  pedidos: Pedido[],
  facturas: Factura[],
  asignacionManual: Record<string, string[]> = {},
): ResultadoGeneral {
  const mapa = porCodigo(pedidos);
  const fechaPedido = new Map(pedidos.map((x) => [x.id, x.fecha]));
  const adelantados = new Set<string>(); // códigos con unidades adelantadas
  const resultados: ResultadoFactura[] = [];

  for (const f of ordenarPorFecha(facturas)) {
    // 1. Pedido principal: el más viejo con pendiente en los códigos de la factura,
    //    o el que eligió la usuaria.
    const manual = asignacionManual[f.id] ?? [];
    const candidatos = new Map<string, number>();
    for (const r of f.renglones) {
      for (const g of mapa.get(normCodigo(r.codigo)) ?? []) {
        const libre = g.cantidad - g.facturado;
        if (libre > 0) candidatos.set(g.pedido.id, (candidatos.get(g.pedido.id) ?? 0) + Math.min(libre, r.cantidad));
      }
    }
    const principal = manual[0]
      ?? [...candidatos.entries()].sort((a, b) => b[1] - a[1] || (fechaPedido.get(a[0]) ?? '').localeCompare(fechaPedido.get(b[0]) ?? ''))[0]?.[0]
      ?? null;
    const fechaPrincipal = principal ? fechaPedido.get(principal) ?? '' : '';
    const factor = factorImpuestos(f);

    const renglones: ControlRenglon[] = f.renglones.map((r) => {
      const cod = normCodigo(r.codigo);
      const grupos = [...(mapa.get(cod) ?? [])].sort((a, b) => {
        const pa = manual.includes(a.pedido.id) ? 0 : 1;
        const pb = manual.includes(b.pedido.id) ? 0 : 1;
        return pa - pb || a.pedido.fecha.localeCompare(b.pedido.fecha);
      });
      let resto = r.cantidad;
      const asignaciones: Asignacion[] = [];
      const difPrecio: DiferenciaPrecio[] = [];
      const yaAdelantado = adelantados.has(cod);
      for (const g of grupos) {
        if (resto <= 0) break;
        const libre = g.cantidad - g.facturado;
        if (libre <= 0) continue;
        const toma = Math.min(libre, resto);
        g.facturado += toma;
        resto -= toma;
        const adelanto = !!principal && g.pedido.id !== principal && !manual.includes(g.pedido.id) && g.pedido.fecha > fechaPrincipal;
        if (adelanto) adelantados.add(cod);
        asignaciones.push({ pedidoId: g.pedido.id, cantidad: toma, adelanto });
        const dif = c(neto(r.precioUnitario, r.bonificacion) * toma) - c(neto(g.precioLista, g.descuento) * toma);
        if (Math.abs(c(r.precioUnitario) - c(g.precioLista)) > TOL_PRECIO || Math.abs((r.bonificacion || 0) - (g.descuento || 0)) > 0.001) {
          difPrecio.push({ pedidoId: g.pedido.id, cantidad: toma, precioPedido: g.precioLista, descuentoPedido: g.descuento, precioFactura: r.precioUnitario, bonificacionFactura: r.bonificacion, diferencia: p(dif) });
        }
      }
      const sinPedir = resto;
      const netoSinPedir = c(neto(r.precioUnitario, r.bonificacion) * sinPedir);
      const totalCalc = c(neto(r.precioUnitario, r.bonificacion) * r.cantidad);
      return {
        codigo: cod,
        descripcion: r.descripcion,
        cantidad: r.cantidad,
        asignaciones,
        sinPedir,
        posibleDobleCobro: sinPedir > 0 && yaAdelantado,
        netoSinPedir: p(netoSinPedir),
        conImpuestosSinPedir: p(Math.round(netoSinPedir * factor)),
        difPrecio,
        totalCalculado: p(totalCalc),
        totalImpreso: r.total,
        totalOk: Math.abs(totalCalc - c(r.total)) <= tolRenglon(r.cantidad),
      };
    });

    const aritmetica = controlAritmetico(f);
    const totalSinPedirNeto = p(renglones.reduce((s, r) => s + c(r.netoSinPedir), 0));
    const totalSinPedirConImpuestos = p(renglones.reduce((s, r) => s + c(r.conImpuestosSinPedir), 0));
    const totalDifPrecio = p(renglones.reduce((s, r) => s + r.difPrecio.reduce((t, d) => t + c(d.diferencia), 0), 0));
    const motivos: string[] = [];
    const sinPedir = renglones.filter((r) => r.sinPedir > 0);
    if (sinPedir.length) motivos.push(`Facturado sin pedir: ${sinPedir.length} artículo(s), ${fmt(totalSinPedirConImpuestos)} con impuestos.`);
    if (renglones.some((r) => r.posibleDobleCobro)) motivos.push('Posible doble cobro de unidades ya adelantadas en otra factura.');
    const conDif = renglones.filter((r) => r.difPrecio.length);
    if (conDif.length) motivos.push(`Precio o bonificación distinta al pedido en ${conDif.length} artículo(s): diferencia ${fmt(totalDifPrecio)} neto.`);
    const malSumados = renglones.filter((r) => !r.totalOk);
    if (malSumados.length) motivos.push(`${malSumados.length} renglón(es) mal calculados.`);
    motivos.push(...aritmetica.errores);
    if (renglones.some((r) => r.asignaciones.some((a) => a.adelanto))) motivos.push('Adelanta unidades de un pedido posterior (queda registrado para controlar doble cobro).');
    const pedidosCubiertos = [...new Set(renglones.flatMap((r) => r.asignaciones.map((a) => a.pedidoId)))];
    resultados.push({
      factura: f,
      pedidoPrincipal: principal,
      pedidosCubiertos,
      renglones,
      aritmetica,
      totalSinPedirNeto,
      totalSinPedirConImpuestos,
      totalDifPrecio,
      estado: motivos.filter((m) => !m.startsWith('Adelanta')).length ? 'revisar' : 'ok',
      motivos,
      checklist: [],
    });
  }

  // Pendientes por pedido y talle, con el estado final de todas las facturas.
  const pendientes: PendienteTalle[] = [];
  const completo = new Map<string, boolean>(); // pedido|codigo → facturado completo
  for (const grupos of mapa.values()) {
    for (const g of grupos) {
      const lleno = g.facturado >= g.cantidad;
      completo.set(`${g.pedido.id}|${g.codigo}`, lleno);
      for (const t of g.porTalle) {
        const facturado = g.facturado === 0 ? 0 : lleno ? t.cantidad : null;
        pendientes.push({
          pedidoId: g.pedido.id, codigo: g.codigo, descripcion: g.descripcion, talle: t.talle, pedido: t.cantidad,
          facturado, pendiente: facturado === null ? null : t.cantidad - facturado,
        });
      }
    }
  }

  // Checklist de depósito: talles esperados solo si la factura completa el código del pedido.
  const tallesDe = (pedidoId: string, codigo: string) =>
    (mapa.get(codigo) ?? []).find((g) => g.pedido.id === pedidoId)?.porTalle ?? [];
  for (const res of resultados) {
    res.checklist = res.renglones.map((r) => {
      const partes = r.asignaciones.map((a) => {
        const g = (mapa.get(r.codigo) ?? []).find((x) => x.pedido.id === a.pedidoId);
        return g && a.cantidad === g.cantidad ? tallesDe(a.pedidoId, r.codigo) : null;
      });
      const deducibles = r.sinPedir === 0 && partes.length > 0 && partes.every((x) => x !== null);
      return {
        codigo: r.codigo,
        descripcion: r.descripcion,
        cantidad: r.cantidad,
        talles: deducibles ? sumarTalles(partes.flat() as { talle: string; cantidad: number }[]) : null,
        nota: r.sinPedir > 0 ? `${r.sinPedir} sin pedir: controlar que no sea otro color` : deducibles ? '' : 'Talle a confirmar por depósito',
      };
    });
  }

  return { facturas: resultados, pendientes, estado: resultados.some((r) => r.estado === 'revisar') ? 'revisar' : 'ok' };
}

function sumarTalles(xs: { talle: string; cantidad: number }[]) {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x.talle, (m.get(x.talle) ?? 0) + x.cantidad);
  return [...m.entries()].map(([talle, cantidad]) => ({ talle, cantidad }));
}

/** $ 1.234.567,89 */
export function fmt(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const s = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}$ ${s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${s[1]}`;
}

/** Mensaje corto para el grupo de pagos. */
export function mensajePagos(r: ResultadoFactura): string {
  const f = r.factura;
  const ped = r.pedidosCubiertos.length ? r.pedidosCubiertos.join(' + ') : 'sin pedido asociado';
  const estado = r.estado === 'ok' ? '✅ OK para pagar' : '⚠️ REVISAR antes de pagar';
  return [
    `Factura ${f.numero} (${fechaAr(f.fecha)})`,
    `Pedido: ${ped}`,
    `Total: ${fmt(f.total)}`,
    `Vencimiento: ${f.vencimiento ? fechaAr(f.vencimiento) : f.condicionVenta || 'sin dato'}`,
    `Estado: ${estado}`,
  ].join('\n');
}

/** Reporte de reclamo al proveedor, solo si hay diferencias. */
export function reporteReclamo(r: ResultadoFactura): string | null {
  const f = r.factura;
  const lineas: string[] = [];
  for (const x of r.renglones) {
    if (x.sinPedir > 0) lineas.push(`- ${x.codigo} ${x.descripcion}: facturaron ${x.cantidad}, sin pedido ${x.sinPedir} unidades (${fmt(x.netoSinPedir)} neto + impuestos = ${fmt(x.conImpuestosSinPedir)}).${x.posibleDobleCobro ? ' Ya habían sido facturadas como adelanto.' : ''}`);
    for (const d of x.difPrecio) {
      lineas.push(`- ${x.codigo} ${x.descripcion}: precio ${fmt(d.precioFactura)} con ${d.bonificacionFactura}% de bonificación; en el pedido ${d.pedidoId} era ${fmt(d.precioPedido)} con ${d.descuentoPedido}%. Diferencia ${fmt(d.diferencia)} neto en ${d.cantidad} unidades.`);
    }
    if (!x.totalOk) lineas.push(`- ${x.codigo}: el renglón da ${fmt(x.totalCalculado)} y figura ${fmt(x.totalImpreso)}.`);
  }
  for (const e of r.aritmetica.errores) lineas.push(`- ${e}`);
  if (!lineas.length) return null;
  return [`Reclamo factura ${f.numero} del ${fechaAr(f.fecha)}${f.remito ? `, remito ${f.remito}` : ''}:`, ...lineas].join('\n');
}

function fechaAr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '';
}
