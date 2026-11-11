// ============================================================================
// REGISTRO DE CARGAS EN SHOPIFY (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// «Un registro de actividad de carga, con número de remito y de factura y qué
// productos se cargaron». Lo guarda el servidor (server/control-facturas.js,
// lista cf:registro) cada vez que una carga termina o que se libera una marca a
// mano. Acá solo se agrupa por entrega, se filtra y se arma el Excel.
// Solo lectura: no toca Shopify ni la base.
// ============================================================================

export type EstadoRegistro = 'cargada' | 'parcial' | 'dudosa' | 'en curso';
export interface EventoRegistro {
  /** carga: se cargó en Shopify · liberada: la usuaria liberó la marca y se puede cargar otra vez. */
  tipo: 'carga' | 'liberada';
  /** ISO, hora del servidor. */
  hora: string;
  proveedor: string;
  entregaId: string;
  codigo: string;
  entrega: { fecha: string; nombre: string };
  remito: string;
  factura: string;
  estado: EstadoRegistro;
  accion?: 'alta' | 'reposicion';
  titulo?: string;
  productoId?: string;
  unidades?: number;
  talles: { talle: string; cantidad: number }[];
  mensaje?: string;
  /** Armado con la marca de carga (cargas hechas antes de que existiera el registro, o cortadas). */
  deMarca?: boolean;
}
export interface GrupoRegistro {
  clave: string;
  proveedor: string;
  entregaId: string;
  entrega: { fecha: string; nombre: string };
  remito: string;
  factura: string;
  /** Del más viejo al más nuevo. */
  eventos: EventoRegistro[];
  ultima: string;
  /** Unidades de las cargas (no cuenta las liberadas). */
  unidades: number;
}

export const NOMBRE_PROVEEDOR: Record<string, string> = { family: 'Family', id: 'iD', distrinando: 'Distrinando' };
const SIN_FACTURA = new Set(['family']);
const TIENDA = 'indy-com-ar';

/** Enlace al producto en el admin de Shopify. */
export function enlaceShopify(productoId?: string): string {
  const m = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(productoId || '');
  return m ? `https://admin.shopify.com/store/${TIENDA}/products/${m[1]}` : '';
}

/** «11/11/2026 16:20», en hora de Argentina. */
export function horaAr(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return iso || '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const fechaAr = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

export const textoFactura = (proveedor: string, factura: string) => factura || (SIN_FACTURA.has(proveedor) ? `no tiene (${NOMBRE_PROVEEDOR[proveedor] ?? proveedor} no factura)` : 'sin número');
export const textoTalles = (ts: EventoRegistro['talles']) => ts.map((t) => `${t.talle}:${t.cantidad}`).join(' ');

/** Qué se hizo: [ícono, texto]. */
export function accionRegistro(e: EventoRegistro): [string, string] {
  if (e.tipo === 'liberada') return ['🔓', 'Marca liberada a mano'];
  if (e.accion === 'alta') return ['🆕', 'Producto nuevo'];
  if (e.accion === 'reposicion') return ['🔁', 'Reposición'];
  return ['⬆️', 'Carga'];
}

/** Cómo terminó: [ícono, texto]. */
export function estadoRegistro(e: EventoRegistro): [string, string] {
  if (e.tipo === 'liberada') return ['🔓', 'Se puede cargar otra vez'];
  const m: Record<EstadoRegistro, [string, string]> = {
    cargada: ['✅', 'Cargado'],
    parcial: ['⚠️', 'Cargado en parte'],
    dudosa: ['❓', 'Dudoso: revisar en Shopify'],
    'en curso': ['⏳', 'Sin terminar: revisar en Shopify'],
  };
  return m[e.estado] ?? ['', String(e.estado)];
}

/** Unidades de un evento: las informadas o, si no vinieron, la suma de los talles. */
export const unidadesEvento = (e: EventoRegistro) => e.unidades ?? e.talles.reduce((s, t) => s + t.cantidad, 0);

/** Agrupa por entrega. Las entregas con actividad más reciente van primero. */
export function agruparRegistro(eventos: EventoRegistro[]): GrupoRegistro[] {
  const grupos = new Map<string, GrupoRegistro>();
  for (const e of [...eventos].sort((a, b) => a.hora.localeCompare(b.hora))) {
    const clave = `${e.proveedor}|${e.entregaId}`;
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, proveedor: e.proveedor, entregaId: e.entregaId, entrega: { ...e.entrega }, remito: e.remito, factura: e.factura, eventos: [], ultima: e.hora, unidades: 0 };
      grupos.set(clave, g);
    }
    g.eventos.push(e);
    g.ultima = e.hora;
    // Lo más nuevo manda (por ejemplo, si después se corrigió el número de remito).
    if (e.remito) g.remito = e.remito;
    if (e.factura) g.factura = e.factura;
    if (e.entrega.fecha) g.entrega.fecha = e.entrega.fecha;
    if (e.entrega.nombre) g.entrega.nombre = e.entrega.nombre;
    if (e.tipo === 'carga') g.unidades += unidadesEvento(e);
  }
  return [...grupos.values()].sort((a, b) => b.ultima.localeCompare(a.ultima));
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Busca por código, producto, remito, factura, proveedor o fecha (dd/mm/aaaa). */
export function filtrarRegistro(grupos: GrupoRegistro[], texto: string): GrupoRegistro[] {
  const q = sinAcentos(texto.trim());
  if (!q) return grupos;
  const enGrupo = (g: GrupoRegistro) => sinAcentos([NOMBRE_PROVEEDOR[g.proveedor] ?? g.proveedor, g.remito, g.factura, g.entrega.nombre, fechaAr(g.entrega.fecha)].join(' ')).includes(q);
  const enEvento = (e: EventoRegistro) => sinAcentos([e.codigo, e.titulo ?? '', horaAr(e.hora)].join(' ')).includes(q);
  return grupos.flatMap((g) => {
    if (enGrupo(g)) return [g];
    const eventos = g.eventos.filter(enEvento);
    return eventos.length ? [{ ...g, eventos }] : [];
  });
}

/** Filas para el Excel: una por artículo cargado o liberado, la más nueva primero. */
export function filasExcel(eventos: EventoRegistro[]): (string | number)[][] {
  const encabezado = ['Fecha y hora', 'Proveedor', 'Entrega del', 'Planilla', 'Remito', 'Factura', 'Código', 'Producto', 'Qué se hizo', 'Talles', 'Unidades', 'Estado', 'Detalle', 'Enlace a Shopify'];
  const filas = [...eventos].sort((a, b) => b.hora.localeCompare(a.hora)).map((e) => [
    horaAr(e.hora), NOMBRE_PROVEEDOR[e.proveedor] ?? e.proveedor, fechaAr(e.entrega.fecha), e.entrega.nombre, e.remito || 'sin número',
    textoFactura(e.proveedor, e.factura), e.codigo, e.titulo ?? '', accionRegistro(e)[1], textoTalles(e.talles),
    e.tipo === 'carga' ? unidadesEvento(e) : '', estadoRegistro(e)[1], e.mensaje ?? '', enlaceShopify(e.productoId),
  ]);
  return [encabezado, ...filas];
}
