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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import Asistente from './Asistente';
import {
  analizarFacturas, claveCodigo, notaDisponible, claveRecepcion, huellaPedido, compararRecepcion, fmt, mensajePagos, reporteReclamo, resumenPedidos,
  type ControlRenglon, type CopiaPlanilla, type Factura, type Pedido, type Recepcion, type Remito, type ResultadoFactura, type ResultadoGeneral,
} from './utils/controlFacturas';
import { leerFacturaDistrinando, leerFacturaId, leerPedidoAuto, leerTextoRemito, textoRemito, type HojaMarcada, type ItemPdf } from './utils/lectoresFacturas';
import { celdasVerdes, hojaVisible, marcarPlanilla } from './utils/planillaVerde';
import { consejoNota, fusionarPlanilla, marcasDeNota, type ConsejoNota, type MarcasNota } from './utils/marcasPlanilla';
import { conEstadoTrello, estadosTarjetas, listaDeParciales, listasDePendientes, tarjetaDeNota, type EstadoTarjeta, type ListaTrello } from './utils/listasTrello';
import ControlFamily from './ControlFamily';
import RegistroCargas from './RegistroCargas';
import EnlacesRapidos from './EnlacesRapidos';
import { Archivo, Copiar, Parte } from './EntregasPartes';
import { PanelCarga } from './PanelCarga';
import { ejecutarCargaFamily, resumenCarga, textoCarga, type CargaFamily, type EleccionesCarga, type PlanCarga } from './utils/cargaFamily';
import { estadoCargaFactura, leerEstadoCargaId, planCargaId, precioYCostoAntes, SUCURSAL_CARGA_ID } from './utils/cargaId';
import { actualizarPreciosManualmente, shopifyGraphQL } from './utils/shopify';
import {
  apiControl, boton, botonChico, botonPrincipal, enlace, fechaAr, hoy, inputSt, leerFotos, mensaje, nombreArchivoPlanilla, slug, td, th,
} from './utils/entregasUi';

type Prov = 'distrinando' | 'id' | 'family';
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
  /** iD: qué artículos de cada entrega ya se cargaron en Shopify («{facturaId}|{código}»). */
  cargas?: Record<string, CargaFamily>;
}
/** Versión del lector de Excel de Trello. Subirla cuando cambie: los descartados se revisan de nuevo. */
const LECTOR_TRELLO = 5; // 4: 12-nov-2026, una copia en una tarjeta de pendientes de una nota cargada desde otra lista; 5: lee el verde
/** Versión con que se leyó una nota: desde la 5 guarda las celdas y lo pintado en verde. */
const LECTOR_PLANILLA = 5;
const VACIO: Datos = { pedidos: [], facturas: [], asignaciones: {}, recepciones: {}, remitos: {}, config: {}, trelloVistos: {}, tarjetasTrello: {}, listasTrello: [] };
const PROVS: { id: Prov; nombre: string }[] = [
  { id: 'id', nombre: 'iD (Converse, Le Coq)' },
  { id: 'distrinando', nombre: 'Distrinando (Reebok, Kappa, Crocs)' },
  { id: 'family', nombre: 'Family (sin factura)' },
];
type Vista = 'entregas' | 'pedidos' | 'deposito' | 'reportes';
interface AdjuntoTrello { id: string; nombre: string; fecha?: string }
interface TarjetaTrello { id: string; nombre: string; enlace: string; lista: string; idLista?: string; creada: string; inicio: string; adjuntos: AdjuntoTrello[]; otrosAdjuntos?: string[] }
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
interface Bajado { buf: ArrayBuffer; nombre: string; fecha: string; completo: boolean; verdes: Set<string>; origen: { r: number; c: number } }

