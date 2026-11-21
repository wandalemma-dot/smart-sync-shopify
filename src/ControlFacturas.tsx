// ============================================================================
// CONTROL DE ENTREGAS: factura + remito + nota de pedido (pedido de gax)
// ----------------------------------------------------------------------------
// 10-nov-2026: factura contra pedidos, guardado en la base de Vercel.
// 11-nov-2026: pantalla en un solo recuadro («Nueva entrega»): se sube la
// factura (PDF) y la foto del remito; la nota de pedido se busca sola en Trello.
// Las tres partes son obligatorias: sin remito o sin nota la entrega queda
// «incompleta». El asistente de IA queda escondido abajo para consultas sueltas.
// Las cuentas las hace utils/controlFacturas.ts (sin IA). La foto del remito se
// pasa a texto con api/leer-remito.js y se puede corregir o escribir a mano.
// No toca Shopify.
// ============================================================================
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import Asistente from './Asistente';
import {
  analizarFacturas, claveCodigo, notaDisponible, claveRecepcion, huellaPedido, compararRecepcion, fmt, mailPagos, mensajePagos, reporteReclamo, resumenPedidos,
  type ControlRenglon, type CopiaPlanilla, type Factura, type Pedido, type Recepcion, type Remito, type ResultadoFactura, type ResultadoGeneral,
} from './utils/controlFacturas';
import { filasPdf, leerFacturaDistrinando, leerFacturaId, leerPedidoAuto, leerTextoRemito, textoRemito, type HojaMarcada, type ItemPdf } from './utils/lectoresFacturas';
import { esPedidoTarget, facturaTargetDeFoto, leerPedidoTarget, type FacturaFoto } from './utils/target';
import { planCargaTarget, type ColorTarget } from './utils/cargaTarget';
import { celdasVerdes, hojaVisible } from './utils/planillaVerde';
import { consejoNota, fusionarPlanilla, marcasDeNota, type ConsejoNota, type MarcasNota, type NoEntro } from './utils/marcasPlanilla';
import { conEstadoTrello, estadosTarjetas, listaDeParciales, listaFinalizado, listasDePendientes, movimientosTarjetas, tarjetaDeNota, type EstadoTarjeta, type ListaTrello } from './utils/listasTrello';
import ControlFamily from './ControlFamily';
import RegistroCargas from './RegistroCargas';
import EnlacesRapidos from './EnlacesRapidos';
import { Archivo, Copiar, Parte } from './EntregasPartes';
import { NoEntraron, OrdenesQueSalen, PanelCarga } from './PanelCarga';
import { accionesElegidas, ejecutarCargaFamily, resumenCarga, textoCarga, type CargaFamily, type EleccionesCarga, type ModoVenta, type NoEntroCarga, type PlanCarga, type ResultadoCarga } from './utils/cargaFamily';
import { ResultadosCarga } from './ResultadosCarga';
import { comentarioTrello, fechaIngreso, filaPlanilla, textoAvisoAdmin } from './utils/avisoAdmin';
import { cambiosDePrecio, enlacesMail, textoAvisoPrecio, type CambioPrecio, type MailsAviso } from './utils/avisoPrecio';
import { diferenciasDeTalles, netosDeCarga, textoAvisoTalles } from './utils/avisoTalles';
import { planCargaDistrinando } from './utils/cargaDistrinando';
import { entregaArchivada, estadoCargaFactura, leerEstadoCargaId, noEntraronId, ordenesQueSalen, planCargaId, type OrdenQueSale, precioYCostoAntes, SUCURSAL_CARGA_ID, type EstadoCargaId } from './utils/cargaId';
import { actualizarPreciosManualmente, shopifyGraphQL } from './utils/shopify';
import {
  adjuntarATrello, apiControl, archivosParaTrello, boton, botonChico, botonPrincipal, enlace, fechaAr, hoy, inputSt, leerFotos, mensaje, slug, td, th,
  anotarEnPlanilla, comentarEnTrello, moverEnTrello, probarPlanilla,
} from './utils/entregasUi';

type Prov = 'distrinando' | 'id' | 'family' | 'target' | 'ullua';
/** Marketplaces con su propia pantalla (ControlFamily): sin nota de pedido ni Trello de pendientes. */
const esMarket = (p: Prov) => p === 'family' || p === 'ullua';
type PedidoGuardado = Pedido & { nroProveedor?: string; origen?: string; enlace?: string };
type RecepcionGuardada = Recepcion & { nota?: string; actualizado?: string };
interface Datos {
  pedidos: PedidoGuardado[];
  facturas: Factura[];
  asignaciones: Record<string, string[]>;
  recepciones: Record<string, RecepcionGuardada>;
  remitos: Record<string, Remito>;
  config: { condicionesPago?: string };
  /** Excel de Trello ya revisados que no se cargaron (otro proveedor, no es pedido, repetido, borrado). */
  trelloVistos: Record<string, { motivo?: string; fecha?: string; version?: number; nro?: string; huella?: string }>;
  /** En qué lista de Trello está cada tarjeta con notas (solo cuentan las de pedidos pendientes). */
  tarjetasTrello: Record<string, EstadoTarjeta>;
  /** Listas de Trello elegidas como de pedidos pendientes (vacío = las que dicen «pendiente»). */
  listasTrello: string[];
  /** A quién va el aviso de cambio de precio (se guarda en la base, no en el código). */
  mailsAviso?: MailsAviso;
  mailsAdmin?: MailsAviso;
  /** iD: qué artículos de cada entrega ya se cargaron en Shopify («{facturaId}|{código}»). */
  cargas?: Record<string, CargaFamily>;
  /** Artículos sacados de la carga porque no llegaron («{facturaId}|{código}»): cuentan como terminados. */
  noLlego?: Record<string, { fecha?: string }>;
  /** Entregas dadas por cerradas o vueltas a abrir a mano (si no, se cierran solas al terminar la carga). */
  archivo?: Record<string, { estado: 'cerrada' | 'abierta'; fecha?: string }>;
}
/** Versión del lector de Excel de Trello. Subirla cuando cambie: los descartados se revisan de nuevo. */
const LECTOR_TRELLO = 6; // 4: 12-nov-2026, una copia en una tarjeta de pendientes de una nota cargada desde otra lista; 5: lee el verde; 6: talles de un dígito
/** Versión con que se leyó una nota: desde la 5 guarda las celdas y lo pintado en verde. */
const LECTOR_PLANILLA = 6; // 6: 19-nov-2026, lee los talles de un dígito (se suman los renglones que faltaban)
const VACIO: Datos = { pedidos: [], facturas: [], asignaciones: {}, recepciones: {}, remitos: {}, config: {}, trelloVistos: {}, tarjetasTrello: {}, listasTrello: [] };
const PROVS: { id: Prov; nombre: string }[] = [
  { id: 'id', nombre: 'iD (Converse, Le Coq)' },
  { id: 'distrinando', nombre: 'Distrinando (Reebok, Kappa, Crocs)' },
  { id: 'target', nombre: 'Target (Discovery, Reebok, NBA…)' },
  { id: 'family', nombre: 'Family (sin factura)' },
  { id: 'ullua', nombre: 'Ullua (Thrasher, Spitfire, DTS)' },
];
type Vista = 'entregas' | 'pedidos' | 'deposito' | 'reportes';
interface AdjuntoTrello { id: string; nombre: string; fecha?: string }
interface TarjetaTrello { id: string; nombre: string; enlace: string; lista: string; idLista?: string; creada: string; inicio: string; adjuntos: AdjuntoTrello[]; otrosAdjuntos?: string[]; /** PDF subidos (Target). */ pdfs?: AdjuntoTrello[] }
type EstadoTrello = 'cargada' | 'ya estaba' | 'borrada' | 'otra' | 'ilegible' | 'no es excel' | 'falla';
/** Qué pasó con cada Excel de Trello en la última búsqueda (se muestra en la entrega). */
interface FilaTrello {
  tarjeta: string; enlace: string; archivo: string; adjunto?: string; estado: EstadoTrello; detalle: string;
  /** Cuántos artículos de la factura tiene esa nota. */
  deEstaFactura: number;
  /** Nota leída de un Excel borrado a mano, lista para volver a cargarla. */
  pedido?: PedidoGuardado;
}
interface InformeTrello {
  /** Proveedor de la búsqueda: el informe no se muestra ni se usa con otro proveedor elegido. */
  prov: Prov;
  facturaId?: string; hora: string; tablero: string; tarjetas: number; conExcel: number; filas: FilaTrello[];
  /** Listas de pedidos pendientes revisadas, y cuántas tarjetas abiertas hay en otras listas (no se usan). */
  listas?: string[]; fueraDeListas?: number;
  /** Excel ya anotados como de otro proveedor: no se vuelven a bajar. */
  otroProveedor: number;
  /** Excel revisados antes que esta vez no se volvieron a bajar. */
  sinRevisar: number;
  /** Alguna nota cargada (de Trello o subida a mano) tiene artículos de la factura. */
  cubierta?: boolean;
  error?: string;
}
/** Marca de un Excel que repetía otra nota (o una nota borrada a mano). */
const REPITE = /: repite /;
/** Marca de un Excel que es copia de una nota borrada a mano. */
const REPITE_BORRADA = /: repite una nota que borraste/;
/** Enlace a la tarjeta de Trello de un pedido importado desde ahí. */
const enlaceTrello = (p?: PedidoGuardado) => {
  const m = /^trello:([a-f0-9]{24})$/.exec(p?.origen || '');
  return m ? (p!.enlace || `https://trello.com/c/${m[1]}`) : '';
};

/** Excel bajado de Trello: los datos y lo pintado en verde (leído del archivo original en el servidor). */
interface Bajado { buf: ArrayBuffer; nombre: string; fecha: string; completo: boolean; verdes: Set<string>; origen: { r: number; c: number }; /** Target: es un PDF. */ pdf?: boolean }

async function bajarAdjunto(tarjeta: string, adjunto: string): Promise<Bajado> {
  const r = await fetch(`/api/trello?accion=adjunto&tarjeta=${tarjeta}&adjunto=${adjunto}`, { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { status: r.status });
  const bin = atob(d.datos);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return {
    buf: buf.buffer, nombre: String(d.nombre || ''), fecha: String(d.fecha || ''), completo: d.completo !== false, pdf: d.pdf === true,
    verdes: new Set(Array.isArray(d.verdes) ? d.verdes.map(String) : []),
    origen: d.origen && Number.isInteger(d.origen.r) && Number.isInteger(d.origen.c) ? d.origen : { r: 0, c: 0 },
  };
}

/** Lee la hoja visible de un Excel: filas (como las lee la app) y lo pintado en verde. */
function leerHoja(buf: ArrayBuffer, fecha: string, deTrello?: Pick<Bajado, 'verdes' | 'origen' | 'completo'>): { filas: unknown[][]; hoja: HojaMarcada } {
  const wb = XLSX.read(buf, { cellStyles: !deTrello || deTrello.completo });
  const nombre = hojaVisible(wb);
  const ws = wb.Sheets[nombre];
  const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  const ini = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s : { r: 0, c: 0 };
  // De Trello, los verdes vienen del original (la copia liviana de un Excel grande no trae colores).
  const verdes = deTrello && !deTrello.completo ? deTrello.verdes : celdasVerdes(ws);
  const origen = deTrello && !deTrello.completo ? deTrello.origen : { r: ini.r, c: ini.c };
  return { filas, hoja: { verdes, origen, fecha } };
}

const SEMAFORO = {
  ok: { icono: '✅', texto: 'Todo coincide', color: '#34d399' },
  observaciones: { icono: '⚠️', texto: 'Con observaciones', color: '#fbbf24' },
  reclamar: { icono: '❌', texto: 'No coincide: reclamar al proveedor', color: '#f87171' },
  incompleta: { icono: '⏳', texto: 'Incompleta: falta el remito o la nota', color: '#94a3b8' },
} as const;
/**
 * iD en naranja (19-nov-2026, gax: «es medio chocante que tenga rojo la app… pongámosle un naranjita… por lo menos en
 * iD»): lo que no coincide con la nota se ve en naranja en lugar de rojo. Los demás proveedores, sin cambios por ahora.
 */
const NARANJA = '#fb923c';
function semaforoDe(r: ResultadoFactura, naranja?: boolean) {
  const s = SEMAFORO[r.semaforo];
  return naranja && r.semaforo === 'reclamar' ? { ...s, icono: '🟠', color: NARANJA } : s;
}

interface PaginaPdf {
  getTextContent(): Promise<{ items: ItemPdf[] }>;
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
}
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(o: { data: ArrayBuffer }): { promise: Promise<{ numPages: number; getPage(i: number): Promise<PaginaPdf> }> };
}

async function abrirPdf(datos: File | ArrayBuffer) {
  const pdfjsLib = (window as unknown as { pdfjsLib?: PdfJs }).pdfjsLib;
  if (!pdfjsLib) throw new Error('No cargó el lector de PDF. Refrescá la página con Ctrl+Shift+R.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  // pdf.js se queda con el ArrayBuffer (lo pasa al worker): se le da una copia.
  return pdfjsLib.getDocument({ data: datos instanceof ArrayBuffer ? datos.slice(0) : await datos.arrayBuffer() }).promise;
}
async function itemsPdf(datos: File | ArrayBuffer): Promise<ItemPdf[][]> {
  const pdf = await abrirPdf(datos);
  const paginas: ItemPdf[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) paginas.push((await (await pdf.getPage(i)).getTextContent()).items);
  return paginas;
}
/** Target: el texto del PDF renglón por renglón (para la nota de pedido «Detalle de solicitud»). */
async function lineasPdf(datos: File | ArrayBuffer): Promise<string[]> {
  return (await itemsPdf(datos)).flatMap((p) => filasPdf(p).map((f) => f.map((c) => c.s).join(' ')));
}
const esPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
/** Target: una factura en PDF escaneado se pasa a fotos (una por página, hasta 5) para leerla como las fotos. */
async function comoFotos(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (!esPdf(f)) { out.push(f); continue; }
    const pdf = await abrirPdf(f);
    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
      const pag = await pdf.getPage(i);
      const vista = pag.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = vista.width; canvas.height = vista.height;
      await pag.render({ canvasContext: canvas.getContext('2d')!, viewport: vista }).promise;
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
      if (!blob) throw new Error(`No pude leer la página ${i} de ${f.name}.`);
      out.push(new File([blob], `${f.name.replace(/\.pdf$/i, '')} pág ${i}.jpg`, { type: 'image/jpeg' }));
    }
  }
  return out;
}

const api = (body?: object, proveedor?: Prov) => apiControl(body, proveedor);

/** Guarda en qué lista de Trello está cada tarjeta con notas (de a 500, el servidor acepta hasta 1000). */
async function guardarEstados(p: Prov, cambios: Record<string, EstadoTarjeta>) {
  const entradas = Object.entries(cambios);
  for (let i = 0; i < entradas.length; i += 500) await api({ proveedor: p, accion: 'guardarTarjetas', tarjetas: Object.fromEntries(entradas.slice(i, i + 500)) });
}
/** Fecha de hoy en Argentina (hoy() es la de UTC: después de las 21 ya da mañana). */
const hoyAr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Control de todas las facturas. Las notas de tarjetas archivadas en Trello (16-nov-2026, gax: «esta tarjeta yo la
 * archivé») no se eligen solas para las entregas abiertas; las entregas ya cargadas y cerradas conservan su resultado.
 */
/**
 * iD: lo que no entró de las notas de una entrega y ya no va a entrar (17-nov-2026, gax: «iD siempre va a preparar
 * los pedidos completos»). Con datos frescos de la base. Ver consejoNota (completoPorTipo).
 */
function noEntroDeEntrega(facturaId: string, d: Datos, p: Prov): (NoEntro & { nota: string })[] {
  try {
    const datos = { ...VACIO, ...d } as Datos;
    const ctrl = conEstadoTrello(datos.pedidos, datos.tarjetasTrello, hoyAr());
    const res = analizarControl(ctrl, datos, p);
    const rf = res.facturas.find((x) => x.factura.id === facturaId);
    if (!rf) return [];
    return rf.pedidosCubiertos.flatMap((id) => {
      const nota = ctrl.find((x) => x.id === id);
      const c = consejoNota(marcasDeNota(res, null, ctrl, id), { completoPorTipo: true });
      const nombre = nota ? (nota.nroProveedor ? `N° ${nota.nroProveedor}` : nota.nombre) : id;
      return (c.noEntro ?? []).map((x) => ({ ...x, nota: nombre }));
    });
  } catch { return []; }
}

function analizarControl(ctrl: (Pedido & { archivada?: boolean })[], d: Datos, p: Prov) {
  const res = analizarFacturas(ctrl, d.facturas, d.asignaciones, d.remitos);
  if (!ctrl.some((x) => x.archivada)) return res;
  const cargaEnt = p === 'id' || p === 'distrinando' || p === 'target';
  const abiertas = new Set(res.facturas.filter((r) => !(cargaEnt
    && entregaArchivada(r, estadoCargaFactura(r, d.cargas ?? {}, d.noLlego), d.archivo?.[r.factura.id]?.estado, p !== 'distrinando'))).map((r) => r.factura.id));
  return analizarFacturas(ctrl, d.facturas, d.asignaciones, d.remitos, abiertas);
}
const sinListas = (elegidas: string[]) => elegidas.length
  ? 'Las listas de Trello elegidas como pedidos pendientes ya no están en el tablero: elegilas de nuevo en «Notas de pedido cargadas».'
  : 'No encontré en Trello ninguna lista de pedidos pendientes (con «pendiente» en el nombre): elegilas en «Notas de pedido cargadas».';



