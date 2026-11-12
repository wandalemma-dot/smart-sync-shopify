// ============================================================================
// CONTROL DE FACTURAS CONTRA PEDIDOS (10-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Motor de cuentas, independiente del formato de los archivos. Los lectores de
// cada proveedor (Excel de pedidos, PDF de facturas, remitos) arman estos tipos.
//
// Reglas:
// - El código de artículo (modelo + color) se compara EXACTO. El mismo modelo en
//   otro color tiene otro código y el mismo precio: nunca son equivalentes.
// - Lo facturado se acumula entre TODAS las facturas, en orden de fecha. Cada
//   factura se descuenta de las notas que mejor la explican (elegirNotas: la que
//   más artículos de la factura tiene y, si falta algo, las siguientes), nunca
//   de la más vieja por ser vieja. Lo que supera lo pedido en todas las notas es
//   FACTURADO SIN PEDIR (alerta roja).
// - Si una factura toma unidades de un pedido posterior al suyo, es un ADELANTO;
//   si después se vuelven a facturar, se marca como posible DOBLE COBRO.
// - El precio se controla contra la lista del Excel DEL PEDIDO al que se asignó
//   cada unidad, nunca contra una lista más nueva.
// - Las facturas no traen talles: si un código del pedido quedó facturado
//   completo, los talles se deducen; si es parcial, «talle a confirmar».
// - Montos en centavos para comparar. SOLO LECTURA.
//
// 11-nov-2026, método de gax («cómo se controla una factura contra la nota de
// pedido») y carga obligatoria de las TRES partes: factura, remito y nota de
// pedido. Sin remito, o sin ninguna nota que cubra la factura, queda
// «incompleta» (no se paga todavía). Renglones de otra nota y faltantes son
// observaciones; facturado sin pedir y precio mayor al del pedido, reclamo.
// El remito se compara con la factura (cantidades por código) y sus talles con
// los del pedido.
// ============================================================================

export const IVA = 0.21;
export const PERCEPCION_CABA = 0.05;
export const PERCEPCION_BSAS = 0.06;
/** Tolerancias de redondeo, en centavos. El proveedor calcula los packs con el
 *  precio por pack y lo imprime por par redondeado: unos centavos por renglón. */
const TOL_PRECIO = 2; // $0,02 por unidad (método de gax, 11-nov-2026)
const tolRenglon = (cantidad: number) => 5 + Math.ceil(Math.abs(cantidad));
const TOL_TOTAL = 50; // $0,50 por redondeo en subtotal, IVA y percepciones
const TOL_TOTAL_FINAL = 100; // $1 en el total de la factura

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
  nroProveedor?: string;    // N° de nota de pedido del proveedor, si lo trae
  /**
   * La tarjeta de Trello de la nota salió de las listas de pedidos pendientes (11-nov-2026):
   * desde esta fecha la nota no se elige sola para una factura (sí si se tilda a mano).
   * NUNCA_PENDIENTE = nunca estuvo en esas listas. Sin el campo, la nota está pendiente.
   */
  cerradaDesde?: string;
}
/** cerradaDesde de una nota cuya tarjeta nunca estuvo en las listas de pedidos pendientes. */
export const NUNCA_PENDIENTE = '0000-00-00';
/** La nota se puede elegir sola para una factura de esta fecha. */
export const notaDisponible = (p: Pedido, fechaFactura: string) =>
  !p.cerradaDesde || (p.cerradaDesde !== NUNCA_PENDIENTE && (!fechaFactura || fechaFactura <= p.cerradaDesde));

