// ============================================================================
// CONTROL DE ENTREGAS — FAMILY (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Family es marketplace y NO factura: cada entrega es la planilla «ENTREGA
// MERCADERIA» (Excel o foto) + el remito. La app controla la planilla contra el
// remito, dice qué artículos son NUEVOS (no están en Shopify) y cuáles son
// REPOSICIÓN, y avisa si Family cambió algún precio. Los precios no se cambian
// desde acá. Las cuentas: utils/controlFamily.ts.
// «⬆️ Cargar en Shopify» (pedido de gax, 11-nov-2026): crea los nuevos y suma
// la reposición en FAMILYARG, con vista previa y confirmación. Cada artículo se
// carga una sola vez. La lógica: utils/cargaFamily.ts.
// ULLUA (19-nov-2026, gax: «es igual que Family prácticamente»): misma pantalla con
// prov="ullua". En lugar de planilla + remito, la entrega es UN papel (remito con
// IVA o factura sin IVA) que se lee de la foto; las curvas y el precio c/u salen
// de utils/ullua.ts y el stock va a su sucursal.
// REEF (26-nov-2026, gax): igual que Ullua (un solo papel: el remito de New Arrecife,
// sin precios). El precio y la curva salen de la lista de precios de Reef, que se
// sube una vez acá y queda guardada (utils/reef.ts).
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { costoUllua, entregaDeDocumentoUllua, ULLUA, type DocumentoUllua } from './utils/ullua';
import { entregaDeRemitoReef, leerListaReef, marketplaceReef, remitoReefDeExcel, type ListaReef, type RemitoReef } from './utils/reef';
import * as XLSX from 'xlsx';
import { Archivo, Copiar, Parte } from './EntregasPartes';
import { PanelCarga } from './PanelCarga';
import type { Remito } from './utils/controlFacturas';
import { fmt } from './utils/controlFacturas';
import {
  consultarShopifyFamily, controlarEntregaFamily, leerEntregaFamily, leerTextoEntregaFamily, resumenFamily, textoEntregaFamily,
  type EntregaFamily, type FilaFamily, type OpcionesControl, type RenglonFamily, type ResultadoFamily,
} from './utils/controlFamily';
import {
  cargasDeEntrega, ejecutarCargaFamily, estadoShopifyEntrega, FAMILY, leerEstadoCarga, planCargaFamily, resumenCarga, textoCarga,
  type CargaFamily, type EleccionesCarga, type Marketplace, type PlanCarga, type ResultadoCarga,
  avisoLiberar,
} from './utils/cargaFamily';
import { ResultadosCarga } from './ResultadosCarga';
import { leerTextoRemito, textoRemito } from './utils/lectoresFacturas';
import { shopifyGraphQL } from './utils/shopify';
import {
  adjuntarATrello, anotarEnPlanilla, apiControl, archivosFamily, botonChico, crearEnTrello, listasDeTrello, botonPrincipal, enlace, fechaAr, hoy, inputSt, leerFotos, mensaje, slug, td, th,
} from './utils/entregasUi';
import { fechaIngreso, filaPlanillaFamily } from './utils/avisoAdmin';
import { listaFinalizado } from './utils/listasTrello';
import { descripcionTarjetaFamily, nombreTarjetaFamily, papel } from './utils/trelloFamily';

/** Lo que cambia entre Family, Ullua y Reef. unPapel: la entrega es un solo papel (remito o factura), sin planilla aparte. */
type ProvMarket = 'family' | 'ullua' | 'reef';
interface Config { prov: ProvMarket; m: Marketplace; opciones: OpcionesControl; planilla: string; unPapel: boolean; reef: boolean }
const REEF_SIN_LISTA = marketplaceReef(null);
const CONFIG: Record<ProvMarket, Config> = {
  family: { prov: 'family', m: FAMILY, opciones: {}, planilla: 'Familyarg', unPapel: false, reef: false },
  ullua: {
    prov: 'ullua', m: ULLUA, planilla: 'ULLUA', unPapel: true, reef: false,
    opciones: { nombre: 'Ullua', mayor: 'c/u sin IVA', sinRemito: true, costoEsperado: ULLUA.costoEsperado },
  },
  reef: {
    prov: 'reef', m: REEF_SIN_LISTA, planilla: 'REEF', unPapel: true, reef: true,
    opciones: { nombre: 'Reef', mayor: 'PMV', sinRemito: true, costoEsperado: REEF_SIN_LISTA.costoEsperado },
  },
};

const SEMAFORO = {
  ok: { icono: '✅', texto: 'Todo coincide', color: '#34d399' },
  observaciones: { icono: '⚠️', texto: 'Revisar los avisos', color: '#fbbf24' },
  revisar: { icono: '❌', texto: 'No coincide con el remito', color: '#f87171' },
  incompleta: { icono: '⏳', texto: 'Falta el remito', color: '#94a3b8' },
} as const;
const AMARILLO = '#fbbf24', VERDE = '#34d399';
const tdN: React.CSSProperties = { ...td, whiteSpace: 'nowrap' };
const esExcel = (f: File) => /\.(xlsx|xls)$/i.test(f.name);
const firma = (rs: RenglonFamily[]) => rs.map((r) => `${r.codigo}:${r.cantidad}`).sort().join('|');
type Leida = { fecha: string; renglones: RenglonFamily[]; dudas?: string[]; origen: 'excel' | 'foto' | 'manual'; nombre: string; avisos: string[]; documento?: EntregaFamily['documento'] };

/** Ullua: el remito o la factura (fotos, o PDF pasado a fotos) leído con IA y pasado a la entrega. */
async function leerDocumentoUllua(files: File[], aFotos?: (f: File[]) => Promise<File[]>): Promise<Leida> {
  const doc = await leerFotos<DocumentoUllua>(aFotos ? await aFotos(files) : files, 'ullua');
  const { entrega, avisos } = entregaDeDocumentoUllua(doc, hoy());
  return { ...entrega, origen: 'foto', avisos };
}

/**
 * Reef: el remito digital (Excel, 26-nov-2026) o, si no lo hay, las fotos (o PDF pasado a fotos) leídas con IA.
 * Las dos formas se completan con la lista de precios. Con Excel y fotos juntos manda el Excel.
 */
async function leerRemitoReef(files: File[], lista: ListaReef | null, aFotos?: (f: File[]) => Promise<File[]>): Promise<Leida> {
  const excel = files.find(esExcel);
  if (excel) {
    const wb = XLSX.read(await excel.arrayBuffer());
    const hoja = wb.SheetNames.find((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden) || wb.SheetNames[0];
    const doc = remitoReefDeExcel(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, raw: true }));
    const { entrega, avisos } = entregaDeRemitoReef(doc, lista, hoy(), 'excel');
    return { ...entrega, origen: 'excel', avisos: files.length > 1 ? [...avisos, 'Usé el Excel del remito; las fotos quedan para Trello.'] : avisos };
  }
  const doc = await leerFotos<RemitoReef>(aFotos ? await aFotos(files) : files, 'reef');
  const { entrega, avisos } = entregaDeRemitoReef(doc, lista, hoy());
  return { ...entrega, origen: 'foto', avisos };
}

