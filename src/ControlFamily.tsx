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
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Archivo, Copiar, Parte } from './EntregasPartes';
import type { Remito } from './utils/controlFacturas';
import { fmt } from './utils/controlFacturas';
import {
  consultarShopifyFamily, controlarEntregaFamily, leerEntregaFamily, leerTextoEntregaFamily, resumenFamily, textoEntregaFamily,
  type EntregaFamily, type FilaFamily, type RenglonFamily, type ResultadoFamily,
} from './utils/controlFamily';
import {
  ejecutarCargaFamily, leerEstadoCarga, planCargaFamily, resumenCarga, SUCURSAL_FAMILY, textoCarga,
  type CargaFamily, type EleccionesCarga, type ItemCarga, type PlanCarga,
} from './utils/cargaFamily';
import { leerTextoRemito, textoRemito } from './utils/lectoresFacturas';
import { shopifyGraphQL } from './utils/shopify';
import {
  apiControl, botonChico, botonPrincipal, enlace, fechaAr, hoy, inputSt, leerFotos, mensaje, slug, td, th,
} from './utils/entregasUi';

const SEMAFORO = {
  ok: { icono: '✅', texto: 'Todo coincide', color: '#34d399' },
  observaciones: { icono: '⚠️', texto: 'Revisar los avisos', color: '#fbbf24' },
  revisar: { icono: '❌', texto: 'No coincide con el remito', color: '#f87171' },
  incompleta: { icono: '⏳', texto: 'Falta el remito', color: '#94a3b8' },
} as const;
const tdN: React.CSSProperties = { ...td, whiteSpace: 'nowrap' };
const api = (body?: object) => (body ? apiControl({ proveedor: 'family', ...body }) : apiControl(undefined, 'family'));
const esExcel = (f: File) => /\.(xlsx|xls)$/i.test(f.name);
const firma = (rs: RenglonFamily[]) => rs.map((r) => `${r.codigo}:${r.cantidad}`).sort().join('|');
type Leida = { fecha: string; renglones: RenglonFamily[]; dudas?: string[]; origen: 'excel' | 'foto' | 'manual'; nombre: string; avisos: string[] };

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

