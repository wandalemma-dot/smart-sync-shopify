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
const TOL_TOTAL = 50; // $0,50 por redondeo (especificación de gax, 10-nov-2026)

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
  /** El código no figura en NINGÚN pedido cargado: ¿falta cargar un pedido? */
  noEstaEnPedidos: boolean;
  /** Facturas anteriores que ya cubrieron este código (detalle del doble cobro). */
  facturasPrevias: { factura: string; cantidad: number; adelanto: boolean }[];
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
  /** ✅ ok para pagar · ⚠️ con observaciones · ❌ reclamar. */
  semaforo: Semaforo;
  motivos: string[];
  checklist: FilaChecklist[];
  /** Pares/unidades facturados y si los pedidos que toca quedaron completos. */
  unidades: number;
  pedidosCompletos: boolean;
}

export type Semaforo = 'ok' | 'observaciones' | 'reclamar';

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
  const historial = new Map<string, { factura: string; cantidad: number; adelanto: boolean }[]>();
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
      const facturasPrevias = [...(historial.get(cod) ?? [])];
      if (!historial.has(cod)) historial.set(cod, []);
      historial.get(cod)!.push({ factura: f.numero || f.id, cantidad: r.cantidad, adelanto: asignaciones.some((a) => a.adelanto) });
      const netoSinPedir = c(neto(r.precioUnitario, r.bonificacion) * sinPedir);
      const totalCalc = c(neto(r.precioUnitario, r.bonificacion) * r.cantidad);
      return {
        codigo: cod,
        descripcion: r.descripcion,
        cantidad: r.cantidad,
        asignaciones,
        sinPedir,
        posibleDobleCobro: sinPedir > 0 && yaAdelantado,
        noEstaEnPedidos: grupos.length === 0,
        facturasPrevias,
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
    let criticas = 0, medias = 0;
    const sinPedir = renglones.filter((r) => r.sinPedir > 0);
    if (sinPedir.length) {
      criticas++;
      motivos.push(`NO PEDIDO: ${sinPedir.length} artículo(s), ${sinPedir.reduce((s, r) => s + r.sinPedir, 0)} unidades, ${fmt(totalSinPedirConImpuestos)} con impuestos.`);
      const noCargados = sinPedir.filter((r) => r.noEstaEnPedidos);
      if (noCargados.length) motivos.push(`${noCargados.map((r) => r.codigo).join(', ')} no figura en ningún pedido cargado: ¿falta cargar un pedido?`);
    }
    const dobles = renglones.filter((r) => r.posibleDobleCobro);
    if (dobles.length) {
      criticas++;
      for (const r of dobles) {
        const previas = r.facturasPrevias.filter((x) => x.adelanto).map((x) => `${x.factura} (${x.cantidad})`).join(', ');
        motivos.push(`DOBLE COBRO: ${r.codigo} ya había sido facturado como adelanto en ${previas || 'una factura anterior'}.`);
      }
    }
    const conDif = renglones.filter((r) => r.difPrecio.length);
    if (conDif.length) {
      criticas++;
      motivos.push(`PRECIO: precio o bonificación distinta al pedido en ${conDif.length} artículo(s): diferencia ${fmt(totalDifPrecio)} neto, ${fmt(totalDifPrecio * factor)} con impuestos.`);
    }
    const malSumados = renglones.filter((r) => !r.totalOk);
    if (malSumados.length) { medias++; motivos.push(`CUENTAS: ${malSumados.length} renglón(es) mal calculados.`); }
    if (aritmetica.errores.length) { medias++; motivos.push(...aritmetica.errores.map((e) => `CUENTAS: ${e}`)); }
    if (renglones.some((r) => r.asignaciones.some((a) => a.adelanto))) {
      medias++;
      motivos.push('ADELANTO: toma unidades de un pedido posterior; no deben volver a facturarse.');
    }
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
      estado: criticas || medias ? 'revisar' : 'ok',
      semaforo: criticas ? 'reclamar' : medias ? 'observaciones' : 'ok',
      motivos,
      checklist: [],
      unidades: renglones.reduce((s, r) => s + r.cantidad, 0),
      pedidosCompletos: pedidosCubiertos.length > 0 && pedidosCubiertos.every((id) =>
        [...mapa.values()].every((gs) => gs.every((g) => g.pedido.id !== id || g.facturado >= g.cantidad))),
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

/** Mensaje corto para el grupo de pagos: «Factura X ✅ OK: pedido Y, N pares, total $Z, vence DD/MM, completa». */
export function mensajePagos(r: ResultadoFactura, condicionesPago = '', nombrePedido: (id: string) => string = (id) => id): string {
  const f = r.factura;
  const ped = r.pedidosCubiertos.length ? `pedido ${r.pedidosCubiertos.map(nombrePedido).join(' + ')}` : 'sin pedido asociado';
  const icono = r.semaforo === 'ok' ? '✅ OK' : r.semaforo === 'observaciones' ? '⚠️ CON OBSERVACIONES' : '❌ RECLAMAR, NO PAGAR';
  const vence = f.vencimiento ? `vence ${fechaAr(f.vencimiento).slice(0, 5)}` : f.condicionVenta ? f.condicionVenta : 'sin vencimiento';
  const partes = [ped, `${r.unidades} pares`, `total ${fmt(f.total)}`, vence, r.pedidosCompletos ? 'completa' : 'parcial'];
  const lineas = [`Factura ${f.numero} ${icono}: ${partes.join(', ')}.`];
  if (r.semaforo !== 'ok') lineas.push(...r.motivos.map((m) => `- ${m}`));
  if (condicionesPago.trim()) lineas.push(`Recordar: ${condicionesPago.trim()}.`);
  return lineas.join('\n');
}

export interface ResumenPedido {
  pedidoId: string;
  pedido: number;
  facturado: number;
  pendiente: number;
  estado: 'sin facturar' | 'parcial' | 'completo';
}

/** Estado de cada pedido con todas las facturas cargadas. */
export function resumenPedidos(pedidos: Pedido[], res: ResultadoGeneral): ResumenPedido[] {
  const fact = new Map<string, number>();
  for (const f of res.facturas) for (const r of f.renglones) for (const a of r.asignaciones) fact.set(a.pedidoId, (fact.get(a.pedidoId) ?? 0) + a.cantidad);
  return pedidos.map((p) => {
    const pedido = p.lineas.reduce((s, l) => s + (l.cantidad > 0 ? l.cantidad : 0), 0);
    const facturado = fact.get(p.id) ?? 0;
    return {
      pedidoId: p.id, pedido, facturado, pendiente: Math.max(0, pedido - facturado),
      estado: facturado <= 0 ? 'sin facturar' : facturado >= pedido ? 'completo' : 'parcial',
    };
  });
}

export interface Recepcion {
  /** clave codigo|talle (talle '' si se cuenta el modelo completo) → recibido */
  recibido: Record<string, number>;
  /** Códigos recibidos que no están en la factura (otro color, cambios). */
  extras: { codigo: string; talle: string; cantidad: number }[];
}

export interface DiferenciaRecepcion {
  codigo: string;
  talle: string;
  esperado: number | null;   // null = talle a confirmar (solo se conoce el total del modelo)
  recibido: number;
  diferencia: number | null; // recibido − esperado
}

export const claveRecepcion = (codigo: string, talle: string) => `${normCodigo(codigo)}|${talle}`;

/** Compara lo que contó el depósito contra el checklist de la factura. */
export function compararRecepcion(checklist: FilaChecklist[], rec: Recepcion): { filas: DiferenciaRecepcion[]; ok: boolean } {
  const filas: DiferenciaRecepcion[] = [];
  for (const c of checklist) {
    if (c.talles) {
      for (const t of c.talles) {
        const recibido = rec.recibido[claveRecepcion(c.codigo, t.talle)] ?? 0;
        filas.push({ codigo: c.codigo, talle: t.talle, esperado: t.cantidad, recibido, diferencia: recibido - t.cantidad });
      }
    } else {
      // Talles a confirmar: se cuentan por talle y se compara el total del modelo.
      const pref = `${normCodigo(c.codigo)}|`;
      const porTalle = Object.entries(rec.recibido).filter(([k]) => k.startsWith(pref));
      const total = porTalle.reduce((s, [, v]) => s + (Number(v) || 0), 0);
      for (const [k, v] of porTalle) filas.push({ codigo: c.codigo, talle: k.slice(pref.length) || '(sin talle)', esperado: null, recibido: Number(v) || 0, diferencia: null });
      filas.push({ codigo: c.codigo, talle: 'TOTAL', esperado: c.cantidad, recibido: total, diferencia: total - c.cantidad });
    }
  }
  for (const e of rec.extras) filas.push({ codigo: normCodigo(e.codigo), talle: e.talle, esperado: 0, recibido: e.cantidad, diferencia: e.cantidad });
  return { filas, ok: filas.every((f) => f.diferencia === null || f.diferencia === 0) };
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
