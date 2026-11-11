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
  analizarFacturas, claveCodigo, claveRecepcion, huellaPedido, compararRecepcion, fmt, mensajePagos, reporteReclamo, resumenPedidos,
  type ControlRenglon, type Factura, type Pedido, type Recepcion, type Remito, type ResultadoFactura,
} from './utils/controlFacturas';
import { leerFacturaDistrinando, leerFacturaId, leerPedidoAuto, leerTextoRemito, textoRemito, type ItemPdf } from './utils/lectoresFacturas';
import ControlFamily from './ControlFamily';
import RegistroCargas from './RegistroCargas';
import EnlacesRapidos from './EnlacesRapidos';
import { Archivo, Copiar, Parte } from './EntregasPartes';
import {
  apiControl, boton, botonChico, botonPrincipal, enlace, fechaAr, hoy, inputSt, leerFotos, mensaje, slug, td, th,
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
}
/** Versión del lector de Excel de Trello. Subirla cuando cambie: los descartados se revisan de nuevo. */
const LECTOR_TRELLO = 3;
const VACIO: Datos = { pedidos: [], facturas: [], asignaciones: {}, recepciones: {}, remitos: {}, config: {}, trelloVistos: {} };
const PROVS: { id: Prov; nombre: string }[] = [
  { id: 'id', nombre: 'iD (Converse, Le Coq)' },
  { id: 'distrinando', nombre: 'Distrinando (Reebok, Kappa, Crocs)' },
  { id: 'family', nombre: 'Family (sin factura)' },
];
type Vista = 'entregas' | 'pedidos' | 'deposito' | 'reportes';
interface AdjuntoTrello { id: string; nombre: string }
interface TarjetaTrello { id: string; nombre: string; enlace: string; lista: string; creada: string; inicio: string; adjuntos: AdjuntoTrello[]; otrosAdjuntos?: string[] }
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