/** Lee la lista de precios de Reef (Excel): solo las hojas con artículos; la de apertura de cuenta se ignora. */
async function leerExcelListaReef(f: File): Promise<{ lista: ListaReef; avisos: string[] }> {
  const wb = XLSX.read(await f.arrayBuffer());
  const hojas = wb.SheetNames.filter((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden)
    .map((nombre) => ({ nombre, filas: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombre], { header: 1, raw: true }) }));
  return leerListaReef(hojas, f.name.replace(/\.[^.]+$/, ''));
}

/** Lee la planilla de entrega: Excel (por encabezados) o fotos (con IA). */
async function leerPlanilla(files: File[]): Promise<Leida> {
  const excel = files.find(esExcel);
  if (excel) {
    const wb = XLSX.read(await excel.arrayBuffer());
    const hoja = wb.SheetNames.find((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden) || wb.SheetNames[0];
    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, raw: true });
    const { entrega, avisos } = leerEntregaFamily(filas, excel.name.replace(/\.[^.]+$/, ''), hoy());
    return { ...entrega, origen: 'excel', avisos };
  }
  const d = await leerFotos<{ fecha: string; renglones: RenglonFamily[]; dudas: string[] }>(files, 'entrega');
  return { fecha: d.fecha || hoy(), renglones: d.renglones, dudas: d.dudas, origen: 'foto', nombre: 'Planilla (foto)', avisos: d.fecha ? [] : ['La foto no trae la fecha: se usó la de hoy (se puede corregir).'] };
}