export default function ControlFacturas() {
  const [prov, setProv] = useState<Prov>('id');
  const [vista, setVista] = useState<Vista>('entregas');
  // Registro de cargas en Shopify (todos los proveedores). Las pantallas de abajo quedan montadas
  // (ocultas) mientras se mira, así una carga en curso no se corta.
  const [verRegistro, setVerRegistro] = useState(false);
  const [datos, setDatos] = useState<Datos>(VACIO);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [sinBase, setSinBase] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  /** Precios de venta que cambió la última carga: se ofrece mandar el aviso por mail. */
  const [avisoPrecio, setAvisoPrecio] = useState<{ cambios: CambioPrecio[]; asunto: string; cuerpo: string } | null>(null);
  const [avisoAdmin, setAvisoAdmin] = useState<{ asunto: string; cuerpo: string } | null>(null);
  /** Talles distintos al remito en la última carga (13-nov-2026, gax): el mail para avisar. */
  const [avisoTalles, setAvisoTalles] = useState<{ asunto: string; cuerpo: string } | null>(null);
  /** Órdenes de iD que se llevaron algo de la última carga: cuáles ya pueden salir (12-nov-2026, gax). */
  const [ordenesCarga, setOrdenesCarga] = useState<OrdenQueSale[]>([]);
  const [noEntraronCarga, setNoEntraronCarga] = useState<{ items: NoEntroCarga[]; factura: string } | null>(null);
  const [resultadoCarga, setResultadoCarga] = useState<{ resultados: ResultadoCarga[]; conVentas: boolean } | null>(null);
  const [fechaPedido, setFechaPedido] = useState(hoy());
  const [abierta, setAbierta] = useState<string | null>(null);
  /** Entrega cerrada que se está mirando completa (en el apartado verde se ve en una línea). */
  const [verCerrada, setVerCerrada] = useState<string | null>(null);
  const [facturaDeposito, setFacturaDeposito] = useState('');
  const [condiciones, setCondiciones] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [nuevaFactura, setNuevaFactura] = useState<File | null>(null);
  // Target: la factura llega en fotos (o en PDF escaneado), una o varias.
  const [fotosFactura, setFotosFactura] = useState<File[]>([]);
  const [nuevasFotos, setNuevasFotos] = useState<File[]>([]);
  const [informe, setInforme] = useState<InformeTrello | null>(null);
  // Listas del tablero de Trello (para elegir de cuáles salen las notas). null = todavía no se leyeron.
  const [listasTablero, setListasTablero] = useState<ListaTrello[] | null>(null);
  const [verCerradas, setVerCerradas] = useState(false);
  // iD: vista previa de la carga en Shopify (una entrega por vez).
  const [planCarga, setPlanCarga] = useState<PlanCarga | null>(null);
  // Lo leído para armar la carga: «cargarlo igual» (no separar lo vendido en iD) rearma sin volver a leer.
  // Distrinando (13-nov-2026): además la tabla de talle y el talle de destino que se eligen en la vista previa.
  /** La factura y las fotos del remito que se subieron en esta pantalla, para mandarlas a Trello sin elegirlas de nuevo. */
  const archivosEntrega = useRef(new Map<string, File[]>());
  const [, setRecordados] = useState(0);
  /** Target: las fotos de la factura (van a Trello como «Factura …», no como remito). */
  const fotosDeFactura = useRef(new WeakSet<File>());
  const esFotoFactura = (f: File) => fotosDeFactura.current.has(f);
  const recordar = (facturaId: string, files: File[], reemplazarFotos: boolean) => {
    const antes = archivosEntrega.current.get(facturaId) ?? [];
    const quedan = reemplazarFotos ? antes.filter((f) => esPdf(f) || esFotoFactura(f)) : [];
    archivosEntrega.current.set(facturaId, [...quedan, ...files]);
    setRecordados((n) => n + 1);
  };
  const baseCarga = useRef<{
    prov: Prov; r: ResultadoFactura; estado: EstadoCargaId; cargas: Record<string, CargaFamily>; modos: Map<string, ModoVenta>; cantidades: Map<string, Record<string, number>>;
    pedidos: Pedido[]; tablas: Map<string, string>; destinos: Map<string, Record<string, string>>;
    /** Distrinando: SKU escaneado a mano y artículos sacados de la carga (no llegaron). */
    skus: Map<string, Record<string, string>>; quitados: Set<string>;
    /** iD: unidades por pack escritas a mano. */
    packs: Map<string, number>;
    /** Target (20-nov-2026): colores escritos a mano por código (cada color es un producto aparte). */
    colores: Map<string, ColorTarget[]>;
    /** iD: lo pedido en las notas de esta entrega que no entró, con las ventas que lo esperan. */
    noEntraron?: NoEntroCarga[];
  } | null>(null);
  const listasRevisadas = useRef(new Set<Prov>());
  // Proveedor elegido ahora: una búsqueda o carga que termina después de cambiarlo no toca la pantalla.
  const provRef = useRef(prov);
  const sigue = (p: Prov) => provRef.current === p;

  const recargar = useCallback(async () => {
    if (esMarket(prov)) return; // Family y Ullua tienen su propia pantalla (ControlFamily)
    setCargando(true); setError('');
    try {
      const d = await api(undefined, prov);
      if (provRef.current !== prov) return; // se cambió de proveedor mientras cargaba
      setDatos({ ...VACIO, ...d }); setSinBase(false);
      setCondiciones(d.config?.condicionesPago || '');
    } catch (e) {
      if (provRef.current !== prov) return;
      setError(mensaje(e)); setSinBase(!!(e as { sinBase?: boolean }).sinBase); setDatos(VACIO);
    }
    finally { setCargando(false); }
  }, [prov]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de proveedor
  useEffect(() => { recargar(); }, [recargar]);

  /**
   * Sin bajar ningún Excel: anota en qué lista de Trello está cada tarjeta con notas, así una nota
   * cuya tarjeta salió de las listas de pendientes deja de elegirse sola. Una vez al abrir cada
   * proveedor (o al cambiar las listas). Devuelve un aviso si algo falló ('' si salió bien).
   */
  const revisarListas = useCallback(async (p: Prov, forzar = false): Promise<string> => {
    if (esMarket(p) || (!forzar && listasRevisadas.current.has(p))) return '';
    listasRevisadas.current.add(p);
    try {
      const r = await fetch('/api/trello?accion=tarjetas', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { listasRevisadas.current.delete(p); return d.sinTrello ? '' : `Trello: ${d.error || `Error ${r.status}`}`; }
      const listas = (d.listas || []) as ListaTrello[];
      setListasTablero(listas);
      const frescos = { ...VACIO, ...(await api(undefined, p)) } as Datos;
      const deLista = listasDePendientes(listas, frescos.listasTrello);
      if (!deLista.length) { listasRevisadas.current.delete(p); return `Trello: ${sinListas(frescos.listasTrello)}`; }
      const cambios = estadosTarjetas(frescos.pedidos, (d.tarjetas || []) as TarjetaTrello[], new Set(deLista.map((l) => l.id)), frescos.tarjetasTrello, hoyAr());
      if (!Object.keys(cambios).length) return '';
      await guardarEstados(p, cambios);
      if (provRef.current === p) await recargar();
      return '';
    } catch (e) {
      listasRevisadas.current.delete(p); // se reintenta la próxima vez que se abra
      return `Trello: no pude revisar las listas (${mensaje(e)}).`;
    }
  }, [recargar]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- consulta a Trello al abrir el proveedor (el estado cambia al responder)
  useEffect(() => { void revisarListas(prov); }, [prov, revisarListas]);

  /** Cambia las listas de Trello de donde salen las notas y vuelve a anotar dónde está cada tarjeta. */
  async function elegirListas(ids: string[]) {
    const p = prov;
    setOcupado('Guardando las listas de Trello…');
    try { await api({ accion: 'guardarListasTrello', listas: ids }); }
    catch (e) { setError(mensaje(e)); return; }
    finally { setOcupado(''); }
    // Las listas son de todo el tablero: los otros proveedores se vuelven a revisar al abrirlos.
    listasRevisadas.current.clear();
    const m = await revisarListas(p, true);
    if (!sigue(p)) return;
    await recargar();
    setAvisos([m || 'Listas de Trello guardadas. Para traer las notas de una lista nueva, tocá «Buscar notas nuevas en Trello».']);
  }

  // Las notas cuya tarjeta de Trello salió de las listas de pedidos pendientes no se eligen solas.
  const pedidosControl = useMemo(() => conEstadoTrello(datos.pedidos, datos.tarjetasTrello, hoyAr()), [datos.pedidos, datos.tarjetasTrello]);
  const res = useMemo(() => analizarControl(pedidosControl, datos, prov), [pedidosControl, datos, prov]);
  const resumen = useMemo(() => resumenPedidos(pedidosControl, res), [pedidosControl, res]);
  // Qué hacer con la tarjeta de cada nota hoy: finalizar, pasar a la lista de parciales o nada (la app no la mueve).
  const listaParcial = useMemo(() => listaDeParciales(listasTablero ?? []), [listasTablero]);
  const listaFinal = useMemo(() => listaFinalizado(listasTablero ?? [])?.nombre || '', [listasTablero]);
  const listaDe = useCallback((p: { origen?: string }) => datos.tarjetasTrello[tarjetaDeNota(p)]?.lista || '', [datos.tarjetasTrello]);
  const consejos = useMemo(() => {
    const out = new Map<string, ConsejoNota>();
    for (const p of pedidosControl) {
      try { out.set(p.id, consejoNota(marcasDeNota(res, null, pedidosControl, p.id), { listaActual: listaDe(p), listaParcial, listaFinal, completoPorTipo: prov === 'id', sinTipos: prov === 'target' })); } catch { /* sin datos */ }
    }
    return out;
  }, [res, pedidosControl, listaDe, listaParcial, listaFinal, prov]);
  const cerradas = useMemo(() => new Set(pedidosControl.filter((p) => p.cerradaDesde).map((p) => p.id)), [pedidosControl]);
  const nombrePedido = (id: string) => { const p = datos.pedidos.find((x) => x.id === id); return p ? (p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre) : id; };

  /**
   * Mueve solas las tarjetas de Trello de una entrega (14-nov-2026, gax: «que haga todo automático»):
   * con la factura subida, de pedidos pendientes a «RECIBIDO / CONTROL / CARGA»; con la entrega cerrada,
   * a «FINALIZADO» si llegó todo lo de la tarjeta o a pendientes de indumentaria/calzado si llegó una parte.
   * Usa datos frescos de la base y de Trello. Devuelve qué movió (o por qué no pudo), para mostrarlo.
   */
  async function avanzarTarjetas(p: Prov, facturaId: string): Promise<string[]> {
    if (esMarket(p)) return [];
    try {
      const r = await fetch('/api/trello?accion=tarjetas', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return d.sinTrello ? [] : [`Trello: no pude ver las tarjetas para moverlas (${d.error || `Error ${r.status}`}).`];
      const listas = (d.listas || []) as ListaTrello[];
      const tarjetas = (d.tarjetas || []) as TarjetaTrello[];
      if (sigue(p)) setListasTablero(listas);
      const frescos = { ...VACIO, ...(await api(undefined, p)) } as Datos;
      const ctrl = conEstadoTrello(frescos.pedidos, frescos.tarjetasTrello, hoyAr());
      const resF = analizarControl(ctrl, frescos, p);
      const rf = resF.facturas.find((x) => x.factura.id === facturaId);
      if (!rf) return [];
      const carga = p === 'id' || p === 'distrinando' || p === 'target' ? estadoCargaFactura(rf, frescos.cargas ?? {}, frescos.noLlego) : null;
      const cerrada = entregaArchivada(rf, carga, frescos.archivo?.[facturaId]?.estado, p !== 'distrinando');
      const pend = listasDePendientes(listas, frescos.listasTrello);
      const consejosDe = (tarjeta: string) => ctrl.filter((x) => tarjetaDeNota(x) === tarjeta).map((x) => {
        try {
          const c = consejoNota(marcasDeNota(resF, null, ctrl, x.id), { completoPorTipo: p === 'id', sinTipos: p === 'target' });
          return c.tipo === 'finalizar' && c.noEntro?.length ? 'cerrar' as const : c.tipo;
        } catch { return 'nada' as const; }
      });
      const plan = movimientosTarjetas({
        tarjetasEntrega: rf.pedidosCubiertos.map((id) => tarjetaDeNota(ctrl.find((x) => x.id === id))),
        tarjetas, listas, pendientes: new Set(pend.map((l) => l.id)), cerrada, consejos: consejosDe,
      });
      const hechos = [...plan.avisos];
      const movidas = new Map<string, ListaTrello>();
      for (const m of plan.mover) {
        try {
          await moverEnTrello(m.tarjeta, m.hacia.id);
          movidas.set(m.tarjeta, m.hacia);
          hechos.push(`Trello: pasé «${m.nombre}» de «${m.desde}» a «${m.hacia.nombre}» (${m.motivo}).`);
        } catch (e) { hechos.push(`Trello: no pude pasar «${m.nombre}» a «${m.hacia.nombre}» (${mensaje(e)}). Movela a mano.`); }
      }
      if (movidas.size && pend.length) {
        // Se anota dónde quedó cada tarjeta: una nota que pasó a «FINALIZADO» deja de elegirse sola.
        const nuevas = tarjetas.map((t) => (movidas.has(t.id) ? { ...t, idLista: movidas.get(t.id)!.id, lista: movidas.get(t.id)!.nombre } : t));
        const cambios = estadosTarjetas(frescos.pedidos, nuevas, new Set(pend.map((l) => l.id)), frescos.tarjetasTrello, hoyAr());
        if (Object.keys(cambios).length) await guardarEstados(p, cambios);
      }
      return hechos;
    } catch (e) { return [`Trello: no pude mover las tarjetas (${mensaje(e)}). Movelas a mano.`]; }
  }
  /** Mueve las tarjetas de la entrega y suma lo que pasó a los avisos de la pantalla. */
  async function avanzarYAvisar(p: Prov, facturaId: string) {
    const m = await avanzarTarjetas(p, facturaId);
    if (!sigue(p) || !m.length) return;
    await recargar();
    setAvisos((a) => [...a, ...m]);
  }

  /** Si cambia el remito, la vista previa de la carga de esa entrega ya no vale: se cierra. */
  function soltarPlan(facturaId: string) {
    setPlanCarga((p) => (p?.entregaId === facturaId ? null : p));
  }

  async function guardar(body: object) {
    setError('');
    try { await api({ proveedor: prov, ...body }); await recargar(); return true; }
    catch (e) { setError(mensaje(e)); return false; }
  }

  /** Lee un Excel de pedido. Devuelve el pedido listo para guardar, o por qué no se carga. */
  function prepararPedido(buf: ArrayBuffer, archivo: string, fecha: string, extra: { id?: string; nombre?: string; origen: string; enlace?: string; copia?: CopiaPlanilla; bajado?: Bajado; lineasPdf?: string[] },
    existentes: PedidoGuardado[]): { pedido?: PedidoGuardado; mensajes: string[]; descartado?: string; repetidoId?: string; leido?: { lineas: PedidoGuardado['lineas']; nroProveedor?: string } } {
    const nombre = extra.nombre || archivo.replace(/\.[^.]+$/, '');
    let r: { pedido: Omit<Pedido, 'id'>; nroProveedor: string; fechaArchivo: string; avisos: string[] };
    if (prov === 'target') {
      // Target (19-nov-2026): la nota es el PDF «Detalle de solicitud» de su web.
      if (!extra.lineasPdf) return { mensajes: [`${archivo}: la nota de Target es el PDF «Detalle de solicitud».`], descartado: 'no es un PDF' };
      // Un PDF que no es «Detalle de solicitud» es de otro proveedor (facturas de iD en sus tarjetas, 19-nov-2026):
      // no se muestra en Target y no se vuelve a bajar.
      if (!esPedidoTarget(extra.lineasPdf)) return { mensajes: [`${archivo}: no es una nota de pedido de Target («Detalle de solicitud»).`], descartado: 'es un pedido de otro proveedor' };
      r = leerPedidoTarget(extra.lineasPdf, nombre, fecha);
    } else {
      // Lo pintado en verde ya entró: la fecha es la de la copia (en Trello) o la de hoy (subida a mano).
      const { filas, hoja } = leerHoja(buf, extra.copia?.fecha || hoyAr(), extra.bajado);
      const auto = leerPedidoAuto(filas, '', nombre, fecha, hoja);
      if (auto.proveedor !== prov) {
        const otro = auto.proveedor === 'id' ? 'iD' : 'Distrinando';
        return { mensajes: [`${archivo}: parece de ${otro}; cambiá el proveedor arriba.`], descartado: `es un pedido de ${otro}` };
      }
      r = auto;
    }
    if (!r.pedido.lineas.length) return { mensajes: [`${archivo}: no tiene cantidades pedidas.`], descartado: 'no tiene cantidades pedidas' };
    // iD trae la fecha de la nota en la fila 1; si no, la que se eligió (o la de la tarjeta).
    const fechaNota = r.pedido.fecha;
    const id = extra.id || `P-${slug(r.nroProveedor || nombre)}-${fechaNota}`;
    // El mismo pedido cargado dos veces (a mano y desde Trello) duplicaría el saldo y taparía lo facturado sin pedir.
    const firma = (ls: { sku: string; cantidad: number }[]) => ls.map((l) => `${l.sku}:${l.cantidad}`).sort().join('|');
    const repetido = existentes.find((p) => p.id !== id && ((r.nroProveedor && p.nroProveedor === r.nroProveedor) || firma(p.lineas) === firma(r.pedido.lineas)));
    if (repetido) {
      const cual = repetido.nroProveedor ? `N° ${repetido.nroProveedor}` : repetido.nombre;
      return { mensajes: [`${archivo}: esta nota ya estaba cargada como «${cual}».`], descartado: `repite el pedido ${cual}`, repetidoId: repetido.id,
        leido: { lineas: r.pedido.lineas, nroProveedor: r.nroProveedor } };
    }
    const pedido = { ...r.pedido, id, nroProveedor: r.nroProveedor, origen: extra.origen, enlace: extra.enlace || '', lector: LECTOR_PLANILLA, ...(extra.copia ? { copias: [extra.copia] } : {}) };
    const verdes = r.pedido.lineas.reduce((s, l) => s + (l.entregado ?? 0), 0);
    return { pedido, mensajes: [`${archivo}: ${r.pedido.lineas.reduce((s, l) => s + l.cantidad, 0)} unidades guardadas con fecha ${fechaAr(fechaNota)}${r.fechaArchivo ? ' (la del archivo)' : ''}${verdes ? `; ${verdes} en verde (ya entraron)` : ''}.`, ...r.avisos] };
  }

  /** Sube notas de pedido. Si vienen desde una factura, quedan asignadas a esa factura. */
  async function subirPedidos(files: File[], fecha: string, paraFactura?: string) {
    const p = prov;
    const nuevos: string[] = [];
    const asignar: string[] = [];
    setOcupado('Leyendo la nota de pedido…');
    try {
      // Datos frescos: lo de la pantalla puede estar viejo (otra compu, una carga que falló) y repetiría una nota.
      let frescos: Datos;
      try { frescos = { ...VACIO, ...(await api(undefined, p)) } as Datos; }
      catch (e) { if (sigue(p)) setAvisos([`No pude leer las notas cargadas: ${mensaje(e)}`]); return; }
      const existentes = [...frescos.pedidos];
      for (const file of files) {
        try {
          const buf = await file.arrayBuffer();
          const lineas = p === 'target' && esPdf(file) ? await lineasPdf(buf) : undefined;
          const r = prepararPedido(buf, file.name, fecha, { origen: 'manual', lineasPdf: lineas }, existentes);
          if (r.pedido) { await api({ proveedor: p, accion: 'guardarPedido', pedido: r.pedido }); existentes.push(r.pedido); asignar.push(r.pedido.id); }
          else if (paraFactura && r.repetidoId) asignar.push(r.repetidoId); // ya estaba cargada: igual se asocia a esta factura
          nuevos.push(...r.mensajes);
        } catch (e) { nuevos.push(`${file.name}: ${mensaje(e)}`); }
      }
      if (paraFactura && asignar.length) {
        const previos = frescos.asignaciones[paraFactura] ?? [];
        await api({ proveedor: p, accion: 'guardarAsignacion', facturaId: paraFactura, pedidos: [...new Set([...previos, ...asignar])] });
        nuevos.push('La nota quedó asociada a esta factura.');
      }
    } catch (e) { nuevos.push(`No pude asociar la nota a la factura: ${mensaje(e)}`); }
    finally { setOcupado(''); }
    if (!sigue(p)) return;
    await recargar();
    setAvisos(nuevos);
  }

  /**
   * Revisa las tarjetas abiertas del tablero de Trello y carga como pedidos los Excel
   * nuevos de este proveedor. Cada Excel se baja una sola vez: los que no son pedidos
   * de este proveedor (o están repetidos, o se borraron a mano) quedan anotados.
   * Con una factura, «profunda» vuelve a revisar también los anotados (menos los que son
   * de otro proveedor): true siempre, 'si-falta' solo si ninguna nota tiene sus artículos.
   * Una nota borrada a mano (o una copia de ella en otra tarjeta) nunca vuelve sola.
   * Devuelve los avisos y un informe tarjeta por tarjeta, para ver qué pasó con cada Excel.
   */
  async function sincronizarTrello(opts: { factura?: Factura; profunda?: boolean | 'si-falta' } = {}): Promise<{ avisos: string[]; informe: InformeTrello }> {
    const { factura, profunda = false } = opts;
    const codigosFactura = new Set((factura?.renglones || []).map((x) => claveCodigo(x.codigo)));
    const deLaFactura = (lineas: { codigo: string }[]) => new Set(lineas.map((l) => claveCodigo(l.codigo)).filter((c) => codigosFactura.has(c))).size;
    const informe: InformeTrello = { prov, facturaId: factura?.id, hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }), tablero: '', tarjetas: 0, conExcel: 0, filas: [], otroProveedor: 0, sinRevisar: 0 };
    setOcupado('Buscando la nota de pedido en Trello…');
    try {
      // Datos frescos de la base: lo que hay en pantalla puede estar viejo (otra compu, una carga que falló).
      const frescos = { ...VACIO, ...(await api(undefined, prov)) } as Datos;
      const vistos = frescos.trelloVistos;
      const existentes = [...frescos.pedidos];
      const r = await fetch('/api/trello?accion=tarjetas', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.sinTrello ? 'Trello no está conectado (faltan las claves en Vercel).' : d.error || `Error ${r.status}`);
      // Target: la nota es un PDF; el resto de los proveedores, Excel.
      const todas = ((d.tarjetas || []) as TarjetaTrello[]).map((t) => (prov === 'target' ? { ...t, adjuntos: t.pdfs ?? [], otrosAdjuntos: [] } : t));
      const listas = (d.listas || []) as ListaTrello[];
      setListasTablero(listas);
      const deLista = listasDePendientes(listas, frescos.listasTrello);
      if (!deLista.length) throw new Error(sinListas(frescos.listasTrello));
      const pendientes = new Set(deLista.map((l) => l.id));
      // Solo las tarjetas de las listas de pedidos pendientes (gax, 11-nov-2026): las demás no traen notas.
      const tarjetas = todas.filter((t) => !!t.idLista && pendientes.has(t.idLista));
      Object.assign(informe, {
        tablero: String(d.tablero || ''), tarjetas: tarjetas.length, conExcel: tarjetas.filter((t) => t.adjuntos.length).length,
        listas: deLista.map((l) => l.nombre), fueraDeListas: todas.length - tarjetas.length,
      });
      // Una nota cuya tarjeta no está en esas listas no cuenta para decidir si la factura ya tiene nota.
      const enPendientes = new Set(tarjetas.map((t) => t.id));
      // Una nota repetida que se había cargado desde una tarjeta fuera de las listas de pendientes.
      const reubicable = (id: string) => {
        const x = existentes.find((p) => p.id === id);
        const t = tarjetaDeNota(x);
        return !!x && !!t && !enPendientes.has(t);
      };
      const vale = (p: PedidoGuardado) => {
        const t = tarjetaDeNota(p);
        // Igual que el control: también vale la nota cuya tarjeta salió después de la fecha de la factura.
        return !t || enPendientes.has(t) || (!!factura && notaDisponible(conEstadoTrello([p], frescos.tarjetasTrello, hoyAr())[0], factura.fecha));
      };
      // Notas borradas a mano, por número y por huella: una copia en otra tarjeta tampoco vuelve sola.
      const borradasNro = new Map<string, string>();
      const borradasHuella = new Map<string, string>();
      const anotarBorrada = (p: PedidoGuardado, tarjeta: string) => {
        if (p.nroProveedor && !borradasNro.has(p.nroProveedor)) borradasNro.set(p.nroProveedor, tarjeta);
        const h = huellaPedido(p.lineas);
        if (!borradasHuella.has(h)) borradasHuella.set(h, tarjeta);
      };
      for (const v of Object.values(vistos)) if (v.motivo === 'borrado a mano' || REPITE_BORRADA.test(v.motivo || '')) {
        if (v.nro) borradasNro.set(v.nro, 'una nota borrada');
        if (v.huella) borradasHuella.set(v.huella, 'una nota borrada');
      }
      const borradaIgual = (p: PedidoGuardado) => (p.nroProveedor && borradasNro.get(p.nroProveedor)) || borradasHuella.get(huellaPedido(p.lineas)) || '';
      const ofrecidas = new Set<string>(); // «Volver a cargar» una sola vez por nota
      const cargados: string[] = [];
      const fallas: string[] = [];
      let otros = 0;
      const fila = (t: TarjetaTrello, a: AdjuntoTrello, estado: EstadoTrello, detalle: string, extra: Partial<FilaTrello> = {}) =>
        informe.filas.push({ tarjeta: t.nombre, enlace: t.enlace, archivo: a.nombre, adjunto: a.id, estado, detalle, deEstaFactura: 0, ...extra });
      const borrada = (t: TarjetaTrello, a: AdjuntoTrello, p: PedidoGuardado, detalle: string) => {
        const h = huellaPedido(p.lineas);
        const ofrecer = !ofrecidas.has(h);
        ofrecidas.add(h);
        fila(t, a, 'borrada', ofrecer || detalle.includes('«') ? detalle : `${detalle} (la misma nota está en otra tarjeta de esta lista)`, { deEstaFactura: deLaFactura(p.lineas), pedido: ofrecer ? p : undefined });
      };
      // Vuelta 0: notas borradas a mano antes de guardar su huella, y copias de otra nota anotadas con un
      // lector anterior (se leen primero, para reconocer una nota borrada antes de cargar nada).
      // Vuelta 1: lo nuevo y lo descartado con un lector anterior. Vuelta 2: lo anotado, si hace falta.
      const fase0: { t: TarjetaTrello; a: AdjuntoTrello }[] = [];
      const fase1: { t: TarjetaTrello; a: AdjuntoTrello }[] = [];
      const fase2: { t: TarjetaTrello; a: AdjuntoTrello }[] = [];
      // Notas cargadas antes de que la app leyera el verde: se leen una vez más (solo las celdas y el verde).
      const faseVerdes: { t: TarjetaTrello; a: AdjuntoTrello; nota: PedidoGuardado }[] = [];
      for (const t of tarjetas) {
        for (const nombre of t.otrosAdjuntos || []) informe.filas.push({ tarjeta: t.nombre, enlace: t.enlace, archivo: nombre, estado: 'no es excel', detalle: 'no es un Excel subido a la tarjeta', deEstaFactura: 0 });
        for (const a of t.adjuntos) {
          const ya = existentes.find((p) => p.id === `T-${a.id}`);
          if (ya) {
            if ((ya.lector ?? 0) < LECTOR_PLANILLA) faseVerdes.push({ t, a, nota: ya });
            fila(t, a, 'ya estaba', 'nota ya cargada', { deEstaFactura: deLaFactura(ya.lineas) });
            continue;
          }
          const marca = vistos[a.id];
          if (marca?.motivo === 'borrado a mano') (marca.huella ? fase2 : fase0).push({ t, a });
          else if (!marca || (marca.version ?? 1) < LECTOR_TRELLO) (REPITE.test(marca?.motivo || '') ? fase0 : fase1).push({ t, a });
          else if (/: es un pedido de /.test(marca.motivo || '')) informe.otroProveedor++;
          else fase2.push({ t, a });
        }
      }
      // Si no se pudo bajar una nota borrada (o una copia anotada), esta vez no se carga ninguna nota
      // nueva: podría ser la misma. Se reintenta la próxima búsqueda.
      let sinRevisarBorradas = '';
      let enVerde = 0;
      // Otra copia de una nota ya cargada (la que el depósito marcó en verde, o la que devolvió la app):
      // se suma lo pintado en verde y las celdas. Si falla, se reintenta la próxima vez.
      const fusionar = async (pedidoId: string, lineas: PedidoGuardado['lineas'], copia: CopiaPlanilla) => {
        const i = existentes.findIndex((x) => x.id === pedidoId);
        if (i < 0) return;
        const antes = existentes[i].lineas.reduce((s, l) => s + (l.entregado ?? 0), 0);
        const nueva = fusionarPlanilla(existentes[i], lineas, copia, LECTOR_PLANILLA);
        if (!nueva) return;
        await api({ proveedor: prov, accion: 'guardarPedido', pedido: nueva });
        existentes[i] = nueva;
        enVerde += Math.max(0, nueva.lineas.reduce((s, l) => s + (l.entregado ?? 0), 0) - antes);
      };
      const copiaDe = (t: TarjetaTrello, a: AdjuntoTrello, b: Bajado): CopiaPlanilla => ({ tarjeta: t.id, adjunto: a.id, fecha: b.fecha || a.fecha || hoyAr(), nombre: a.nombre });
      const procesar = async (lista: { t: TarjetaTrello; a: AdjuntoTrello }[], primero = false) => {
        const LOTE = 4;
        for (let i = 0; i < lista.length; i += LOTE) {
          setOcupado(`Leyendo los Excel de Trello: ${Math.min(i + LOTE, lista.length)} de ${lista.length}…`);
          const lote = lista.slice(i, i + LOTE);
          const bajados = await Promise.all(lote.map(({ t, a }) => bajarAdjunto(t.id, a.id).then((b) => b, (e) => e as Error)));
          for (let j = 0; j < lote.length; j++) {
            const { t, a } = lote[j];
            const bajado = bajados[j];
            const marca = vistos[a.id];
            // Falla de red: no se anota, se reintenta la próxima vez.
            if (bajado instanceof Error) {
              // Un archivo que no existe más o es demasiado grande no se va a poder leer nunca: no frena el resto.
              const definitivo = [400, 403, 404, 413].includes((bajado as Error & { status?: number }).status ?? 0);
              if (primero && !definitivo && !sinRevisarBorradas) sinRevisarBorradas = `«${t.nombre}» ${a.nombre}`;
              fallas.push(`«${t.nombre}» ${a.nombre}: ${bajado.message}`); fila(t, a, 'falla', `no lo pude bajar: ${bajado.message}`); continue;
            }
            const copia = copiaDe(t, a, bajado);
            let leidas = 0;
            try {
              let res: ReturnType<typeof prepararPedido>;
              try {
                const lineas = bajado.pdf ? await lineasPdf(bajado.buf) : undefined;
                res = prepararPedido(bajado.buf, a.nombre, t.inicio || t.creada, { id: `T-${a.id}`, nombre: t.nombre, origen: `trello:${t.id}`, enlace: t.enlace, copia, bajado, lineasPdf: lineas }, existentes);
              } catch (e) { res = { mensajes: [], descartado: `no es un pedido (${mensaje(e)})` }; }
              const leido = res.pedido || res.leido;
              leidas = leido ? deLaFactura(leido.lineas) : 0;
              // Si falla anotar, no importa: se vuelve a leer la próxima vez.
              const anotar = (motivo: string, firma?: { lineas: PedidoGuardado['lineas']; nroProveedor?: string }) =>
                api({ proveedor: prov, accion: 'marcarTrelloVisto', adjunto: a.id, motivo, version: LECTOR_TRELLO, ...(firma ? { nro: firma.nroProveedor, huella: huellaPedido(firma.lineas) } : {}) }).catch(() => undefined);
              if (res.pedido && marca?.motivo === 'borrado a mano') {
                // La borraste de Pedidos: no vuelve sola, pero se avisa si es de esta factura.
                anotarBorrada(res.pedido, t.nombre);
                borrada(t, a, res.pedido, 'la borraste de Pedidos');
                if (!marca.huella) await anotar('borrado a mano', res.pedido);
              } else if (res.pedido && (borradaIgual(res.pedido) || REPITE.test(marca?.motivo || ''))) {
                // Copia de una nota borrada a mano: tampoco vuelve sola. Si antes repetía una nota que ya
                // no está en Pedidos, esa nota se borró a mano.
                const de = borradaIgual(res.pedido);
                anotarBorrada(res.pedido, t.nombre);
                otros++;
                borrada(t, a, res.pedido, de ? `es la misma nota que borraste de Pedidos${de !== 'una nota borrada' ? ` («${de}»)` : ''}` : 'repetía una nota que ya no está en Pedidos (la borraste)');
                await anotar(`«${t.nombre}» ${a.nombre}: repite una nota que borraste de Pedidos`, res.pedido);
              } else if (res.pedido && sinRevisarBorradas) {
                fallas.push(`«${t.nombre}» ${a.nombre}: no la cargo todavía`);
                fila(t, a, 'falla', `no la cargo todavía: no pude bajar ${sinRevisarBorradas}, que repite o es una nota que borraste de Pedidos, y podría ser esta misma. Se reintenta la próxima vez.`, { deEstaFactura: leidas });
              } else if (res.pedido) {
                await api({ proveedor: prov, accion: 'guardarPedido', pedido: res.pedido });
                existentes.push(res.pedido);
                cargados.push(`«${t.nombre}»`);
                fila(t, a, 'cargada', 'nota cargada ahora', { deEstaFactura: leidas });
              } else if (res.repetidoId && reubicable(res.repetidoId)) {
                // La misma nota ya estaba cargada desde una tarjeta que no está en las listas de pendientes
                // (p. ej. las que se bajaron todas juntas el 11-nov): pasa a ser de esta tarjeta, que sí lo está.
                const i = existentes.findIndex((x) => x.id === res.repetidoId);
                const movida = { ...existentes[i], origen: `trello:${t.id}`, enlace: t.enlace };
                await api({ proveedor: prov, accion: 'guardarPedido', pedido: movida });
                existentes[i] = movida;
                if (res.leido) await fusionar(res.repetidoId, res.leido.lineas, copia);
                await anotar(`«${t.nombre}» ${a.nombre}: ${res.descartado}`);
                fila(t, a, 'ya estaba', `${res.descartado}: estaba cargada desde una tarjeta de otra lista y ahora queda asociada a esta`, { deEstaFactura: leidas });
              } else if (res.descartado === 'es un pedido de otro proveedor') {
                // Target: un PDF de otro proveedor (iD) no se lista; solo se cuenta.
                await anotar(`«${t.nombre}» ${a.nombre}: ${res.descartado}`);
                otros++;
                informe.otroProveedor++;
              } else {
                if (res.repetidoId && res.leido) await fusionar(res.repetidoId, res.leido.lineas, copia);
                if (marca?.motivo !== 'borrado a mano') await anotar(`«${t.nombre}» ${a.nombre}: ${res.descartado}`);
                otros++;
                const legible = /^(es un pedido de|repite )/.test(res.descartado || '');
                fila(t, a, legible ? 'otra' : 'ilegible', legible ? res.descartado || '' : `no la pude leer como nota: ${res.descartado}`, { deEstaFactura: leidas });
              }
            } catch (e) {
              // No se pudo guardar: se sigue con las demás y se reintenta la próxima vez.
              fallas.push(`«${t.nombre}» ${a.nombre}: ${mensaje(e)}`);
              fila(t, a, 'falla', `no la pude guardar: ${mensaje(e)}`, { deEstaFactura: leidas });
            }
          }
        }
      };
      await procesar(fase0, true);
      await procesar(fase1);
      for (let i = 0; i < faseVerdes.length; i += 4) {
        setOcupado(`Leyendo lo marcado en verde en las notas: ${Math.min(i + 4, faseVerdes.length)} de ${faseVerdes.length}…`);
        const lote = faseVerdes.slice(i, i + 4);
        const bajados = await Promise.all(lote.map(({ t, a }) => bajarAdjunto(t.id, a.id).then((b) => b, (e) => e as Error)));
        for (let j = 0; j < lote.length; j++) {
          const { t, a, nota } = lote[j];
          const b = bajados[j];
          if (b instanceof Error) continue; // se reintenta la próxima vez
          try {
            const copia = copiaDe(t, a, b);
            const { filas, hoja } = leerHoja(b.buf, copia.fecha, b);
            const leida = leerPedidoAuto(filas, nota.id, nota.nombre, nota.fecha, hoja);
            await fusionar(nota.id, leida.pedido.lineas, copia);
          } catch { /* no se pudo leer otra vez: queda como estaba */ }
        }
      }
      const cubierta = () => existentes.some((p) => vale(p) && deLaFactura(p.lineas) > 0);
      if (factura && fase2.length && (profunda === true || (profunda === 'si-falta' && !cubierta()))) await procesar(fase2);
      else informe.sinRevisar += fase2.length;
      informe.cubierta = !!factura && cubierta();
      // En qué lista está cada tarjeta con notas: las que salieron de las de pendientes dejan de elegirse solas.
      let errorListas = '';
      try { await guardarEstados(prov, estadosTarjetas(existentes, todas, pendientes, frescos.tarjetasTrello, hoyAr())); }
      catch (e) { errorListas = `Trello: no pude anotar en qué lista está cada tarjeta (${mensaje(e)}); se reintenta la próxima vez.`; }
      // Con muchas notas nuevas no se listan todas: el detalle está en la entrega.
      const out = !cargados.length ? []
        : cargados.length <= 5 ? [`Trello: traje ${cargados.length} nota(s) de pedido nueva(s): ${cargados.join(', ')}.`]
        : [`Trello: traje ${cargados.length} notas de pedido nuevas (${cargados.slice(0, 3).join(', ')} y ${cargados.length - 3} más).${factura ? ' Las que tienen artículos de esta factura están en el detalle de la entrega.' : ''}`];
      if (otros) out.push(`Trello: ${otros} Excel no eran notas nuevas de este proveedor (otro proveedor, repetidas, borradas o ilegibles).`);
      if (enVerde) out.push(`Trello: ${enVerde} unidad(es) marcadas en verde en las planillas cuentan ahora como ya entregadas.`);
      if (fallas.length) out.push(`Trello: no pude bajar o guardar ${fallas.length} Excel (${fallas.slice(0, 2).join('; ')}); se reintenta la próxima vez.`);
      if (errorListas) out.push(errorListas);
      const borradas = informe.filas.filter((f) => f.estado === 'borrada' && f.pedido && f.deEstaFactura > 0);
      if (borradas.length) out.push(`Trello: ${borradas.map((f) => `«${f.tarjeta}»`).join(', ')} tiene(n) artículos de esta factura pero la(s) borraste de Pedidos: abrí la entrega y tocá «Volver a cargar».`);
      const ilegibles = informe.filas.filter((f) => f.estado === 'ilegible' || f.estado === 'falla').length;
      if (factura && !cubierta() && !informe.filas.some((f) => f.deEstaFactura > 0)) out.push(`Trello: revisé ${informe.conExcel} tarjeta(s) con ${prov === 'target' ? 'PDF' : 'Excel'} y ninguna de las notas que pude leer tiene artículos de la factura ${factura.numero}.${ilegibles ? ` ${ilegibles} archivo(s) no los pude leer.` : ''} El detalle de cada tarjeta está en la entrega.`);
      return { avisos: out, informe };
    } catch (e) {
      informe.error = mensaje(e);
      return { avisos: [`Trello: ${mensaje(e)} Se controló con las notas ya cargadas.`], informe };
    } finally { setOcupado(''); }
  }

  async function buscarEnTrello() {
    const p = prov;
    const { avisos: m, informe: inf } = await sincronizarTrello();
    if (!sigue(p)) return;
    await recargar();
    setInforme(inf);
    setAvisos(m.length ? m : ['Trello: no hay notas de pedido nuevas de este proveedor.']);
  }

  /** Desde una entrega sin nota: revisa de nuevo TODOS los Excel de Trello buscando los artículos de esa factura. */
  async function buscarEnTrelloParaFactura(factura: Factura) {
    const p = prov;
    const { avisos: m, informe: inf } = await sincronizarTrello({ factura, profunda: true });
    if (!sigue(p)) return;
    await recargar();
    setInforme(inf);
    setAvisos(m.length ? m : ['Trello: no hay notas de pedido nuevas de este proveedor.']);
    setAbierta(factura.id);
    await avanzarYAvisar(p, factura.id);
  }

  /** Vuelve a cargar una nota de Trello que se había borrado a mano (si no está ya cargada de otra forma). */
  async function recargarBorrada(f: FilaTrello) {
    const ped = f.pedido;
    // La nota es del proveedor de la búsqueda: nunca se guarda en otro.
    const p = informe?.prov;
    if (!ped || !p || !sigue(p) || !informe?.filas.includes(f)) return;
    const marcar = (estado: EstadoTrello, detalle: string) =>
      setInforme((inf) => inf && { ...inf, filas: inf.filas.map((x) => (x === f ? { ...x, estado, detalle, pedido: undefined } : x)) });
    setOcupado('Cargando la nota de nuevo…');
    try {
      const frescos = { ...VACIO, ...(await api(undefined, p)) } as Datos;
      const h = huellaPedido(ped.lineas);
      const igual = frescos.pedidos.find((x) => x.id !== ped.id && ((ped.nroProveedor && x.nroProveedor === ped.nroProveedor) || huellaPedido(x.lineas) === h));
      if (igual) {
        const cual = igual.nroProveedor ? `N° ${igual.nroProveedor}` : igual.nombre;
        marcar('ya estaba', `ya está cargada como «${cual}»`);
        setAvisos([`La nota «${f.tarjeta}» ya está cargada como «${cual}»: no la cargo dos veces.`]);
      } else {
        await api({ proveedor: p, accion: 'guardarPedido', pedido: ped, recargar: true });
        marcar('cargada', 'nota cargada de nuevo');
        setAvisos([`Nota «${f.tarjeta}» cargada de nuevo.`]);
      }
    } catch (e) { setAvisos([`No pude cargar la nota «${f.tarjeta}»: ${mensaje(e)}`]); }
    finally { setOcupado(''); }
    if (sigue(p)) await recargar();
  }

  /** Lee la foto del remito y la guarda en la factura. Si no se puede, deja el error para escribirlo a mano. */
  async function remitoDeFotos(facturaId: string, files: File[]): Promise<string[]> {
    setOcupado('Leyendo la foto del remito… (puede tardar un minuto)');
    try {
      const remito = await leerFotos<Remito>(files);
      await api({ proveedor: prov, accion: 'guardarRemito', facturaId, remito });
      const u = remito.renglones.reduce((s, r) => s + r.cantidad, 0);
      return [`Remito ${remito.numero || ''} leído de la foto: ${remito.renglones.length} artículos, ${u} unidades.${remito.dudas?.length ? ' Revisá las dudas que marqué.' : ''}`];
    } catch (e) {
      return [`No pude leer la foto del remito: ${mensaje(e)} Abrí la entrega y escribilo con «✏️ Escribirlo».`];
    } finally { setOcupado(''); }
  }

  // -------------------------------------------------------------------------
  // CARGA EN SHOPIFY (iD, 12-nov-2026): lo que llegó se suma en DEPOSITO MARTINEZ, con precio y
  // costo de la factura. Misma ejecución y misma marca «una sola vez» que Family (cargaFamily.ts).
  // -------------------------------------------------------------------------
  /** Vista previa: lee Shopify y la base en el momento. No escribe nada. */
  async function armarCarga(r: ResultadoFactura) {
    if (!r.remito) { setAvisos(['Para cargar en Shopify primero subí o escribí el remito.']); return; }
    const p = prov;
    setPlanCarga(null); setAvisos([]); setError('');
    setOcupado('Busco los artículos en Shopify para armar la carga…');
    try {
      const d = await api(undefined, p);
      const dis = p === 'distrinando' || p === 'target';
      // iD: lo que no entró de las notas de esta entrega (17-nov-2026, gax). Se leen también esos productos para
      // mostrar las ventas que lo esperan.
      const faltan = dis ? [] : noEntroDeEntrega(r.factura.id, d, p);
      const codigos = [...r.checklist.map((c) => c.codigo), ...faltan.map((x) => x.codigo)];
      const estado = await leerEstadoCargaId(codigos, shopifyGraphQL, dis ? { ventasId: false, pos: true } : {});
      if (!sigue(p)) return;
      setDatos({ ...VACIO, ...d });
      // Lo que ya se sacó antes porque no llegó sigue sacado (queda guardado).
      const quitados = new Set(Object.keys(d.noLlego ?? {}).filter((k) => k.startsWith(`${r.factura.id}|`)).map((k) => k.slice(r.factura.id.length + 1)));
      baseCarga.current = { prov: p, r, estado, cargas: d.cargas ?? {}, modos: new Map(), cantidades: new Map(), pedidos: d.pedidos ?? [], tablas: new Map(), destinos: new Map(), skus: new Map(), quitados, packs: new Map(), colores: new Map(),
        ...(faltan.length ? { noEntraron: noEntraronId(faltan, estado) } : {}) };
      rearmar();
    } catch (e) { if (sigue(p)) setAvisos([`No pude armar la carga: ${mensaje(e)} No se cargó nada.`]); }
    finally { setOcupado(''); }
  }

  /** Vuelve a armar la vista previa con lo elegido, sin volver a leer Shopify. */
  function rearmar() {
    const b = baseCarga.current;
    if (!b) return;
    if (b.prov === 'target') {
      // Target: sin talles; la cantidad escrita a mano va en «u.».
      const cant = new Map<string, number>();
      for (const [c, x] of b.cantidades) if (x['u.'] !== undefined) cant.set(c, x['u.']);
      setPlanCarga({ ...planCargaTarget(b.r, b.estado, b.cargas, cant, new Map(b.colores)), quitados: [...b.quitados] });
      return;
    }
    setPlanCarga(b.prov === 'distrinando'
      ? { ...planCargaDistrinando(b.r, b.estado, b.cargas, b.pedidos, new Map(b.tablas), new Map(b.cantidades), new Map(b.destinos), new Map(b.skus)), quitados: [...b.quitados] }
      : { ...planCargaId(b.r, b.estado, b.cargas, new Map(b.modos), new Map(b.cantidades), new Map(b.packs), new Map(b.tablas), new Map(b.destinos)), quitados: [...b.quitados],
        ...(b.noEntraron ? { noEntraron: b.noEntraron } : {}) });
  }

  /** Lo vendido en iD: separarlo (por defecto), cargarlo igual (si ya se separó antes) o cargarlo y pasar la venta a Martínez. */
  function modoVenta(codigo: string, modo: ModoVenta) {
    const b = baseCarga.current;
    if (!b) return;
    if (modo === 'separar') b.modos.delete(codigo); else b.modos.set(codigo, modo);
    rearmar();
  }

  /** Cantidad escrita a mano para un talle (12-nov-2026, gax): viene la del remito y se puede cambiar antes de confirmar. */
  function cantidadCarga(codigo: string, talle: string, n: number) {
    const b = baseCarga.current;
    if (!b) return;
    b.cantidades.set(codigo, { ...(b.cantidades.get(codigo) ?? {}), [talle]: n });
    rearmar();
  }

  /**
   * iD: unidades por pack escritas a mano (13-nov-2026, gax: «la factura dice por 6, es porque son 6 bandas»);
   * undefined = lo que detecta la app. Las cantidades escritas antes eran de otro pack: vuelven a las del remito.
   */
  function packCarga(codigo: string, n: number | undefined) {
    const b = baseCarga.current;
    if (!b) return;
    if (n === undefined) b.packs.delete(codigo); else b.packs.set(codigo, n);
    b.cantidades.delete(codigo);
    rearmar();
  }

  /** Target (20-nov-2026, gax): los colores de un artículo y sus unidades (null = un solo producto, sin colores). */
  function coloresCarga(codigo: string, colores: ColorTarget[] | null) {
    const b = baseCarga.current;
    if (!b) return;
    if (colores) b.colores.set(codigo, colores); else b.colores.delete(codigo);
    rearmar();
  }

  /** La tabla de talle elegida para un modelo (Distrinando 13-nov-2026; iD, Converse sin etiqueta, 17-nov-2026). */
  function tablaCarga(codigo: string, tabla: string) {
    const b = baseCarga.current;
    if (!b) return;
    b.tablas.set(codigo, tabla);
    rearmar();
  }

  /** El talle de Shopify donde entra un talle que llegó, elegido a mano ('' = automático). Distrinando y, desde el 19-nov-2026, iD. */
  function destinoCarga(codigo: string, talle: string, destino: string) {
    const b = baseCarga.current;
    if (!b) return;
    const x = { ...(b.destinos.get(codigo) ?? {}) };
    if (destino) x[talle] = destino; else delete x[talle];
    b.destinos.set(codigo, x);
    rearmar();
  }

  /** Distrinando: SKU escrito o escaneado a mano para un talle ('' = el que tiene). */
  function skuCarga(codigo: string, talle: string, sku: string) {
    const b = baseCarga.current;
    if (!b) return;
    const x = { ...(b.skus.get(codigo) ?? {}) };
    if (sku) x[talle] = sku; else delete x[talle];
    b.skus.set(codigo, x);
    rearmar();
  }

  /** Distrinando: quitar un talle agregado a mano (no está en el remito). */
  function quitarTalle(codigo: string, talle: string) {
    const b = baseCarga.current;
    if (!b) return;
    for (const m of [b.cantidades, b.destinos, b.skus] as Map<string, Record<string, unknown>>[]) {
      const x = { ...(m.get(codigo) ?? {}) };
      delete x[talle];
      m.set(codigo, x);
    }
    rearmar();
  }

  /**
   * Sacar un artículo de la carga porque no llegó (entra en el mail), o volver a agregarlo. Queda guardado
   * (14-nov-2026): la entrega lo cuenta como terminado y, si todo lo demás está cargado, pasa a las cerradas.
   */
  async function quitarArticulo(facturaId: string, codigo: string, quitar: boolean) {
    const p = prov;
    setError('');
    try { await api({ proveedor: p, accion: 'marcarNoLlego', entregaId: facturaId, codigo, noLlego: quitar }); }
    catch (e) { if (sigue(p)) setError(`No pude guardar que ${codigo} ${quitar ? 'no llegó' : 'llegó'}: ${mensaje(e)}`); return; }
    if (!sigue(p)) return;
    setDatos((d) => {
      const x = { ...(d.noLlego ?? {}) };
      if (quitar) x[`${facturaId}|${codigo}`] = { fecha: new Date().toISOString() }; else delete x[`${facturaId}|${codigo}`];
      return { ...d, noLlego: x };
    });
    // Si era lo último que faltaba, la entrega se cierra: la tarjeta de Trello avanza sola.
    if (quitar) void avanzarYAvisar(p, facturaId);
    const b = baseCarga.current;
    if (!b || b.r.factura.id !== facturaId) return;
    if (quitar) b.quitados.add(codigo); else b.quitados.delete(codigo);
    rearmar();
  }

  /**
   * Adjunta la factura y las fotos del remito a la(s) tarjeta(s) de Trello de la entrega (14-nov-2026, gax:
   * «que escriba las tarjetas y ponga las fotos de los remitos y la factura»). Sin archivos elegidos, usa los
   * que se subieron en esta pantalla. Lo que la tarjeta ya tiene con el mismo nombre no se sube otra vez.
   */
  async function subirATrello(r: ResultadoFactura, elegidos?: File[]) {
    const files = elegidos?.length ? elegidos : archivosEntrega.current.get(r.factura.id) ?? [];
    const tarjetas = [...new Set(r.pedidosCubiertos.map((id) => tarjetaDeNota(datos.pedidos.find((p) => p.id === id))).filter(Boolean))];
    if (!files.length || !tarjetas.length) return;
    const nombres = tarjetas.map((t) => datos.pedidos.find((p) => tarjetaDeNota(p) === t)?.nombre || t);
    if (!confirm(`Se ${files.length === 1 ? 'adjunta 1 archivo' : `adjuntan ${files.length} archivos`} (${files.map((f) => f.name).join(', ')}) a ${tarjetas.length === 1 ? 'la tarjeta' : 'las tarjetas'} de Trello: ${nombres.join(', ')}. ¿Confirmás?`)) return;
    setError(''); setAvisos([]);
    setOcupado('Subiendo a Trello…');
    const hechos: string[] = [];
    try {
      const archivos = await archivosParaTrello(files, r.factura.numero, r.remito?.numero || r.factura.remito || '', esFotoFactura);
      for (const [i, t] of tarjetas.entries()) {
        const subidos: string[] = [], ya: string[] = [];
        for (const a of archivos) { const x = await adjuntarATrello(t, a); (x.yaEstaba ? ya : subidos).push(x.nombre); }
        hechos.push(`Trello «${nombres[i]}»: ${subidos.length ? `adjunté ${subidos.join(', ')}` : 'no subí nada nuevo'}${ya.length ? ` (ya tenía ${ya.join(', ')})` : ''}.`);
      }
      setAvisos(hechos);
    } catch (e) { setAvisos([...hechos, `No pude subir a Trello: ${mensaje(e)}`]); }
    finally { setOcupado(''); }
  }

  /** Dar una entrega por cerrada (pasa al apartado verde) o volver a abrirla. */
  async function archivar(r: ResultadoFactura, estado: 'cerrada' | 'abierta') {
    if (estado === 'cerrada' && !confirm(`¿Dar por cerrada la entrega de la factura ${r.factura.numero}? Pasa al apartado verde de cargadas; la podés volver a abrir cuando quieras. No cambia nada en Shopify.`)) return;
    if (estado === 'cerrada') { soltarPlan(r.factura.id); setAbierta(null); }
    setVerCerrada(null);
    const p = prov;
    if (await guardar({ accion: 'archivarEntrega', entregaId: r.factura.id, estado }) && estado === 'cerrada') await avanzarYAvisar(p, r.factura.id);
  }

  /** El mail de diferencias con el remito (talles distintos y lo que no llegó). */
  function armarMailTalles(r: ResultadoFactura, plan: PlanCarga, resultados: Parameters<typeof diferenciasDeTalles>[1], p: Prov) {
    const difs = diferenciasDeTalles(plan.items, resultados, netosDeCarga(plan.items, r.factura.renglones), new Set(plan.quitados ?? []));
    const fecha = hoyAr().split('-').reverse().join('/');
    const proveedor = PROVS.find((x) => x.id === p)?.nombre ?? p;
    setAvisoTalles(difs.length ? textoAvisoTalles(difs, { proveedor, factura: r.factura.numero, remito: r.remito?.numero, fecha }) : null);
  }

  async function confirmarCarga(r: ResultadoFactura, plan: PlanCarga, elecciones: EleccionesCarga) {
    const res = resumenCarga(plan, elecciones);
    if (!res.lineas.length) return;
    const texto = [`Se va a cargar en Shopify (${SUCURSAL_CARGA_ID}):`, ...res.lineas, '',
      `${res.altas ? `${res.altas} producto(s) nuevo(s) y ` : ''}${res.reposiciones} reposición(es), ${res.unidades} unidades en total.`,
      'El precio y el costo se cambian antes de sumar el stock.' + (res.lineas.some((l) => l.includes('pasar la venta')) ? ' Después de sumar el stock, las ventas marcadas pasan de iD a Martínez.' : '') + ' ¿Confirmás?'].join('\n');
    if (!confirm(texto)) return;
    const p = prov, eid = plan.entregaId, factura = r.factura.numero;
    const elegidas = accionesElegidas(plan, elecciones);
    const salen = ordenesQueSalen(plan, elecciones);
    setAvisoPrecio(null); setAvisoTalles(null); setAvisoAdmin(null); setOrdenesCarga([]); setNoEntraronCarga(null); setResultadoCarga(null); setAvisos([]);
    setOcupado('Cargando en Shopify… no cierres esta página.');
    try {
      const resultados = await ejecutarCargaFamily(plan, elecciones, {
        gql: shopifyGraphQL,
        reservar: (codigo, firma, detalle) => api({ proveedor: p, accion: 'reservarCarga', entregaId: eid, codigo, firma, detalle, factura }),
        terminar: async (codigo, estado, detalle) => { await api({ proveedor: p, accion: 'terminarCarga', entregaId: eid, codigo, estado, detalle }); },
        liberar: async (codigo) => { await api({ proveedor: p, accion: 'liberarCarga', entregaId: eid, codigo }); },
        clave: () => crypto.randomUUID(),
        onProgreso: (h, t) => setOcupado(`Cargando en Shopify… ${h} de ${t}. No cierres esta página.`),
        antes: precioYCostoAntes(actualizarPreciosManualmente),
      });
      if (sigue(p)) {
        setResultadoCarga({ resultados, conVentas: p === 'id' });
        setOrdenesCarga(salen);
        if (plan.noEntraron?.length) setNoEntraronCarga({ items: plan.noEntraron, factura: factura || '' });
        const cambios = cambiosDePrecio(elegidas, resultados);
        const fecha = hoyAr().split('-').reverse().join('/');
        const proveedor = PROVS.find((x) => x.id === p)?.nombre ?? p;
        if (cambios.length) setAvisoPrecio({ cambios, ...textoAvisoPrecio(cambios, { proveedor, factura, remito: r.remito?.numero, fecha }) });
        armarMailTalles(r, plan, resultados, p);
        await avisarCarga(p, r, resultados);
      }
      setPlanCarga(null);
    } catch (e) { if (sigue(p)) setAvisos([`La carga se cortó: ${mensaje(e)} Revisá en Shopify qué quedó cargado antes de volver a intentar.`]); }
    finally { setOcupado(''); if (sigue(p)) await recargar(); }
    // Con la carga terminada, la entrega se cierra sola y la tarjeta de Trello pasa a su lista.
    if (sigue(p)) await avanzarYAvisar(p, eid);
  }

  /**
   * Después de una carga (16-nov-2026, gax: «que la app cargue la carga en Trello y avise a administración»):
   * comenta lo cargado en la tarjeta de cada nota de la entrega (automático) y arma el mail a administración
   * con los datos de la planilla de ingreso (lo envía la persona).
   */
  async function avisarCarga(p: Prov, r: ResultadoFactura, resultados: ResultadoCarga[]) {
    if (esMarket(p)) return;
    const algo = resultados.some((x) => (x.detalle?.sumados.length ?? 0) > 0 || (x.detalle?.pasadas.length ?? 0) > 0);
    if (!algo) return;
    const datosAviso = { prov: p, r, resultados, sucursal: SUCURSAL_CARGA_ID, hoy: hoyAr(), ingreso: fechaIngreso(r.factura, r.remito).fecha };
    setAvisoAdmin(textoAvisoAdmin(datosAviso));
    const hechos: string[] = [];
    // Fila en la planilla «CONTROL INGRESO MERCADERIA» (16-nov-2026, gax): la agrega sola; si esa factura
    // ya está anotada (otra carga de la misma entrega), no la repite.
    try {
      const a = await anotarEnPlanilla(filaPlanilla(datosAviso));
      if (a.sinPlanilla) hechos.push('Planilla de ingreso: todavía no está conectada (ver «Planilla de ingreso» en Notas de pedido).');
      else if (a.yaEstaba) hechos.push(`Planilla de ingreso: la factura ${r.factura.numero} ya estaba anotada${a.fila ? ` (fila ${a.fila})` : ''}.`);
      else hechos.push(`Planilla de ingreso: agregué la factura ${r.factura.numero}${a.fila ? ` en la fila ${a.fila}` : ''}.`);
    } catch (e) { hechos.push(`Planilla de ingreso: no pude agregar la fila (${mensaje(e)}). Cargala a mano.`); }
    const tarjetas = [...new Set(r.pedidosCubiertos.map((id) => tarjetaDeNota(datos.pedidos.find((x) => x.id === id))).filter(Boolean))];
    if (!tarjetas.length) { if (sigue(p)) setAvisos((a) => [...a, ...hechos]); return; }
    const texto = comentarioTrello(datosAviso);
    // Factura y fotos del remito a la tarjeta, solas (19-nov-2026, gax: «le cargué yo las fotos del remito y la
    // factura; no las está subiendo»). Solo los archivos subidos en esta pantalla (no se guardan en la base);
    // lo que la tarjeta ya tiene con el mismo nombre no se sube otra vez.
    const files = archivosEntrega.current.get(r.factura.id) ?? [];
    let archivos: Awaited<ReturnType<typeof archivosParaTrello>> = [];
    if (files.length) {
      try { archivos = await archivosParaTrello(files, r.factura.numero, r.remito?.numero || r.factura.remito || '', esFotoFactura); }
      catch (e) { hechos.push(`Trello: no pude preparar la factura y las fotos del remito (${mensaje(e)}). Subilas con «📎 Subir factura y remito a Trello».`); }
    } else hechos.push('Trello: la factura y las fotos del remito no se subieron porque no están en esta pantalla (se recargó la página). Subilas con «📎 Subir factura y remito a Trello».');
    for (const t of tarjetas) {
      const nombre = datos.pedidos.find((x) => tarjetaDeNota(x) === t)?.nombre ?? 'la tarjeta';
      try { await comentarEnTrello(t, texto); hechos.push(`Trello: dejé en «${nombre}» el comentario con lo cargado.`); }
      catch (e) { hechos.push(`Trello: no pude comentar en «${nombre}» lo cargado (${mensaje(e)}).`); }
      if (!archivos.length) continue;
      const subidos: string[] = [];
      try {
        for (const a of archivos) { const x = await adjuntarATrello(t, a); if (!x.yaEstaba) subidos.push(x.nombre); }
        if (subidos.length) hechos.push(`Trello: adjunté en «${nombre}» ${subidos.join(', ')}.`);
      } catch (e) { hechos.push(`Trello: no pude adjuntar en «${nombre}» la factura y el remito (${mensaje(e)})${subidos.length ? `; ya había subido ${subidos.join(', ')}` : ''}.`); }
    }
    if (sigue(p)) setAvisos((a) => [...a, ...hechos]);
  }

  async function liberarCarga(entregaId: string, codigo: string, c: CargaFamily) {
    const aviso = c.estado === 'cargada'
      ? `${codigo} figura como cargado en Shopify. Si liberás la marca, la app lo deja cargar OTRA VEZ (sumaría el stock dos veces). ¿Seguro?`
      : `${codigo}: ${textoCarga(c)}\n\nAntes de liberar, mirá en Shopify si quedó cargado y corregilo a mano si hace falta. Si liberás, la app lo deja cargar de nuevo. ¿Liberar?`;
    if (!confirm(aviso)) return;
    setPlanCarga(null);
    // manual: queda anotada en el registro de cargas.
    await guardar({ accion: 'liberarCarga', entregaId, codigo, manual: true });
  }

  async function fotosParaFactura(facturaId: string, files: File[]) {
    const p = prov;
    recordar(facturaId, files, true);
    const m = await remitoDeFotos(facturaId, files);
    if (!sigue(p)) return;
    await recargar();
    setAvisos(m);
    setAbierta(facturaId);
  }

  /** Nueva entrega: factura (PDF) + fotos del remito. La nota de pedido se busca sola en Trello. */
  async function controlarEntrega() {
    const p = prov;
    const archivosFactura = p === 'target' ? fotosFactura : nuevaFactura ? [nuevaFactura] : [];
    if (!archivosFactura.length) return;
    const nombreArchivo = archivosFactura.map((f) => f.name).join(', ');
    const nuevos: string[] = [];
    let factura: Factura;
    let av: string[];
    let paraTrello = archivosFactura;
    setOcupado(p === 'target' ? 'Leyendo la foto de la factura… (puede tardar un minuto)' : 'Leyendo la factura…');
    try {
      if (p === 'target') {
        // Target (19-nov-2026): la factura llega en fotos; se lee como el remito y se controlan sus cuentas.
        paraTrello = await comoFotos(archivosFactura);
        const leida = facturaTargetDeFoto(await leerFotos<FacturaFoto>(paraTrello, 'factura'));
        if (!leida.factura.numero) throw new Error('no encontré el número de la factura en la foto.');
        factura = { ...leida.factura, id: `F-${slug(leida.factura.emisor || 'target')}-${slug(leida.factura.numero)}` };
        av = leida.avisos;
      } else {
        const paginas = await itemsPdf(archivosFactura[0]);
        const leida = p === 'id' ? leerFacturaId(paginas, '') : leerFacturaDistrinando(paginas, '');
        factura = { ...leida.factura, id: `F-${slug(leida.factura.numero || archivosFactura[0].name)}` };
        av = leida.avisos;
      }
    } catch (e) { setAvisos([`${nombreArchivo}: ${mensaje(e)}`]); return; }
    finally { setOcupado(''); }
    if (!sigue(p)) return;
    const { avisos: deTrello, informe: inf } = await sincronizarTrello({ factura, profunda: 'si-falta' });
    if (!sigue(p)) return;
    setInforme(inf);
    try {
      const ya = datos.facturas.some((f) => f.id === factura.id);
      await api({ proveedor: p, accion: 'guardarFactura', factura });
      nuevos.push(`Factura ${factura.emisor ? `${factura.emisor} ` : ''}${factura.numero} ${ya ? 'actualizada (ya estaba cargada)' : 'guardada'}: ${factura.renglones.length} renglones.`, ...av);
    } catch (e) { setAvisos([`${nombreArchivo}: ${mensaje(e)}`]); return; }
    if (p === 'target') for (const f of paraTrello) fotosDeFactura.current.add(f);
    recordar(factura.id, [...paraTrello, ...nuevasFotos], false);
    if (nuevasFotos.length) nuevos.push(...await remitoDeFotos(factura.id, nuevasFotos));
    if (!sigue(p)) return;
    setNuevaFactura(null); setFotosFactura([]); setNuevasFotos([]);
    await recargar();
    setAvisos([...nuevos, ...deTrello]);
    setAbierta(factura.id);
    await avanzarYAvisar(p, factura.id);
  }

  const pedidosOrd = [...datos.pedidos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  // Notas de tarjetas que no están en las listas de pendientes de Trello: al final, plegadas.
  const pedidosVigentes = pedidosOrd.filter((p) => !cerradas.has(p.id));
  const pedidosCerrados = pedidosOrd.filter((p) => cerradas.has(p.id));
  const filaNota = (p: PedidoGuardado) => {
    const r = resumen.find((x) => x.pedidoId === p.id)!;
    const det = res.pendientes.filter((x) => x.pedidoId === p.id);
    return (<Fragment key={p.id}>
      <tr>
        <td style={td}><button onClick={() => setAbierta(abierta === p.id ? null : p.id)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
          {abierta === p.id ? '▾' : '▸'} {p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre}</button>
          {enlaceTrello(p) && <> · <a href={enlaceTrello(p)} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>🗂️ {p.nroProveedor ? p.nombre : 'Trello'}</a></>}
          {cerradas.has(p.id) && <span style={{ opacity: 0.6 }}> · {datos.tarjetasTrello[tarjetaDeNota(p)]?.lista ? `en «${datos.tarjetasTrello[tarjetaDeNota(p)].lista}»` : 'fuera de las listas de pendientes'}</span>}</td>
        <td style={td}><input type="date" value={p.fecha} style={inputSt}
          onChange={(e) => e.target.value && guardar({ accion: 'guardarPedido', pedido: { ...p, fecha: e.target.value } })} /></td>
        <td style={td}>{r.pedido}</td><td style={td}>{r.facturado}</td><td style={td}>{r.pendiente}</td>
        <td style={{ ...td, color: consejos.get(p.id)?.noEntro?.length ? '#fdba74' : consejos.get(p.id)?.tipo === 'finalizar' ? '#34d399' : consejos.get(p.id)?.tipo === 'parcial' ? '#fbbf24' : undefined }}
          title={consejos.get(p.id) ? `${consejos.get(p.id)!.texto} ${consejos.get(p.id)!.tarjeta}` : undefined}>{consejos.get(p.id)?.corto ?? r.estado}</td>
        <td style={td}><button onClick={() => confirm(`¿Borrar la nota ${p.nombre}?${enlaceTrello(p) ? ' No se vuelve a traer de Trello.' : ''}`) && guardar({ accion: 'borrarPedido', id: p.id, nro: p.nroProveedor, huella: huellaPedido(p.lineas) })}
          style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button></td>
      </tr>
      {abierta === p.id && <tr><td colSpan={7} style={{ ...td, background: 'rgba(255,255,255,0.03)' }}>
        {consejos.get(p.id) && <div style={{ marginBottom: 6 }}>{consejos.get(p.id)!.texto} <strong>{consejos.get(p.id)!.tarjeta}</strong></div>}
        {consejos.get(p.id)?.noEntro?.length ? <div style={{ marginBottom: 6, color: '#fdba74' }}>⛔ No entraron: {textoNoEntro(consejos.get(p.id)!.noEntro!)}.</div> : null}
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead><tr><th style={th}>Código</th><th style={th}>Descripción</th><th style={th}>Talle</th><th style={th}>Pedido</th><th style={th}>Facturado</th><th style={th}>Pendiente</th></tr></thead>
          <tbody>{det.map((d, i) => <tr key={i}><td style={td}>{d.codigo}</td><td style={td}>{d.descripcion}</td><td style={td}>{d.talle}</td><td style={td}>{d.pedido}</td>
            <td style={td}>{d.facturado ?? 'a confirmar'}</td><td style={td}>{d.pendiente ?? 'a confirmar'}</td></tr>)}</tbody>
        </table></td></tr>}
    </Fragment>);
  };
  // Las notas subidas a mano y borradas también se anotan ahí (con «P:»), pero no son Excel de Trello.
  const excelTrello = Object.entries(datos.trelloVistos).filter(([k]) => /^[a-f0-9]{24}$/.test(k)).map(([, v]) => v);
  const facturasRes = [...res.facturas].reverse();
  // Entregas con la carga terminada: van al apartado verde (14-nov-2026, gax: «que quede como en archivadas»).
  const cargaEnt = prov === 'id' || prov === 'distrinando' || prov === 'target';
  const hayFactura = prov === 'target' ? fotosFactura.length > 0 : !!nuevaFactura;
  const esCerrada = (r: ResultadoFactura) => cargaEnt && planCarga?.entregaId !== r.factura.id
    && entregaArchivada(r, estadoCargaFactura(r, datos.cargas ?? {}, datos.noLlego), datos.archivo?.[r.factura.id]?.estado, prov !== 'distrinando');
  const cerradasEnt = facturasRes.filter(esCerrada);
  const abiertas = facturasRes.filter((r) => !esCerrada(r));
  const tarjeta = (r: ResultadoFactura) => <TarjetaEntrega key={r.factura.id} r={r} naranja={prov === 'id' || prov === 'target'} abierta={abierta === r.factura.id}
      onAbrir={() => setAbierta(abierta === r.factura.id ? null : r.factura.id)} pedidos={pedidosOrd} cerradas={cerradas} nombrePedido={nombrePedido}
      manual={datos.asignaciones[r.factura.id] || []} condiciones={condiciones} ocupado={!!ocupado}
      onIngreso={(fecha) => guardar({ accion: 'guardarIngreso', facturaId: r.factura.id, fecha })}
      mailsAdmin={datos.mailsAdmin ?? { para: [], copia: [] }} proveedor={prov === 'distrinando' ? 'Distrinando' : prov === 'target' ? 'Target' : 'ID'}
      onAsignar={async (ids) => { const p = prov; if (await guardar({ accion: 'guardarAsignacion', facturaId: r.factura.id, pedidos: ids })) await avanzarYAvisar(p, r.factura.id); }}
      onBorrar={() => confirm(`¿Borrar la entrega de la factura ${r.factura.numero}? Se borran también el remito y lo que contó el depósito.`) && guardar({ accion: 'borrarFactura', id: r.factura.id })}
      onDeposito={() => { setFacturaDeposito(r.factura.id); setVista('deposito'); }}
      onFotos={(f) => { soltarPlan(r.factura.id); fotosParaFactura(r.factura.id, f); }}
      onGuardarRemito={(remito) => { soltarPlan(r.factura.id); return guardar({ accion: 'guardarRemito', facturaId: r.factura.id, remito }); }}
      onBorrarRemito={() => { if (confirm('¿Borrar el remito de esta entrega?')) { soltarPlan(r.factura.id); guardar({ accion: 'borrarRemito', facturaId: r.factura.id }); } }}
      onNota={(f) => subirPedidos(f, r.factura.fecha, r.factura.id)}
      onTrello={() => buscarEnTrelloParaFactura(r.factura)} recordados={archivosEntrega.current.get(r.factura.id)?.length ?? 0}
      onSubirTrello={(f) => subirATrello(r, f)} res={res} todas={pedidosControl} consejos={consejos}
      informe={informe?.prov === prov && informe.facturaId === r.factura.id ? informe : null} onRecargarBorrada={recargarBorrada}
      carga={cargaEnt ? {
        cargas: datos.cargas ?? {}, noLlego: datos.noLlego ?? {}, plan: planCarga?.entregaId === r.factura.id ? planCarga : null,
        cerrada: esCerrada(r), cerrarIncompleta: prov === 'distrinando', onArchivar: (estado) => archivar(r, estado),
        onQuitar: (codigo, quitar) => quitarArticulo(r.factura.id, codigo, quitar),
        onArmar: () => armarCarga(r), onConfirmar: (e) => planCarga && confirmarCarga(r, planCarga, e),
        onCancelar: () => setPlanCarga(null), onLiberar: (codigo, c) => liberarCarga(r.factura.id, codigo, c), onCantidad: cantidadCarga,
        ...(prov === 'id' ? { onModoVenta: modoVenta, onPack: packCarga, onTabla: tablaCarga, onTalleId: destinoCarga, explicacion: EXPLICA_ID } : prov === 'target' ? { onColores: coloresCarga, explicacion: EXPLICA_TARGET } : {
          onTabla: tablaCarga, onDestino: destinoCarga, onSku: skuCarga, onQuitarTalle: quitarTalle,
          onMailSolo: () => planCarga && armarMailTalles(r, planCarga, [], prov), explicacion: EXPLICA_DISTRINANDO,
        }),
      } : undefined} />;
  const cambiarProv = (p: Prov) => { setResultadoCarga(null); setAvisoAdmin(null); setPlanCarga(null); setAvisoPrecio(null); setAvisoTalles(null); setOrdenesCarga([]); setNoEntraronCarga(null); setVerRegistro(false); provRef.current = p; setProv(p); setAvisos([]); setInforme(null); setAbierta(null); setFacturaDeposito(''); setVista('entregas'); setNuevaFactura(null); setFotosFactura([]); setNuevasFotos([]); };

  const cabecera = (<>
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>🧾 Control de entregas</h2>
      <button style={{ ...boton, background: verRegistro ? '#6366f1' : boton.background, border: verRegistro ? '1px solid #6366f1' : boton.border }}
        onClick={() => setVerRegistro((v) => !v)} title="Qué se cargó en Shopify desde acá, con remito y factura">📋 Registro de cargas</button>
      <EnlacesRapidos />
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontSize: '0.88rem', opacity: 0.8 }}>Proveedor:</span>
      {PROVS.map((p) => (
        <button key={p.id} onClick={() => cambiarProv(p.id)} disabled={!!ocupado && prov !== p.id}
          title={ocupado && prov !== p.id ? 'Esperá a que termine lo que está haciendo' : undefined}
          style={{ ...boton, background: prov === p.id ? '#6366f1' : 'rgba(255,255,255,0.04)', border: prov === p.id ? '1px solid #6366f1' : boton.border, opacity: prov === p.id ? 1 : ocupado ? 0.4 : 0.75, cursor: ocupado && prov !== p.id ? 'not-allowed' : 'pointer' }}>
          {p.nombre}
        </button>
      ))}
      {cargando && <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Cargando…</span>}
    </div>
  </>);
  // Family no factura: entrega + remito, con su propia pantalla.
  const registro = verRegistro && <RegistroCargas onVolver={() => setVerRegistro(false)} />;
  if (esMarket(prov)) return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '0.5rem' }}>
      {cabecera}{registro}
      {/* Ullua (19-nov-2026): marketplace como Family; el remito o la factura en PDF se pasan a fotos. */}
      <div style={{ display: verRegistro ? 'none' : undefined }}><ControlFamily key={prov} prov={prov} aFotos={comoFotos} /></div>
    </div>
  );

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '0.5rem' }}>
      {cabecera}{registro}
      <div style={{ display: verRegistro ? 'none' : undefined }}>

      {sinBase && <p style={{ color: '#fbbf24', fontSize: '0.9rem' }}>⚠ Falta conectar la base de datos al proyecto en Vercel. Sin ella no se pueden guardar las entregas.</p>}
      {error && !sinBase && <p style={{ color: '#f87171', fontWeight: 'bold' }}>⚠ {error}</p>}
      {ocupado && <p style={{ fontSize: '0.88rem', color: '#93c5fd' }}>⏳ {ocupado}</p>}
      {resultadoCarga && <ResultadosCarga resultados={resultadoCarga.resultados} sucursal={SUCURSAL_CARGA_ID} conVentas={resultadoCarga.conVentas} onCerrar={() => setResultadoCarga(null)} />}
      {avisos.length > 0 && <div style={{ fontSize: '0.84rem', margin: '6px 0 12px', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
        {avisos.map((a, i) => <div key={i}>• {a}</div>)}
      </div>}
      {ordenesCarga.length > 0 && <div style={{ position: 'relative' }}>
        <OrdenesQueSalen ordenes={ordenesCarga} titulo="📦 Órdenes de iD de esta carga: qué separar" />
        <button style={{ ...botonChico, position: 'absolute', top: 6, right: 6, padding: '1px 8px' }} onClick={() => setOrdenesCarga([])}>cerrar</button>
      </div>}
      {noEntraronCarga && <div style={{ position: 'relative' }}>
        <NoEntraron items={noEntraronCarga.items} factura={noEntraronCarga.factura} />
        <button style={{ ...botonChico, position: 'absolute', top: 6, right: 6, padding: '1px 8px' }} onClick={() => setNoEntraronCarga(null)}>cerrar</button>
      </div>}
      {avisoPrecio && <AvisoPrecio aviso={avisoPrecio} mails={datos.mailsAviso ?? { para: [], copia: [] }} ocupado={!!ocupado}
        onGuardarMails={async (m) => { await api({ accion: 'guardarMailsAviso', ...m }); await recargar(); }} onCerrar={() => setAvisoPrecio(null)} />}
      {avisoAdmin && <AvisoPrecio aviso={avisoAdmin} mails={datos.mailsAdmin ?? { para: [], copia: [] }} ocupado={!!ocupado}
        titulo="✉️ Avisá a administración la carga" boton="✉️ Avisar a administración (Gmail)" placeholder="mail de administración"
        onGuardarMails={async (m) => { await api({ accion: 'guardarMailsAviso', tipo: 'admin', ...m }); await recargar(); }} onCerrar={() => setAvisoAdmin(null)} />}
      {avisoTalles && <AvisoTalles aviso={avisoTalles} onCerrar={() => setAvisoTalles(null)} />}

      {vista !== 'entregas' && <button style={{ ...enlace, marginBottom: 10 }} onClick={() => setVista('entregas')}>← Volver a las entregas</button>}

      {vista === 'entregas' && (
        <div>
          <div style={{ border: '1px solid rgba(99,102,241,0.55)', borderRadius: 10, padding: '12px 14px', background: 'rgba(99,102,241,0.08)', marginBottom: 16 }}>
            <strong style={{ fontSize: '1rem' }}>Nueva entrega</strong>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              {prov === 'target'
                ? <><Archivo etiqueta="1 · 🧾 Foto de la factura" accept="image/*,.pdf" multiple disabled={!!ocupado} onArchivos={(f) => setFotosFactura(f)} />
                  <span style={{ fontSize: '0.82rem', opacity: fotosFactura.length ? 1 : 0.5 }}>{fotosFactura.length ? `✔ ${fotosFactura.length} archivo(s)` : 'sin elegir'}</span></>
                : <><Archivo etiqueta="1 · 🧾 Factura (PDF)" accept=".pdf" disabled={!!ocupado} onArchivos={(f) => setNuevaFactura(f[0])} />
                  <span style={{ fontSize: '0.82rem', opacity: nuevaFactura ? 1 : 0.5 }}>{nuevaFactura ? `✔ ${nuevaFactura.name}` : 'sin elegir'}</span></>}
              <Archivo etiqueta="2 · 📷 Foto del remito" accept="image/*" multiple disabled={!!ocupado} onArchivos={(f) => setNuevasFotos(f)} />
              <span style={{ fontSize: '0.82rem', opacity: nuevasFotos.length ? 1 : 0.5 }}>{nuevasFotos.length ? `✔ ${nuevasFotos.length} foto(s)` : 'sin elegir'}</span>
              <button style={{ ...botonPrincipal, opacity: hayFactura && !ocupado ? 1 : 0.5, cursor: hayFactura && !ocupado ? 'pointer' : 'not-allowed' }}
                disabled={!hayFactura || !!ocupado} onClick={controlarEntrega}>Controlar</button>
            </div>
            <p style={{ fontSize: '0.8rem', opacity: 0.75, margin: '8px 0 0' }}>
              La nota de pedido la busco sola en Trello. Si no la encuentro, te la pido en la entrega. Primero controlo que el remito traiga lo mismo que la factura; después, que la nota de pedido coincida con lo facturado y lo que llegó. Hasta tener las tres cosas, la entrega queda «incompleta».
            </p>
          </div>

          {!facturasRes.length && !cargando && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no hay entregas cargadas de este proveedor.</p>}
          {abiertas.map(tarjeta)}
          {cerradasEnt.length > 0 && <details style={{ marginTop: 14, border: '1px solid rgba(52,211,153,0.45)', borderRadius: 10, padding: '8px 12px', background: 'rgba(52,211,153,0.07)' }}>
            <summary style={{ cursor: 'pointer', color: '#34d399', fontWeight: 'bold' }}>✅ Cargadas y cerradas ({cerradasEnt.length})</summary>
            <div style={{ fontSize: '0.8rem', opacity: 0.75, margin: '6px 0' }}>Entregas con todo cargado en Shopify (o dadas por cerradas a mano). «Ver» muestra todo el detalle.</div>
            {cerradasEnt.map((r) => verCerrada === r.factura.id
              ? <div key={r.factura.id}>
                <button style={{ ...enlace, margin: '4px 0' }} onClick={() => setVerCerrada(null)}>▴ Achicar</button>
                {tarjeta(r)}
              </div>
              : <FilaCerrada key={r.factura.id} r={r} naranja={prov === 'id' || prov === 'target'} enShopify={estadoCargaFactura(r, datos.cargas ?? {}, datos.noLlego)} manual={datos.archivo?.[r.factura.id]?.estado === 'cerrada'}
                ocupado={!!ocupado} onVer={() => setVerCerrada(r.factura.id)} onAbrir={() => archivar(r, 'abierta')} />)}
          </details>}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 16, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button style={enlace} onClick={() => setVista('pedidos')}>📋 Notas de pedido cargadas ({pedidosVigentes.length})</button>
            <button style={enlace} onClick={() => setVista('deposito')}>📦 Checklist del depósito</button>
            <button style={enlace} onClick={() => setVista('reportes')}>💬 Mensajes de control y pendientes</button>
          </div>
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.88rem', opacity: 0.85 }}>🤖 ¿Otra consulta? Preguntale al asistente (órdenes pendientes, costo ponderado, un código)</summary>
            <div style={{ marginTop: 10 }}><Asistente /></div>
          </details>
        </div>
      )}

      {vista === 'pedidos' && (
        <div>
          <h3 style={{ fontSize: '1rem', marginTop: 0 }}>📋 Notas de pedido cargadas</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <button style={boton} disabled={!!ocupado} onClick={buscarEnTrello}>🗂️ Buscar notas nuevas en Trello</button>
            <Archivo etiqueta={prov === 'target' ? '➕ Subir nota(s) PDF' : '➕ Subir nota(s) Excel'} accept={prov === 'target' ? '.pdf' : '.xlsx,.xls'} multiple disabled={!!ocupado} onArchivos={(f) => subirPedidos(f, fechaPedido)} />
            {prov === 'distrinando' && <label style={{ fontSize: '0.85rem' }}>fecha en que se mandó{' '}
              <input type="date" value={fechaPedido} onChange={(e) => setFechaPedido(e.target.value)} style={inputSt} /></label>}
          </div>
          <p style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: 0 }}>
            {prov === 'id' ? 'La fecha de cada nota sale de la fila 1 del Excel de iD.' : prov === 'target' ? 'La nota de Target es el PDF «Detalle de solicitud»; la fecha sale del PDF.' : 'Distrinando no trae la fecha en el Excel: poné la del día que lo mandaste.'} La fecha ordena qué nota se factura primero; se puede corregir abajo.
          </p>
          <ListasTrelloCaja listas={listasTablero} elegidas={datos.listasTrello} ocupado={!!ocupado} onElegir={elegirListas} />
          <PlanillaCaja />
          {excelTrello.length > 0 && (
            <details style={{ fontSize: '0.8rem', margin: '0 0 10px', opacity: 0.85 }}>
              <summary style={{ cursor: 'pointer' }}>{excelTrello.length} Excel de Trello que no se cargaron como notas de este proveedor</summary>
              {excelTrello.map((v, i) => <div key={i}>• {v.motivo || 'sin detalle'}{v.fecha ? ` (${fechaAr(v.fecha)})` : ''}</div>)}
            </details>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.84rem', width: '100%' }}>
              <thead><tr><th style={th}>Nota</th><th style={th}>Fecha</th><th style={th}>Pedido u.</th><th style={th}>Facturado</th><th style={th}>Pendiente</th><th style={th}>Estado</th><th style={th}></th></tr></thead>
              <tbody>{pedidosVigentes.map(filaNota)}
                {pedidosCerrados.length > 0 && <tr><td colSpan={7} style={{ ...td, paddingTop: 10 }}>
                  <button style={enlace} onClick={() => setVerCerradas((v) => !v)}>
                    {verCerradas ? '▾' : '▸'} {pedidosCerrados.length} nota(s) de tarjetas que no están en las listas de pedidos pendientes de Trello: no se usan solas (sí si las tildás a mano en una entrega)
                  </button></td></tr>}
                {verCerradas && pedidosCerrados.map(filaNota)}</tbody>
            </table>
          </div>
          {!pedidosOrd.length && !cargando && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no hay notas de pedido cargadas de este proveedor.</p>}
        </div>
      )}

      {vista === 'deposito' && (
        <Deposito key={facturaDeposito} facturas={facturasRes} elegida={facturaDeposito} onElegir={setFacturaDeposito}
          recepciones={datos.recepciones}
          onGuardar={(facturaId, recepcion) => guardar({ accion: 'guardarRecepcion', facturaId, recepcion })} />
      )}

      {vista === 'reportes' && (
        <div>
          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: 10 }}>Condiciones de pago del proveedor (aparecen en el mensaje de pagos){' '}
            <input value={condiciones} onChange={(e) => setCondiciones(e.target.value)} placeholder="ej. contado 7% de descuento / 30 días"
              style={{ ...inputSt, width: 320, maxWidth: '100%' }} />{' '}
            <button style={botonChico} onClick={() => guardar({ accion: 'guardarConfig', config: { condicionesPago: condiciones } })}>Guardar</button>
          </label>
          <h3 style={{ fontSize: '1rem' }}>Mensajes para pagos</h3>
          {facturasRes.map((r) => <pre key={r.factura.id} style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', background: 'rgba(0,0,0,0.25)', padding: 8, borderRadius: 6 }}>{mensajePagos(r, condiciones, nombrePedido, fechaIngreso(r.factura, r.remito).fecha)}</pre>)}
          {facturasRes.length > 0 && <Copiar etiqueta="📋 Copiar todos" texto={facturasRes.map((r) => mensajePagos(r, condiciones, nombrePedido, fechaIngreso(r.factura, r.remito).fecha)).join('\n\n')} />}
          <h3 style={{ fontSize: '1rem' }}>Pendiente de entrega por nota y talle</h3>
          <Pendientes res={res} nombrePedido={nombrePedido} ocultar={cerradas} />
        </div>
      )}
      </div>
    </div>
  );
}