async function bajarAdjunto(tarjeta: string, adjunto: string): Promise<ArrayBuffer> {
  const r = await fetch(`/api/trello?accion=adjunto&tarjeta=${tarjeta}&adjunto=${adjunto}`, { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { status: r.status });
  const bin = atob(d.datos);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

const SEMAFORO = {
  ok: { icono: '✅', texto: 'OK para pagar', color: '#34d399' },
  observaciones: { icono: '⚠️', texto: 'Con observaciones', color: '#fbbf24' },
  reclamar: { icono: '❌', texto: 'Reclamar, no pagar', color: '#f87171' },
  incompleta: { icono: '⏳', texto: 'Incompleta, no pagar todavía', color: '#94a3b8' },
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

  const res = useMemo(() => analizarFacturas(datos.pedidos, datos.facturas, datos.asignaciones, datos.remitos), [datos]);
  const resumen = useMemo(() => resumenPedidos(datos.pedidos, res), [datos.pedidos, res]);
  const nombrePedido = (id: string) => { const p = datos.pedidos.find((x) => x.id === id); return p ? (p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre) : id; };

  async function guardar(body: object) {
    setError('');
    try { await api({ proveedor: prov, ...body }); await recargar(); return true; }
    catch (e) { setError(mensaje(e)); return false; }
  }

  /** Lee un Excel de pedido. Devuelve el pedido listo para guardar, o por qué no se carga. */
  function prepararPedido(buf: ArrayBuffer, archivo: string, fecha: string, extra: { id?: string; nombre?: string; origen: string; enlace?: string },
    existentes: PedidoGuardado[]): { pedido?: PedidoGuardado; mensajes: string[]; descartado?: string; repetidoId?: string; leido?: { lineas: PedidoGuardado['lineas']; nroProveedor?: string } } {
    const wb = XLSX.read(buf);
    const hoja = wb.SheetNames.find((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden) || wb.SheetNames[0];
    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, raw: true });
    const nombre = extra.nombre || archivo.replace(/\.[^.]+$/, '');
    const r = leerPedidoAuto(filas, '', nombre, fecha);
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
    const pedido = { ...r.pedido, id, nroProveedor: r.nroProveedor, origen: extra.origen, enlace: extra.enlace || '' };
    return { pedido, mensajes: [`${archivo}: ${r.pedido.lineas.reduce((s, l) => s + l.cantidad, 0)} unidades guardadas con fecha ${fechaAr(fechaNota)}${r.fechaArchivo ? ' (la del archivo)' : ''}.`, ...r.avisos] };
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
      const tarjetas = (d.tarjetas || []) as TarjetaTrello[];
      Object.assign(informe, { tablero: String(d.tablero || ''), tarjetas: tarjetas.length, conExcel: tarjetas.filter((t) => t.adjuntos.length).length });
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
      for (const t of tarjetas) {
        for (const nombre of t.otrosAdjuntos || []) informe.filas.push({ tarjeta: t.nombre, enlace: t.enlace, archivo: nombre, estado: 'no es excel', detalle: 'no es un Excel subido a la tarjeta', deEstaFactura: 0 });
        for (const a of t.adjuntos) {
          const ya = existentes.find((p) => p.id === `T-${a.id}`);
          if (ya) { fila(t, a, 'ya estaba', 'nota ya cargada', { deEstaFactura: deLaFactura(ya.lineas) }); continue; }
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
      const procesar = async (lista: { t: TarjetaTrello; a: AdjuntoTrello }[], primero = false) => {
        const LOTE = 4;
        for (let i = 0; i < lista.length; i += LOTE) {
          setOcupado(`Leyendo los Excel de Trello: ${Math.min(i + LOTE, lista.length)} de ${lista.length}…`);
          const lote = lista.slice(i, i + LOTE);
          const bajados = await Promise.all(lote.map(({ t, a }) => bajarAdjunto(t.id, a.id).then((b) => b, (e) => e as Error)));
          for (let j = 0; j < lote.length; j++) {
            const { t, a } = lote[j];
            const buf = bajados[j];
            const marca = vistos[a.id];
            // Falla de red: no se anota, se reintenta la próxima vez.
            if (buf instanceof Error) {
              // Un archivo que no existe más o es demasiado grande no se va a poder leer nunca: no frena el resto.
              const definitivo = [400, 403, 404, 413].includes((buf as Error & { status?: number }).status ?? 0);
              if (primero && !definitivo && !sinRevisarBorradas) sinRevisarBorradas = `«${t.nombre}» ${a.nombre}`;
              fallas.push(`«${t.nombre}» ${a.nombre}: ${buf.message}`); fila(t, a, 'falla', `no lo pude bajar: ${buf.message}`); continue;
            }
            let leidas = 0;
            try {
              let res: ReturnType<typeof prepararPedido>;
              try {
                res = prepararPedido(buf, a.nombre, t.inicio || t.creada, { id: `T-${a.id}`, nombre: t.nombre, origen: `trello:${t.id}`, enlace: t.enlace }, existentes);
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
              } else {
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
      const cubierta = () => existentes.some((p) => deLaFactura(p.lineas) > 0);
      if (factura && fase2.length && (profunda === true || (profunda === 'si-falta' && !cubierta()))) await procesar(fase2);
      else informe.sinRevisar += fase2.length;
      informe.cubierta = !!factura && cubierta();
      const out = cargados.length ? [`Trello: traje ${cargados.length} nota(s) de pedido nueva(s): ${cargados.join(', ')}.`] : [];
      if (otros) out.push(`Trello: ${otros} Excel no eran notas nuevas de este proveedor (otro proveedor, repetidas, borradas o ilegibles).`);
      if (fallas.length) out.push(`Trello: no pude bajar o guardar ${fallas.length} Excel (${fallas.slice(0, 2).join('; ')}); se reintenta la próxima vez.`);
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
  // Las notas subidas a mano y borradas también se anotan ahí (con «P:»), pero no son Excel de Trello.
  const excelTrello = Object.entries(datos.trelloVistos).filter(([k]) => /^[a-f0-9]{24}$/.test(k)).map(([, v]) => v);
  const facturasRes = [...res.facturas].reverse();
  const cambiarProv = (p: Prov) => { setVerRegistro(false); provRef.current = p; setProv(p); setAvisos([]); setInforme(null); setAbierta(null); setFacturaDeposito(''); setVista('entregas'); setNuevaFactura(null); setNuevasFotos([]); };

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
              La nota de pedido la busco sola en Trello. Si no la encuentro, te la pido en la entrega. Hasta tener las tres cosas, la entrega queda «incompleta» y no se paga.
            </p>
          </div>

          {!facturasRes.length && !cargando && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no hay entregas cargadas de este proveedor.</p>}
          {facturasRes.map((r) => <TarjetaEntrega key={r.factura.id} r={r} abierta={abierta === r.factura.id}
            onAbrir={() => setAbierta(abierta === r.factura.id ? null : r.factura.id)} pedidos={pedidosOrd} nombrePedido={nombrePedido}
            manual={datos.asignaciones[r.factura.id] || []} condiciones={condiciones} ocupado={!!ocupado}
            onAsignar={(ids) => guardar({ accion: 'guardarAsignacion', facturaId: r.factura.id, pedidos: ids })}
            onBorrar={() => confirm(`¿Borrar la entrega de la factura ${r.factura.numero}? Se borran también el remito y lo que contó el depósito.`) && guardar({ accion: 'borrarFactura', id: r.factura.id })}
            onDeposito={() => { setFacturaDeposito(r.factura.id); setVista('deposito'); }}
            onFotos={(f) => fotosParaFactura(r.factura.id, f)}
            onGuardarRemito={(remito) => guardar({ accion: 'guardarRemito', facturaId: r.factura.id, remito })}
            onBorrarRemito={() => confirm('¿Borrar el remito de esta entrega?') && guardar({ accion: 'borrarRemito', facturaId: r.factura.id })}
            onNota={(f) => subirPedidos(f, r.factura.fecha, r.factura.id)}
            onTrello={() => buscarEnTrelloParaFactura(r.factura)}
            informe={informe?.prov === prov && informe.facturaId === r.factura.id ? informe : null} onRecargarBorrada={recargarBorrada} />)}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 16, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button style={enlace} onClick={() => setVista('pedidos')}>📋 Notas de pedido cargadas ({datos.pedidos.length})</button>
            <button style={enlace} onClick={() => setVista('deposito')}>📦 Checklist del depósito</button>
            <button style={enlace} onClick={() => setVista('reportes')}>💬 Mensajes para pagos y pendientes</button>
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
          {excelTrello.length > 0 && (
            <details style={{ fontSize: '0.8rem', margin: '0 0 10px', opacity: 0.85 }}>
              <summary style={{ cursor: 'pointer' }}>{excelTrello.length} Excel de Trello que no se cargaron como notas de este proveedor</summary>
              {excelTrello.map((v, i) => <div key={i}>• {v.motivo || 'sin detalle'}{v.fecha ? ` (${fechaAr(v.fecha)})` : ''}</div>)}
            </details>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.84rem', width: '100%' }}>
              <thead><tr><th style={th}>Nota</th><th style={th}>Fecha</th><th style={th}>Pedido u.</th><th style={th}>Facturado</th><th style={th}>Pendiente</th><th style={th}>Estado</th><th style={th}></th></tr></thead>
              <tbody>{pedidosOrd.map((p) => {
                const r = resumen.find((x) => x.pedidoId === p.id)!;
                const det = res.pendientes.filter((x) => x.pedidoId === p.id);
                return (<Fragment key={p.id}>
                  <tr>
                    <td style={td}><button onClick={() => setAbierta(abierta === p.id ? null : p.id)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                      {abierta === p.id ? '▾' : '▸'} {p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre}</button>
                      {enlaceTrello(p) && <> · <a href={enlaceTrello(p)} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>🗂️ {p.nroProveedor ? p.nombre : 'Trello'}</a></>}</td>
                    <td style={td}><input type="date" value={p.fecha} style={inputSt}
                      onChange={(e) => e.target.value && guardar({ accion: 'guardarPedido', pedido: { ...p, fecha: e.target.value } })} /></td>
                    <td style={td}>{r.pedido}</td><td style={td}>{r.facturado}</td><td style={td}>{r.pendiente}</td>
                    <td style={{ ...td, color: r.estado === 'completo' ? '#34d399' : r.estado === 'parcial' ? '#fbbf24' : undefined }}>{r.estado}</td>
                    <td style={td}><button onClick={() => confirm(`¿Borrar la nota ${p.nombre}?${enlaceTrello(p) ? ' No se vuelve a traer de Trello.' : ''}`) && guardar({ accion: 'borrarPedido', id: p.id, nro: p.nroProveedor, huella: huellaPedido(p.lineas) })}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button></td>
                  </tr>
                  {abierta === p.id && <tr><td colSpan={7} style={{ ...td, background: 'rgba(255,255,255,0.03)' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead><tr><th style={th}>Código</th><th style={th}>Descripción</th><th style={th}>Talle</th><th style={th}>Pedido</th><th style={th}>Facturado</th><th style={th}>Pendiente</th></tr></thead>
                      <tbody>{det.map((d, i) => <tr key={i}><td style={td}>{d.codigo}</td><td style={td}>{d.descripcion}</td><td style={td}>{d.talle}</td><td style={td}>{d.pedido}</td>
                        <td style={td}>{d.facturado ?? 'a confirmar'}</td><td style={td}>{d.pendiente ?? 'a confirmar'}</td></tr>)}</tbody>
                    </table></td></tr>}
                </Fragment>);
              })}</tbody>
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
          <Pendientes res={res} nombrePedido={nombrePedido} />
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


function TarjetaEntrega({ r, abierta, onAbrir, pedidos, nombrePedido, manual, condiciones, ocupado, onAsignar, onBorrar, onDeposito, onFotos, onGuardarRemito, onBorrarRemito, onNota, onTrello, informe, onRecargarBorrada }: {
  r: ResultadoFactura; abierta: boolean; onAbrir: () => void; pedidos: PedidoGuardado[]; nombrePedido: (id: string) => string;
  manual: string[]; condiciones: string; ocupado: boolean; onAsignar: (ids: string[]) => void; onBorrar: () => void; onDeposito: () => void;
  onFotos: (f: File[]) => void; onGuardarRemito: (r: Remito) => Promise<boolean>; onBorrarRemito: () => void; onNota: (f: File[]) => void; onTrello: () => void;
  informe: InformeTrello | null; onRecargarBorrada: (f: FilaTrello) => void;
}) {
  const f = r.factura;
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
      </div>
      <TarjetasTrello ids={r.pedidosCubiertos} pedidos={pedidos} />
      {informe && <InformeTrelloCaja informe={informe} ocupado={ocupado} onRecargar={onRecargarBorrada} />}

      {editando && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: '0.82rem', opacity: 0.85, marginBottom: 6 }}>
            Una línea por artículo: código y después talle/cantidad. Ej.: <code>571818C 5.0/1 6.0/2 6.5/3</code>. Si no tiene talles: <code>A10520C 3</code>.
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
            <p style={{ opacity: 0.75, margin: '4px 0' }}>Las notas tildadas se usan primero; el resto sigue por fecha.</p>
            {pedidos.map((p) => <label key={p.id} style={{ display: 'block' }}>
              <input type="checkbox" checked={manual.includes(p.id)}
                onChange={(e) => onAsignar(e.target.checked ? [...manual, p.id] : manual.filter((x) => x !== p.id))} /> {p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre} ({fechaAr(p.fecha)})
            </label>)}
          </details>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Copiar etiqueta="📋 Mensaje para pagos" texto={mensajePagos(r, condiciones, nombrePedido)} />
            {reclamo && <Copiar etiqueta="📋 Texto de reclamo" texto={reclamo} />}
            <button style={botonChico} onClick={onDeposito}>📦 Checklist del depósito</button>
            <button style={{ ...botonChico, background: 'transparent', color: '#f87171' }} onClick={onBorrar}>Borrar entrega</button>
          </div>
        </div>
      )}
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
              <div><strong>{c.codigo}</strong> <span style={{ opacity: 0.8 }}>{c.descripcion}</span> · facturado {c.cantidad}</div>
              {c.nota && <div style={{ color: '#fbbf24', fontSize: '0.82rem' }}>{c.nota}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {(c.talles ?? Object.keys(rec.recibido).filter((k) => k.startsWith(claveRecepcion(c.codigo, ''))).map((k) => ({ talle: k.split('|')[1], cantidad: NaN }))).map((t) => {
                  const k = claveRecepcion(c.codigo, t.talle);
                  const v = rec.recibido[k];
                  const dif = Number.isNaN(t.cantidad) ? 0 : (v ?? 0) - t.cantidad;
                  return <label key={t.talle} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '0.8rem' }}>
                    <span>T {t.talle}{Number.isNaN(t.cantidad) ? '' : ` · esp. ${t.cantidad}`}</span>
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

function Pendientes({ res, nombrePedido }: { res: ReturnType<typeof analizarFacturas>; nombrePedido: (id: string) => string }) {
  const filas = res.pendientes.filter((p) => p.pendiente === null || p.pendiente > 0);
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
        🗂️ Lo que revisé en Trello ({informe.hora}){informe.tablero ? ` · tablero «${informe.tablero}»` : ''}: {informe.tarjetas} tarjeta(s) abiertas, {informe.conExcel} con Excel.
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