export default function ControlFamily({ prov = 'family', aFotos }: { prov?: ProvMarket; aFotos?: (f: File[]) => Promise<File[]> } = {}) {
  // Reef: la lista de precios guardada (de ahí salen el tipo de producto de las altas y el costo esperado).
  const [lista, setLista] = useState<ListaReef | null>(null);
  const cfg = useMemo<Config>(() => {
    if (prov !== 'reef') return CONFIG[prov];
    const m = marketplaceReef(lista);
    return { ...CONFIG.reef, m, opciones: { ...CONFIG.reef.opciones, costoEsperado: m.costoEsperado } };
  }, [prov, lista]);
  const nombre = cfg.m.nombre, sucursal = cfg.m.sucursal;
  const api = useMemo(() => (body?: object) => (body ? apiControl({ proveedor: prov, ...body }) : apiControl(undefined, prov)), [prov]);
  const [entregas, setEntregas] = useState<EntregaFamily[]>([]);
  const [remitos, setRemitos] = useState<Record<string, Remito>>({});
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [sinBase, setSinBase] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [resultadoCarga, setResultadoCarga] = useState<ResultadoCarga[] | null>(null);
  const [ocupado, setOcupado] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [planilla, setPlanilla] = useState<File[]>([]);
  const [fotosRemito, setFotosRemito] = useState<File[]>([]);
  const [aMano, setAMano] = useState<string | null>(null);
  const [cargas, setCargas] = useState<Record<string, CargaFamily>>({});
  const [armado, setArmado] = useState<PlanCarga | null>(null);
  // Archivos subidos en esta pantalla, por entrega, para adjuntarlos a la tarjeta de Trello (no se guardan en la base).
  const [archivos, setArchivos] = useState<Record<string, { planilla: File[]; remito: File[] }>>({});
  const [enTrello, setEnTrello] = useState<Record<string, string>>({});
  const guardarArchivos = (id: string, planilla: File[], remito: File[]) => setArchivos((a) => ({
    ...a, [id]: { planilla: planilla.length ? planilla : a[id]?.planilla ?? [], remito: remito.length ? remito : a[id]?.remito ?? [] },
  }));

  const recargar = useCallback(async () => {
    setCargando(true); setError('');
    try {
      const d = await api();
      // Cualquier cambio guardado deja vieja la vista previa de la carga: hay que armarla de nuevo.
      setEntregas(d.entregas ?? []); setRemitos(d.remitos ?? {}); setCargas(d.cargas ?? {}); setSinBase(false); setArmado(null);
      setLista(d.lista && Array.isArray(d.lista.articulos) ? d.lista : null);
    } catch (e) { setError(mensaje(e)); setSinBase(!!(e as { sinBase?: boolean }).sinBase); setEntregas([]); setRemitos({}); setCargas({}); }
    finally { setCargando(false); }
  }, [api]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial
  useEffect(() => { recargar(); }, [recargar]);

  const resultados = useMemo(() => [...entregas].sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id))
    .map((e) => controlarEntregaFamily(e, remitos[e.id], entregas, cfg.opciones)), [entregas, remitos, cfg]);
  // Pedido de gax (11-nov-2026): arriba lo que falta cargar en Shopify, en amarillo; abajo, después
  // de una línea, las entregas ya cargadas enteras. Dentro de cada grupo, la más nueva primero.
  const tarjetas = useMemo(() => resultados.map((r) => {
    const deEntrega = cargasDeEntrega(cargas, r.entrega.id);
    return { r, cargas: deEntrega, completa: estadoShopifyEntrega(r.filas.map((f) => f.codigo), deEntrega).completa };
  }), [resultados, cargas]);
  const pendientes = tarjetas.filter((t) => !t.completa);
  const cargadas = tarjetas.filter((t) => t.completa);

  async function guardar(body: object) {
    setError('');
    try { await api(body); await recargar(); return true; }
    catch (e) { setError(mensaje(e)); return false; }
  }

  /** Busca en Shopify (solo lectura) si cada código ya existe. */
  async function conShopify(e: EntregaFamily): Promise<EntregaFamily> {
    setOcupado('Buscando los artículos en Shopify…');
    try { return { ...e, shopify: await consultarShopifyFamily(e.renglones.map((r) => r.codigo), shopifyGraphQL, cfg.m) }; }
    finally { setOcupado(''); }
  }

  async function remitoDeFotos(id: string, files: File[]): Promise<string> {
    setOcupado('Leyendo la foto del remito… (puede tardar un minuto)');
    try {
      const remito = await leerFotos<Remito>(files, 'remito');
      await api({ accion: 'guardarRemito', facturaId: id, remito });
      return `Remito ${remito.numero || ''} leído de la foto: ${remito.renglones.length} artículos, ${remito.renglones.reduce((s, r) => s + r.cantidad, 0)} unidades.${remito.dudas?.length ? ' Revisá las dudas que marqué.' : ''}`;
    } catch (e) {
      return `No pude leer la foto del remito: ${mensaje(e)} Abrí la entrega y escribilo con «✏️ Escribirlo».`;
    } finally { setOcupado(''); }
  }

  /** Guarda una planilla nueva (o actualiza la misma si ya estaba) y le suma el remito. */
  async function guardarNueva(leida: Leida, fotos: File[], planillaFiles: File[] = [], papelFiles: File[] = []) {
    const nuevos: string[] = [];
    const repetida = entregas.find((x) => x.fecha === leida.fecha && firma(x.renglones) === firma(leida.renglones));
    const id = repetida?.id || `E-${leida.fecha}-${slug(leida.nombre).slice(0, 30)}-${Date.now().toString(36)}`;
    let entrega: EntregaFamily = {
      id, nombre: leida.nombre, fecha: leida.fecha, origen: leida.origen, renglones: leida.renglones, dudas: leida.dudas ?? [],
      ...(leida.documento ?? repetida?.documento ? { documento: leida.documento ?? repetida?.documento } : {}),
    };
    entrega = await conShopify(entrega);
    await api({ accion: 'guardarEntrega', entrega });
    // Ullua: las fotos del remito o la factura van a Trello como «Remito …» / «Factura …».
    guardarArchivos(id, planillaFiles, fotos.length ? fotos : papelFiles);
    const u = leida.renglones.reduce((s, r) => s + r.cantidad, 0);
    nuevos.push(`${cfg.unPapel ? leida.nombre : 'Planilla'} del ${fechaAr(leida.fecha)} ${repetida ? 'actualizada (ya estaba cargada)' : 'guardada'}: ${leida.renglones.length} artículos, ${u} unidades.`, ...leida.avisos);
    if (entrega.shopify?.error) nuevos.push(`No pude consultar Shopify: ${entrega.shopify.error}`);
    if (fotos.length) nuevos.push(await remitoDeFotos(id, fotos));
    await recargar();
    setAvisos(nuevos);
    setAbierta(id);
  }

  async function controlar() {
    if (!planilla.length) return;
    let leida: Leida;
    if (cfg.unPapel) {
      setOcupado(cfg.reef ? (planilla.some(esExcel) ? 'Leyendo el remito…' : 'Leyendo el remito… (puede tardar un minuto)') : 'Leyendo el remito o la factura… (puede tardar un minuto)');
      try { leida = cfg.reef ? await leerRemitoReef(planilla, lista, aFotos) : await leerDocumentoUllua(planilla, aFotos); }
      catch (e) { setAvisos([`No pude leer ${cfg.reef ? 'el remito' : 'el remito o la factura'}: ${mensaje(e)} Podés escribirlo a mano.`]); setOcupado(''); return; }
      setOcupado('');
      try { await guardarNueva(leida, [], [], planilla); } catch (e) { setAvisos([mensaje(e)]); return; }
      setPlanilla([]);
      return;
    }
    setOcupado(planilla.some(esExcel) ? 'Leyendo la planilla…' : 'Leyendo la foto de la planilla… (puede tardar un minuto)');
    try { leida = await leerPlanilla(planilla); }
    catch (e) { setAvisos([`No pude leer la planilla de entrega: ${mensaje(e)}${planilla.some(esExcel) ? '' : ' Podés escribirla a mano.'}`]); setOcupado(''); return; }
    setOcupado('');
    try { await guardarNueva(leida, fotosRemito, planilla); } catch (e) { setAvisos([mensaje(e)]); return; }
    setPlanilla([]); setFotosRemito([]);
  }

  /** Reef: sube la lista de precios (Excel) y la guarda en la base. */
  async function subirLista(files: File[]) {
    const f = files[0];
    if (!f) return;
    setOcupado('Leyendo la lista de precios…');
    try {
      const { lista: l, avisos: av } = await leerExcelListaReef(f);
      await api({ accion: 'guardarListaReef', lista: l });
      await recargar();
      const us = l.articulos.filter((a) => a.us).length;
      setAvisos([
        `Lista de precios «${l.nombre}» guardada: ${l.articulos.length} artículos.${us ? ` ${us} vienen en talle de EE.UU. (esos piden escribir el talle argentino).` : ''}`,
        ...(entregas.length ? ['Las entregas que ya estaban no cambian solas: si alguna quedó sin precio o sin talles, volvé a subir su remito.'] : []),
        ...av.slice(0, 15), ...(av.length > 15 ? [`… y ${av.length - 15} avisos más.`] : []),
      ]);
    } catch (e) { setAvisos([`No pude leer la lista de precios: ${mensaje(e)}`]); }
    finally { setOcupado(''); }
  }

  async function guardarAMano() {
    const { fecha, renglones, errores } = leerTextoEntregaFamily(aMano ?? '');
    if (errores.length) { setAvisos(errores); return; }
    if (!renglones.length) { setAvisos(['Escribí al menos un artículo.']); return; }
    try { await guardarNueva({ fecha: fecha || hoy(), renglones, origen: 'manual', nombre: cfg.unPapel ? 'Entrega escrita a mano' : 'Planilla escrita a mano', avisos: fecha ? [] : ['Sin fecha: se usó la de hoy.'] }, cfg.unPapel ? [] : fotosRemito); }
    catch (e) { setAvisos([mensaje(e)]); return; }
    setAMano(null); setFotosRemito([]);
  }

  /** Vista previa de la carga en Shopify: lee Shopify y la base en el momento. No escribe nada. */
  async function armarCarga(r: ResultadoFamily) {
    if (r.semaforo === 'incompleta' || r.semaforo === 'revisar') {
      setAvisos([r.semaforo === 'incompleta' ? 'Para cargar en Shopify primero subí o escribí el remito.' : 'Para cargar en Shopify primero la planilla tiene que coincidir con el remito.']);
      return;
    }
    setArmado(null); setAvisos([]); setError('');
    setOcupado('Busco los artículos en Shopify para armar la carga…');
    try {
      const d = await api();
      const estado = await leerEstadoCarga(r.entrega.renglones, shopifyGraphQL, cfg.m);
      setCargas(d.cargas ?? {});
      setArmado(planCargaFamily(r, estado, d.cargas ?? {}, cfg.m));
      setAbierta(r.entrega.id);
    } catch (e) { setAvisos([`No pude armar la carga: ${mensaje(e)} No se cargó nada.`]); }
    finally { setOcupado(''); }
  }

  async function confirmarCarga(plan: PlanCarga, elecciones: EleccionesCarga) {
    const res = resumenCarga(plan, elecciones);
    if (!res.altas && !res.reposiciones) return;
    const texto = [`Se va a cargar en Shopify (${sucursal}):`, ...res.lineas, '',
      `${res.altas} producto(s) nuevo(s) y ${res.reposiciones} reposición(es), ${res.unidades} unidades en total.`,
      'Los precios de los productos que ya existen no se tocan. ¿Confirmás?'].join('\n');
    if (!confirm(texto)) return;
    const eid = plan.entregaId;
    const entrega = resultados.find((x) => x.entrega.id === eid);
    // La fila de la planilla de ingreso va con la primera carga de la entrega (las siguientes ya la tienen).
    const yaAnotada = Object.values(cargasDeEntrega(cargas, eid)).some((c) => c.estado === 'cargada' || c.estado === 'parcial');
    setResultadoCarga(null);
    setOcupado('Cargando en Shopify… no cierres esta página.');
    try {
      const resultados = await ejecutarCargaFamily(plan, elecciones, {
        gql: shopifyGraphQL,
        reservar: (codigo, firma, detalle) => api({ accion: 'reservarCarga', entregaId: eid, codigo, firma, detalle }),
        terminar: async (codigo, estado, detalle) => { await api({ accion: 'terminarCarga', entregaId: eid, codigo, estado, detalle }); },
        liberar: async (codigo) => { await api({ accion: 'liberarCarga', entregaId: eid, codigo }); },
        clave: () => crypto.randomUUID(),
        buscador: cfg.m,
        onProgreso: (h, t) => setOcupado(`Cargando en Shopify… ${h} de ${t}. No cierres esta página.`),
      });
      setAvisos([]);
      setResultadoCarga(resultados);
      setArmado(null);
      const algo = resultados.some((x) => x.estado === 'cargada' || x.estado === 'parcial' || (x.detalle?.sumados.length ?? 0) > 0);
      if (algo && entrega && !yaAnotada) setAvisos([await anotarFamily(entrega), ...await tarjetaFamily(entrega)]);
    } catch (e) { setAvisos([`La carga se cortó: ${mensaje(e)} Revisá en Shopify qué quedó cargado antes de volver a intentar.`]); }
    finally { setOcupado(''); await recargar(); }
  }

  /**
   * Fila en la planilla «CONTROL INGRESO MERCADERIA» (16-nov-2026, gax: «lo de Family igual se sube al Excel?»,
   * con captura de cómo la anotaban a mano). Si el remito ya está anotado, la planilla no la repite.
   */
  async function anotarFamily(r: ResultadoFamily): Promise<string> {
    // Ullua: el número sale del papel de la entrega (remito, o factura con el remito que menciona).
    const doc = r.entrega.documento;
    const factura = doc?.tipo === 'factura' ? doc.numero.trim() : '';
    const remito = (doc ? doc.remito : r.remito?.numero)?.trim() ?? '';
    if (!remito && !factura) return `Planilla de ingreso: ${cfg.unPapel ? 'el remito o la factura' : 'el remito'} no tiene número, así que no agregué la fila. ${cfg.unPapel ? 'Anotala a mano.' : 'Escribí el número en «✏️ Ver o corregir» del remito y anotala a mano.'}`;
    const que = factura ? `la factura ${factura}` : `el remito ${remito}`;
    const hoyAr = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    try {
      const a = await anotarEnPlanilla(filaPlanillaFamily({ fecha: fechaIngreso(r.entrega, r.remito).fecha, remito, hoy: hoyAr, proveedor: cfg.planilla, factura, monto: doc?.total ?? null }));
      if (a.sinPlanilla) return 'Planilla de ingreso: todavía no está conectada (ver «Planilla de ingreso» en Notas de pedido de iD o Distrinando).';
      if (a.yaEstaba) return `Planilla de ingreso: ${que} ya estaba anotado${a.fila ? ` (fila ${a.fila})` : ''}.`;
      return `Planilla de ingreso: agregué ${que} de ${nombre}${a.fila ? ` en la fila ${a.fila}` : ''}.`;
    } catch (e) { return `Planilla de ingreso: no pude agregar la fila (${mensaje(e)}). Anotala a mano.`; }
  }

  /**
   * Tarjeta de Trello de la entrega (16-nov-2026, gax: «que cree la tarjeta de Trello y la mande a finalizada
   * con remito y planilla»). Se crea en «FINALIZADO» (si ya hay una abierta con el mismo nombre, se usa esa) y se
   * le adjuntan la planilla y el remito subidos en esta pantalla, o los que se eligen con «📎».
   */
  async function tarjetaFamily(r: ResultadoFamily, elegidos?: { planilla: File[]; remito: File[] }): Promise<string[]> {
    const hechos: string[] = [];
    const tit = nombreTarjetaFamily(r, nombre);
    let tarjeta: { id: string; enlace: string; yaEstaba: boolean };
    try {
      const final = listaFinalizado(await listasDeTrello());
      if (!final) return ['Trello: no encontré una sola lista «FINALIZADO» en el tablero. Creá la tarjeta a mano.'];
      const hoyAr = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      tarjeta = await crearEnTrello(final.id, tit, descripcionTarjetaFamily(r, sucursal, hoyAr, nombre));
      hechos.push(tarjeta.yaEstaba ? `Trello: la tarjeta «${tit}» ya estaba.` : `Trello: creé la tarjeta «${tit}» en «${final.nombre}».`);
      if (tarjeta.enlace) setEnTrello((t) => ({ ...t, [r.entrega.id]: tarjeta.enlace }));
    } catch (e) { return [`Trello: no pude crear la tarjeta (${mensaje(e)}). Creala a mano en «FINALIZADO».`]; }
    const files = elegidos ?? archivos[r.entrega.id] ?? { planilla: [], remito: [] };
    if (!files.planilla.length && !files.remito.length) {
      hechos.push(cfg.unPapel
        ? 'Trello: no tengo en esta pantalla las fotos del remito o la factura (se suben de nuevo si se recargó la página). Adjuntalas con «📎» en la parte Trello de la entrega.'
        : 'Trello: no tengo en esta pantalla la planilla ni la foto del remito (se suben de nuevo si se recargó la página). Adjuntalos con «📎» en la parte Trello de la entrega.');
      return hechos;
    }
    try {
      for (const a of await archivosFamily(files.planilla, files.remito, r.remito?.numero?.trim() ?? '', r.entrega.fecha, papel(r))) {
        try { const x = await adjuntarATrello(tarjeta.id, a); hechos.push(`Trello: ${x.yaEstaba ? `«${x.nombre}» ya estaba en la tarjeta` : `adjunté «${x.nombre}»`}.`); }
        catch (e) { hechos.push(`Trello: no pude adjuntar «${a.nombre}» (${mensaje(e)}).`); }
      }
    } catch (e) { hechos.push(`Trello: ${mensaje(e)}`); }
    if (!files.planilla.length && !cfg.unPapel) hechos.push('Trello: la planilla no está en esta pantalla; adjuntala con «📎 Planilla».');
    if (!files.remito.length) hechos.push(cfg.unPapel ? 'Trello: las fotos del remito o la factura no están en esta pantalla; adjuntalas con «📎».' : 'Trello: la foto del remito no está en esta pantalla; adjuntala con «📎 Remito».');
    return hechos;
  }

  async function adjuntarElegidos(r: ResultadoFamily, que: 'planilla' | 'remito', files: File[]) {
    if (!confirm(`Se ${files.length === 1 ? 'adjunta 1 archivo' : `adjuntan ${files.length} archivos`} como ${cfg.unPapel ? (papel(r).split(' ')[0] || 'remito').toLowerCase() : que} a la tarjeta «${nombreTarjetaFamily(r, nombre)}» de Trello (si no existe, se crea en «FINALIZADO»). ¿Confirmás?`)) return;
    guardarArchivos(r.entrega.id, que === 'planilla' ? files : [], que === 'remito' ? files : []);
    setOcupado('Subiendo a Trello…');
    try { setAvisos(await tarjetaFamily(r, { planilla: que === 'planilla' ? files : [], remito: que === 'remito' ? files : [] })); }
    finally { setOcupado(''); }
  }

  async function liberarCarga(entregaId: string, codigo: string, c: CargaFamily) {
    const aviso = c.estado === 'cargada'
      ? `${codigo} figura como cargado en Shopify. Si liberás la marca, la app lo deja cargar OTRA VEZ (sumaría el stock dos veces o crearía otro producto). ¿Seguro?`
      : avisoLiberar(codigo, c, textoCarga(c));
    if (!confirm(aviso)) return;
    setArmado(null);
    // manual: queda anotada en el registro de cargas (la que libera la app sola cuando Shopify rechazó la carga, no).
    await guardar({ accion: 'liberarCarga', entregaId, codigo, manual: true });
  }

  async function reconsultar(e: EntregaFamily) {
    try { await guardar({ accion: 'guardarEntrega', entrega: await conShopify(e) }); }
    catch (err) { setError(mensaje(err)); }
  }

  return (
    <div>
      {sinBase && <p style={{ color: '#fbbf24', fontSize: '0.9rem' }}>⚠ Falta conectar la base de datos al proyecto en Vercel. Sin ella no se pueden guardar las entregas.</p>}
      {error && !sinBase && <p style={{ color: '#f87171', fontWeight: 'bold' }}>⚠ {error}</p>}
      {ocupado && <p style={{ fontSize: '0.88rem', color: '#93c5fd' }}>⏳ {ocupado}</p>}
      {cargando && <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>Cargando…</p>}
      {resultadoCarga && <ResultadosCarga resultados={resultadoCarga} sucursal={sucursal} conVentas={false} onCerrar={() => setResultadoCarga(null)} />}
      {avisos.length > 0 && <div style={{ fontSize: '0.84rem', margin: '6px 0 12px', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
        {avisos.map((a, i) => <div key={i}>• {a}</div>)}
      </div>}

      <div style={{ border: '1px solid rgba(99,102,241,0.55)', borderRadius: 10, padding: '12px 14px', background: 'rgba(99,102,241,0.08)', marginBottom: 16 }}>
        <strong style={{ fontSize: '1rem' }}>Nueva entrega de {nombre}</strong>
        {cfg.reef && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, fontSize: '0.84rem' }}>
          <span style={{ color: lista ? undefined : AMARILLO }}>
            📋 Lista de precios: {lista ? <>«{lista.nombre || 'sin nombre'}», {lista.articulos.length} artículos{lista.guardada ? `, subida el ${fechaAr(lista.guardada.slice(0, 10))}` : ''}</> : 'todavía no está cargada (el remito no trae precios ni la curva: salen de la lista)'}
          </span>
          <Archivo etiqueta={lista ? '🔄 Cambiar lista (Excel)' : '📋 Subir lista de precios (Excel)'} accept=".xlsx,.xls" disabled={!!ocupado} estilo={botonChico} onArchivos={subirLista} />
        </div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          {cfg.unPapel
            ? <Archivo etiqueta={cfg.reef ? '🧾 Remito (Excel, foto o PDF)' : '🧾 Remito o factura (foto o PDF)'} accept={cfg.reef ? '.xlsx,.xls,image/*,.pdf' : 'image/*,.pdf'} multiple disabled={!!ocupado} onArchivos={(f) => { setPlanilla(f); setAMano(null); }} />
            : <Archivo etiqueta="1 · 📄 Planilla de entrega (Excel o foto)" accept=".xlsx,.xls,image/*" multiple disabled={!!ocupado} onArchivos={(f) => { setPlanilla(f); setAMano(null); }} />}
          <span style={{ fontSize: '0.82rem', opacity: planilla.length ? 1 : 0.5 }}>{planilla.length ? `✔ ${planilla.length === 1 ? planilla[0].name : `${planilla.length} ${planilla.some(esExcel) ? 'archivos' : 'fotos'}`}` : 'sin elegir'}</span>
          {!cfg.unPapel && <>
            <Archivo etiqueta="2 · 📷 Foto del remito" accept="image/*" multiple disabled={!!ocupado} onArchivos={(f) => setFotosRemito(f)} />
            <span style={{ fontSize: '0.82rem', opacity: fotosRemito.length ? 1 : 0.5 }}>{fotosRemito.length ? `✔ ${fotosRemito.length} foto(s)` : 'sin elegir'}</span>
          </>}
          <button style={{ ...botonPrincipal, opacity: planilla.length && !ocupado ? 1 : 0.5, cursor: planilla.length && !ocupado ? 'pointer' : 'not-allowed' }}
            disabled={!planilla.length || !!ocupado} onClick={controlar}>Controlar</button>
          <button style={enlace} onClick={() => { setAMano(aMano === null ? 'Fecha \n' : null); setPlanilla([]); }}>{aMano === null ? `o escribir ${cfg.unPapel ? 'la entrega' : 'la planilla'} a mano` : 'cancelar'}</button>
        </div>
        {aMano !== null && <EditorTexto texto={aMano} onTexto={setAMano} onGuardar={guardarAMano} onCancelar={() => setAMano(null)} ayuda={cfg.reef ? AYUDA_REEF : cfg.unPapel ? AYUDA_ULLUA : AYUDA_PLANILLA} etiqueta="💾 Guardar y controlar" />}
        <p style={{ fontSize: '0.8rem', opacity: 0.75, margin: '8px 0 0' }}>
          {cfg.reef
            ? <>Subí el remito de New Arrecife: el Excel (remito digital, lo más seguro) o, si no lo tenés, la foto o el PDF. No trae precios: el PMV, el PVP y la curva salen de la lista de precios. Los talles salen de la curva × la cantidad de curvas que llegaron; los de EE.UU. (parte del calzado y las ojotas) se escriben a mano. Costo = PMV − 15% (contrato); los nuevos se crean con el PVP de la lista (se puede cambiar). Con «⬆️ Cargar en Shopify» sumo el stock en {sucursal}, siempre con tu confirmación. Los precios de lo que ya existe no los toco.</>
            : cfg.unPapel
            ? <>Subí la foto del remito (los precios traen IVA: los divido por 1,21) o de la factura (sin IVA). El precio de cada renglón es el de la curva: lo divido por las unidades de la curva (S1 M2 L3 XL2 = 8; mujer S2 M2 L2 XL2). Costo = precio c/u sin IVA − 15%; los nuevos se crean con el precio c/u × 2 (se puede cambiar). Te digo cuáles son nuevos y cuáles reposición, y con «⬆️ Cargar en Shopify» sumo el stock en {sucursal}, siempre con tu confirmación. Los precios de lo que ya existe no los toco.</>
            : <>Family no factura: controlo la planilla contra el remito, te digo qué artículos son nuevos y cuáles reposición (los busco en Shopify) y te aviso si cambió algún precio. Con «⬆️ Cargar en Shopify» creo los nuevos y sumo la reposición en {sucursal}, siempre con tu confirmación. Los precios de lo que ya existe no los toco.</>}
        </p>
      </div>

      {!resultados.length && !cargando && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no hay entregas de {nombre} cargadas.</p>}
      {/* Una sola lista con claves: una entrega que pasa de pendiente a cargada (o vuelve) se MUEVE, no se
          vuelve a montar, así no se pierde lo que se estaba escribiendo en su remito o planilla. */}
      {[
        ...(pendientes.length && cargadas.length ? [<Separador key="sep-pendientes" color={AMARILLO} texto={`⏳ Falta cargar en Shopify (${pendientes.length})`} />] : []),
        ...pendientes.map(tarjeta),
        ...(cargadas.length && !pendientes.length ? [<p key="sin-pendientes" style={{ opacity: 0.7, fontSize: '0.85rem' }}>No hay entregas pendientes de cargar en Shopify.</p>] : []),
        ...(cargadas.length ? [<Separador key="sep-cargadas" color={VERDE} texto={`✔ Cargadas en Shopify (${cargadas.length})`} />] : []),
        ...cargadas.map(tarjeta),
      ]}
    </div>
  );

  function tarjeta({ r, cargas: deEntrega }: (typeof tarjetas)[number]) {
    return <TarjetaFamily key={r.entrega.id} cfg={cfg} r={r} abierta={abierta === r.entrega.id} ocupado={!!ocupado}
        cargas={deEntrega}
        plan={armado?.entregaId === r.entrega.id ? armado : null}
        onArmar={() => armarCarga(r)} onConfirmar={(el) => armado && confirmarCarga(armado, el)} onCancelarCarga={() => setArmado(null)}
        onLiberar={(codigo, c) => liberarCarga(r.entrega.id, codigo, c)}
        onAbrir={() => setAbierta(abierta === r.entrega.id ? null : r.entrega.id)}
        onFotos={async (f) => { guardarArchivos(r.entrega.id, [], f); const m = await remitoDeFotos(r.entrega.id, f); await recargar(); setAvisos([m]); }}
        enTrello={enTrello[r.entrega.id] ?? ''} onTrello={(que, f) => adjuntarElegidos(r, que, f)}
        onGuardarRemito={(remito) => guardar({ accion: 'guardarRemito', facturaId: r.entrega.id, remito })}
        onBorrarRemito={() => confirm('¿Borrar el remito de esta entrega?') && guardar({ accion: 'borrarRemito', facturaId: r.entrega.id })}
        onGuardarEntrega={async (e) => { try { return await guardar({ accion: 'guardarEntrega', entrega: await conShopify(e) }); } catch (err) { setError(mensaje(err)); return false; } }}
        onFecha={(fecha) => guardar({ accion: 'guardarEntrega', entrega: { ...r.entrega, fecha } })}
        onIngreso={(fecha) => guardar({ accion: 'guardarIngreso', facturaId: r.entrega.id, fecha })}
        onConsultar={() => reconsultar(r.entrega)}
        onBorrar={() => confirm(`¿Borrar la entrega del ${fechaAr(r.entrega.fecha)}?${cfg.unPapel ? '' : ' Se borra también su remito.'}`) && guardar({ accion: 'borrarEntrega', id: r.entrega.id })} />;
  }
}