/** Estado de un renglón para la tabla: lo más grave primero. */
function estadoRenglon(x: ControlRenglon, nombrePedido: (id: string) => string, naranja?: boolean): [string, string] {
  const rojo = naranja ? NARANJA : '#f87171', amarillo = '#fbbf24', x0 = naranja ? '🟠' : '❌';
  if (x.posibleDobleCobro) return [`${x0} doble cobro`, rojo];
  if (x.sinPedir > 0) return [`${x0} ${x.sinPedir} sin pedir`, rojo];
  if (x.remito !== null && x.remito < x.cantidad) return [`${x0} el remito trae ${x.remito}`, rojo];
  const dif = x.difPrecio.reduce((t, d) => t + d.diferencia, 0);
  if (dif > 0) return [`${x0} +${fmt(dif)} neto`, rojo];
  if (x.difPrecio.length) return [`⚠️ precio distinto (${fmt(dif)})`, amarillo];
  if (!x.totalOk) return ['⚠️ renglón mal calculado', amarillo];
  if (x.remito !== null && x.remito > x.cantidad) return [`⚠️ el remito trae ${x.remito}`, amarillo];
  if (x.otraNota.length) return [`⚠️ de la nota ${x.otraNota.map(nombrePedido).join(', ')}`, amarillo];
  if (x.faltante > 0) return [`⚠️ faltan ${x.faltante}`, amarillo];
  if (x.asignaciones.some((a) => a.adelanto)) return ['⚠️ adelanto', amarillo];
  return ['✅', '#34d399'];
}