export interface TalleCantidad { talle: string; cantidad: number }
export interface RenglonRemito {
  codigo: string;
  cantidad: number;           // total del código (suma de talles, o el total si no hay talles)
  talles: TalleCantidad[];
}
/** Lo que llegó según el remito de la entrega (foto leída o escrito a mano). */
export interface Remito {
  numero: string;
  fecha: string;
  renglones: RenglonRemito[];
  origen?: 'foto' | 'manual';
  dudas?: string[];           // lo que no se leyó bien de la foto
  actualizado?: string;
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
  /** Cuánto se pidió de este código en los pedidos de donde sale (null = en ningún pedido). */
  pedidoCantidad: number | null;
  /** De lo pedido, cuánto ya habían facturado facturas anteriores. */
  yaFacturadoAntes: number;
  precioPedido: number | null;
  bonifPedido: number | null;
  /** Lo que sigue pendiente de este código en esos pedidos después de esta factura. */
  faltante: number;
  /** Pedidos anteriores al principal de donde sale este renglón («pedido en otra nota»). */
  otraNota: string[];
  /** Unidades de este código en el remito (null = sin remito cargado). */
  remito: number | null;
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
  /** Las tres partes de la entrega: falta el remito / ninguna nota de pedido cubre la factura. */
  faltaRemito: boolean;
  faltaNota: boolean;
  /** Códigos facturados que no están en ninguna nota cargada (¿falta subir una nota?). */
  codigosSinNota: string[];
  remito: Remito | null;
  /** Códigos donde el remito y la factura no dicen la misma cantidad. */
  difRemito: { codigo: string; factura: number; remito: number }[];
  /** Talles del remito que no estaban pedidos (o llegaron más de los pedidos). */
  tallesNoPedidos: { codigo: string; talle: string; llegaron: number; pedidos: number }[];
  /** Lo que queda pendiente de los pedidos de esta factura (iD factura calzado y ropa por separado). */
  pendientePedidos: { pedidoId: string; codigo: string; descripcion: string; pendiente: number }[];
  /** Lo que se reclama (precio de más + sin pedir): la nota de crédito se pide por el neto. */
  reclamo: Impuestos;
}

export interface Impuestos { neto: number; iva: number; percepciones: number; total: number }

/** ✅ ok · ⚠️ observaciones · ❌ reclamar · ⏳ incompleta (falta el remito o la nota de pedido). */
export type Semaforo = 'ok' | 'observaciones' | 'reclamar' | 'incompleta';

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
/** Clave para comparar códigos entre documentos: la O y el 0 cuentan igual. */
export const claveCodigo = (s: string) => normCodigo(s).replace(/O/g, '0');

/**
 * Huella de una nota de pedido: las mismas líneas y cantidades dan la misma huella aunque
 * vengan en otro archivo o en otra tarjeta. Se guarda al borrar una nota de Trello, para que
 * una copia de esa misma nota no vuelva a cargarse sola.
 */