/** Línea con título que separa las entregas pendientes de las ya cargadas en Shopify. */
function Separador({ color, texto }: { color: string; texto: string }) {
  const linea = <span style={{ flex: 1, height: 1, background: `${color}66` }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 10px', color, fontWeight: 'bold', fontSize: '0.9rem' }}>
      {linea}<span>{texto}</span>{linea}
    </div>
  );
}

const AYUDA_PLANILLA = <>Una línea por artículo: código, talle/cantidad, precio por mayor y precio público (con $), y la descripción. Ej.:<br />
  <code>Fecha 30/10/2026</code><br /><code>SHBSPEC S/2 M/4 L/4 XL/6 2XL/4 $34500 $69000 Short Spectrum Basket Negro/Multi</code></>;
const AYUDA_ULLUA = <>Una línea por artículo: código, talle/cantidad (en unidades, no curvas), el precio c/u SIN IVA (con $) y la descripción. Ej.:<br />
  <code>Fecha 18/11/2026</code><br /><code>580580C S/1 M/2 L/3 XL/2 $50000 SP Hoodie OG Classic Melange</code><br />Sin talles: <code>251451 6 $9000 Medias Thrasher</code></>;
const AYUDA_REEF = <>Una línea por artículo: código, talle/cantidad (talle argentino, en unidades), el PMV y el PVP (con $) y la descripción. Ej.:<br />
  <code>Fecha 25/11/2026</code><br /><code>27112280 40/1 41/2 42/3 43/3 44/2 45/1 $49995 $99990 SHAKA BLACK/WHITE</code><br />Dobles con guion: <code>39-40/2</code>. Talle único: <code>272219086 3 $19995 $39990 Riñonera Austin Negro</code></>;