const EXPLICA_ID = 'Lo que llegó (el remito, menos lo que salió para órdenes y lo que ya está vendido en iD, que se separa) se SUMA al stock de Martínez; el stock de iD lo lleva la sincronización. Antes de sumar, el costo de la factura va a los talles que llegan y a los que están en 0 en Martínez (si un talle que llega ya tenía stock, lleva el promedio ponderado), y si el margen no llega al 50% hay que poner un precio nuevo para toda la curva. Lo que viene en packs (X6 en la factura, en el nombre de Shopify o en la lista de packs de la plantilla de iD) se carga por unidad, con el costo dividido. Una zapatilla Converse sin la etiqueta TABLA DE TALLE no se carga hasta que elijas su tabla (mirá la caja): la elegida se agrega a las etiquetas. Los productos que no están en Shopify se crean desde Sincronización.';
const EXPLICA_TARGET = 'Lo que llegó (el remito) se SUMA al stock de Martínez. Target no trae talles: un producto por código. Los que no están en Shopify se crean (activos y en Point of Sale) con el nombre de la factura (lo podés cambiar), la marca del producto, las etiquetas «Target» y el código, SKU = código, precio = lista × 2 y costo = lista menos la bonificación de esa factura. Si un artículo viene en varios colores, tocá «🎨 Viene en varios colores»: cada color se crea como un producto aparte (nombre + color, SKU código-COLOR) y la suma de los colores tiene que dar lo que llegó. Los que ya están (con la etiqueta «Target») suman stock y costo nuevo (promedio ponderado si ya había stock); si el precio no llega a la lista × 2 hay que poner uno nuevo.';
const EXPLICA_DISTRINANDO = 'Lo que llegó (el remito) se SUMA al stock de Martínez. Cada talle US entra en el talle de Shopify que da el SKU del proveedor, el AR que informa la nota o la tabla de talle que elijas; al lado de cada talle podés escribir otro si entró en otro. La tabla elegida se agrega a las etiquetas. Los talles que no existen se crean (SKU del proveedor, precio de la curva, costo de la factura) y los modelos nuevos se crean con precio Reebok (Mayorista × 1,8755, terminado en 999). Antes de sumar, el costo de la factura va a los talles que llegan y a los que están en 0 en Martínez (con stock: promedio ponderado). Por ahora solo Reebok calzado.';