async function bajarAdjunto(tarjeta: string, adjunto: string): Promise<Bajado> {
  const r = await fetch(`/api/trello?accion=adjunto&tarjeta=${tarjeta}&adjunto=${adjunto}`, { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { status: r.status });
  const bin = atob(d.datos);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return {
    buf: buf.buffer, nombre: String(d.nombre || ''), fecha: String(d.fecha || ''), completo: d.completo !== false,
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

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(o: { data: ArrayBuffer }): { promise: Promise<{ numPages: number; getPage(i: number): Promise<{ getTextContent(): Promise<{ items: ItemPdf[] }> }> }> };
}

async function itemsPdf(file: File): Promise<ItemPdf[][]> {
  const pdfjsLib = (window as unknown as { pdfjsLib?: PdfJs }).pdfjsLib;
  if (!pdfjsLib) throw new Error('No cargó el lector de PDF. Refrescá la página con Ctrl+Shift+R.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const paginas: ItemPdf[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) paginas.push((await (await pdf.getPage(i)).getTextContent()).items);
  return paginas;
}

const api = (body?: object, proveedor?: Prov) => apiControl(body, proveedor);

/** Guarda en qué lista de Trello está cada tarjeta con notas (de a 500, el servidor acepta hasta 1000). */
async function guardarEstados(p: Prov, cambios: Record<string, EstadoTarjeta>) {
  const entradas = Object.entries(cambios);
  for (let i = 0; i < entradas.length; i += 500) await api({ proveedor: p, accion: 'guardarTarjetas', tarjetas: Object.fromEntries(entradas.slice(i, i + 500)) });
}
/** Fecha de hoy en Argentina (hoy() es la de UTC: después de las 21 ya da mañana). */
const hoyAr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
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
  const [fechaPedido, setFechaPedido] = useState(hoy());
  const [abierta, setAbierta] = useState<string | null>(null);
  const [facturaDeposito, setFacturaDeposito] = useState('');
  const [condiciones, setCondiciones] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [nuevaFactura, setNuevaFactura] = useState<File | null>(null);
  const [nuevasFotos, setNuevasFotos] = useState<File[]>([]);
  const [informe, setInforme] = useState<InformeTrello | null>(null);
  // Listas del tablero de Trello (para elegir de cuáles salen las notas). null = todavía no se leyeron.
  const [listasTablero, setListasTablero] = useState<ListaTrello[] | null>(null);
  const [verCerradas, setVerCerradas] = useState(false);
  // iD: vista previa de la carga en Shopify (una entrega por vez).
  const [planCarga, setPlanCarga] = useState<PlanCarga | null>(null);
  const listasRevisadas = useRef(new Set<Prov>());
  // Proveedor elegido ahora: una búsqueda o carga que termina después de cambiarlo no toca la pantalla.
  const provRef = useRef(prov);
  const sigue = (p: Prov) => provRef.current === p;

  const recargar = useCallback(async () => {
    if (prov === 'family') return; // Family tiene su propia pantalla (ControlFamily)
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
    if (p === 'family' || (!forzar && listasRevisadas.current.has(p))) return '';
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
  const res = useMemo(() => analizarFacturas(pedidosControl, datos.facturas, datos.asignaciones, datos.remitos), [pedidosControl, datos.facturas, datos.asignaciones, datos.remitos]);
  const resumen = useMemo(() => resumenPedidos(pedidosControl, res), [pedidosControl, res]);
  // Qué hacer con la tarjeta de cada nota hoy: finalizar, pasar a la lista de parciales o nada (la app no la mueve).
  const listaParcial = useMemo(() => listaDeParciales(listasTablero ?? []), [listasTablero]);
  const listaDe = useCallback((p: { origen?: string }) => datos.tarjetasTrello[tarjetaDeNota(p)]?.lista || '', [datos.tarjetasTrello]);
  const consejos = useMemo(() => {
    const out = new Map<string, ConsejoNota>();
    for (const p of pedidosControl) {
      try { out.set(p.id, consejoNota(marcasDeNota(res, null, pedidosControl, p.id), { listaActual: listaDe(p), listaParcial })); } catch { /* sin datos */ }
    }
    return out;
  }, [res, pedidosControl, listaDe, listaParcial]);
  const cerradas = useMemo(() => new Set(pedidosControl.filter((p) => p.cerradaDesde).map((p) => p.id)), [pedidosControl]);
  const nombrePedido = (id: string) => { const p = datos.pedidos.find((x) => x.id === id); return p ? (p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre) : id; };

  async function guardar(body: object) {
    setError('');
    try { await api({ proveedor: prov, ...body }); await recargar(); return true; }
    catch (e) { setError(mensaje(e)); return false; }
  }

  /** Lee un Excel de pedido. Devuelve el pedido listo para guardar, o por qué no se carga. */
  function prepararPedido(buf: ArrayBuffer, archivo: string, fecha: string, extra: { id?: string; nombre?: string; origen: string; enlace?: string; copia?: CopiaPlanilla; bajado?: Bajado },
    existentes: PedidoGuardado[]): { pedido?: PedidoGuardado; mensajes: string[]; descartado?: string; repetidoId?: string; leido?: { lineas: PedidoGuardado['lineas']; nroProveedor?: string } } {
    // Lo pintado en verde ya entró: la fecha es la de la copia (en Trello) o la de hoy (subida a mano).
    const { filas, hoja } = leerHoja(buf, extra.copia?.fecha || hoyAr(), extra.bajado);
    const nombre = extra.nombre || archivo.replace(/\.[^.]+$/, '');
    const r = leerPedidoAuto(filas, '', nombre, fecha, hoja);
    if (r.proveedor !== prov) {
      const otro = r.proveedor === 'id' ? 'iD' : 'Distrinando';
      return { mensajes: [`${archivo}: parece de ${otro}; cambiá el proveedor arriba.`], descartado: `es un pedido de ${otro}` };
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
          const r = prepararPedido(await file.arrayBuffer(), file.name, fecha, { origen: 'manual' }, existentes);
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
      const todas = (d.tarjetas || []) as TarjetaTrello[];
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
                res = prepararPedido(bajado.buf, a.nombre, t.inicio || t.creada, { id: `T-${a.id}`, nombre: t.nombre, origen: `trello:${t.id}`, enlace: t.enlace, copia, bajado }, existentes);
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
      if (factura && !cubierta() && !informe.filas.some((f) => f.deEstaFactura > 0)) out.push(`Trello: revisé ${informe.conExcel} tarjeta(s) con Excel y ninguna de las notas que pude leer tiene artículos de la factura ${factura.numero}.${ilegibles ? ` ${ilegibles} archivo(s) no los pude leer.` : ''} El detalle de cada tarjeta está en la entrega.`);
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
      const estado = await leerEstadoCargaId(r.checklist.map((c) => c.codigo), shopifyGraphQL);
      if (!sigue(p)) return;
      setDatos({ ...VACIO, ...d });
      setPlanCarga(planCargaId(r, estado, d.cargas ?? {}));
    } catch (e) { if (sigue(p)) setAvisos([`No pude armar la carga: ${mensaje(e)} No se cargó nada.`]); }
    finally { setOcupado(''); }
  }

  async function confirmarCarga(r: ResultadoFactura, plan: PlanCarga, elecciones: EleccionesCarga) {
    const res = resumenCarga(plan, elecciones);
    if (!res.reposiciones) return;
    const texto = [`Se va a cargar en Shopify (${SUCURSAL_CARGA_ID}):`, ...res.lineas, '',
      `${res.reposiciones} artículo(s), ${res.unidades} unidades en total.`,
      'El precio y el costo se cambian antes de sumar el stock. ¿Confirmás?'].join('\n');
    if (!confirm(texto)) return;
    const p = prov, eid = plan.entregaId, factura = r.factura.numero;
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
      const icono = { cargada: '✅', parcial: '⚠️', dudosa: '❓', error: '❌', saltado: '↷' } as const;
      if (sigue(p)) setAvisos(resultados.map((x) => `${icono[x.estado]} ${x.codigo}: ${x.mensaje}`));
      setPlanCarga(null);
    } catch (e) { if (sigue(p)) setAvisos([`La carga se cortó: ${mensaje(e)} Revisá en Shopify qué quedó cargado antes de volver a intentar.`]); }
    finally { setOcupado(''); if (sigue(p)) await recargar(); }
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
    const m = await remitoDeFotos(facturaId, files);
    if (!sigue(p)) return;
    await recargar();
    setAvisos(m);
    setAbierta(facturaId);
  }

  /** Nueva entrega: factura (PDF) + fotos del remito. La nota de pedido se busca sola en Trello. */
  async function controlarEntrega() {
    if (!nuevaFactura) return;
    const p = prov;
    const nuevos: string[] = [];
    let factura: Factura;
    let av: string[];
    setOcupado('Leyendo la factura…');
    try {
      const paginas = await itemsPdf(nuevaFactura);
      const leida = p === 'id' ? leerFacturaId(paginas, '') : leerFacturaDistrinando(paginas, '');
      factura = { ...leida.factura, id: `F-${slug(leida.factura.numero || nuevaFactura.name)}` };
      av = leida.avisos;
    } catch (e) { setAvisos([`${nuevaFactura.name}: ${mensaje(e)}`]); return; }
    finally { setOcupado(''); }
    if (!sigue(p)) return;
    const { avisos: deTrello, informe: inf } = await sincronizarTrello({ factura, profunda: 'si-falta' });
    if (!sigue(p)) return;
    setInforme(inf);
    try {
      const ya = datos.facturas.some((f) => f.id === factura.id);
      await api({ proveedor: p, accion: 'guardarFactura', factura });
      nuevos.push(`Factura ${factura.numero} ${ya ? 'actualizada (ya estaba cargada)' : 'guardada'}: ${factura.renglones.length} renglones.`, ...av);
    } catch (e) { setAvisos([`${nuevaFactura.name}: ${mensaje(e)}`]); return; }
    if (nuevasFotos.length) nuevos.push(...await remitoDeFotos(factura.id, nuevasFotos));
    if (!sigue(p)) return;
    setNuevaFactura(null); setNuevasFotos([]);
    await recargar();
    setAvisos([...nuevos, ...deTrello]);
    setAbierta(factura.id);
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
        <td style={{ ...td, color: consejos.get(p.id)?.tipo === 'finalizar' ? '#34d399' : consejos.get(p.id)?.tipo === 'parcial' ? '#fbbf24' : undefined }}
          title={consejos.get(p.id) ? `${consejos.get(p.id)!.texto} ${consejos.get(p.id)!.tarjeta}` : undefined}>{consejos.get(p.id)?.corto ?? r.estado}</td>
        <td style={td}><button onClick={() => confirm(`¿Borrar la nota ${p.nombre}?${enlaceTrello(p) ? ' No se vuelve a traer de Trello.' : ''}`) && guardar({ accion: 'borrarPedido', id: p.id, nro: p.nroProveedor, huella: huellaPedido(p.lineas) })}
          style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button></td>
      </tr>
      {abierta === p.id && <tr><td colSpan={7} style={{ ...td, background: 'rgba(255,255,255,0.03)' }}>
        {consejos.get(p.id) && <div style={{ marginBottom: 6 }}>{consejos.get(p.id)!.texto} <strong>{consejos.get(p.id)!.tarjeta}</strong></div>}
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
  const cambiarProv = (p: Prov) => { setPlanCarga(null); setVerRegistro(false); provRef.current = p; setProv(p); setAvisos([]); setInforme(null); setAbierta(null); setFacturaDeposito(''); setVista('entregas'); setNuevaFactura(null); setNuevasFotos([]); };

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
  if (prov === 'family') return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '0.5rem' }}>
      {cabecera}{registro}
      <div style={{ display: verRegistro ? 'none' : undefined }}><ControlFamily /></div>
    </div>
  );

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '0.5rem' }}>
      {cabecera}{registro}
      <div style={{ display: verRegistro ? 'none' : undefined }}>

      {sinBase && <p style={{ color: '#fbbf24', fontSize: '0.9rem' }}>⚠ Falta conectar la base de datos al proyecto en Vercel. Sin ella no se pueden guardar las entregas.</p>}
      {error && !sinBase && <p style={{ color: '#f87171', fontWeight: 'bold' }}>⚠ {error}</p>}
      {ocupado && <p style={{ fontSize: '0.88rem', color: '#93c5fd' }}>⏳ {ocupado}</p>}
      {avisos.length > 0 && <div style={{ fontSize: '0.84rem', margin: '6px 0 12px', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
        {avisos.map((a, i) => <div key={i}>• {a}</div>)}
      </div>}

      {vista !== 'entregas' && <button style={{ ...enlace, marginBottom: 10 }} onClick={() => setVista('entregas')}>← Volver a las entregas</button>}

      {vista === 'entregas' && (
        <div>
          <div style={{ border: '1px solid rgba(99,102,241,0.55)', borderRadius: 10, padding: '12px 14px', background: 'rgba(99,102,241,0.08)', marginBottom: 16 }}>
            <strong style={{ fontSize: '1rem' }}>Nueva entrega</strong>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <Archivo etiqueta="1 · 🧾 Factura (PDF)" accept=".pdf" disabled={!!ocupado} onArchivos={(f) => setNuevaFactura(f[0])} />
              <span style={{ fontSize: '0.82rem', opacity: nuevaFactura ? 1 : 0.5 }}>{nuevaFactura ? `✔ ${nuevaFactura.name}` : 'sin elegir'}</span>
              <Archivo etiqueta="2 · 📷 Foto del remito" accept="image/*" multiple disabled={!!ocupado} onArchivos={(f) => setNuevasFotos(f)} />
              <span style={{ fontSize: '0.82rem', opacity: nuevasFotos.length ? 1 : 0.5 }}>{nuevasFotos.length ? `✔ ${nuevasFotos.length} foto(s)` : 'sin elegir'}</span>
              <button style={{ ...botonPrincipal, opacity: nuevaFactura && !ocupado ? 1 : 0.5, cursor: nuevaFactura && !ocupado ? 'pointer' : 'not-allowed' }}
                disabled={!nuevaFactura || !!ocupado} onClick={controlarEntrega}>Controlar</button>
            </div>
            <p style={{ fontSize: '0.8rem', opacity: 0.75, margin: '8px 0 0' }}>
              La nota de pedido la busco sola en Trello. Si no la encuentro, te la pido en la entrega. Primero controlo que el remito traiga lo mismo que la factura; después, que la nota de pedido coincida con lo facturado y lo que llegó. Hasta tener las tres cosas, la entrega queda «incompleta».
            </p>
          </div>

          {!facturasRes.length && !cargando && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no hay entregas cargadas de este proveedor.</p>}
          {facturasRes.map((r) => <TarjetaEntrega key={r.factura.id} r={r} abierta={abierta === r.factura.id}
            onAbrir={() => setAbierta(abierta === r.factura.id ? null : r.factura.id)} pedidos={pedidosOrd} cerradas={cerradas} nombrePedido={nombrePedido}
            manual={datos.asignaciones[r.factura.id] || []} condiciones={condiciones} ocupado={!!ocupado}
            onAsignar={(ids) => guardar({ accion: 'guardarAsignacion', facturaId: r.factura.id, pedidos: ids })}
            onBorrar={() => confirm(`¿Borrar la entrega de la factura ${r.factura.numero}? Se borran también el remito y lo que contó el depósito.`) && guardar({ accion: 'borrarFactura', id: r.factura.id })}
            onDeposito={() => { setFacturaDeposito(r.factura.id); setVista('deposito'); }}
            onFotos={(f) => fotosParaFactura(r.factura.id, f)}
            onGuardarRemito={(remito) => guardar({ accion: 'guardarRemito', facturaId: r.factura.id, remito })}
            onBorrarRemito={() => confirm('¿Borrar el remito de esta entrega?') && guardar({ accion: 'borrarRemito', facturaId: r.factura.id })}
            onNota={(f) => subirPedidos(f, r.factura.fecha, r.factura.id)}
            onTrello={() => buscarEnTrelloParaFactura(r.factura)} res={res} todas={pedidosControl} consejos={consejos}
            informe={informe?.prov === prov && informe.facturaId === r.factura.id ? informe : null} onRecargarBorrada={recargarBorrada}
            carga={prov === 'id' ? {
              cargas: datos.cargas ?? {}, plan: planCarga?.entregaId === r.factura.id ? planCarga : null,
              onArmar: () => armarCarga(r), onConfirmar: (e) => planCarga && confirmarCarga(r, planCarga, e),
              onCancelar: () => setPlanCarga(null), onLiberar: (codigo, c) => liberarCarga(r.factura.id, codigo, c),
            } : undefined} />)}

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
            <Archivo etiqueta="➕ Subir nota(s) Excel" accept=".xlsx,.xls" multiple disabled={!!ocupado} onArchivos={(f) => subirPedidos(f, fechaPedido)} />
            {prov === 'distrinando' && <label style={{ fontSize: '0.85rem' }}>fecha en que se mandó{' '}
              <input type="date" value={fechaPedido} onChange={(e) => setFechaPedido(e.target.value)} style={inputSt} /></label>}
          </div>
          <p style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: 0 }}>
            {prov === 'id' ? 'La fecha de cada nota sale de la fila 1 del Excel de iD.' : 'Distrinando no trae la fecha en el Excel: poné la del día que lo mandaste.'} La fecha ordena qué nota se factura primero; se puede corregir abajo.
          </p>
          <ListasTrelloCaja listas={listasTablero} elegidas={datos.listasTrello} ocupado={!!ocupado} onElegir={elegirListas} />
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
          {facturasRes.map((r) => <pre key={r.factura.id} style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', background: 'rgba(0,0,0,0.25)', padding: 8, borderRadius: 6 }}>{mensajePagos(r, condiciones, nombrePedido)}</pre>)}
          {facturasRes.length > 0 && <Copiar etiqueta="📋 Copiar todos" texto={facturasRes.map((r) => mensajePagos(r, condiciones, nombrePedido)).join('\n\n')} />}
          <h3 style={{ fontSize: '1rem' }}>Pendiente de entrega por nota y talle</h3>
          <Pendientes res={res} nombrePedido={nombrePedido} ocultar={cerradas} />
        </div>
      )}
      </div>
    </div>
  );
}

/** Estado de un renglón para la tabla: lo más grave primero. */
function estadoRenglon(x: ControlRenglon, nombrePedido: (id: string) => string): [string, string] {
  const rojo = '#f87171', amarillo = '#fbbf24';
  if (x.posibleDobleCobro) return ['❌ doble cobro', rojo];
  if (x.sinPedir > 0) return [`❌ ${x.sinPedir} sin pedir`, rojo];
  if (x.remito !== null && x.remito < x.cantidad) return [`❌ el remito trae ${x.remito}`, rojo];
  const dif = x.difPrecio.reduce((t, d) => t + d.diferencia, 0);
  if (dif > 0) return [`❌ +${fmt(dif)} neto`, rojo];
  if (x.difPrecio.length) return [`⚠️ precio distinto (${fmt(dif)})`, amarillo];
  if (!x.totalOk) return ['⚠️ renglón mal calculado', amarillo];
  if (x.remito !== null && x.remito > x.cantidad) return [`⚠️ el remito trae ${x.remito}`, amarillo];
  if (x.otraNota.length) return [`⚠️ de la nota ${x.otraNota.map(nombrePedido).join(', ')}`, amarillo];
  if (x.faltante > 0) return [`⚠️ faltan ${x.faltante}`, amarillo];
  if (x.asignaciones.some((a) => a.adelanto)) return ['⚠️ adelanto', amarillo];
  return ['✅', '#34d399'];
}


function TarjetaEntrega({ r, abierta, onAbrir, pedidos, cerradas, nombrePedido, manual, condiciones, ocupado, onAsignar, onBorrar, onDeposito, onFotos, onGuardarRemito, onBorrarRemito, onNota, onTrello, informe, onRecargarBorrada, res, todas, consejos, carga }: {
  r: ResultadoFactura; abierta: boolean; onAbrir: () => void; pedidos: PedidoGuardado[]; cerradas: Set<string>; nombrePedido: (id: string) => string;
  res: ResultadoGeneral; todas: PedidoGuardado[]; consejos: Map<string, ConsejoNota>;
  manual: string[]; condiciones: string; ocupado: boolean; onAsignar: (ids: string[]) => void; onBorrar: () => void; onDeposito: () => void;
  onFotos: (f: File[]) => void; onGuardarRemito: (r: Remito) => Promise<boolean>; onBorrarRemito: () => void; onNota: (f: File[]) => void; onTrello: () => void;
  informe: InformeTrello | null; onRecargarBorrada: (f: FilaTrello) => void;
  /** iD: carga en Shopify (Martínez). */
  carga?: {
    cargas: Record<string, CargaFamily>; plan: PlanCarga | null; onArmar: () => void; onConfirmar: (e: EleccionesCarga) => void;
    onCancelar: () => void; onLiberar: (codigo: string, c: CargaFamily) => void;
  };
}) {
  const f = r.factura;
  const enShopify = carga ? estadoCargaFactura(r, carga.cargas) : null;
  // Marcas que no terminaron bien (o quedaron «en curso» si se cerró la página): se revisan en Shopify y se liberan a mano.
  const aRevisar = carga ? Object.entries(carga.cargas).filter(([k, c]) => k.startsWith(`${f.id}|`) && c.estado !== 'cargada').map(([k, c]) => [k.slice(f.id.length + 1), c] as const) : [];
  const s = SEMAFORO[r.semaforo];
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
        <strong>{abierta ? '▾' : '▸'} Factura {f.numero}</strong>
        <span style={{ opacity: 0.8, fontSize: '0.85rem' }}>{fechaAr(f.fecha)} · {r.unidades} u. · {fmt(f.total)}{f.vencimiento ? ` · vence ${fechaAr(f.vencimiento)}` : ''}</span>
        <span style={{ color: s.color, fontWeight: 'bold' }}>{s.icono} {s.texto}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Parte ok titulo="Factura" detalle={`${f.renglones.length} artículos`} />
        <Parte ok={!r.faltaRemito} titulo="Remito" detalle={r.remito ? `${r.remito.numero || ''} · ${unidadesRemito} u.${r.remito.origen === 'foto' ? ' (de la foto)' : ''}` : 'falta'}>
          {r.faltaRemito && <Archivo etiqueta="📷 Subir foto" accept="image/*" multiple disabled={ocupado} estilo={botonChico} onArchivos={onFotos} />}
          <button style={botonChico} onClick={() => (editando ? setEditando(false) : abrirEditor())}>{r.remito ? '✏️ Ver o corregir' : '✏️ Escribirlo'}</button>
        </Parte>
        <Parte ok={!r.faltaNota && !r.codigosSinNota.length} titulo="Nota de pedido"
          detalle={r.faltaNota ? 'falta: no la encontré en Trello' : `${notas || '—'}${r.codigosSinNota.length ? ` · falta la de ${r.codigosSinNota.length} artículo(s)` : ''}`}>
          {(r.faltaNota || r.codigosSinNota.length > 0) && <>
            <button style={botonChico} disabled={ocupado} onClick={onTrello}>🗂️ Buscar en Trello</button>
            <Archivo etiqueta="📎 Subir nota" accept=".xlsx,.xls" multiple disabled={ocupado} estilo={botonChico} onArchivos={onNota} />
          </>}
        </Parte>
        {carga && enShopify && <Parte ok={enShopify.completa} titulo="Shopify" detalle={enShopify.cargados ? `${enShopify.cargados} de ${enShopify.total} cargados en Martínez` : 'sin cargar'}>
          {!enShopify.completa && !carga.plan && <button style={{ ...botonChico, opacity: r.remito && !ocupado ? 1 : 0.5 }} disabled={ocupado}
            title={r.remito ? 'Suma lo que llegó en DEPOSITO MARTINEZ, con vista previa y confirmación' : 'Primero subí o escribí el remito'}
            onClick={carga.onArmar}>⬆️ Cargar en Shopify</button>}
        </Parte>}
      </div>
      <Controles r={r} unidadesRemito={unidadesRemito} pendiente={pendiente} />
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
        explicacion="Lo que llegó (el remito, menos lo que salió para órdenes) se SUMA al stock de Martínez; el stock de iD lo lleva la sincronización. Antes de sumar, el costo de la factura va a los talles que llegan y a los que están en 0 en Martínez (si un talle que llega ya tenía stock, lleva el promedio ponderado), y si el margen no llega al 50% hay que poner un precio nuevo para toda la curva. Los productos que no están en Shopify se crean desde Sincronización." />}
      <TarjetasTrello ids={r.pedidosCubiertos} pedidos={pedidos} />
      {r.semaforo !== 'incompleta' && r.pedidosCubiertos.length > 0 && <PlanillasMarcadas r={r} res={res} pedidos={todas} nombrePedido={nombrePedido} ocupado={ocupado} consejos={consejos} />}
      {informe && <InformeTrelloCaja informe={informe} ocupado={ocupado} onRecargar={onRecargarBorrada} />}

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
            {r.remito && <Archivo etiqueta="📷 Volver a leer de la foto" accept="image/*" multiple disabled={ocupado} estilo={botonChico} onArchivos={(x) => { setEditando(false); onFotos(x); }} />}
            {r.remito && <button style={{ ...botonChico, color: '#f87171' }} onClick={onBorrarRemito}>Borrar remito</button>}
          </div>
        </div>
      )}

      {r.motivos.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.84rem' }}>{r.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
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
                const [estado, color] = estadoRenglon(x, nombrePedido);
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Copiar etiqueta="📋 Mensaje para pagos" texto={mensajePagos(r, condiciones, nombrePedido)} />
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

/**
 * Los dos controles, en orden (gax, 12-nov-2026: «todo esto ya está pagado; es control y carga»):
 * 1. el remito trae lo mismo que la factura; 2. la nota de pedido coincide con lo facturado y lo que llegó.
 */
function Controles({ r, unidadesRemito, pendiente }: { r: ResultadoFactura; unidadesRemito: number; pendiente: number }) {
  const linea = (ok: boolean | null, texto: string) => (
    <div style={{ color: ok === null ? '#94a3b8' : ok ? '#34d399' : '#f87171' }}>{ok === null ? '⏳' : ok ? '✔' : '✖'} {texto}</div>
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

/** La copia más nueva de la planilla en Trello (la original si no hay otras). */
function planillaBase(p: PedidoGuardado): { tarjeta: string; adjunto: string } | null {
  const ultima = p.copias?.[p.copias.length - 1];
  if (ultima) return ultima;
  const adj = /^T-([a-f0-9]{24})$/.exec(p.id)?.[1];
  const tarjeta = tarjetaDeNota(p);
  return adj && tarjeta ? { tarjeta, adjunto: adj } : null;
}

/**
 * Planillas de las notas de esta entrega con lo que llegó pintado en verde (12-nov-2026, gax: «que la
 * app devuelva las planillas de Excel marcadas; mi empleado las sube a Trello»). La app no escribe en
 * Trello: baja la última planilla de la tarjeta, la pinta y la descarga.
 */
function PlanillasMarcadas({ r, res, pedidos, nombrePedido, ocupado, consejos }: {
  r: ResultadoFactura; res: ResultadoGeneral; pedidos: PedidoGuardado[]; nombrePedido: (id: string) => string; ocupado: boolean; consejos: Map<string, ConsejoNota>;
}) {
  const [mensajes, setMensajes] = useState<Record<string, string>>({});
  const [trabajando, setTrabajando] = useState('');
  const [pedirArchivo, setPedirArchivo] = useState<Record<string, boolean>>({});
  const notas = useMemo(() => r.pedidosCubiertos.map((id) => {
    const p = pedidos.find((x) => x.id === id);
    let m: MarcasNota | null;
    try { m = p ? marcasDeNota(res, r.factura.id, pedidos, id) : null; } catch { m = null; }
    return { id, p, m };
  }), [r, res, pedidos]);
  const decir = (id: string, t: string) => setMensajes((x) => ({ ...x, [id]: t }));

  async function descargar(p: PedidoGuardado, archivo?: File) {
    setTrabajando(p.id);
    decir(p.id, '');
    try {
      let buf: ArrayBuffer;
      if (archivo) buf = await archivo.arrayBuffer();
      else {
        const base = planillaBase(p);
        if (!base) { setPedirArchivo((x) => ({ ...x, [p.id]: true })); decir(p.id, 'Esta nota se subió a mano: elegí la planilla para marcarla.'); return; }
        const b = await bajarAdjunto(base.tarjeta, base.adjunto);
        if (!b.completo) {
          setPedirArchivo((x) => ({ ...x, [p.id]: true }));
          decir(p.id, 'La planilla de Trello pesa mucho para bajarla desde la app: descargala de la tarjeta y elegila acá.');
          return;
        }
        buf = b.buf;
      }
      // Las celdas salen de la misma planilla (las notas cargadas antes del 12-nov no las tienen guardadas).
      const { filas, hoja } = leerHoja(buf, hoyAr());
      const leida = leerPedidoAuto(filas, p.id, p.nombre, p.fecha, hoja);
      const conCeldas = fusionarPlanilla(p, leida.pedido.lineas) ?? p;
      const m = marcasDeNota(res, r.factura.id, pedidos.map((x) => (x.id === p.id ? conCeldas : x)), p.id);
      if (!m.celdas.length) throw new Error('No encontré en la planilla las celdas de lo que llegó: marcalo a mano.');
      const out = marcarPlanilla(new Uint8Array(buf), m.celdas, { nro: p.nroProveedor, cantidades: m.cantidades });
      const url = URL.createObjectURL(new Blob([new Uint8Array(out)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivoPlanilla(p, hoyAr());
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setPedirArchivo((x) => ({ ...x, [p.id]: false }));
      decir(p.id, `✔ Descargada${m.sinTalle.length ? `. Ojo: ${m.sinTalle.map((x) => `${x.codigo} (${x.unidades})`).join(', ')} llegó sin saber el talle: pintalo a mano` : ''}. Subila a la tarjeta de Trello.`);
    } catch (e) { decir(p.id, `⚠ ${mensaje(e)}`); }
    finally { setTrabajando(''); }
  }

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.3)', fontSize: '0.83rem' }}>
      <strong>📥 Planilla para Trello con lo que llegó en verde</strong>
      {notas.map(({ id, p, m }) => {
        if (!p || !m) return null;
        const pedido = m.codigos.reduce((s, c) => s + c.pedido, 0);
        const llegaron = m.codigos.reduce((s, c) => s + c.llegaron, 0);
        const c = consejos.get(id);
        return (
          <div key={id} style={{ marginTop: 6 }}>
            <div>
              <strong>{nombrePedido(id)}</strong>
              {(p.nroProveedor || p.fecha) && <span style={{ opacity: 0.85 }}>
                {p.nroProveedor && p.nombre ? <> · {p.origen?.startsWith('trello:') ? 'tarjeta' : 'archivo'} {p.enlace ? <a href={p.enlace} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>«{p.nombre}»</a> : `«${p.nombre}»`}</> : ''}
                {p.fecha ? ` · del ${fechaAr(p.fecha)}` : ''}
              </span>}
              : {m.estaEntrega.length ? `en esta entrega llegó ${m.estaEntrega.map((x) => `${x.codigo} ${x.talle}×${x.cantidad}`).join(', ')}` : 'en esta entrega no se sabe de qué talles'}
              {' · '}hasta acá llegaron {llegaron} de {pedido} u.
              {m.facturas.length > 1 ? ` (con ${m.facturas.length - 1} entrega(s) anterior(es))` : ''}
            </div>
            {c && c.tipo !== 'nada' && <div style={{ marginTop: 3, padding: '4px 8px', borderRadius: 6, background: c.tipo === 'finalizar' ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.13)' }}>
              <strong>Hoy:</strong> {c.texto} <strong>{c.tarjeta}</strong>
              {c.tipo === 'parcial' && c.falta.length > 0 && <div style={{ opacity: 0.85 }}>Falta: {c.falta.slice(0, 8).map((x) => `${x.codigo} ${x.descripcion} (${x.unidades} u.)`).join(' · ')}{c.falta.length > 8 ? ` y ${c.falta.length - 8} más` : ''}</div>}
            </div>}
            {m.sinTalle.length > 0 && <div style={{ color: '#fbbf24' }}>Sin talle identificado: {m.sinTalle.map((x) => `${x.codigo} (${x.unidades})`).join(', ')}. Cargá los talles en el remito o pintalos a mano.</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
              <button style={botonChico} disabled={ocupado || !!trabajando} onClick={() => descargar(p)}>{trabajando === id ? 'Preparando…' : '📥 Descargar planilla marcada'}</button>
              {pedirArchivo[id] && <Archivo etiqueta="📎 Elegir la planilla" accept=".xlsx" disabled={!!trabajando} estilo={botonChico} onArchivos={(f) => f[0] && descargar(p, f[0])} />}
              {mensajes[id] && <span style={{ color: mensajes[id].startsWith('⚠') ? '#f87171' : undefined }}>{mensajes[id]}</span>}
            </div>
          </div>
        );
      })}
      <div style={{ opacity: 0.7, marginTop: 6 }}>Se baja la última planilla de la tarjeta y se pintan en verde los talles que llegaron (también los de entregas anteriores). Las fotos y el formato quedan iguales. La app no la sube: la sube tu empleado a la tarjeta.</div>
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

/** De qué listas de Trello salen las notas (por defecto, las que dicen «pendiente»). */
function ListasTrelloCaja({ listas, elegidas, ocupado, onElegir }: { listas: ListaTrello[] | null; elegidas: string[]; ocupado: boolean; onElegir: (ids: string[]) => void }) {
  const usadas = listas ? listasDePendientes(listas, elegidas) : [];
  const ids = usadas.map((l) => l.id);
  return (
    <details style={{ fontSize: '0.8rem', margin: '0 0 10px' }}>
      <summary style={{ cursor: 'pointer' }}>
        🗂️ Listas de Trello de donde salen las notas: {listas ? (usadas.length ? usadas.map((l) => `«${l.nombre}»`).join(', ') : 'ninguna') : 'las que dicen «pendiente» en el nombre'}{elegidas.length ? '' : ' (automático)'}
      </summary>
      <p style={{ opacity: 0.75, margin: '4px 0' }}>Solo esas tarjetas traen notas. Una nota cuya tarjeta pasó a otra lista no se usa sola para las facturas nuevas (sí si la tildás a mano en la entrega).</p>
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
        🗂️ Lo que revisé en Trello ({informe.hora}){informe.tablero ? ` · tablero «${informe.tablero}»` : ''}: {informe.tarjetas} tarjeta(s){informe.listas?.length ? ` en ${informe.listas.map((l) => `«${l}»`).join(' y ')}` : ' abiertas'}, {informe.conExcel} con Excel.
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
      {informe.otroProveedor > 0 && <div style={{ opacity: 0.7, marginTop: 4 }}>{informe.otroProveedor} Excel son de otro proveedor (no se volvieron a bajar).</div>}
    </div>
  );
}

function TarjetasTrello({ ids, pedidos }: { ids: string[]; pedidos: PedidoGuardado[] }) {
  const tarjetas = ids.map((id) => pedidos.find((p) => p.id === id)).filter((p): p is PedidoGuardado => !!enlaceTrello(p));
  const vistas = new Set<string>();
  const unicas = tarjetas.filter((p) => !vistas.has(enlaceTrello(p)) && vistas.add(enlaceTrello(p)));
  if (!unicas.length) return null;
  return (
    <div style={{ fontSize: '0.84rem', marginTop: 6 }}>
      🗂️ En Trello: {unicas.map((p, i) => <Fragment key={p.id}>{i ? ' + ' : ''}<a href={enlaceTrello(p)} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>{p.nombre}</a></Fragment>)}
    </div>
  );
}