const AYUDA_REMITO = <>Una línea por artículo: código y cantidad. Ej.: <code>SHBSPEC 20</code>. Si trae talles: <code>SHBSPEC S/2 M/4</code>. Arriba podés poner <code>Remito 0001-00002715</code>.</>;

function EditorTexto({ texto, onTexto, onGuardar, onCancelar, ayuda, etiqueta, errores = [], dudas = [], extra }: {
  texto: string; onTexto: (t: string) => void; onGuardar: () => void; onCancelar: () => void; ayuda: React.ReactNode; etiqueta: string;
  errores?: string[]; dudas?: string[]; extra?: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.2)' }}>
      <div style={{ fontSize: '0.82rem', opacity: 0.85, marginBottom: 6 }}>{ayuda}</div>
      {dudas.length > 0 && <div style={{ fontSize: '0.82rem', color: '#fbbf24', marginBottom: 6 }}>
        Dudas de la lectura de la foto (revisalas contra el papel):{dudas.map((d, i) => <div key={i}>• {d}</div>)}
      </div>}
      <textarea value={texto} onChange={(e) => onTexto(e.target.value)} rows={Math.min(18, Math.max(5, texto.split('\n').length + 1))}
        style={{ ...inputSt, width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.85rem' }} />
      {errores.length > 0 && <div style={{ color: '#f87171', fontSize: '0.82rem' }}>{errores.map((e, i) => <div key={i}>• {e}</div>)}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <button style={{ ...botonChico, background: '#6366f1', border: '1px solid #6366f1' }} onClick={onGuardar}>{etiqueta}</button>
        <button style={botonChico} onClick={onCancelar}>Cancelar</button>
        {extra}
      </div>
    </div>
  );
}

/** Aviso corto de un artículo para la tabla. */
function estadoFila(f: FilaFamily, sinRemito = false): [string, string] {
  const rojo = '#f87171', amarillo = '#fbbf24';
  if (f.remito !== null && f.remito !== f.entrega) return [`❌ el remito trae ${f.remito}`, rojo];
  if (f.cambiosPrecio.length) return ['⚠️ cambió el precio', amarillo];
  if (f.sumaMal) return ['⚠️ talles no suman el total', amarillo];
  if (f.tallesNuevos.length) return [`⚠️ talle ${f.tallesNuevos.join(', ')} nuevo`, amarillo];
  if (f.remito === null && !sinRemito) return ['⏳ falta el remito', '#94a3b8'];
  return ['✅', '#34d399'];
}

function TarjetaFamily({ cfg, r, abierta, ocupado, cargas, plan, onArmar, onConfirmar, onCancelarCarga, onLiberar, onAbrir, onFotos, enTrello, onTrello, onGuardarRemito, onBorrarRemito, onGuardarEntrega, onFecha, onIngreso, onConsultar, onBorrar }: {
  cfg: Config; r: ResultadoFamily; abierta: boolean; ocupado: boolean; cargas: Record<string, CargaFamily>; plan: PlanCarga | null;
  onArmar: () => void; onConfirmar: (e: EleccionesCarga) => void; onCancelarCarga: () => void; onLiberar: (codigo: string, c: CargaFamily) => void;
  onAbrir: () => void; onFotos: (f: File[]) => void;
  enTrello: string; onTrello: (que: 'planilla' | 'remito', f: File[]) => void;
  onGuardarRemito: (r: Remito) => Promise<boolean>; onBorrarRemito: () => void; onGuardarEntrega: (e: EntregaFamily) => Promise<boolean>;
  onFecha: (f: string) => void; onConsultar: () => void; onBorrar: () => void;
  /** El día que entró la mercadería, escrito a mano (vacío = el día que se subió). */
  onIngreso: (f: string) => void;
}) {
  const e = r.entrega;
  const ingreso = fechaIngreso(e, r.remito);
  const s = SEMAFORO[r.semaforo];
  const [editando, setEditando] = useState<'remito' | 'planilla' | null>(null);
  const [texto, setTexto] = useState('');
  const [errores, setErrores] = useState<string[]>([]);
  const abrir = (que: 'remito' | 'planilla') => {
    if (editando === que) { setEditando(null); return; }
    setTexto(que === 'remito' ? (r.remito ? textoRemito(r.remito) : '') : textoEntregaFamily(e));
    setErrores([]); setEditando(que);
  };
  async function guardarRemito() {
    const { remito, errores: errs } = leerTextoRemito(texto, { codigoSinNumeros: true });
    if (errs.length) { setErrores(errs); return; }
    if (!remito.renglones.length) { setErrores(['Escribí al menos un artículo.']); return; }
    if (await onGuardarRemito({ ...remito, origen: 'manual', dudas: [] })) setEditando(null);
  }
  async function guardarPlanilla() {
    const { fecha, renglones, errores: errs } = leerTextoEntregaFamily(texto);
    if (errs.length) { setErrores(errs); return; }
    if (!renglones.length) { setErrores(['Escribí al menos un artículo.']); return; }
    if (await onGuardarEntrega({ ...e, fecha: fecha || e.fecha, renglones, origen: 'manual', dudas: [] })) setEditando(null);
  }
  const unidadesRemito = r.remito?.renglones.reduce((t, x) => t + x.cantidad, 0) ?? 0;
  const enShopify = estadoShopifyEntrega(r.filas.map((f) => f.codigo), cargas);
  const cargados = enShopify.cargados;
  // Lo que falta cargar en Shopify va en amarillo; el rojo (no coincide con el remito) manda porque hay que arreglarlo antes.
  const color = enShopify.completa || r.semaforo === 'revisar' ? s.color : AMARILLO;
  const aRevisar = Object.entries(cargas).filter(([, c]) => c.estado !== 'cargada');
  const puedeCargar = r.semaforo === 'ok' || r.semaforo === 'observaciones';
  // Cargada entera o en parte: «hay que darlos de alta» deja de ser cierto para lo ya cargado.
  const pendientes = r.filas.filter((f) => !cargas[f.codigo]).map((f) => f.codigo);
  const motivos = enShopify.completa ? [...r.motivos.filter((m) => !/^(🆕|🔁)/.test(m)), '✔ Entrega cargada en Shopify.']
    : cargados ? [...r.motivos.filter((m) => !/^(🆕|🔁)/.test(m)),
      `✔ Ya cargado en Shopify: ${r.filas.filter((f) => cargas[f.codigo]?.estado === 'cargada').map((f) => f.codigo).join(', ')}.`,
      ...(pendientes.length ? [`⏳ Falta cargar: ${pendientes.join(', ')}. Cuando llegue, tocá «⬆️ Cargar en Shopify».`] : [])]
    : r.motivos;
  return (
    <div style={{ border: `1px solid ${color}${enShopify.completa ? '66' : '99'}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12, background: `${color}${enShopify.completa ? '0d' : '14'}` }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }} onClick={onAbrir}>
        <strong>{abierta ? '▾' : '▸'} Entrega del {fechaAr(e.fecha)}</strong>
        <span style={{ opacity: 0.8, fontSize: '0.85rem' }}>{r.filas.length} artículos · {r.unidades} u.{r.nuevos ? ` · 🆕 ${r.nuevos} nuevo(s)` : ''}{r.reposiciones ? ` · 🔁 ${r.reposiciones} reposición` : ''}</span>
        <span style={{ color: s.color, fontWeight: 'bold' }}>{s.icono} {s.texto}</span>
        <span style={{ color: enShopify.completa ? VERDE : AMARILLO, border: `1px solid ${enShopify.completa ? VERDE : AMARILLO}88`, borderRadius: 999, padding: '1px 9px', fontSize: '0.82rem', fontWeight: 'bold' }}>
          {enShopify.completa ? '✔ Cargada en Shopify' : `⏳ Falta cargar en Shopify${cargados ? `: ${cargados} de ${enShopify.total} cargados` : ''}`}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Parte ok titulo={cfg.unPapel ? 'Artículos' : 'Planilla'} detalle={`${r.filas.length} artículos${e.origen === 'foto' ? ' (de la foto)' : e.origen === 'manual' ? ' (escrita a mano)' : ''}`}>
          <button style={botonChico} onClick={() => abrir('planilla')}>✏️ Ver o corregir</button>
        </Parte>
        {cfg.unPapel
          ? <Parte ok={!!e.documento} titulo={e.documento?.tipo === 'factura' ? 'Factura' : 'Remito'}
            detalle={e.documento ? `${e.documento.numero || 'sin número'}${e.documento.total ? ` · ${fmt(e.documento.total)}` : ''}${cfg.reef ? '' : e.documento.tipo === 'remito' ? ' (con IVA)' : ' (sin IVA)'}${e.documento.tipo === 'factura' && e.documento.remito ? ` · remito ${e.documento.remito}` : ''}` : 'escrita a mano'}>
            {null}
          </Parte>
          : <Parte ok={!!r.remito} titulo="Remito" detalle={r.remito ? `${r.remito.numero || ''} · ${unidadesRemito} u.${r.remito.origen === 'foto' ? ' (de la foto)' : ''}` : 'falta'}>
            {!r.remito && <Archivo etiqueta="📷 Subir foto" accept="image/*" multiple disabled={ocupado} estilo={botonChico} onArchivos={onFotos} />}
            <button style={botonChico} onClick={() => abrir('remito')}>{r.remito ? '✏️ Ver o corregir' : '✏️ Escribirlo'}</button>
          </Parte>}
        <Parte ok={enShopify.completa} titulo="Shopify" detalle={cargados ? `${cargados} de ${enShopify.total} cargados` : 'sin cargar'}>
          {!enShopify.completa && !plan && <button style={{ ...botonChico, opacity: puedeCargar && !ocupado ? 1 : 0.5 }} disabled={ocupado}
            title={puedeCargar ? 'Crea los nuevos y suma la reposición, con vista previa y confirmación' : cfg.unPapel ? 'Revisá los avisos primero' : 'Primero la planilla tiene que coincidir con el remito'}
            onClick={onArmar}>⬆️ Cargar en Shopify</button>}
        </Parte>
        {cargados > 0 && <Parte ok={!!enTrello} titulo="Trello" detalle={enTrello ? 'tarjeta en FINALIZADO' : 'se crea al cargar'}>
          {enTrello && <a href={enTrello} target="_blank" rel="noreferrer" style={{ ...botonChico, textDecoration: 'none' }}>🗂️ Ver tarjeta</a>}
          {!cfg.unPapel && <Archivo etiqueta="📎 Planilla" accept="image/*,.pdf,.xlsx,.xls" multiple disabled={ocupado} estilo={botonChico} onArchivos={(f) => onTrello('planilla', f)} />}
          <Archivo etiqueta={cfg.unPapel ? `📎 ${e.documento?.tipo === 'factura' ? 'Factura' : 'Remito'}` : '📎 Remito'} accept={cfg.reef ? '.xlsx,.xls,image/*,.pdf' : 'image/*,.pdf'} multiple disabled={ocupado} estilo={botonChico} onArchivos={(f) => onTrello('remito', f)} />
        </Parte>}
      </div>
      {aRevisar.length > 0 && <div style={{ marginTop: 8, fontSize: '0.84rem', color: '#fbbf24' }}>
        {aRevisar.map(([codigo, c]) => <div key={codigo}>
          {codigo}: {textoCarga(c)}{' '}
          <button style={{ ...botonChico, padding: '1px 7px' }} disabled={ocupado} onClick={() => onLiberar(codigo, c)}>🔓 Ya lo revisé: liberar</button>
        </div>)}
      </div>}
      {plan && <PanelCarga plan={plan} ocupado={ocupado} onConfirmar={onConfirmar} onCancelar={onCancelarCarga} sucursal={cfg.m.sucursal}
        explicacion={cfg.reef
          ? 'Los nuevos se crean activos y solo en Point of Sale (las fotos se agregan a mano), con el PVP de la lista (lo podés cambiar) y el costo PMV − 15%. La reposición se SUMA a lo que hay. Los precios de lo que ya existe no se tocan.'
          : cfg.unPapel
          ? 'Los nuevos se crean activos y solo en Point of Sale (las fotos se agregan a mano), con el precio c/u sin IVA × 2 al 999 (lo podés cambiar) y el costo c/u sin IVA − 15%. La reposición se SUMA a lo que hay. Los precios de lo que ya existe no se tocan.'
          : 'Los nuevos se crean activos y solo en Point of Sale (las fotos se agregan a mano), con el precio público de la planilla y el costo por mayor − 15%. La reposición se SUMA a lo que hay. Los precios de lo que ya existe no se tocan.'} />}

      {editando === 'remito' && <EditorTexto texto={texto} onTexto={setTexto} onGuardar={guardarRemito} onCancelar={() => setEditando(null)}
        ayuda={AYUDA_REMITO} etiqueta="💾 Guardar remito" errores={errores} dudas={r.remito?.dudas ?? []}
        extra={r.remito && <>
          <Archivo etiqueta="📷 Volver a leer de la foto" accept="image/*" multiple disabled={ocupado} estilo={botonChico} onArchivos={(x) => { setEditando(null); onFotos(x); }} />
          <button style={{ ...botonChico, color: '#f87171' }} onClick={onBorrarRemito}>Borrar remito</button>
        </>} />}
      {editando === 'planilla' && <EditorTexto texto={texto} onTexto={setTexto} onGuardar={guardarPlanilla} onCancelar={() => setEditando(null)}
        ayuda={cfg.reef ? AYUDA_REEF : cfg.unPapel ? AYUDA_ULLUA : AYUDA_PLANILLA} etiqueta={cfg.unPapel ? '💾 Guardar' : '💾 Guardar planilla'} errores={errores} dudas={e.dudas ?? []} />}

      {motivos.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.84rem' }}>{motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {!abierta && <button style={{ ...enlace, marginTop: 6 }} onClick={onAbrir}>Ver el detalle artículo por artículo</button>}

      {abierta && (
        <div style={{ marginTop: 10 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
              <thead><tr><th style={th}>Código</th><th style={th}>Descripción</th><th style={th}>Tipo</th><th style={th}>{cfg.unPapel ? 'Unidades' : 'Planilla'}</th>{!cfg.unPapel && <th style={th}>Remito</th>}
                <th style={th}>{cfg.reef ? 'PMV' : cfg.unPapel ? 'c/u sin IVA' : 'Por mayor'}</th><th style={th}>{cfg.unPapel ? 'Costo (−15%)' : 'Público'}</th><th style={th}>En Shopify</th><th style={th}>Estado</th></tr></thead>
              <tbody>{r.filas.map((f) => {
                const [estado, color] = estadoFila(f, cfg.unPapel);
                const talles = e.renglones.find((x) => x.codigo === f.codigo)?.talles ?? [];
                const precios = [...new Set(f.productos.flatMap((p) => p.precios.map(fmt)))];
                const costos = [...new Set(f.productos.flatMap((p) => p.costos.map(fmt)))];
                return <tr key={f.codigo}>
                  <td style={td}>{f.codigo}</td>
                  <td style={td}>{f.descripcion}{talles.length ? <div style={{ opacity: 0.7 }}>{talles.map((t) => `${t.talle}:${t.cantidad}`).join(' ')}</div> : null}</td>
                  <td style={tdN}>{f.tipo === 'nuevo' ? '🆕 Nuevo' : f.tipo === 'reposicion' ? '🔁 Reposición' : '? sin consultar'}
                    {cargas[f.codigo] && <div style={{ color: cargas[f.codigo].estado === 'cargada' ? '#34d399' : '#fbbf24' }}>{cargas[f.codigo].estado === 'cargada' ? '✔ cargado' : `⚠️ ${cargas[f.codigo].estado}`}</div>}</td>
                  <td style={td}>{f.entrega}</td>
                  {!cfg.unPapel && <td style={td}>{f.remito ?? '—'}</td>}
                  <td style={tdN}>{f.precioMayor ? fmt(f.precioMayor) : '—'}{f.anterior && f.anterior.precioMayor && f.anterior.precioMayor !== f.precioMayor ? <div style={{ opacity: 0.7 }}>antes {fmt(f.anterior.precioMayor)}</div> : null}</td>
                  {cfg.unPapel
                    ? <td style={tdN}>{f.precioMayor ? fmt(costoUllua(f.precioMayor)) : '—'}</td>
                    : <td style={tdN}>{f.precioPublico ? fmt(f.precioPublico) : '—'}{f.anterior && f.anterior.precioPublico && f.anterior.precioPublico !== f.precioPublico ? <div style={{ opacity: 0.7 }}>antes {fmt(f.anterior.precioPublico)}</div> : null}</td>}
                  <td style={td}>{f.tipo === 'reposicion' ? <><span style={{ whiteSpace: 'nowrap' }}>{precios.join(' / ')}{cfg.unPapel && costos.length ? ` · costo ${costos.join(' / ')}` : ''}</span><div style={{ opacity: 0.7 }}>{f.productos.map((p) => p.titulo).join(' · ')}</div></> : '—'}</td>
                  <td style={{ ...td, color }}>{estado}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: '0.82rem' }}>
            <Copiar etiqueta="📋 Copiar resumen" texto={resumenFamily(r, cfg.m.nombre, cfg.opciones.mayor)} />
            <button style={botonChico} disabled={ocupado} onClick={onConsultar}>🔄 Consultar Shopify de nuevo</button>
            <label>fecha {cfg.unPapel ? 'de la entrega' : 'de la planilla'} <input type="date" value={e.fecha} style={inputSt} onChange={(ev) => ev.target.value && onFecha(ev.target.value)} /></label>
            <label title={`Va a la planilla de ingreso (FECHA). ${ingreso.origen === 'escrita' ? 'Escrita a mano.' : 'Por ahora es el día que se subió a la app: si entró otro día, cambiala antes de cargar.'}`}>
              📅 entró el <input type="date" value={ingreso.fecha} style={inputSt} disabled={ocupado}
                onChange={(ev) => ev.target.value && ev.target.value !== ingreso.fecha && onIngreso(ev.target.value)} /></label>
            {e.shopify?.fecha && <span style={{ opacity: 0.65 }}>Shopify consultado el {fechaAr(e.shopify.fecha)}</span>}
            {!enShopify.completa && !plan && <button style={botonChico} disabled={ocupado} onClick={onArmar}>⬆️ Cargar en Shopify</button>}
            {Object.entries(cargas).filter(([, c]) => c.estado === 'cargada').map(([codigo, c]) => (
              <button key={codigo} style={{ ...botonChico, background: 'transparent', opacity: 0.7 }} disabled={ocupado} title={textoCarga(c)} onClick={() => onLiberar(codigo, c)}>🔓 {codigo}</button>
            ))}
            <button style={{ ...botonChico, background: 'transparent', color: '#f87171' }} onClick={onBorrar}>Borrar entrega</button>
          </div>
        </div>
      )}
    </div>
  );
}