function TarjetaEntrega({ r, abierta, onAbrir, pedidos, cerradas, nombrePedido, manual, condiciones, ocupado, onAsignar, onBorrar, onDeposito, onFotos, onGuardarRemito, onBorrarRemito, onNota, onTrello, recordados, onSubirTrello, informe, onRecargarBorrada, res, todas, consejos, carga, mailsAdmin, proveedor, naranja, onIngreso }: {
  /** Para el mail a administración (se abre en Gmail con un toque). */
  mailsAdmin: MailsAviso; proveedor: string;
  /** iD: lo que no coincide va en naranja, no en rojo (19-nov-2026). */
  naranja?: boolean;
  /** El día que entró la mercadería, escrito a mano (vacío = el día que se subió). */
  onIngreso: (fecha: string) => void;
  r: ResultadoFactura; abierta: boolean; onAbrir: () => void; pedidos: PedidoGuardado[]; cerradas: Set<string>; nombrePedido: (id: string) => string;
  res: ResultadoGeneral; todas: PedidoGuardado[]; consejos: Map<string, ConsejoNota>;
  manual: string[]; condiciones: string; ocupado: boolean; onAsignar: (ids: string[]) => void; onBorrar: () => void; onDeposito: () => void;
  onFotos: (f: File[]) => void; onGuardarRemito: (r: Remito) => Promise<boolean>; onBorrarRemito: () => void; onNota: (f: File[]) => void; onTrello: () => void;
  /** Factura y fotos subidas en esta pantalla, y adjuntarlas (o las elegidas) a la tarjeta de Trello. */
  recordados: number; onSubirTrello: (f?: File[]) => void;
  informe: InformeTrello | null; onRecargarBorrada: (f: FilaTrello) => void;
  /** iD: carga en Shopify (Martínez). */
  carga?: {
    cargas: Record<string, CargaFamily>; plan: PlanCarga | null; onArmar: () => void; onConfirmar: (e: EleccionesCarga) => void;
    /** Lo que no llegó (guardado) y si la entrega está en el apartado de cerradas. */
    noLlego: Record<string, unknown>; cerrada: boolean; onArchivar: (estado: 'cerrada' | 'abierta') => void;
    /** Distrinando: se puede dar por cerrada aunque falte cargar (Kappa, Crocs y ropa se cargan a mano). */
    cerrarIncompleta?: boolean;
    onCancelar: () => void; onLiberar: (codigo: string, c: CargaFamily) => void; onCantidad: (codigo: string, talle: string, n: number) => void;
    explicacion: string;
    /** iD: lo vendido en iD y las unidades por pack escritas a mano. */
    onModoVenta?: (codigo: string, modo: ModoVenta) => void;
    onPack?: (codigo: string, n: number | undefined) => void;
    /** Target: colores de un artículo (cada uno un producto aparte). */
    onColores?: (codigo: string, colores: ColorTarget[] | null) => void;
    /** Distrinando: tabla de talle y talle de destino. */
    onTabla?: (codigo: string, tabla: string) => void; onDestino?: (codigo: string, talle: string, destino: string) => void;
    onTalleId?: (codigo: string, talle: string, destino: string) => void;
    /** Distrinando: SKU a mano, quitar un talle agregado y armar el mail sin cargar. */
    onSku?: (codigo: string, talle: string, sku: string) => void; onQuitarTalle?: (codigo: string, talle: string) => void;
    onMailSolo?: () => void;
    /** Sacar un artículo que no llegó, o volver a agregarlo (queda guardado). */
    onQuitar: (codigo: string, quitar: boolean) => void;
  };
}) {
  const f = r.factura;
  const ingreso = fechaIngreso(f, r.remito);
  const enShopify = carga ? estadoCargaFactura(r, carga.cargas, carga.noLlego) : null;
  // Marcas que no terminaron bien (o quedaron «en curso» si se cerró la página): se revisan en Shopify y se liberan a mano.
  const aRevisar = carga ? Object.entries(carga.cargas).filter(([k, c]) => k.startsWith(`${f.id}|`) && c.estado !== 'cargada').map(([k, c]) => [k.slice(f.id.length + 1), c] as const) : [];
  const s = semaforoDe(r, naranja);
  const reclamo = reporteReclamo(r, nombrePedido);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [errores, setErrores] = useState<string[]>([]);
  const abrirEditor = () => { setTexto(r.remito ? textoRemito(r.remito) : f.remito ? `Remito ${f.remito}\n` : ''); setErrores([]); setEditando(true); };
  async function guardarTexto() {
    const { remito, errores: errs } = leerTextoRemito(texto);
    if (errs.length) { setErrores(errs); return; }
    if (!remito.renglones.length) { setErrores(['Escribí al menos un artículo.']); return; }
    if (await onGuardarRemito({ ...remito, origen: 'manual', dudas: [] })) setEditando(false);
  }
  const notas = r.pedidosCubiertos.map(nombrePedido).join(' + ');
  // Para elegir a mano: primero las notas con más artículos de esta factura, después las más nuevas.
  const deEsta = useMemo(() => {
    const cods = new Set(f.renglones.map((x) => claveCodigo(x.codigo)));
    return new Map(pedidos.map((p) => [p.id, new Set(p.lineas.map((l) => claveCodigo(l.codigo)).filter((k) => cods.has(k))).size]));
  }, [f, pedidos]);
  const paraElegir = useMemo(() => [...pedidos].sort((a, b) =>
    (deEsta.get(b.id) ?? 0) - (deEsta.get(a.id) ?? 0) || Number(cerradas.has(a.id)) - Number(cerradas.has(b.id))
    || (b.fecha || '').localeCompare(a.fecha || '')), [pedidos, deEsta, cerradas]);
  const unidadesRemito = r.remito?.renglones.reduce((t, x) => t + x.cantidad, 0) ?? 0;
  const pendiente = r.pendientePedidos.reduce((t, x) => t + x.pendiente, 0);
  return (
    <div style={{ border: `1px solid ${s.color}66`, borderRadius: 10, padding: '10px 12px', marginBottom: 12, background: `${s.color}0d` }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }} onClick={onAbrir}>
        <strong>{abierta ? '▾' : '▸'} Factura {f.emisor ? `${f.emisor} ` : ''}{f.numero}</strong>
        <span style={{ opacity: 0.8, fontSize: '0.85rem' }}>{fechaAr(f.fecha)} · {r.unidades} u. · {fmt(f.total)}{f.vencimiento ? ` · vence ${fechaAr(f.vencimiento)}` : ''}</span>
        <span style={{ color: s.color, fontWeight: 'bold' }}>{s.icono} {s.texto}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Parte ok titulo="Factura" detalle={`${f.renglones.length} artículos`} />
        <Parte ok={!r.faltaRemito} titulo="Remito" detalle={r.remito ? `${r.remito.numero || ''} · ${unidadesRemito} u.${r.remito.origen === 'foto' ? ' (de la foto)' : ''}` : 'falta'}>
          {r.faltaRemito && <Archivo etiqueta="📷 Subir foto" accept="image/*" multiple disabled={ocupado} estilo={botonChico} onArchivos={onFotos} />}
          <button style={botonChico} onClick={() => (editando ? setEditando(false) : abrirEditor())}>{r.remito ? '✏️ Ver o corregir' : '✏️ Escribirlo'}</button>
          {r.remito && <Archivo etiqueta="📷 Volver a leer de la foto" accept="image/*" multiple disabled={ocupado} estilo={botonChico} onArchivos={(x) => { setEditando(false); onFotos(x); }} />}
          {r.remito && <button style={{ ...botonChico, color: '#f87171' }} disabled={ocupado} title="Borra solo el remito de esta entrega (la factura, las notas y lo ya cargado en Shopify quedan). Después lo podés subir de nuevo."
            onClick={() => { setEditando(false); onBorrarRemito(); }}>🗑️ Borrar remito</button>}
        </Parte>
        <Parte ok={!r.faltaNota && !r.codigosSinNota.length} titulo="Nota de pedido"
          detalle={r.faltaNota ? 'falta: no la encontré en Trello' : `${notas || '—'}${r.codigosSinNota.length ? ` · falta la de ${r.codigosSinNota.length} artículo(s)` : ''}`}>
          {(r.faltaNota || r.codigosSinNota.length > 0) && <>
            <button style={botonChico} disabled={ocupado} onClick={onTrello}>🗂️ Buscar en Trello</button>
            <Archivo etiqueta="📎 Subir nota" accept=".xlsx,.xls" multiple disabled={ocupado} estilo={botonChico} onArchivos={onNota} />
          </>}
        </Parte>
        {carga && enShopify && <Parte ok={enShopify.completa} titulo="Shopify" detalle={textoShopify(enShopify)}>
          {!enShopify.completa && !carga.plan && !enShopify.cargados && !enShopify.noLlego.length && <button style={{ ...botonChico, opacity: r.remito && !ocupado ? 1 : 0.5 }} disabled={ocupado}
            title={r.remito ? 'Suma lo que llegó en DEPOSITO MARTINEZ, con vista previa y confirmación' : 'Primero subí o escribí el remito'}
            onClick={carga.onArmar}>⬆️ Cargar en Shopify</button>}
          {!carga.plan && (carga.cerrada
            ? <button style={botonChico} disabled={ocupado} onClick={() => carga.onArchivar('abierta')}>Volver a abrir</button>
            : (enShopify.completa || carga.cerrarIncompleta) && <button style={botonChico} disabled={ocupado}
              title={enShopify.completa ? 'Pasa la entrega al apartado verde de cargadas. La podés volver a abrir.' : 'Solo si lo que falta lo cargaste a mano (Kappa, Crocs o ropa). Pasa la entrega al apartado verde de cargadas; la podés volver a abrir.'}
              onClick={() => carga.onArchivar('cerrada')}>{enShopify.completa ? '✅ Dar por cerrada' : 'Lo que falta lo cargué a mano: dar por cerrada'}</button>)}
        </Parte>}
      </div>
      {/* Carga sin terminar (21-nov-2026, gax: «que aparezca grande un botón que diga hay pendiente un producto por cargar»). */}
      {carga && enShopify && !carga.plan && !enShopify.completa && (enShopify.cargados > 0 || enShopify.noLlego.length > 0) && enShopify.pendientes.length > 0 && (
        <button disabled={ocupado} onClick={carga.onArmar}
          title="Arma la carga de nuevo con lo que falta. Si no llegó, sacalo de la carga con «Sacar de la carga (no llegó)»."
          style={{ display: 'block', width: '100%', marginTop: 10, padding: '12px 14px', fontSize: '1.05rem', fontWeight: 'bold', textAlign: 'left',
            background: '#fbbf2426', color: '#fbbf24', border: '2px solid #fbbf24', borderRadius: 10, cursor: ocupado ? 'default' : 'pointer' }}>
          ⚠️ {enShopify.pendientes.length === 1 ? 'Hay 1 producto pendiente por cargar' : `Hay ${enShopify.pendientes.length} productos pendientes por cargar`}: {enShopify.pendientes.slice(0, 6).join(', ')}{enShopify.pendientes.length > 6 ? '…' : ''}
          <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'normal', opacity: 0.9, marginTop: 3 }}>
            Tocá acá para cargarlo. Si no llegó, sacalo de la carga con «Sacar de la carga (no llegó)».</span>
        </button>)}
      <div style={{ marginTop: 8, fontSize: '0.85rem', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        title="Va a la planilla de ingreso (FECHA) y al mail a administración. La fecha de carga (CARGA STOCK) es el día en que se carga.">
        <span>📅 La mercadería entró el</span>
        <input type="date" value={ingreso.fecha} max={hoy()} disabled={ocupado} style={inputSt}
          onChange={(e) => e.target.value && e.target.value !== ingreso.fecha && onIngreso(e.target.value)} />
        <span style={{ opacity: 0.7 }}>{ingreso.origen === 'escrita' ? 'escrita a mano' : ingreso.origen === 'subida'
          ? 'el día que se subió a la app: si entró otro día, cambiala antes de cargar' : 'fecha de la factura (no sé cuándo se subió): cambiala si entró otro día'}</span>
        {ingreso.origen === 'escrita' && <button style={botonChico} disabled={ocupado} onClick={() => onIngreso('')}>Volver a la del día que se subió</button>}
      </div>
      {carga && enShopify && enShopify.noLlego.length > 0 && <div style={{ marginTop: 6, fontSize: '0.84rem', opacity: 0.85 }}>
        No llegó (lo sacaste de la carga): {enShopify.noLlego.map((c) => <span key={c} style={{ marginRight: 8 }}>{c}{' '}
          <button style={{ ...botonChico, padding: '1px 7px' }} disabled={ocupado} onClick={() => carga.onQuitar(c, false)}>Llegó: volver a agregarlo</button></span>)}
      </div>}
      {editando && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: '0.82rem', opacity: 0.85, marginBottom: 6 }}>
            Una línea por artículo: código y después talle/cantidad. Ej.: <code>571818C 5.0/1 6.0/2 6.5/3</code>. Si no tiene talles: <code>A10520C 3</code>.
            {' '}Si el depósito marcó a mano «-1» (salió para órdenes y no se carga), escribilo después de la cantidad: <code>CTO0325003 XL/3-1</code> (llegaron 3, se cargan 2).
          </div>
          {r.remito?.dudas?.length ? <div style={{ fontSize: '0.82rem', color: '#fbbf24', marginBottom: 6 }}>
            Dudas de la lectura de la foto (revisalas contra el papel):{r.remito.dudas.map((d, i) => <div key={i}>• {d}</div>)}
          </div> : null}
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={Math.min(18, Math.max(6, texto.split('\n').length + 1))}
            style={{ ...inputSt, width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.85rem' }} />
          {errores.length > 0 && <div style={{ color: '#f87171', fontSize: '0.82rem' }}>{errores.map((e, i) => <div key={i}>• {e}</div>)}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <button style={{ ...botonChico, background: '#6366f1', border: '1px solid #6366f1' }} onClick={guardarTexto}>💾 Guardar remito</button>
            <button style={botonChico} onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
      )}
      <Controles r={r} unidadesRemito={unidadesRemito} pendiente={pendiente} naranja={naranja} />
      {r.retirados.length > 0 && <div style={{ marginTop: 4, fontSize: '0.86rem', color: '#a5b4fc' }}>
        ✋ Salieron para órdenes (marcado a mano en el remito, no se cargan): {r.retirados.map((x) => `${x.codigo}${x.talle ? ` T ${x.talle}` : ''} −${x.cantidad}`).join(' · ')}.
        {' '}Hay que cargar {unidadesRemito - r.retirados.reduce((t, x) => t + x.cantidad, 0)} u. de las {unidadesRemito} del remito.
      </div>}
      {aRevisar.length > 0 && carga && <div style={{ marginTop: 8, fontSize: '0.84rem', color: '#fbbf24' }}>
        {aRevisar.map(([codigo, c]) => <div key={codigo}>
          {codigo}: {textoCarga(c)}{' '}
          <button style={{ ...botonChico, padding: '1px 7px' }} disabled={ocupado} onClick={() => carga.onLiberar(codigo, c)}>🔓 Ya lo revisé: liberar</button>
        </div>)}
      </div>}
      {carga?.plan && <PanelCarga plan={carga.plan} ocupado={ocupado} onConfirmar={carga.onConfirmar} onCancelar={carga.onCancelar} sucursal={SUCURSAL_CARGA_ID}
        onModoVenta={carga.onModoVenta} onCantidad={carga.onCantidad} onTabla={carga.onTabla} onDestino={carga.onDestino} onTalleId={carga.onTalleId} sinTildar
        onSku={carga.onSku} onQuitarTalle={carga.onQuitarTalle} onQuitar={carga.onQuitar} onMailSolo={carga.onMailSolo} onPack={carga.onPack} onColores={carga.onColores}
        explicacion={carga.explicacion} />}
      <TarjetasTrello ids={r.pedidosCubiertos} pedidos={pedidos}>
        {recordados > 0 && <button style={{ ...botonChico, padding: '1px 8px' }} disabled={ocupado} title="Adjunta la factura y las fotos del remito que subiste recién a la tarjeta de Trello"
          onClick={() => onSubirTrello()}>📎 Subir factura y remito a Trello ({recordados})</button>}
        <Archivo etiqueta={recordados ? '📎 Elegir otros' : '📎 Subir factura y remito a Trello'} accept=".pdf,image/*" multiple disabled={ocupado}
          estilo={{ ...botonChico, padding: '1px 8px' }} onArchivos={(f) => onSubirTrello(f)} />
      </TarjetasTrello>
      {r.semaforo !== 'incompleta' && r.pedidosCubiertos.length > 0 && <NotasEntrega r={r} res={res} pedidos={todas} nombrePedido={nombrePedido} consejos={consejos} />}
      {informe && <InformeTrelloCaja informe={informe} ocupado={ocupado} onRecargar={onRecargarBorrada} />}

      {r.motivos.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.84rem', ...(naranja && r.semaforo === 'reclamar' ? { color: NARANJA } : {}) }}>{r.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {!abierta && <button style={{ ...enlace, marginTop: 6 }} onClick={onAbrir}>Ver el detalle artículo por artículo</button>}

      {abierta && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: 6 }}>
            {f.remito && <>Remito según la factura {f.remito} · </>}{f.pedidoProveedor && <>Pedidos del proveedor {f.pedidoProveedor} · </>}
            Subtotal {fmt(f.subtotal)} · IVA {fmt(f.iva)} · Perc. CABA {fmt(f.percepcionCaba)} · Perc. Bs.As. {fmt(f.percepcionBsAs)}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
              <thead><tr><th style={th}>Código</th><th style={th}>Descripción</th><th style={th}>Pedido</th><th style={th}>Facturado</th><th style={th}>Remito</th><th style={th}>Precio pedido</th><th style={th}>Precio factura</th><th style={th}>Estado</th></tr></thead>
              <tbody>{r.renglones.map((x, i) => {
                const fr = f.renglones[i];
                const [estado, color] = estadoRenglon(x, nombrePedido, naranja);
                return <tr key={i}>
                  <td style={td}>{x.codigo}</td><td style={td}>{x.descripcion}</td>
                  <td style={td}>{x.pedidoCantidad ?? '—'}{x.yaFacturadoAntes ? <span style={{ opacity: 0.7 }}> (ya fact. {x.yaFacturadoAntes})</span> : null}</td>
                  <td style={td}>{x.cantidad}</td>
                  <td style={td}>{x.remito ?? '—'}</td>
                  <td style={td}>{x.precioPedido === null ? '—' : `${fmt(x.precioPedido)}${x.bonifPedido ? ` −${x.bonifPedido}%` : ''}`}</td>
                  <td style={td}>{fmt(fr.precioUnitario)}{fr.bonificacion ? ` −${fr.bonificacion}%` : ''}</td>
                  <td style={{ ...td, color }}>{estado}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {r.pendientePedidos.length > 0 && (
            <details style={{ marginTop: 8, fontSize: '0.82rem' }}>
              <summary style={{ cursor: 'pointer' }}>De la nota {[...new Set(r.pendientePedidos.map((x) => nombrePedido(x.pedidoId)))].join(' + ')} todavía falta entregar {pendiente} u. en {r.pendientePedidos.length} artículo(s)</summary>
              <p style={{ opacity: 0.75, margin: '4px 0' }}>iD factura calzado e indumentaria por separado: lo que falta puede venir en otra factura.</p>
              {r.pendientePedidos.map((x, i) => <div key={i}>• {nombrePedido(x.pedidoId)} · {x.codigo} {x.descripcion}: {x.pendiente}</div>)}
            </details>
          )}
          <details style={{ marginTop: 8, fontSize: '0.82rem' }}>
            <summary style={{ cursor: 'pointer' }}>Elegir a mano a qué nota corresponde ({manual.length ? manual.map(nombrePedido).join(', ') : 'automático'})</summary>
            <p style={{ opacity: 0.75, margin: '4px 0' }}>Las notas tildadas se usan primero (aunque su tarjeta ya no esté en las listas de pendientes de Trello); lo que falte se busca en la nota pendiente que más artículos de esta factura tiene. Arriba, las que tienen artículos de esta factura.</p>
            {paraElegir.map((p) => <label key={p.id} style={{ display: 'block' }}>
              <input type="checkbox" checked={manual.includes(p.id)}
                onChange={(e) => onAsignar(e.target.checked ? [...manual, p.id] : manual.filter((x) => x !== p.id))} /> {p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre} ({fechaAr(p.fecha)}){deEsta.get(p.id) ? ` · ${deEsta.get(p.id)} artículo(s) de esta factura` : ''}{cerradas.has(p.id) ? ' · fuera de las listas de pendientes de Trello' : ''}
            </label>)}
          </details>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            {/* Al lado del mail (21-nov-2026, gax: «que aparezca el botón de mail de administración y la mercadería entró y seleccionar la fecha»). */}
            <label style={{ fontSize: '0.85rem' }} title="Va en el mail a administración y en la planilla de ingreso.">📅 Entró el{' '}
              <input type="date" value={ingreso.fecha} max={hoy()} disabled={ocupado} style={inputSt}
                onChange={(e) => e.target.value && e.target.value !== ingreso.fecha && onIngreso(e.target.value)} /></label>
            {(() => {
              const m = mailPagos(r, proveedor, condiciones, nombrePedido, ingreso.fecha);
              return <a href={enlacesMail(mailsAdmin, m.asunto, m.cuerpo).gmail} target="_blank" rel="noreferrer"
                title={mailsAdmin.para.length ? `Para ${mailsAdmin.para.join(', ')}` : 'Sin destinatario guardado: lo completás en Gmail'}
                style={{ ...botonChico, textDecoration: 'none' }}>✉️ Mail a administración</a>;
            })()}
            <Copiar etiqueta="📋 Copiar" texto={mensajePagos(r, condiciones, nombrePedido, ingreso.fecha)} />
            {reclamo && <Copiar etiqueta="📋 Texto de reclamo" texto={reclamo} />}
            <button style={botonChico} onClick={onDeposito}>📦 Checklist del depósito</button>
            {carga && Object.entries(carga.cargas).filter(([k, c]) => k.startsWith(`${f.id}|`) && c.estado === 'cargada').map(([k, c]) => (
              <button key={k} style={{ ...botonChico, background: 'transparent', opacity: 0.7 }} disabled={ocupado} title={textoCarga(c)}
                onClick={() => carga.onLiberar(k.slice(f.id.length + 1), c)}>🔓 {k.slice(f.id.length + 1)}</button>
            ))}
            <button style={{ ...botonChico, background: 'transparent', color: '#f87171' }} onClick={onBorrar}>Borrar entrega</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Lo que dice el recuadro «Shopify»: cargados, lo que no llegó y el total. */
function textoShopify(e: { cargados: number; noLlego: string[]; total: number }): string {
  if (!e.cargados && !e.noLlego.length) return 'sin cargar';
  return `${e.cargados} de ${e.total} cargados en Martínez${e.noLlego.length ? ` · ${e.noLlego.length} no llegó` : ''}`;
}

/** Una entrega cerrada, en una línea (14-nov-2026, gax: «menos explicación… en un apartado en verde»). */
function FilaCerrada({ r, enShopify, manual, ocupado, onVer, onAbrir, naranja }: {
  r: ResultadoFactura; enShopify: { cargados: number; noLlego: string[]; total: number; completa: boolean }; manual: boolean; ocupado: boolean; naranja?: boolean;
  onVer: () => void; onAbrir: () => void;
}) {
  const f = r.factura;
  const s = semaforoDe(r, naranja);
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(52,211,153,0.2)', fontSize: '0.86rem' }}>
      <strong style={{ color: '#34d399' }}>✅ Factura {f.numero}</strong>
      <span style={{ opacity: 0.8 }}>{fechaAr(f.fecha)} · {r.unidades} u. · {fmt(f.total)}</span>
      <span style={{ opacity: 0.8 }}>Shopify: {textoShopify(enShopify)}{manual && !enShopify.completa ? ' · cerrada a mano' : ''}</span>
      {r.semaforo !== 'ok' && <span style={{ color: s.color, opacity: 0.85 }} title={r.motivos.join('\n')}>{s.icono} {s.texto}</span>}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <button style={botonChico} onClick={onVer}>Ver</button>
        <button style={{ ...botonChico, background: 'transparent' }} disabled={ocupado} onClick={onAbrir}>Volver a abrir</button>
      </span>
    </div>
  );
}

/**
 * Los dos controles, en orden (gax, 12-nov-2026: «todo esto ya está pagado; es control y carga»):
 * 1. el remito trae lo mismo que la factura; 2. la nota de pedido coincide con lo facturado y lo que llegó.
 */
function Controles({ r, unidadesRemito, pendiente, naranja }: { r: ResultadoFactura; unidadesRemito: number; pendiente: number; naranja?: boolean }) {
  const linea = (ok: boolean | null, texto: string) => (
    <div style={{ color: ok === null ? '#94a3b8' : ok ? '#34d399' : naranja ? NARANJA : '#f87171' }}>{ok === null ? '⏳' : ok ? '✔' : '✖'} {texto}</div>
  );
  const distintos = r.difRemito.length;
  const remito = r.faltaRemito || !r.remito
    ? linea(null, '1 · Remito contra factura: falta el remito.')
    : linea(!distintos, `1 · Remito contra factura: ${!distintos ? `coinciden (${r.unidades} u.)` : `la factura dice ${r.unidades} u. y el remito ${unidadesRemito} u.; no coinciden ${distintos} artículo(s)`}.`);
  const sinPedir = r.renglones.reduce((t, x) => t + x.sinPedir, 0);
  const caros = r.renglones.filter((x) => x.difPrecio.some((d) => d.diferencia > 0)).length;
  const problemas = [
    sinPedir ? `${sinPedir} u. facturadas que no están en la nota` : '',
    caros ? `${caros} artículo(s) más caros que en la nota` : '',
    r.tallesNoPedidos.length ? `${r.tallesNoPedidos.length} talle(s) que no se pidieron` : '',
  ].filter(Boolean);
  const nota = r.faltaNota
    ? linea(null, '2 · Nota de pedido: falta la nota.')
    : linea(!problemas.length, `2 · Nota de pedido contra factura y remito: ${problemas.length ? problemas.join(' · ') : 'todo lo facturado está pedido'}${pendiente ? ` (de la nota falta entregar ${pendiente} u.)` : ''}.`);
  return <div style={{ marginTop: 8, fontSize: '0.86rem' }}>{remito}{nota}</div>;
}

/**
 * Cómo quedó cada nota de la entrega, en pocas líneas (16-nov-2026, gax: «tiene demasiada información que no
 * se llega a leer»; la planilla marcada ya no hace falta porque la app mueve la tarjeta sola). Lo que llegó
 * talle por talle queda plegado.
 */
/** «A10516C talle 039×2, 043×7 · CTO0325003 (3)» */
function textoNoEntro(xs: NoEntro[]): string {
  const por = new Map<string, NoEntro[]>();
  for (const x of xs) por.set(x.codigo, [...(por.get(x.codigo) ?? []), x]);
  return [...por.entries()].map(([cod, ls]) => (ls.every((l) => l.talle)
    ? `${cod} talle ${ls.map((l) => `${l.talle}×${l.unidades}`).join(', ')}`
    : `${cod} (${ls.reduce((s, l) => s + l.unidades, 0)} u.)`)).join(' · ');
}

function NotasEntrega({ r, res, pedidos, nombrePedido, consejos }: {
  r: ResultadoFactura; res: ResultadoGeneral; pedidos: PedidoGuardado[]; nombrePedido: (id: string) => string; consejos: Map<string, ConsejoNota>;
}) {
  const notas = useMemo(() => r.pedidosCubiertos.map((id) => {
    const p = pedidos.find((x) => x.id === id);
    let m: MarcasNota | null;
    try { m = p ? marcasDeNota(res, r.factura.id, pedidos, id) : null; } catch { m = null; }
    return { id, p, m };
  }), [r, res, pedidos]);

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.83rem' }}>
      <strong>🗂️ Notas de pedido de esta entrega</strong>
      {notas.map(({ id, p, m }) => {
        if (!p || !m) return null;
        const c = consejos.get(id);
        const color = c?.noEntro?.length ? '#fdba74' : c?.tipo === 'finalizar' ? '#34d399' : c?.tipo === 'parcial' ? '#fbbf24' : undefined;
        return (
          <div key={id} style={{ marginTop: 6 }}>
            <div>
              <strong>{nombrePedido(id)}</strong>
              {p.nroProveedor && p.nombre && <> · {p.enlace ? <a href={p.enlace} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{p.nombre}</a> : p.nombre}</>}
              {c && c.tipo !== 'nada' && <span style={{ color }}> · {c.texto}</span>}
            </div>
            {c && c.tipo !== 'nada' && <div style={{ opacity: 0.75 }}>{c.tarjeta}
              {c.tipo === 'parcial' && c.falta.length > 0 && <> Falta: {c.falta.slice(0, 3).map((x) => `${x.codigo} ${x.descripcion} (${x.unidades})`).join(' · ')}{c.falta.length > 3 ? ` y ${c.falta.length - 3} más` : ''}.</>}
            </div>}
            {c?.noEntro && c.noEntro.length > 0 && <div style={{ color: '#fdba74' }}>
              ⛔ No entraron (iD no los mandó): {textoNoEntro(c.noEntro)}. Las ventas que los esperan aparecen al armar la carga.
            </div>}
            {m.sinTalle.length > 0 && <div style={{ color: '#fbbf24' }}>Sin talle identificado: {m.sinTalle.map((x) => `${x.codigo} (${x.unidades})`).join(', ')}.</div>}
            {m.estaEntrega.length > 0 && <details style={{ opacity: 0.8 }}>
              <summary style={{ cursor: 'pointer' }}>Qué llegó de esta nota en esta entrega ({m.estaEntrega.reduce((s, x) => s + x.cantidad, 0)} u.)</summary>
              {m.estaEntrega.map((x) => `${x.codigo} ${x.talle}×${x.cantidad}`).join(', ')}
            </details>}
          </div>
        );
      })}
    </div>
  );
}

function Deposito({ facturas, elegida, onElegir, recepciones, onGuardar }: {
  facturas: ResultadoFactura[]; elegida: string; onElegir: (id: string) => void;
  recepciones: Record<string, RecepcionGuardada>; onGuardar: (facturaId: string, r: RecepcionGuardada) => Promise<boolean>;
}) {
  const r = facturas.find((x) => x.factura.id === elegida);
  // Se remonta con key={elegida}: el estado inicial es lo guardado de esa factura.
  const [rec, setRec] = useState<RecepcionGuardada>(() => (recepciones[elegida] ? { ...recepciones[elegida] } : { recibido: {}, extras: [] }));
  const [nuevoTalle, setNuevoTalle] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState({ codigo: '', talle: '', cantidad: '' });
  const [guardado, setGuardado] = useState('');
  const cambiar = (k: string, v: string) => setRec((x) => ({ ...x, recibido: { ...x.recibido, [k]: Math.max(0, Number(v) || 0) } }));
  const comp = r ? compararRecepcion(r.checklist, rec) : null;
  const numSt: React.CSSProperties = { ...inputSt, width: 64, fontSize: '1rem', padding: '6px' };

  return (
    <div>
      <h3 style={{ fontSize: '1rem', marginTop: 0 }}>📦 Checklist del depósito</h3>
      <select value={elegida} onChange={(e) => onElegir(e.target.value)} style={{ ...inputSt, background: 'var(--bg-color)', fontSize: '0.95rem', maxWidth: '100%' }}>
        <option value="">Elegí la factura que llegó…</option>
        {facturas.map((x) => <option key={x.factura.id} value={x.factura.id}>Factura {x.factura.numero} · {fechaAr(x.factura.fecha)} · {x.unidades} u.{recepciones[x.factura.id] ? ' · contada' : ''}</option>)}
      </select>
      {r && comp && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: '0.85rem', opacity: 0.85 }}>Contá lo que llegó y anotá la cantidad recibida. Si un talle no está en la lista, agregalo. Si llegó un artículo de otro color, cargalo abajo en «Recibido y no facturado».</p>
          {r.checklist.map((c) => (
            <div key={c.codigo} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
              <div><strong>{c.codigo}</strong> <span style={{ opacity: 0.8 }}>{c.descripcion}</span> · facturado {c.cantidad}{c.retirado ? ` · cargar ${Math.max(0, c.cantidad - c.retirado)}` : ''}</div>
              {c.nota && <div style={{ color: '#fbbf24', fontSize: '0.82rem' }}>{c.nota}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {(c.talles ?? Object.keys(rec.recibido).filter((k) => k.startsWith(claveRecepcion(c.codigo, ''))).map((k) => ({ talle: k.split('|')[1], cantidad: NaN }))).map((t) => {
                  const k = claveRecepcion(c.codigo, t.talle);
                  const v = rec.recibido[k];
                  const dif = Number.isNaN(t.cantidad) ? 0 : (v ?? 0) - t.cantidad;
                  return <label key={t.talle} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '0.8rem' }}>
                    <span>T {t.talle}{Number.isNaN(t.cantidad) ? '' : 'retirado' in t && t.retirado ? ` · cargar ${t.cantidad} (−${t.retirado} órdenes)` : ` · esp. ${t.cantidad}`}</span>
                    <input type="number" min={0} inputMode="numeric" value={v ?? ''} onChange={(e) => cambiar(k, e.target.value)}
                      style={{ ...numSt, borderColor: v === undefined ? undefined : dif ? '#f87171' : '#34d399' }} />
                  </label>;
                })}
                {!c.talles && <span style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
                  <input placeholder="talle" value={nuevoTalle[c.codigo] || ''} onChange={(e) => setNuevoTalle((x) => ({ ...x, [c.codigo]: e.target.value }))} style={{ ...inputSt, width: 60 }} />
                  <button style={botonChico} onClick={() => {
                    const t = (nuevoTalle[c.codigo] || '').trim().toUpperCase();
                    if (t) { cambiar(claveRecepcion(c.codigo, t), String(rec.recibido[claveRecepcion(c.codigo, t)] ?? 0)); setNuevoTalle((x) => ({ ...x, [c.codigo]: '' })); }
                  }}>+ talle</button>
                </span>}
              </div>
            </div>
          ))}
          <div style={{ border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>
            <strong>Recibido y no facturado</strong> <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>(otro color u otro artículo)</span>
            {rec.extras.map((e, i) => <div key={i} style={{ fontSize: '0.85rem' }}>{e.codigo} · T {e.talle || '—'} · {e.cantidad}{' '}
              <button onClick={() => setRec((x) => ({ ...x, extras: x.extras.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button></div>)}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <input placeholder="código" value={extra.codigo} onChange={(e) => setExtra({ ...extra, codigo: e.target.value })} style={{ ...inputSt, width: 150 }} />
              <input placeholder="talle" value={extra.talle} onChange={(e) => setExtra({ ...extra, talle: e.target.value })} style={{ ...inputSt, width: 60 }} />
              <input placeholder="cant." type="number" min={1} value={extra.cantidad} onChange={(e) => setExtra({ ...extra, cantidad: e.target.value })} style={{ ...inputSt, width: 60 }} />
              <button style={botonChico} onClick={() => {
                if (!extra.codigo.trim() || !(Number(extra.cantidad) > 0)) return;
                setRec((x) => ({ ...x, extras: [...x.extras, { codigo: extra.codigo.trim().toUpperCase(), talle: extra.talle.trim().toUpperCase(), cantidad: Number(extra.cantidad) }] }));
                setExtra({ codigo: '', talle: '', cantidad: '' });
              }}>Agregar</button>
            </div>
          </div>
          <textarea placeholder="Nota del depósito (opcional)" value={rec.nota || ''} onChange={(e) => setRec((x) => ({ ...x, nota: e.target.value }))}
            style={{ ...inputSt, width: '100%', minHeight: 50, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
            <button style={botonPrincipal} onClick={async () => { if (await onGuardar(elegida, rec)) setGuardado('✔ Guardado'); }}>💾 Guardar lo recibido</button>
            {guardado && <span style={{ color: '#34d399' }}>{guardado}</span>}
            {rec.actualizado && <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>Última carga: {new Date(rec.actualizado).toLocaleString('es-AR')}</span>}
          </div>
          {(Object.keys(rec.recibido).length > 0 || rec.extras.length > 0) && <>
          <h4 style={{ margin: '10px 0 4px' }}>{comp.ok ? '✅ Lo recibido coincide con la factura' : '⚠️ Diferencias'}</h4>
          {!comp.ok && <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead><tr><th style={th}>Código</th><th style={th}>Talle</th><th style={th}>Esperado</th><th style={th}>Recibido</th><th style={th}>Diferencia</th></tr></thead>
            <tbody>{comp.filas.filter((x) => x.diferencia).map((x, i) => <tr key={i}><td style={td}>{x.codigo}</td><td style={td}>{x.talle}</td><td style={td}>{x.esperado}</td>
              <td style={td}>{x.recibido}</td><td style={{ ...td, color: '#f87171' }}>{(x.diferencia ?? 0) > 0 ? '+' : ''}{x.diferencia}</td></tr>)}</tbody>
          </table>}
          </>}
        </div>
      )}
    </div>
  );
}

/** Planilla «CONTROL INGRESO MERCADERIA»: qué hace y botón para probar la conexión (no escribe nada). */
function PlanillaCaja() {
  const [estado, setEstado] = useState('');
  async function probar() {
    setEstado('Probando…');
    try {
      const r = await probarPlanilla();
      setEstado(r.sinPlanilla ? 'Todavía no está conectada: faltan PLANILLA_URL y PLANILLA_SECRETO en Vercel.' : `Conectada: la fila se agrega en la hoja «${r.hoja}».`);
    } catch (e) { setEstado(`No anduvo: ${mensaje(e)}`); }
  }
  return (
    <details style={{ fontSize: '0.8rem', margin: '0 0 10px' }}>
      <summary style={{ cursor: 'pointer' }}>📊 Planilla de ingreso (CONTROL INGRESO MERCADERIA)</summary>
      <p style={{ opacity: 0.75, margin: '4px 0' }}>Al terminar una carga de iD o Distrinando, la app agrega sola la fila de la factura al final de la planilla (fecha, proveedor, N° de factura, remito, monto, observaciones y carga de stock), con el color del proveedor. Si la factura ya está anotada, no la repite.</p>
      <button style={botonChico} onClick={probar} disabled={estado === 'Probando…'}>Probar la conexión</button>
      {estado && <span style={{ marginLeft: 8 }}>{estado}</span>}
    </details>
  );
}

/** De qué listas de Trello salen las notas (por defecto, las que dicen «pendiente»). */
function ListasTrelloCaja({ listas, elegidas, ocupado, onElegir }: { listas: ListaTrello[] | null; elegidas: string[]; ocupado: boolean; onElegir: (ids: string[]) => void }) {
  const usadas = listas ? listasDePendientes(listas, elegidas) : [];
  const ids = usadas.map((l) => l.id);
  return (
    <details style={{ fontSize: '0.8rem', margin: '0 0 10px' }}>
      <summary style={{ cursor: 'pointer' }}>
        🗂️ Listas de Trello de donde salen las notas: {listas ? (usadas.length ? usadas.map((l) => `«${l.nombre}»`).join(', ') : 'ninguna') : 'las que dicen «pendiente» en el nombre'}{elegidas.length ? '' : ' (automático)'}
      </summary>
      <p style={{ opacity: 0.75, margin: '4px 0' }}>Solo esas tarjetas traen notas. Una nota cuya tarjeta pasó a otra lista no se usa sola para las facturas nuevas (sí si la tildás a mano en la entrega). «RECIBIDO / CONTROL / CARGA» cuenta siempre.</p>
      <p style={{ opacity: 0.75, margin: '4px 0' }}>La app mueve sola las tarjetas: al subir la factura pasa la tarjeta de su nota a «RECIBIDO / CONTROL / CARGA»; al cerrarse la entrega, a «FINALIZADO» si llegó todo, o a pendientes de indumentaria/calzado si falta una parte.</p>
      {!listas && <div style={{ opacity: 0.7 }}>Todavía no leí las listas de Trello (tocá «Buscar notas nuevas en Trello»).</div>}
      {listas?.map((l) => <label key={l.id} style={{ display: 'block' }}>
        <input type="checkbox" disabled={ocupado} checked={ids.includes(l.id)}
          onChange={(e) => onElegir(e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id))} /> {l.nombre}
      </label>)}
      {elegidas.length > 0 && <button style={{ ...botonChico, marginTop: 6 }} disabled={ocupado} onClick={() => onElegir([])}>Volver a automático (las que dicen «pendiente»)</button>}
    </details>
  );
}

function Pendientes({ res, nombrePedido, ocultar }: { res: ReturnType<typeof analizarFacturas>; nombrePedido: (id: string) => string; ocultar: Set<string> }) {
  // Las notas de tarjetas que salieron de las listas de pendientes de Trello no se listan como pendientes.
  const filas = res.pendientes.filter((p) => !ocultar.has(p.pedidoId) && (p.pendiente === null || p.pendiente > 0));
  if (!filas.length) return <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>No hay pendientes.</p>;
  const texto = filas.map((p) => `${nombrePedido(p.pedidoId)}\t${p.codigo}\t${p.descripcion}\t${p.talle}\t${p.pendiente ?? 'a confirmar'}`).join('\n');
  return (
    <div>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead><tr><th style={th}>Nota</th><th style={th}>Código</th><th style={th}>Descripción</th><th style={th}>Talle</th><th style={th}>Pedido</th><th style={th}>Pendiente</th></tr></thead>
          <tbody>{filas.map((p, i) => <tr key={i}><td style={td}>{nombrePedido(p.pedidoId)}</td><td style={td}>{p.codigo}</td><td style={td}>{p.descripcion}</td>
            <td style={td}>{p.talle}</td><td style={td}>{p.pedido}</td><td style={td}>{p.pendiente ?? 'a confirmar'}</td></tr>)}</tbody>
        </table>
      </div>
      <div style={{ marginTop: 6 }}><Copiar etiqueta="📋 Copiar pendientes (para Excel)" texto={texto} /></div>
    </div>
  );
}

/** «Esta factura corresponde a las tarjetas…», con enlace a cada una. */
const ICONO_TRELLO: Record<EstadoTrello, string> = { cargada: '✅', 'ya estaba': '✅', borrada: '↩️', otra: '·', ilegible: '⚠️', 'no es excel': '·', falla: '❌' };

/** Qué encontró la última búsqueda en Trello para esta entrega, tarjeta por tarjeta. */
function InformeTrelloCaja({ informe, ocupado, onRecargar }: { informe: InformeTrello; ocupado: boolean; onRecargar: (f: FilaTrello) => void }) {
  const importa = (f: FilaTrello) => f.deEstaFactura > 0 || f.estado === 'falla' || f.estado === 'ilegible';
  const arriba = informe.filas.filter(importa).sort((a, b) => b.deEstaFactura - a.deEstaFactura);
  const leidas = informe.filas.filter((f) => !importa(f) && f.estado !== 'no es excel');
  const noExcel = informe.filas.filter((f) => f.estado === 'no es excel');
  const conArticulos = arriba.some((f) => f.deEstaFactura > 0);
  const sinLeer = arriba.filter((f) => f.estado === 'falla' || f.estado === 'ilegible').length;
  const linea = (f: FilaTrello, i: number) => (
    <div key={i} style={{ margin: '3px 0' }}>
      {ICONO_TRELLO[f.estado]}{' '}
      {f.enlace ? <a href={f.enlace} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>«{f.tarjeta}»</a> : <>«{f.tarjeta}»</>}
      <span style={{ opacity: 0.7 }}> {f.archivo}</span>: {f.detalle}
      {f.deEstaFactura > 0 && <strong> · tiene {f.deEstaFactura} artículo(s) de esta factura</strong>}
      {f.estado === 'borrada' && f.pedido && f.deEstaFactura > 0 && <>{' '}
        <button style={botonChico} disabled={ocupado} onClick={() => onRecargar(f)}>↩️ Volver a cargar</button></>}
    </div>
  );
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.3)', fontSize: '0.82rem' }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
        🗂️ Lo que revisé en Trello ({informe.hora}){informe.tablero ? ` · tablero «${informe.tablero}»` : ''}: {informe.tarjetas} tarjeta(s){informe.listas?.length ? ` en ${informe.listas.map((l) => `«${l}»`).join(' y ')}` : ' abiertas'}, {informe.conExcel} con {informe.prov === 'target' ? 'PDF' : 'Excel'}.
        {informe.fueraDeListas ? <span style={{ fontWeight: 'normal', opacity: 0.75 }}> Las {informe.fueraDeListas} tarjetas de otras listas no se usan.</span> : null}
      </div>
      {informe.error && <div style={{ color: '#f87171' }}>❌ {informe.error}</div>}
      {!informe.error && !conArticulos && (informe.cubierta
        ? <div>Las notas con artículos de esta factura ya estaban cargadas.{sinLeer ? ` ${sinLeer} archivo(s) no los pude leer (abajo el motivo).` : ''}</div>
        : <div>Ninguna de las notas que pude leer tiene artículos de esta factura.{sinLeer ? ` ${sinLeer} archivo(s) no los pude leer (abajo el motivo).` : ''}</div>)}
      {arriba.map(linea)}
      {leidas.length > 0 && <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: 'pointer', opacity: 0.8 }}>{leidas.length} nota(s) o archivo(s) leídos, sin artículos de esta factura</summary>
        {leidas.map(linea)}
      </details>}
      {noExcel.length > 0 && <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: 'pointer', opacity: 0.8 }}>{noExcel.length} adjunto(s) que no son Excel (enlaces, PDF, fotos)</summary>
        {noExcel.map(linea)}
      </details>}
      {informe.sinRevisar > 0 && <div style={{ opacity: 0.7, marginTop: 4 }}>{informe.sinRevisar} Excel revisados antes no se volvieron a bajar: «Buscar en Trello» los revisa de nuevo.</div>}
      {informe.otroProveedor > 0 && <div style={{ opacity: 0.7, marginTop: 4 }}>{informe.otroProveedor} {informe.prov === 'target' ? 'PDF' : 'Excel'} de otros proveedores (no se muestran ni se vuelven a bajar).</div>}
    </div>
  );
}