export default function ControlFamily() {
  const [entregas, setEntregas] = useState<EntregaFamily[]>([]);
  const [remitos, setRemitos] = useState<Record<string, Remito>>({});
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [sinBase, setSinBase] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [planilla, setPlanilla] = useState<File[]>([]);
  const [fotosRemito, setFotosRemito] = useState<File[]>([]);
  const [aMano, setAMano] = useState<string | null>(null);
  const [cargas, setCargas] = useState<Record<string, CargaFamily>>({});
  const [armado, setArmado] = useState<PlanCarga | null>(null);

  const recargar = useCallback(async () => {
    setCargando(true); setError('');
    try {
      const d = await api();
      // Cualquier cambio guardado deja vieja la vista previa de la carga: hay que armarla de nuevo.
      setEntregas(d.entregas ?? []); setRemitos(d.remitos ?? {}); setCargas(d.cargas ?? {}); setSinBase(false); setArmado(null);
    } catch (e) { setError(mensaje(e)); setSinBase(!!(e as { sinBase?: boolean }).sinBase); setEntregas([]); setRemitos({}); setCargas({}); }
    finally { setCargando(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial
  useEffect(() => { recargar(); }, [recargar]);

  const resultados = useMemo(() => [...entregas].sort((a, b) => (b.fecha + b.id).localeCompare(a.fecha + a.id))
    .map((e) => controlarEntregaFamily(e, remitos[e.id], entregas)), [entregas, remitos]);

  async function guardar(body: object) {
    setError('');
    try { await api(body); await recargar(); return true; }
    catch (e) { setError(mensaje(e)); return false; }
  }

  /** Busca en Shopify (solo lectura) si cada código ya existe. */
  async function conShopify(e: EntregaFamily): Promise<EntregaFamily> {
    setOcupado('Buscando los artículos en Shopify…');
    try { return { ...e, shopify: await consultarShopifyFamily(e.renglones.map((r) => r.codigo), shopifyGraphQL) }; }
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
  async function guardarNueva(leida: Leida, fotos: File[]) {
    const nuevos: string[] = [];
    const repetida = entregas.find((x) => x.fecha === leida.fecha && firma(x.renglones) === firma(leida.renglones));
    const id = repetida?.id || `E-${leida.fecha}-${slug(leida.nombre).slice(0, 30)}-${Date.now().toString(36)}`;
    let entrega: EntregaFamily = { id, nombre: leida.nombre, fecha: leida.fecha, origen: leida.origen, renglones: leida.renglones, dudas: leida.dudas ?? [] };
    entrega = await conShopify(entrega);
    await api({ accion: 'guardarEntrega', entrega });
    const u = leida.renglones.reduce((s, r) => s + r.cantidad, 0);
    nuevos.push(`Planilla del ${fechaAr(leida.fecha)} ${repetida ? 'actualizada (ya estaba cargada)' : 'guardada'}: ${leida.renglones.length} artículos, ${u} unidades.`, ...leida.avisos);
    if (entrega.shopify?.error) nuevos.push(`No pude consultar Shopify: ${entrega.shopify.error}`);
    if (fotos.length) nuevos.push(await remitoDeFotos(id, fotos));
    await recargar();
    setAvisos(nuevos);
    setAbierta(id);
  }

  async function controlar() {
    if (!planilla.length) return;
    let leida: Leida;
    setOcupado(planilla.some(esExcel) ? 'Leyendo la planilla…' : 'Leyendo la foto de la planilla… (puede tardar un minuto)');
    try { leida = await leerPlanilla(planilla); }
    catch (e) { setAvisos([`No pude leer la planilla de entrega: ${mensaje(e)}${planilla.some(esExcel) ? '' : ' Podés escribirla a mano.'}`]); setOcupado(''); return; }
    setOcupado('');
    try { await guardarNueva(leida, fotosRemito); } catch (e) { setAvisos([mensaje(e)]); return; }
    setPlanilla([]); setFotosRemito([]);
  }

  async function guardarAMano() {
    const { fecha, renglones, errores } = leerTextoEntregaFamily(aMano ?? '');
    if (errores.length) { setAvisos(errores); return; }
    if (!renglones.length) { setAvisos(['Escribí al menos un artículo.']); return; }
    try { await guardarNueva({ fecha: fecha || hoy(), renglones, origen: 'manual', nombre: 'Planilla escrita a mano', avisos: fecha ? [] : ['Sin fecha: se usó la de hoy.'] }, fotosRemito); }
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
      const estado = await leerEstadoCarga(r.entrega.renglones, shopifyGraphQL);
      setCargas(d.cargas ?? {});
      setArmado(planCargaFamily(r, estado, d.cargas ?? {}));
      setAbierta(r.entrega.id);
    } catch (e) { setAvisos([`No pude armar la carga: ${mensaje(e)} No se cargó nada.`]); }
    finally { setOcupado(''); }
  }

  async function confirmarCarga(plan: PlanCarga, elecciones: EleccionesCarga) {
    const res = resumenCarga(plan, elecciones);
    if (!res.altas && !res.reposiciones) return;
    const texto = [`Se va a cargar en Shopify (${SUCURSAL_FAMILY}):`, ...res.lineas, '',
      `${res.altas} producto(s) nuevo(s) y ${res.reposiciones} reposición(es), ${res.unidades} unidades en total.`,
      'Los precios de los productos que ya existen no se tocan. ¿Confirmás?'].join('\n');
    if (!confirm(texto)) return;
    const eid = plan.entregaId;
    setOcupado('Cargando en Shopify… no cierres esta página.');
    try {
      const resultados = await ejecutarCargaFamily(plan, elecciones, {
        gql: shopifyGraphQL,
        reservar: (codigo, firma, detalle) => api({ accion: 'reservarCarga', entregaId: eid, codigo, firma, detalle }),
        terminar: async (codigo, estado, detalle) => { await api({ accion: 'terminarCarga', entregaId: eid, codigo, estado, detalle }); },
        liberar: async (codigo) => { await api({ accion: 'liberarCarga', entregaId: eid, codigo }); },
        clave: () => crypto.randomUUID(),
        onProgreso: (h, t) => setOcupado(`Cargando en Shopify… ${h} de ${t}. No cierres esta página.`),
      });
      const icono = { cargada: '✅', parcial: '⚠️', dudosa: '❓', error: '❌', saltado: '↷' } as const;
      setAvisos(resultados.map((x) => `${icono[x.estado]} ${x.codigo}: ${x.mensaje}`));
      setArmado(null);
    } catch (e) { setAvisos([`La carga se cortó: ${mensaje(e)} Revisá en Shopify qué quedó cargado antes de volver a intentar.`]); }
    finally { setOcupado(''); await recargar(); }
  }

  async function liberarCarga(entregaId: string, codigo: string, c: CargaFamily) {
    const aviso = c.estado === 'cargada'
      ? `${codigo} figura como cargado en Shopify. Si liberás la marca, la app lo deja cargar OTRA VEZ (sumaría el stock dos veces o crearía otro producto). ¿Seguro?`
      : `${codigo}: ${textoCarga(c)}\n\nAntes de liberar, mirá en Shopify si quedó cargado y corregilo a mano si hace falta. Si liberás, la app lo deja cargar de nuevo. ¿Liberar?`;
    if (!confirm(aviso)) return;
    setArmado(null);
    await guardar({ accion: 'liberarCarga', entregaId, codigo });
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
      {avisos.length > 0 && <div style={{ fontSize: '0.84rem', margin: '6px 0 12px', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
        {avisos.map((a, i) => <div key={i}>• {a}</div>)}
      </div>}

      <div style={{ border: '1px solid rgba(99,102,241,0.55)', borderRadius: 10, padding: '12px 14px', background: 'rgba(99,102,241,0.08)', marginBottom: 16 }}>
        <strong style={{ fontSize: '1rem' }}>Nueva entrega de Family</strong>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <Archivo etiqueta="1 · 📄 Planilla de entrega (Excel o foto)" accept=".xlsx,.xls,image/*" multiple disabled={!!ocupado} onArchivos={(f) => { setPlanilla(f); setAMano(null); }} />
          <span style={{ fontSize: '0.82rem', opacity: planilla.length ? 1 : 0.5 }}>{planilla.length ? `✔ ${planilla.length === 1 ? planilla[0].name : `${planilla.length} fotos`}` : 'sin elegir'}</span>
          <Archivo etiqueta="2 · 📷 Foto del remito" accept="image/*" multiple disabled={!!ocupado} onArchivos={(f) => setFotosRemito(f)} />
          <span style={{ fontSize: '0.82rem', opacity: fotosRemito.length ? 1 : 0.5 }}>{fotosRemito.length ? `✔ ${fotosRemito.length} foto(s)` : 'sin elegir'}</span>
          <button style={{ ...botonPrincipal, opacity: planilla.length && !ocupado ? 1 : 0.5, cursor: planilla.length && !ocupado ? 'pointer' : 'not-allowed' }}
            disabled={!planilla.length || !!ocupado} onClick={controlar}>Controlar</button>
          <button style={enlace} onClick={() => { setAMano(aMano === null ? 'Fecha \n' : null); setPlanilla([]); }}>{aMano === null ? 'o escribir la planilla a mano' : 'cancelar'}</button>
        </div>
        {aMano !== null && <EditorTexto texto={aMano} onTexto={setAMano} onGuardar={guardarAMano} onCancelar={() => setAMano(null)} ayuda={AYUDA_PLANILLA} etiqueta="💾 Guardar y controlar" />}
        <p style={{ fontSize: '0.8rem', opacity: 0.75, margin: '8px 0 0' }}>
          Family no factura: controlo la planilla contra el remito, te digo qué artículos son nuevos y cuáles reposición (los busco en Shopify) y te aviso si cambió algún precio. Con «⬆️ Cargar en Shopify» creo los nuevos y sumo la reposición en {SUCURSAL_FAMILY}, siempre con tu confirmación. Los precios de lo que ya existe no los toco.
        </p>
      </div>

      {!resultados.length && !cargando && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no hay entregas de Family cargadas.</p>}
      {resultados.map((r) => <TarjetaFamily key={r.entrega.id} r={r} abierta={abierta === r.entrega.id} ocupado={!!ocupado}
        cargas={Object.fromEntries(Object.entries(cargas).filter(([k]) => k.startsWith(`${r.entrega.id}|`)).map(([k, v]) => [k.slice(r.entrega.id.length + 1), v]))}
        plan={armado?.entregaId === r.entrega.id ? armado : null}
        onArmar={() => armarCarga(r)} onConfirmar={(el) => armado && confirmarCarga(armado, el)} onCancelarCarga={() => setArmado(null)}
        onLiberar={(codigo, c) => liberarCarga(r.entrega.id, codigo, c)}
        onAbrir={() => setAbierta(abierta === r.entrega.id ? null : r.entrega.id)}
        onFotos={async (f) => { const m = await remitoDeFotos(r.entrega.id, f); await recargar(); setAvisos([m]); }}
        onGuardarRemito={(remito) => guardar({ accion: 'guardarRemito', facturaId: r.entrega.id, remito })}
        onBorrarRemito={() => confirm('¿Borrar el remito de esta entrega?') && guardar({ accion: 'borrarRemito', facturaId: r.entrega.id })}
        onGuardarEntrega={async (e) => { try { return await guardar({ accion: 'guardarEntrega', entrega: await conShopify(e) }); } catch (err) { setError(mensaje(err)); return false; } }}
        onFecha={(fecha) => guardar({ accion: 'guardarEntrega', entrega: { ...r.entrega, fecha } })}
        onConsultar={() => reconsultar(r.entrega)}
        onBorrar={() => confirm(`¿Borrar la entrega del ${fechaAr(r.entrega.fecha)}? Se borra también su remito.`) && guardar({ accion: 'borrarEntrega', id: r.entrega.id })} />)}
    </div>
  );
}

const AYUDA_PLANILLA = <>Una línea por artículo: código, talle/cantidad, precio por mayor y precio público (con $), y la descripción. Ej.:<br />
  <code>Fecha 30/10/2026</code><br /><code>SHBSPEC S/2 M/4 L/4 XL/6 2XL/4 $34500 $69000 Short Spectrum Basket Negro/Multi</code></>;
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
function estadoFila(f: FilaFamily): [string, string] {
  const rojo = '#f87171', amarillo = '#fbbf24';
  if (f.remito !== null && f.remito !== f.entrega) return [`❌ el remito trae ${f.remito}`, rojo];
  if (f.cambiosPrecio.length) return ['⚠️ cambió el precio', amarillo];
  if (f.sumaMal) return ['⚠️ talles no suman el total', amarillo];
  if (f.tallesNuevos.length) return [`⚠️ talle ${f.tallesNuevos.join(', ')} nuevo`, amarillo];
  if (f.remito === null) return ['⏳ falta el remito', '#94a3b8'];
  return ['✅', '#34d399'];
}

function TarjetaFamily({ r, abierta, ocupado, cargas, plan, onArmar, onConfirmar, onCancelarCarga, onLiberar, onAbrir, onFotos, onGuardarRemito, onBorrarRemito, onGuardarEntrega, onFecha, onConsultar, onBorrar }: {
  r: ResultadoFamily; abierta: boolean; ocupado: boolean; cargas: Record<string, CargaFamily>; plan: PlanCarga | null;
  onArmar: () => void; onConfirmar: (e: EleccionesCarga) => void; onCancelarCarga: () => void; onLiberar: (codigo: string, c: CargaFamily) => void;
  onAbrir: () => void; onFotos: (f: File[]) => void;
  onGuardarRemito: (r: Remito) => Promise<boolean>; onBorrarRemito: () => void; onGuardarEntrega: (e: EntregaFamily) => Promise<boolean>;
  onFecha: (f: string) => void; onConsultar: () => void; onBorrar: () => void;
}) {
  const e = r.entrega;
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
  const cargados = r.filas.filter((f) => cargas[f.codigo]?.estado === 'cargada').length;
  const aRevisar = Object.entries(cargas).filter(([, c]) => c.estado !== 'cargada');
  const puedeCargar = r.semaforo === 'ok' || r.semaforo === 'observaciones';
  // Ya cargada entera: «hay que darlos de alta» deja de ser cierto.
  const motivos = cargados === r.filas.length ? [...r.motivos.filter((m) => !/^(🆕|🔁)/.test(m)), '✔ Entrega cargada en Shopify.'] : r.motivos;
  return (
    <div style={{ border: `1px solid ${s.color}66`, borderRadius: 10, padding: '10px 12px', marginBottom: 12, background: `${s.color}0d` }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }} onClick={onAbrir}>
        <strong>{abierta ? '▾' : '▸'} Entrega del {fechaAr(e.fecha)}</strong>
        <span style={{ opacity: 0.8, fontSize: '0.85rem' }}>{r.filas.length} artículos · {r.unidades} u.{r.nuevos ? ` · 🆕 ${r.nuevos} nuevo(s)` : ''}{r.reposiciones ? ` · 🔁 ${r.reposiciones} reposición` : ''}{cargados ? ` · ✔ ${cargados === r.filas.length ? 'cargada' : `${cargados} cargado(s)`} en Shopify` : ''}</span>
        <span style={{ color: s.color, fontWeight: 'bold' }}>{s.icono} {s.texto}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Parte ok titulo="Planilla" detalle={`${r.filas.length} artículos${e.origen === 'foto' ? ' (de la foto)' : e.origen === 'manual' ? ' (escrita a mano)' : ''}`}>
          <button style={botonChico} onClick={() => abrir('planilla')}>✏️ Ver o corregir</button>
        </Parte>
        <Parte ok={!!r.remito} titulo="Remito" detalle={r.remito ? `${r.remito.numero || ''} · ${unidadesRemito} u.${r.remito.origen === 'foto' ? ' (de la foto)' : ''}` : 'falta'}>
          {!r.remito && <Archivo etiqueta="📷 Subir foto" accept="image/*" multiple disabled={ocupado} estilo={botonChico} onArchivos={onFotos} />}
          <button style={botonChico} onClick={() => abrir('remito')}>{r.remito ? '✏️ Ver o corregir' : '✏️ Escribirlo'}</button>
        </Parte>
        <Parte ok={cargados === r.filas.length} titulo="Shopify" detalle={cargados ? `${cargados} de ${r.filas.length} cargados` : 'sin cargar'}>
          {cargados < r.filas.length && !plan && <button style={{ ...botonChico, opacity: puedeCargar && !ocupado ? 1 : 0.5 }} disabled={ocupado}
            title={puedeCargar ? 'Crea los nuevos y suma la reposición, con vista previa y confirmación' : 'Primero la planilla tiene que coincidir con el remito'}
            onClick={onArmar}>⬆️ Cargar en Shopify</button>}
        </Parte>
      </div>
      {aRevisar.length > 0 && <div style={{ marginTop: 8, fontSize: '0.84rem', color: '#fbbf24' }}>
        {aRevisar.map(([codigo, c]) => <div key={codigo}>
          {codigo}: {textoCarga(c)}{' '}
          <button style={{ ...botonChico, padding: '1px 7px' }} disabled={ocupado} onClick={() => onLiberar(codigo, c)}>🔓 Ya lo revisé: liberar</button>
        </div>)}
      </div>}
      {plan && <PanelCarga plan={plan} ocupado={ocupado} onConfirmar={onConfirmar} onCancelar={onCancelarCarga} />}

      {editando === 'remito' && <EditorTexto texto={texto} onTexto={setTexto} onGuardar={guardarRemito} onCancelar={() => setEditando(null)}
        ayuda={AYUDA_REMITO} etiqueta="💾 Guardar remito" errores={errores} dudas={r.remito?.dudas ?? []}
        extra={r.remito && <>
          <Archivo etiqueta="📷 Volver a leer de la foto" accept="image/*" multiple disabled={ocupado} estilo={botonChico} onArchivos={(x) => { setEditando(null); onFotos(x); }} />
          <button style={{ ...botonChico, color: '#f87171' }} onClick={onBorrarRemito}>Borrar remito</button>
        </>} />}
      {editando === 'planilla' && <EditorTexto texto={texto} onTexto={setTexto} onGuardar={guardarPlanilla} onCancelar={() => setEditando(null)}
        ayuda={AYUDA_PLANILLA} etiqueta="💾 Guardar planilla" errores={errores} dudas={e.dudas ?? []} />}

      {motivos.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.84rem' }}>{motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {!abierta && <button style={{ ...enlace, marginTop: 6 }} onClick={onAbrir}>Ver el detalle artículo por artículo</button>}

      {abierta && (
        <div style={{ marginTop: 10 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
              <thead><tr><th style={th}>Código</th><th style={th}>Descripción</th><th style={th}>Tipo</th><th style={th}>Planilla</th><th style={th}>Remito</th>
                <th style={th}>Por mayor</th><th style={th}>Público</th><th style={th}>En Shopify</th><th style={th}>Estado</th></tr></thead>
              <tbody>{r.filas.map((f) => {
                const [estado, color] = estadoFila(f);
                const talles = e.renglones.find((x) => x.codigo === f.codigo)?.talles ?? [];
                const precios = [...new Set(f.productos.flatMap((p) => p.precios.map(fmt)))];
                return <tr key={f.codigo}>
                  <td style={td}>{f.codigo}</td>
                  <td style={td}>{f.descripcion}{talles.length ? <div style={{ opacity: 0.7 }}>{talles.map((t) => `${t.talle}:${t.cantidad}`).join(' ')}</div> : null}</td>
                  <td style={tdN}>{f.tipo === 'nuevo' ? '🆕 Nuevo' : f.tipo === 'reposicion' ? '🔁 Reposición' : '? sin consultar'}
                    {cargas[f.codigo] && <div style={{ color: cargas[f.codigo].estado === 'cargada' ? '#34d399' : '#fbbf24' }}>{cargas[f.codigo].estado === 'cargada' ? '✔ cargado' : `⚠️ ${cargas[f.codigo].estado}`}</div>}</td>
                  <td style={td}>{f.entrega}</td>
                  <td style={td}>{f.remito ?? '—'}</td>
                  <td style={tdN}>{f.precioMayor ? fmt(f.precioMayor) : '—'}{f.anterior && f.anterior.precioMayor && f.anterior.precioMayor !== f.precioMayor ? <div style={{ opacity: 0.7 }}>antes {fmt(f.anterior.precioMayor)}</div> : null}</td>
                  <td style={tdN}>{f.precioPublico ? fmt(f.precioPublico) : '—'}{f.anterior && f.anterior.precioPublico && f.anterior.precioPublico !== f.precioPublico ? <div style={{ opacity: 0.7 }}>antes {fmt(f.anterior.precioPublico)}</div> : null}</td>
                  <td style={td}>{f.tipo === 'reposicion' ? <><span style={{ whiteSpace: 'nowrap' }}>{precios.join(' / ')}</span><div style={{ opacity: 0.7 }}>{f.productos.map((p) => p.titulo).join(' · ')}</div></> : '—'}</td>
                  <td style={{ ...td, color }}>{estado}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: '0.82rem' }}>
            <Copiar etiqueta="📋 Copiar resumen" texto={resumenFamily(r)} />
            <button style={botonChico} disabled={ocupado} onClick={onConsultar}>🔄 Consultar Shopify de nuevo</button>
            <label>fecha de la planilla <input type="date" value={e.fecha} style={inputSt} onChange={(ev) => ev.target.value && onFecha(ev.target.value)} /></label>
            {e.shopify?.fecha && <span style={{ opacity: 0.65 }}>Shopify consultado el {fechaAr(e.shopify.fecha)}</span>}
            {cargados < r.filas.length && !plan && <button style={botonChico} disabled={ocupado} onClick={onArmar}>⬆️ Cargar en Shopify</button>}
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

const COLOR_ITEM = { listo: '#34d399', elegir: '#fbbf24', bloqueado: '#f87171', cargado: '#94a3b8' } as const;

/** Vista previa de la carga: qué se crea y qué se suma, artículo por artículo. Nada se escribe hasta confirmar. */
function PanelCarga({ plan, ocupado, onConfirmar, onCancelar }: { plan: PlanCarga; ocupado: boolean; onConfirmar: (e: EleccionesCarga) => void; onCancelar: () => void }) {
  const [elecciones, setElecciones] = useState<EleccionesCarga>(() =>
    Object.fromEntries(plan.items.filter((it) => it.opciones.length).map((it) => [it.codigo, { clave: it.opciones[0].clave }])));
  const elegir = (codigo: string, cambio: Partial<{ clave: string; titulo: string }>) =>
    setElecciones((x) => ({ ...x, [codigo]: { ...(x[codigo] ?? { clave: 'no' }), ...cambio } }));
  const res = resumenCarga(plan, elecciones);
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.6)', background: 'rgba(99,102,241,0.08)' }}>
      <strong>⬆️ Carga en Shopify ({SUCURSAL_FAMILY}): revisá antes de confirmar</strong>
      <div style={{ fontSize: '0.8rem', opacity: 0.8, margin: '4px 0 8px' }}>
        Los nuevos se crean activos y solo en Point of Sale (las fotos se agregan a mano), con el precio público de la planilla y el costo por mayor − 15%. La reposición se SUMA a lo que hay. Los precios de lo que ya existe no se tocan.
      </div>
      {plan.avisos.map((a, i) => <div key={i} style={{ color: '#fbbf24', fontSize: '0.84rem' }}>⚠️ {a}</div>)}
      {plan.items.map((it) => <FilaCarga key={it.codigo} it={it} eleccion={elecciones[it.codigo]} onElegir={(c) => elegir(it.codigo, c)} />)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <button style={{ ...botonPrincipal, opacity: res.lineas.length && !ocupado ? 1 : 0.5, cursor: res.lineas.length && !ocupado ? 'pointer' : 'not-allowed' }}
          disabled={!res.lineas.length || ocupado} onClick={() => onConfirmar(elecciones)}>✅ Confirmar y cargar</button>
        <button style={botonChico} disabled={ocupado} onClick={onCancelar}>Cancelar</button>
        <span style={{ fontSize: '0.84rem', opacity: 0.85 }}>
          {res.lineas.length ? `${res.altas} nuevo(s) y ${res.reposiciones} reposición(es): ${res.unidades} unidades.` : 'No hay nada elegido para cargar.'}
        </span>
      </div>
    </div>
  );
}

function FilaCarga({ it, eleccion, onElegir }: { it: ItemCarga; eleccion?: { clave: string; titulo?: string }; onElegir: (c: Partial<{ clave: string; titulo: string }>) => void }) {
  const op = it.opciones.find((o) => o.clave === (eleccion?.clave ?? it.opciones[0]?.clave));
  const a = op?.accion;
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '7px 0', fontSize: '0.84rem' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ color: COLOR_ITEM[it.estado] }}>{it.codigo}</strong>
        <span style={{ opacity: 0.8 }}>{it.descripcion} · {it.unidades} u.</span>
        {it.opciones.length > 1 && <select value={eleccion?.clave ?? it.opciones[0].clave} onChange={(ev) => onElegir({ clave: ev.target.value })} style={{ ...inputSt, maxWidth: '100%' }}>
          {it.opciones.map((o) => <option key={o.clave} value={o.clave} disabled={!!o.bloqueo}>{o.etiqueta}{o.bloqueo ? ' (no se puede)' : ''}</option>)}
        </select>}
      </div>
      {it.motivo && <div style={{ color: COLOR_ITEM[it.estado], marginTop: 2 }}>{it.estado === 'bloqueado' ? '⛔ ' : ''}{it.motivo}</div>}
      {it.opciones.filter((o) => o.bloqueo && it.opciones.length > 1).map((o) => <div key={o.clave} style={{ opacity: 0.75 }}>· {o.etiqueta}: {o.bloqueo}</div>)}
      {a?.tipo === 'alta' && <div style={{ marginTop: 4 }}>
        🆕 Crear <input value={eleccion?.titulo ?? a.titulo} onChange={(ev) => onElegir({ titulo: ev.target.value })} style={{ ...inputSt, width: 'min(420px, 100%)' }} />
        <div style={{ opacity: 0.8, marginTop: 2 }}>
          Tipo {a.productType} · precio {fmt(a.precio)} · costo {fmt(a.costo)} · {a.variantes.map((v) => `${v.talle}:${v.cantidad}`).join(' ')} · SKU {a.variantes[0]?.sku}… · etiquetas {a.etiquetas.join(', ')}
        </div>
      </div>}
      {a?.tipo === 'reposicion' && <div style={{ marginTop: 4 }}>
        🔁 Sumar en «{a.titulo}»: {a.lineas.map((l) => (l.actual === null ? `${l.talle} alta con ${l.suma}` : `${l.talle} ${l.actual}→${l.actual + l.suma}`)).join(' · ')}
      </div>}
      {op?.avisos.map((x, i) => <div key={i} style={{ color: '#fbbf24' }}>⚠️ {x}</div>)}
    </div>
  );
}