export function huellaPedido(lineas: { sku: string; cantidad: number }[]): string {
  const s = lineas.map((l) => `${l.sku}:${l.cantidad}`).sort().join('|');
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
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

/**
 * Notas de pedido de una factura, en el orden en que se descuenta de ellas.
 * 11-nov-2026, gax («trajo todas, tiene que matchear exactas las que sí son»): antes se
 * descontaba de la nota más vieja con saldo, y las tarjetas viejas de Trello que nunca se
 * marcaron como recibidas se quedaban con la factura (0011-00139953 quedó repartida en 11 notas).
 * Ahora, como en el método de gax («¿existe el código en el pedido? NO → buscarlo en los otros»):
 * primero las notas que eligió la usuaria; después, de a una, la que mejor explica lo que falta:
 *   1. notas de hasta la fecha de la factura antes que las posteriores (una nota de después
 *      solo si ninguna anterior tiene saldo: así una nota nueva no se queda con una factura vieja);
 *   2. la que cubre COMPLETOS más artículos de lo que falta (un resto de 1 unidad no cuenta como el artículo);
 *   3. la que cubre más unidades; 4. la que cubre más artículos aunque sea en parte;
 *   5. la que tiene más artículos de la factura con saldo; 6. la que tiene más artículos al mismo precio de la factura;
 *   7. la más vieja (el proveedor entrega primero lo más viejo).
 * Se sigue hasta cubrir todo o hasta que ninguna nota tenga saldo de lo que falta. Las demás notas no se tocan.
 */
function elegirNotas(f: Factura, mapa: Map<string, LineaCodigo[]>, manual: string[], fechaPedido: Map<string, string>): string[] {
  const falta = new Map<string, number>();
  const precio = new Map<string, RenglonFactura>();
  for (const r of f.renglones) {
    const k = normCodigo(r.codigo);
    falta.set(k, (falta.get(k) ?? 0) + Math.max(0, r.cantidad));
    if (!precio.has(k)) precio.set(k, r);
  }
  const saldo = new Map<string, Map<string, number>>(); // nota → código de la factura → unidades libres
  const mismoPrecio = new Map<string, number>(); // nota → artículos con la lista y bonificación de la factura
  for (const cod of falta.keys()) {
    for (const g of mapa.get(cod) ?? []) {
      const libre = g.cantidad - g.facturado;
      if (libre <= 0 || !(manual.includes(g.pedido.id) || notaDisponible(g.pedido, f.fecha))) continue;
      if (!saldo.has(g.pedido.id)) saldo.set(g.pedido.id, new Map());
      const m = saldo.get(g.pedido.id)!;
      m.set(cod, (m.get(cod) ?? 0) + libre);
      const r = precio.get(cod)!;
      if (Math.abs(c(r.precioUnitario) - c(g.precioLista)) <= TOL_PRECIO && Math.abs((r.bonificacion || 0) - (g.descuento || 0)) <= 0.001) {
        mismoPrecio.set(g.pedido.id, (mismoPrecio.get(g.pedido.id) ?? 0) + 1);
      }
    }
  }
  const orden: string[] = [];
  const tomar = (id: string) => {
    orden.push(id);
    for (const [cod, libre] of saldo.get(id) ?? []) falta.set(cod, Math.max(0, (falta.get(cod) ?? 0) - libre));
  };
  for (const id of manual) if (!orden.includes(id)) tomar(id);
  type Candidata = { id: string; antes: boolean; completos: number; unidades: number; codigos: number; afinidad: number; precio: number; fecha: string };
  const mejorQue = (x: Candidata, y: Candidata) => (Number(x.antes) - Number(y.antes) || x.completos - y.completos || x.unidades - y.unidades
    || x.codigos - y.codigos || x.afinidad - y.afinidad || x.precio - y.precio || y.fecha.localeCompare(x.fecha) || y.id.localeCompare(x.id)) > 0;
  for (;;) {
    let mejor: Candidata | null = null;
    for (const [id, m] of saldo) {
      if (orden.includes(id)) continue;
      let codigos = 0, completos = 0, unidades = 0;
      for (const [cod, libre] of m) {
        const necesita = falta.get(cod) ?? 0;
        const u = Math.min(libre, necesita);
        if (u > 0) { codigos++; unidades += u; if (u === necesita) completos++; }
      }
      if (!codigos) continue;
      const fecha = fechaPedido.get(id) ?? '';
      const x: Candidata = { id, antes: !f.fecha || fecha <= f.fecha, completos, unidades, codigos, afinidad: m.size, precio: mismoPrecio.get(id) ?? 0, fecha };
      if (!mejor || mejorQue(x, mejor)) mejor = x;
    }
    if (!mejor) break;
    tomar(mejor.id);
  }
  return orden;
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
  if (Math.abs(total - c(f.total)) > TOL_TOTAL_FINAL) errores.push(`Total: subtotal + impuestos da ${fmt(p(total))}, impreso ${fmt(f.total)}.`);
  return { subtotalCalculado: p(sub), ivaCalculado: p(iva), caba: p(caba), bsas: p(bsas), totalCalculado: p(total), errores };
}

/** Cuánto suman IVA y percepciones sobre el neto, según lo que cobra esa factura. */
function factorImpuestos(f: Factura): number {
  return 1 + IVA + (f.percepcionCaba ? PERCEPCION_CABA : 0) + (f.percepcionBsAs ? PERCEPCION_BSAS : 0);
}

/** Neto + IVA 21% + percepciones (las que cobra esa factura), cada parte redondeada a centavos. */
export function conImpuestos(neto: number, f: Pick<Factura, 'percepcionCaba' | 'percepcionBsAs'>): Impuestos {
  const n = c(neto);
  const iva = Math.round(n * IVA);
  const perc = Math.round(n * ((f.percepcionCaba ? PERCEPCION_CABA : 0) + (f.percepcionBsAs ? PERCEPCION_BSAS : 0)));
  return { neto: p(n), iva: p(iva), percepciones: p(perc), total: p(n + iva + perc) };
}

const normTalle = (s: string) => String(s ?? '').trim().toUpperCase().replace(',', '.').replace(/\s+/g, '');
function valoresTalle(s: string): number[] {
  if (!/^\d+(\.\d+)?$/.test(s)) return [];
  const n = Number(s);
  // «055» de la planilla de iD es el US 5.5 de Converse; «040» de Le Coq es el 40.
  return /^\d{3}$/.test(s) ? [n, n / 10] : [n];
}
/** Mismo talle escrito distinto: «5.5» = «055», «10.0» = «100», «40» = «040», «xl» = «XL». */
export function mismoTalle(a: string, b: string): boolean {
  const A = normTalle(a), B = normTalle(b);
  if (A === B) return true;
  const vb = valoresTalle(B);
  return valoresTalle(A).some((x) => vb.includes(x));
}

/** El remito impreso y el de la factura son el mismo aunque uno lleve punto de venta y ceros. */
function mismoNumero(a: string, b: string): boolean {
  const n = (s: string) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const A = n(a), B = n(b);
  return !A || !B || A.endsWith(B) || B.endsWith(A);
}

const etiqueta = (x?: Pedido) => (x ? (x.nroProveedor ? `N° ${x.nroProveedor}` : x.nombre) : '');

/**
 * Analiza todas las facturas en orden de fecha contra todos los pedidos.
 * `asignacionManual` (factura id → pedidos) fija a qué pedidos se imputa primero.
 * `remitos` (factura id → remito): si se pasa, una factura sin remito queda «incompleta».
 */
export function analizarFacturas(
  pedidosIn: Pedido[],
  facturasIn: Factura[],
  asignacionManual: Record<string, string[]> = {},
  remitosIn?: Record<string, Remito | undefined>,
): ResultadoGeneral {
  // La O y el 0 se confunden (en el PDF, en la foto del remito o al tipear: CTN0225003O / CTN02250030).
  // Se comparan como iguales y se muestra la escritura de la factura (o, si no está, la del pedido).
  const escritura = new Map<string, string>();
  const anotar = (s: string) => { const k = claveCodigo(s); if (!escritura.has(k)) escritura.set(k, normCodigo(s)); };
  for (const f of facturasIn) for (const r of f.renglones) anotar(r.codigo);
  for (const x of pedidosIn) for (const l of x.lineas) anotar(l.codigo);
  const canon = (s: string) => escritura.get(claveCodigo(s)) ?? normCodigo(s);
  const pedidos = pedidosIn.map((x) => ({ ...x, lineas: x.lineas.map((l) => ({ ...l, codigo: canon(l.codigo) })) }));
  const facturas = facturasIn.map((f) => ({ ...f, renglones: f.renglones.map((r) => ({ ...r, codigo: canon(r.codigo) })) }));
  const remitos = remitosIn && Object.fromEntries(Object.entries(remitosIn).map(([k, r]) => [k, r && { ...r, renglones: r.renglones.map((x) => ({ ...x, codigo: canon(x.codigo) })) }]));
  const mapa = porCodigo(pedidos);
  const porId = new Map(pedidos.map((x) => [x.id, x]));
  const fechaPedido = new Map(pedidos.map((x) => [x.id, x.fecha]));
  const adelantados = new Set<string>(); // códigos con unidades adelantadas
  const historial = new Map<string, { factura: string; cantidad: number; adelanto: boolean }[]>();
  // Talles pedidos que todavía no llegaron según los remitos (código → talle del pedido → unidades).
  const tallesLibres = new Map<string, Map<string, number>>();
  for (const [cod, grupos] of mapa) {
    const m = new Map<string, number>();
    for (const g of grupos) for (const t of g.porTalle) m.set(t.talle, (m.get(t.talle) ?? 0) + t.cantidad);
    tallesLibres.set(cod, m);
  }
  const resultados: ResultadoFactura[] = [];

  for (const f of ordenarPorFecha(facturas)) {
    // 1. Notas de esta factura: las que eligió la usuaria y, después, las que mejor la explican
    //    (elegirNotas). El pedido principal es la primera.
    const manual = asignacionManual[f.id] ?? [];
    const orden = elegirNotas(f, mapa, manual, fechaPedido);
    const principal = manual[0] ?? orden[0] ?? null;
    const fechaPrincipal = principal ? fechaPedido.get(principal) ?? '' : '';
    const factor = factorImpuestos(f);
    const tocados = new Set<LineaCodigo>(); // grupos de los que tomó esta factura (sin adelantos)
    const tocadosCodigo = new Map<string, Set<LineaCodigo>>();

    const renglones: ControlRenglon[] = f.renglones.map((r) => {
      const cod = normCodigo(r.codigo);
      // Primero las notas elegidas, en su orden; las demás (sin saldo que haga falta) al final.
      // Las notas cuya tarjeta salió de las listas de pendientes no cuentan (salvo tildadas a mano).
      const pos = (id: string) => { const i = orden.indexOf(id); return i < 0 ? orden.length : i; };
      const grupos = (mapa.get(cod) ?? []).filter((g) => manual.includes(g.pedido.id) || notaDisponible(g.pedido, f.fecha)).sort((a, b) =>
        pos(a.pedido.id) - pos(b.pedido.id) || a.pedido.fecha.localeCompare(b.pedido.fecha));
      const antes = new Map(grupos.map((g) => [g, g.facturado]));
      let resto = r.cantidad;
      const asignaciones: Asignacion[] = [];
      const difPrecio: DiferenciaPrecio[] = [];
      const usados: LineaCodigo[] = [];
      const otraNota: string[] = [];
      const yaAdelantado = adelantados.has(cod);
      for (const g of grupos) {
        if (resto <= 0) break;
        const libre = g.cantidad - g.facturado;
        if (libre <= 0) continue;
        const toma = Math.min(libre, resto);
        g.facturado += toma;
        resto -= toma;
        usados.push(g);
        const elegido = manual.includes(g.pedido.id);
        const adelanto = !!principal && g.pedido.id !== principal && !elegido && g.pedido.fecha > fechaPrincipal;
        if (adelanto) adelantados.add(cod);
        else {
          tocados.add(g);
          if (!tocadosCodigo.has(cod)) tocadosCodigo.set(cod, new Set());
          tocadosCodigo.get(cod)!.add(g);
          if (principal && g.pedido.id !== principal && !elegido && !otraNota.includes(g.pedido.id)) otraNota.push(g.pedido.id);
        }
        asignaciones.push({ pedidoId: g.pedido.id, cantidad: toma, adelanto });
        if (Math.abs(c(r.precioUnitario) - c(g.precioLista)) > TOL_PRECIO || Math.abs((r.bonificacion || 0) - (g.descuento || 0)) > 0.001) {
          // dif_neta = (precio factura neto − precio pedido neto) × cantidad, redondeada una sola vez.
          const dif = Math.round((neto(r.precioUnitario, r.bonificacion) - neto(g.precioLista, g.descuento)) * toma * 100);
          difPrecio.push({ pedidoId: g.pedido.id, cantidad: toma, precioPedido: g.precioLista, descuentoPedido: g.descuento, precioFactura: r.precioUnitario, bonificacionFactura: r.bonificacion, diferencia: p(dif) });
        }
      }
      const sinPedir = resto;
      const facturasPrevias = [...(historial.get(cod) ?? [])];
      if (!historial.has(cod)) historial.set(cod, []);
      historial.get(cod)!.push({ factura: f.numero || f.id, cantidad: r.cantidad, adelanto: asignaciones.some((a) => a.adelanto) });
      const netoSinPedir = c(neto(r.precioUnitario, r.bonificacion) * sinPedir);
      const totalCalc = c(neto(r.precioUnitario, r.bonificacion) * r.cantidad);
      const referencia = usados.length ? usados : grupos;
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
        pedidoCantidad: referencia.length ? referencia.reduce((s, g) => s + g.cantidad, 0) : null,
        yaFacturadoAntes: referencia.reduce((s, g) => s + (antes.get(g) ?? 0), 0),
        precioPedido: referencia[0]?.precioLista ?? null,
        bonifPedido: referencia[0]?.descuento ?? null,
        faltante: 0,
        otraNota,
        remito: null,
      };
    });

    // 2. Faltantes: lo que sigue pendiente, en los pedidos de donde salió, de cada código facturado.
    const faltantes: { codigo: string; pedido: number; facturado: number; faltan: number }[] = [];
    for (const [cod, gs] of tocadosCodigo) {
      const pedido = [...gs].reduce((s, g) => s + g.cantidad, 0);
      const faltan = [...gs].reduce((s, g) => s + Math.max(0, g.cantidad - g.facturado), 0);
      for (const r of renglones) if (r.codigo === cod) r.faltante = faltan;
      if (faltan > 0) faltantes.push({ codigo: cod, pedido, facturado: pedido - faltan, faltan });
    }

    // 3. Remito: cantidades por código contra la factura, y talles contra lo pedido.
    const rem = remitos ? remitos[f.id] ?? null : null;
    const difRemito: ResultadoFactura['difRemito'] = [];
    const tallesNoPedidos: ResultadoFactura['tallesNoPedidos'] = [];
    if (rem) {
      const fact = new Map<string, number>();
      for (const r of renglones) fact.set(r.codigo, (fact.get(r.codigo) ?? 0) + r.cantidad);
      const llego = new Map<string, number>();
      for (const x of rem.renglones) {
        const cod = normCodigo(x.codigo);
        llego.set(cod, (llego.get(cod) ?? 0) + (Number(x.cantidad) || 0));
        const libres = tallesLibres.get(cod);
        if (!libres) continue; // código sin pedir: ya lo marca la factura
        for (const t of x.talles) {
          if (!(t.cantidad > 0)) continue;
          const claves = [...libres.keys()].filter((k) => mismoTalle(k, t.talle));
          let resta = t.cantidad;
          for (const k of claves) {
            const toma = Math.min(resta, libres.get(k) ?? 0);
            libres.set(k, (libres.get(k) ?? 0) - toma);
            resta -= toma;
          }
          if (resta > 0) tallesNoPedidos.push({ codigo: cod, talle: t.talle, llegaron: t.cantidad, pedidos: t.cantidad - resta });
        }
      }
      for (const r of renglones) r.remito = llego.get(r.codigo) ?? 0;
      for (const cod of new Set([...fact.keys(), ...llego.keys()])) {
        const a = fact.get(cod) ?? 0, b = llego.get(cod) ?? 0;
        if (a !== b) difRemito.push({ codigo: cod, factura: a, remito: b });
      }
    }

    const aritmetica = controlAritmetico(f);
    const totalSinPedirNeto = p(renglones.reduce((s, r) => s + c(r.netoSinPedir), 0));
    const totalSinPedirConImpuestos = p(renglones.reduce((s, r) => s + c(r.conImpuestosSinPedir), 0));
    const difs = renglones.flatMap((r) => r.difPrecio);
    const totalDifPrecio = p(difs.reduce((t, d) => t + c(d.diferencia), 0));
    const difMas = p(difs.filter((d) => d.diferencia > 0).reduce((t, d) => t + c(d.diferencia), 0));
    const difMenos = p(difs.filter((d) => d.diferencia < 0).reduce((t, d) => t + c(d.diferencia), 0));
    const codigosSinNota = [...new Set(renglones.filter((r) => r.noEstaEnPedidos).map((r) => r.codigo))];
    const faltaNota = !!remitos && renglones.length > 0 && renglones.every((r) => r.noEstaEnPedidos);
    const faltaRemito = !!remitos && !rem;

    const motivos: string[] = [];
    let criticas = 0, medias = 0;
    if (faltaRemito) motivos.push('INCOMPLETA: falta subir la foto del remito.');
    if (faltaNota) motivos.push('INCOMPLETA: falta la nota de pedido. Ningún artículo de la factura está en las notas pendientes (las de las listas de pendientes de Trello o subidas a mano): subila o tildala a mano.');
    const sinPedir = renglones.filter((r) => r.sinPedir > 0);
    if (sinPedir.length && !faltaNota) {
      criticas++;
      motivos.push(`FACTURADO SIN PEDIR: ${sinPedir.map((r) => `${r.codigo} (${r.sinPedir})`).join(', ')}: ${fmt(totalSinPedirNeto)} neto, ${fmt(totalSinPedirConImpuestos)} con impuestos.`);
      if (codigosSinNota.length) motivos.push(`${codigosSinNota.join(', ')} no figura en ninguna nota de pedido pendiente: ¿falta cargar un pedido?`);
    }
    const dobles = renglones.filter((r) => r.posibleDobleCobro);
    if (dobles.length) {
      criticas++;
      for (const r of dobles) {
        const previas = r.facturasPrevias.filter((x) => x.adelanto).map((x) => `${x.factura} (${x.cantidad})`).join(', ');
        motivos.push(`DOBLE COBRO: ${r.codigo} ya había sido facturado como adelanto en ${previas || 'una factura anterior'}.`);
      }
    }
    if (difMas > 0) {
      criticas++;
      const n = renglones.filter((r) => r.difPrecio.some((d) => d.diferencia > 0)).length;
      const x = conImpuestos(difMas, f);
      motivos.push(`PRECIO: ${n} artículo(s) más caros que en el pedido: ${fmt(x.neto)} neto + IVA ${fmt(x.iva)} + percepciones ${fmt(x.percepciones)} = ${fmt(x.total)}. Pedir nota de crédito por ${fmt(x.neto)} neto más impuestos.`);
    }
    if (difMenos < 0) {
      medias++;
      const n = renglones.filter((r) => r.difPrecio.some((d) => d.diferencia < 0)).length;
      motivos.push(`PRECIO: ${n} artículo(s) más baratos o con otra bonificación que en el pedido (${fmt(-difMenos)} neto a favor): revisar.`);
    }
    if (difs.some((d) => d.diferencia === 0)) {
      medias++;
      motivos.push('PRECIO: hay artículos con otra lista y otra bonificación que dan el mismo neto: revisar.');
    }
    const faltanRemito = difRemito.filter((d) => d.remito < d.factura);
    if (faltanRemito.length) {
      criticas++;
      motivos.push(`REMITO: facturaron más de lo que dice el remito: ${faltanRemito.map((d) => `${d.codigo} (factura ${d.factura}, remito ${d.remito})`).join(', ')}.`);
    }
    const sobranRemito = difRemito.filter((d) => d.remito > d.factura);
    if (sobranRemito.length) {
      medias++;
      motivos.push(`REMITO: llegó más de lo facturado: ${sobranRemito.map((d) => `${d.codigo} (remito ${d.remito}, factura ${d.factura})`).join(', ')}.`);
    }
    if (rem && f.remito && rem.numero && !mismoNumero(rem.numero, f.remito)) {
      medias++;
      motivos.push(`REMITO: el remito cargado es el ${rem.numero} y la factura dice ${f.remito}: ¿es el remito correcto?`);
    }
    if (tallesNoPedidos.length) {
      medias++;
      motivos.push(`TALLES: llegaron talles que no se pidieron: ${tallesNoPedidos.map((t) => `${t.codigo} talle ${t.talle} (llegaron ${t.llegaron}, pedidos ${t.pedidos})`).join(', ')}.`);
    }
    const deOtra = new Map<string, string[]>();
    for (const r of renglones) for (const id of r.otraNota) deOtra.set(id, [...(deOtra.get(id) ?? []), `${r.codigo} (${r.asignaciones.filter((a) => a.pedidoId === id).reduce((s, a) => s + a.cantidad, 0)})`]);
    if (deOtra.size) {
      medias++;
      for (const [id, cods] of deOtra) {
        const x = porId.get(id);
        motivos.push(`OTRA NOTA: ${cods.join(', ')} ${cods.length > 1 ? 'corresponden' : 'corresponde'} al pedido ${etiqueta(x)} del ${fechaAr(x?.fecha || '')}, no al ${etiqueta(porId.get(principal!))}.`);
      }
    }
    if (faltantes.length) {
      medias++;
      motivos.push(`FALTANTE: ${faltantes.map((x) => `${x.codigo} (pedido ${x.pedido}, facturado ${x.facturado}, faltan ${x.faltan})`).join(', ')}.`);
    }
    const malSumados = renglones.filter((r) => !r.totalOk);
    if (malSumados.length) { medias++; motivos.push(`CUENTAS: ${malSumados.length} renglón(es) mal calculados.`); }
    if (aritmetica.errores.length) { medias++; motivos.push(...aritmetica.errores.map((e) => `CUENTAS: ${e}`)); }
    if (renglones.some((r) => r.asignaciones.some((a) => a.adelanto))) {
      medias++;
      motivos.push('ADELANTO: toma unidades de un pedido posterior; no deben volver a facturarse.');
    }
    const pedidosCubiertos = [...new Set(renglones.flatMap((r) => r.asignaciones.map((a) => a.pedidoId)))];
    const propios = new Set([...tocados].map((g) => g.pedido.id));
    const pendientePedidos = [...mapa.values()].flat()
      .filter((g) => propios.has(g.pedido.id) && g.cantidad > g.facturado)
      .map((g) => ({ pedidoId: g.pedido.id, codigo: g.codigo, descripcion: g.descripcion, pendiente: g.cantidad - g.facturado }));
    const reclamo = conImpuestos(p(c(difMas) + c(totalSinPedirNeto)), f);
    const incompleta = faltaRemito || faltaNota;
    resultados.push({
      factura: f,
      pedidoPrincipal: principal,
      pedidosCubiertos,
      renglones,
      aritmetica,
      totalSinPedirNeto,
      totalSinPedirConImpuestos,
      totalDifPrecio,
      estado: criticas || medias || incompleta ? 'revisar' : 'ok',
      semaforo: incompleta ? 'incompleta' : criticas ? 'reclamar' : medias ? 'observaciones' : 'ok',
      motivos,
      checklist: [],
      unidades: renglones.reduce((s, r) => s + r.cantidad, 0),
      pedidosCompletos: pedidosCubiertos.length > 0 && pedidosCubiertos.every((id) =>
        [...mapa.values()].every((gs) => gs.every((g) => g.pedido.id !== id || g.facturado >= g.cantidad))),
      faltaRemito,
      faltaNota,
      codigosSinNota,
      remito: rem,
      difRemito,
      tallesNoPedidos,
      pendientePedidos,
      reclamo,
    });
  }

  // Pendientes por pedido y talle, con el estado final de todas las facturas.
  const pendientes: PendienteTalle[] = [];
  for (const grupos of mapa.values()) {
    for (const g of grupos) {
      const lleno = g.facturado >= g.cantidad;
      for (const t of g.porTalle) {
        const facturado = g.facturado === 0 ? 0 : lleno ? t.cantidad : null;
        pendientes.push({
          pedidoId: g.pedido.id, codigo: g.codigo, descripcion: g.descripcion, talle: t.talle, pedido: t.cantidad,
          facturado, pendiente: facturado === null ? null : t.cantidad - facturado,
        });
      }
    }
  }

  // Checklist de depósito: los talles del remito; sin remito, los del pedido solo si la factura completa el código.
  const tallesDe = (pedidoId: string, codigo: string) =>
    (mapa.get(codigo) ?? []).find((g) => g.pedido.id === pedidoId)?.porTalle ?? [];
  for (const res of resultados) {
    const delRemito = new Map<string, TalleCantidad[]>();
    for (const x of res.remito?.renglones ?? []) {
      const cod = normCodigo(x.codigo);
      if (x.talles.length) delRemito.set(cod, [...(delRemito.get(cod) ?? []), ...x.talles.filter((t) => t.cantidad > 0)]);
    }
    res.checklist = res.renglones.map((r) => {
      const remitoTalles = delRemito.get(r.codigo);
      if (remitoTalles?.length) {
        return { codigo: r.codigo, descripcion: r.descripcion, cantidad: r.cantidad, talles: sumarTalles(remitoTalles), nota: r.sinPedir > 0 ? `${r.sinPedir} sin pedir: controlar que no sea otro color` : '' };
      }
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
  const icono = { ok: '✅ OK', observaciones: '⚠️ CON OBSERVACIONES', reclamar: '❌ RECLAMAR, NO PAGAR', incompleta: '⏳ INCOMPLETA, NO PAGAR TODAVÍA' }[r.semaforo];
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
export function reporteReclamo(r: ResultadoFactura, nombrePedido: (id: string) => string = (id) => id): string | null {
  const f = r.factura;
  const lineas: string[] = [];
  for (const x of r.renglones) {
    if (x.sinPedir > 0) lineas.push(`- ${x.codigo} ${x.descripcion}: facturaron ${x.cantidad}, sin pedido ${x.sinPedir} unidades (${fmt(x.netoSinPedir)} neto + impuestos = ${fmt(x.conImpuestosSinPedir)}).${x.posibleDobleCobro ? ' Ya habían sido facturadas como adelanto.' : ''}`);
    for (const d of x.difPrecio) {
      lineas.push(`- ${x.codigo} ${x.descripcion}: precio ${fmt(d.precioFactura)} con ${d.bonificacionFactura}% de bonificación; en el pedido ${nombrePedido(d.pedidoId)} era ${fmt(d.precioPedido)} con ${d.descuentoPedido}%. Diferencia ${fmt(d.diferencia)} neto en ${d.cantidad} unidades.`);
    }
    if (!x.totalOk) lineas.push(`- ${x.codigo}: el renglón da ${fmt(x.totalCalculado)} y figura ${fmt(x.totalImpreso)}.`);
  }
  for (const d of r.difRemito) if (d.remito < d.factura) lineas.push(`- ${d.codigo}: facturaron ${d.factura} y el remito trae ${d.remito}.`);
  for (const e of r.aritmetica.errores) lineas.push(`- ${e}`);
  if (!lineas.length) return null;
  const pie: string[] = [];
  if (r.reclamo.neto > 0) {
    const x = r.reclamo;
    pie.push('', `Diferencia a reclamar: ${fmt(x.neto)} neto + IVA 21% ${fmt(x.iva)} + percepciones ${fmt(x.percepciones)} = ${fmt(x.total)}.`,
      `Les pedimos una nota de crédito por ${fmt(x.neto)} neto, más sus impuestos.`);
  }
  return [`Reclamo factura ${f.numero} del ${fechaAr(f.fecha)}${f.remito ? `, remito ${f.remito}` : ''}:`, ...lineas, ...pie].join('\n');
}

function fechaAr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || '';
}