function TarjetasTrello({ ids, pedidos, children }: { ids: string[]; pedidos: PedidoGuardado[]; children?: ReactNode }) {
  const tarjetas = ids.map((id) => pedidos.find((p) => p.id === id)).filter((p): p is PedidoGuardado => !!enlaceTrello(p));
  const vistas = new Set<string>();
  const unicas = tarjetas.filter((p) => !vistas.has(enlaceTrello(p)) && vistas.add(enlaceTrello(p)));
  if (!unicas.length) return null;
  return (
    <div style={{ fontSize: '0.84rem', marginTop: 6 }}>
      🗂️ En Trello: {unicas.map((p, i) => <Fragment key={p.id}>{i ? ' + ' : ''}<a href={enlaceTrello(p)} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>{p.nombre}</a></Fragment>)}
      {unicas.some((p) => tarjetaDeNota(p)) && children && <span style={{ marginLeft: 8, display: 'inline-flex', gap: 6, flexWrap: 'wrap', verticalAlign: 'middle' }}>{children}</span>}
    </div>
  );
}

/**
 * Aviso de cambio de precio (12-nov-2026, gax): después de una carga que cambió precios de venta,
 * un botón abre el mail ya escrito (Gmail o el programa de correo). La app no lo envía sola.
 */
function AvisoPrecio({ aviso, mails, ocupado, onGuardarMails, onCerrar, titulo, boton: textoBoton, placeholder }: {
  aviso: { cambios?: CambioPrecio[]; asunto: string; cuerpo: string }; mails: MailsAviso; ocupado: boolean;
  onGuardarMails: (m: MailsAviso) => Promise<void>; onCerrar: () => void;
  /** Para reusarlo con otro aviso (administración). */
  titulo?: string; boton?: string; placeholder?: string;
}) {
  const n = aviso.cambios?.length ?? 0;
  const [editar, setEditar] = useState(!mails.para.length);
  const [para, setPara] = useState(mails.para.join(', '));
  const [copia, setCopia] = useState(mails.copia.join(', '));
  const [msg, setMsg] = useState('');
  const partir = (t: string) => t.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const { gmail, mailto } = enlacesMail(mails, aviso.asunto, aviso.cuerpo);
  async function guardarMails() {
    setMsg('');
    try { await onGuardarMails({ para: partir(para), copia: partir(copia) }); setEditar(false); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'No se pudo guardar.'); }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(`${aviso.asunto}\n\n${aviso.cuerpo}`); setMsg('✔ Texto copiado.'); }
    catch { setMsg('No pude copiar: seleccioná el texto de abajo y copialo a mano.'); }
  }
  const listo = mails.para.length > 0 && !editar;
  return (
    <div style={{ border: '1px solid rgba(251,191,36,0.6)', borderRadius: 10, padding: '12px 14px', margin: '6px 0 14px', background: 'rgba(251,191,36,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <strong>{titulo ?? `✉️ Cambió el precio de ${n} producto${n === 1 ? '' : 's'}: avisá por mail`}</strong>
        <button style={enlace} onClick={onCerrar}>Cerrar</button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.82rem', margin: '8px 0', padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}>{aviso.cuerpo}</pre>
      {listo ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <a href={gmail} target="_blank" rel="noreferrer" style={{ ...botonPrincipal, textDecoration: 'none' }}>{textoBoton ?? '✉️ Avisar cambio de precio (Gmail)'}</a>
          <a href={mailto} style={{ ...boton, textDecoration: 'none' }}>Abrir en mi programa de mail</a>
          <button style={boton} onClick={copiar}>📋 Copiar texto</button>
          <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>
            Para {mails.para.join(', ')}{mails.copia.length ? ` · copia a ${mails.copia.join(', ')}` : ''} · <button style={enlace} onClick={() => setEditar(true)}>cambiar</button>
          </span>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, fontSize: '0.84rem' }}>
          <span>¿A quién va el aviso? Se guarda una sola vez para las próximas cargas.</span>
          <label>Para: <input style={{ ...inputSt, width: 'min(420px, 100%)' }} value={para} onChange={(e) => setPara(e.target.value)} placeholder={placeholder ?? 'mail del depósito'} /></label>
          <label>Copia: <input style={{ ...inputSt, width: 'min(420px, 100%)' }} value={copia} onChange={(e) => setCopia(e.target.value)} placeholder="mails separados por coma" /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...botonPrincipal, opacity: ocupado ? 0.5 : 1 }} disabled={ocupado} onClick={guardarMails}>💾 Guardar mails</button>
            {mails.para.length > 0 && <button style={boton} onClick={() => setEditar(false)}>Cancelar</button>}
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: '0.8rem', marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

/**
 * Talles distintos al remito (13-nov-2026, gax: «que me deje un mail para mandar qué pasó con los talles»).
 * El mail se abre escrito y sin destinatario: la persona elige a quién mandarlo. La app no lo envía.
 */
function AvisoTalles({ aviso, onCerrar }: { aviso: { asunto: string; cuerpo: string }; onCerrar: () => void }) {
  const [msg, setMsg] = useState('');
  const { gmail, mailto } = enlacesMail({ para: [], copia: [] }, aviso.asunto, aviso.cuerpo);
  async function copiar() {
    try { await navigator.clipboard.writeText(`${aviso.asunto}\n\n${aviso.cuerpo}`); setMsg('✔ Texto copiado.'); }
    catch { setMsg('No pude copiar: seleccioná el texto de abajo y copialo a mano.'); }
  }
  return (
    <div style={{ border: '1px solid rgba(251,191,36,0.6)', borderRadius: 10, padding: '12px 14px', margin: '6px 0 14px', background: 'rgba(251,191,36,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <strong>✉️ Llegaron talles distintos al remito: avisá por mail</strong>
        <button style={enlace} onClick={onCerrar}>Cerrar</button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.82rem', margin: '8px 0', padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}>{aviso.cuerpo}</pre>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <a href={gmail} target="_blank" rel="noreferrer" style={{ ...botonPrincipal, textDecoration: 'none' }}>✉️ Escribir el mail (Gmail)</a>
        <a href={mailto} style={{ ...boton, textDecoration: 'none' }}>Abrir en mi programa de mail</a>
        <button style={boton} onClick={copiar}>📋 Copiar texto</button>
        <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>El mail se abre sin destinatario: completalo vos.</span>
      </div>
      {msg && <div style={{ fontSize: '0.8rem', marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
