// ============================================================================
// CONTROL DE FACTURAS CONTRA PEDIDOS (10-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Dentro de «Carga y control de entregas», debajo del asistente. Sin IA y sin
// costo: las cuentas las hace utils/controlFacturas.ts. Los archivos se leen en
// el navegador; pedidos, facturas, asignaciones y lo que cuenta el depósito se
// guardan en la base de Vercel (api/control-facturas.js). No toca Shopify.
// ============================================================================
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  analizarFacturas, claveRecepcion, compararRecepcion, fmt, mensajePagos, reporteReclamo, resumenPedidos,
  type Factura, type Pedido, type Recepcion, type ResultadoFactura,
} from './utils/controlFacturas';
import { leerFacturaDistrinando, leerFacturaId, leerPedidoAuto, type ItemPdf } from './utils/lectoresFacturas';

type Prov = 'distrinando' | 'id';
type PedidoGuardado = Pedido & { nroProveedor?: string; origen?: string };
type RecepcionGuardada = Recepcion & { nota?: string; actualizado?: string };
interface Datos {
  pedidos: PedidoGuardado[];
  facturas: Factura[];
  asignaciones: Record<string, string[]>;
  recepciones: Record<string, RecepcionGuardada>;
  config: { condicionesPago?: string };
}
const VACIO: Datos = { pedidos: [], facturas: [], asignaciones: {}, recepciones: {}, config: {} };
const PROVS: { id: Prov; nombre: string }[] = [
  { id: 'id', nombre: 'iD Argentina (Converse, Le Coq)' },
  { id: 'distrinando', nombre: 'Distrinando (Reebok, Kappa, Crocs)' },
];
type Vista = 'facturas' | 'pedidos' | 'deposito' | 'reportes';
interface AdjuntoTrello { id: string; nombre: string; bytes: number; fecha: string }
interface TarjetaTrello { id: string; nombre: string; descripcion: string; lista: string; creada: string; inicio: string; vence: string; etiquetas: string[]; adjuntos: AdjuntoTrello[] }

const inputSt: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '0.85rem',
};
const th: React.CSSProperties = { padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)', verticalAlign: 'top' };
const SEMAFORO = {
  ok: { icono: '✅', texto: 'OK para pagar', color: '#34d399' },
  observaciones: { icono: '⚠️', texto: 'Con observaciones', color: '#fbbf24' },
  reclamar: { icono: '❌', texto: 'Reclamar', color: '#f87171' },
} as const;
const hoy = () => new Date().toISOString().slice(0, 10);
const slug = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'x';
const fechaAr = (iso?: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(o: { data: ArrayBuffer }): { promise: Promise<{ numPages: number; getPage(i: number): Promise<{ getTextContent(): Promise<{ items: ItemPdf[] }> }> }> };
}
const mensaje = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado.');

async function itemsPdf(file: File): Promise<ItemPdf[][]> {
  const pdfjsLib = (window as unknown as { pdfjsLib?: PdfJs }).pdfjsLib;
  if (!pdfjsLib) throw new Error('No cargó el lector de PDF. Refrescá la página con Ctrl+Shift+R.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const paginas: ItemPdf[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) paginas.push((await (await pdf.getPage(i)).getTextContent()).items);
  return paginas;
}

async function api(body?: object, proveedor?: Prov) {
  const r = body
    ? await fetch('/api/control-facturas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await fetch(`/api/control-facturas?proveedor=${proveedor}`, { cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { sinBase: d.sinBase === true });
  return d;
}

function Copiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [ok, setOk] = useState(false);
  return <button className="btn" style={{ fontSize: '0.8rem', padding: '4px 10px' }}
    onClick={() => navigator.clipboard.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}>
    {ok ? '✔ Copiado' : etiqueta}</button>;
}

export default function ControlFacturas() {
  const [prov, setProv] = useState<Prov>('id');
  const [vista, setVista] = useState<Vista>('facturas');
  const [datos, setDatos] = useState<Datos>(VACIO);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [sinBase, setSinBase] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [fechaPedido, setFechaPedido] = useState(hoy());
  const [abierta, setAbierta] = useState<string | null>(null);
  const [facturaDeposito, setFacturaDeposito] = useState('');
  const [condiciones, setCondiciones] = useState('');

  const recargar = useCallback(async () => {
    setCargando(true); setError('');
    try {
      const d = await api(undefined, prov);
      setDatos({ ...VACIO, ...d }); setSinBase(false);
      setCondiciones(d.config?.condicionesPago || '');
    } catch (e) { setError(mensaje(e)); setSinBase(!!(e as { sinBase?: boolean }).sinBase); setDatos(VACIO); }
    finally { setCargando(false); }
  }, [prov]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de proveedor
  useEffect(() => { recargar(); }, [recargar]);

  const res = useMemo(() => analizarFacturas(datos.pedidos, datos.facturas, datos.asignaciones), [datos]);
  const resumen = useMemo(() => resumenPedidos(datos.pedidos, res), [datos.pedidos, res]);
  const nombrePedido = (id: string) => { const p = datos.pedidos.find((x) => x.id === id); return p ? (p.nroProveedor || p.nombre) : id; };

  async function guardar(body: object) {
    setError('');
    try { await api({ proveedor: prov, ...body }); await recargar(); return true; }
    catch (e) { setError(mensaje(e)); return false; }
  }

  /** Lee un Excel de pedido y lo guarda. Devuelve los mensajes para mostrar. */
  async function guardarPedidoExcel(buf: ArrayBuffer, archivo: string, fecha: string, extra: { id?: string; nombre?: string; origen: string }): Promise<string[]> {
    const wb = XLSX.read(buf);
    const hoja = wb.SheetNames.find((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden) || wb.SheetNames[0];
    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, raw: true });
    const nombre = extra.nombre || archivo.replace(/\.[^.]+$/, '');
    const r = leerPedidoAuto(filas, '', nombre, fecha);
    if (r.proveedor !== prov) return [`${archivo}: parece de ${r.proveedor === 'id' ? 'iD' : 'Distrinando'}; cambiá el proveedor arriba.`];
    const id = extra.id || `P-${slug(r.nroProveedor || nombre)}-${fecha}`;
    // El mismo pedido cargado dos veces (a mano y desde Trello) duplicaría el saldo y taparía lo facturado sin pedir.
    const firma = (ls: { sku: string; cantidad: number }[]) => ls.map((l) => `${l.sku}:${l.cantidad}`).sort().join('|');
    const repetido = datos.pedidos.find((p) => p.id !== id && ((r.nroProveedor && p.nroProveedor === r.nroProveedor) || firma(p.lineas) === firma(r.pedido.lineas)));
    if (repetido) return [`${archivo}: este pedido ya está cargado como «${repetido.nroProveedor ? `N° ${repetido.nroProveedor}` : repetido.nombre}». Si querés reemplazarlo, borralo primero.`];
    if (!(await guardar({ accion: 'guardarPedido', pedido: { ...r.pedido, id, nroProveedor: r.nroProveedor, origen: extra.origen } }))) return [];
    return [`${archivo}: ${r.pedido.lineas.reduce((s, l) => s + l.cantidad, 0)} unidades guardadas con fecha ${fechaAr(fecha)}.`, ...r.avisos];
  }

  async function subirPedidos(files: FileList | null) {
    if (!files?.length) return;
    const nuevos: string[] = [];
    for (const file of [...files]) {
      try { nuevos.push(...await guardarPedidoExcel(await file.arrayBuffer(), file.name, fechaPedido, { origen: 'manual' })); }
      catch (e) { nuevos.push(`${file.name}: ${mensaje(e)}`); }
    }
    setAvisos(nuevos);
  }

  async function importarDeTrello(t: TarjetaTrello, a: AdjuntoTrello, fecha: string) {
    try {
      const r = await fetch(`/api/trello?accion=adjunto&tarjeta=${t.id}&adjunto=${a.id}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      const bin = atob(d.datos);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      setAvisos(await guardarPedidoExcel(buf.buffer, a.nombre, fecha, { id: `T-${a.id}`, nombre: t.nombre, origen: `trello:${t.id}` }));
    } catch (e) { setAvisos([`${t.nombre}: ${mensaje(e)}`]); }
  }

  async function subirFacturas(files: FileList | null) {
    if (!files?.length) return;
    const nuevos: string[] = [];
    for (const file of [...files]) {
      try {
        const paginas = await itemsPdf(file);
        const { factura, avisos: av } = prov === 'id' ? leerFacturaId(paginas, '') : leerFacturaDistrinando(paginas, '');
        const id = `F-${slug(factura.numero || file.name)}`;
        const ya = datos.facturas.some((f) => f.id === id);
        if (await guardar({ accion: 'guardarFactura', factura: { ...factura, id } })) {
          nuevos.push(`${file.name}: factura ${factura.numero} ${ya ? 'actualizada (ya estaba cargada)' : 'guardada'}.`, ...av);
          setAbierta(id);
        }
      } catch (e) { nuevos.push(`${file.name}: ${mensaje(e)}`); }
    }
    setAvisos(nuevos);
  }

  const pedidosOrd = [...datos.pedidos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const facturasRes = [...res.facturas].reverse();

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>📑 Control de facturas contra pedidos</h2>
      <p style={{ fontSize: '0.88rem', opacity: 0.85, marginTop: 0 }}>
        Cargá los pedidos (Excel del proveedor) y las facturas (PDF). La app asigna cada artículo al pedido más viejo con saldo,
        avisa lo facturado sin pedir, doble cobro, precios distintos a la lista del pedido y errores de cuentas. Queda todo guardado.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <select value={prov} onChange={(e) => { setProv(e.target.value as Prov); setAvisos([]); setAbierta(null); setFacturaDeposito(''); }}
          style={{ ...inputSt, background: 'var(--bg-color)', fontSize: '0.9rem' }}>
          {PROVS.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {(['facturas', 'pedidos', 'deposito', 'reportes'] as Vista[]).map((v) => (
          <button key={v} className="btn" onClick={() => setVista(v)}
            style={{ fontSize: '0.85rem', padding: '5px 12px', opacity: vista === v ? 1 : 0.6, background: vista === v ? undefined : 'transparent' }}>
            {{ facturas: '🧾 Facturas', pedidos: '📋 Pedidos', deposito: '📦 Depósito', reportes: '📊 Reportes' }[v]}
          </button>
        ))}
        {cargando && <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Cargando…</span>}
      </div>

      {sinBase && <p style={{ color: '#fbbf24', fontSize: '0.9rem' }}>⚠ Falta conectar la base de datos al proyecto en Vercel. Sin ella no se pueden guardar pedidos ni facturas.</p>}
      {error && !sinBase && <p style={{ color: '#f87171', fontWeight: 'bold' }}>⚠ {error}</p>}
      {avisos.length > 0 && <div style={{ fontSize: '0.82rem', margin: '6px 0 10px' }}>{avisos.map((a, i) => <div key={i}>• {a}</div>)}</div>}

      {vista === 'pedidos' && (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: '0.85rem' }}>Fecha en que se mandó el pedido{' '}
              <input type="date" value={fechaPedido} onChange={(e) => setFechaPedido(e.target.value)} style={inputSt} /></label>
            <label className="btn" style={{ fontSize: '0.85rem', padding: '5px 12px', cursor: 'pointer' }}>
              ➕ Subir pedido(s) Excel
              <input type="file" accept=".xlsx,.xls" multiple hidden onChange={(e) => { subirPedidos(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
          <p style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: 0 }}>La fecha del archivo no sirve (el proveedor reusa plantillas): poné la del día que lo mandaste. Ordena qué pedido se factura primero.</p>
          <Trello importados={new Set(datos.pedidos.map((p) => p.id))} onImportar={importarDeTrello} />
          <table style={{ borderCollapse: 'collapse', fontSize: '0.84rem', width: '100%' }}>
            <thead><tr><th style={th}>Pedido</th><th style={th}>Fecha</th><th style={th}>Pedido u.</th><th style={th}>Facturado</th><th style={th}>Pendiente</th><th style={th}>Estado</th><th style={th}></th></tr></thead>
            <tbody>{pedidosOrd.map((p) => {
              const r = resumen.find((x) => x.pedidoId === p.id)!;
              const det = res.pendientes.filter((x) => x.pedidoId === p.id);
              return (<Fragment key={p.id}>
                <tr>
                  <td style={td}><button onClick={() => setAbierta(abierta === p.id ? null : p.id)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                    {abierta === p.id ? '▾' : '▸'} {p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre}</button></td>
                  <td style={td}><input type="date" value={p.fecha} style={inputSt}
                    onChange={(e) => e.target.value && guardar({ accion: 'guardarPedido', pedido: { ...p, fecha: e.target.value } })} /></td>
                  <td style={td}>{r.pedido}</td><td style={td}>{r.facturado}</td><td style={td}>{r.pendiente}</td>
                  <td style={{ ...td, color: r.estado === 'completo' ? '#34d399' : r.estado === 'parcial' ? '#fbbf24' : undefined }}>{r.estado}</td>
                  <td style={td}><button onClick={() => confirm(`¿Borrar el pedido ${p.nombre}?`) && guardar({ accion: 'borrarPedido', id: p.id })}
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
          {!pedidosOrd.length && !cargando && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no hay pedidos cargados de este proveedor.</p>}
        </div>
      )}

      {vista === 'facturas' && (
        <div>
          <label className="btn" style={{ fontSize: '0.85rem', padding: '5px 12px', cursor: 'pointer', display: 'inline-block', marginBottom: 10 }}>
            ➕ Subir factura(s) PDF
            <input type="file" accept=".pdf" multiple hidden onChange={(e) => { subirFacturas(e.target.files); e.target.value = ''; }} />
          </label>
          {prov === 'id' && <p style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: 0 }}>iD factura calzado e indumentaria por separado y puede juntar varios pedidos: cargá todas las facturas y todos los pedidos abiertos.</p>}
          {!facturasRes.length && !cargando && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no hay facturas cargadas de este proveedor.</p>}
          {facturasRes.map((r) => <TarjetaFactura key={r.factura.id} r={r} abierta={abierta === r.factura.id}
            onAbrir={() => setAbierta(abierta === r.factura.id ? null : r.factura.id)} pedidos={pedidosOrd} nombrePedido={nombrePedido}
            manual={datos.asignaciones[r.factura.id] || []} condiciones={condiciones}
            onAsignar={(ids) => guardar({ accion: 'guardarAsignacion', facturaId: r.factura.id, pedidos: ids })}
            onBorrar={() => confirm(`¿Borrar la factura ${r.factura.numero}? También se borra lo que contó el depósito.`) && guardar({ accion: 'borrarFactura', id: r.factura.id })}
            onDeposito={() => { setFacturaDeposito(r.factura.id); setVista('deposito'); }} />)}
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
            <button className="btn" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={() => guardar({ accion: 'guardarConfig', config: { condicionesPago: condiciones } })}>Guardar</button>
          </label>
          <h3 style={{ fontSize: '1rem' }}>Pendiente de entrega por pedido y talle</h3>
          <Pendientes res={res} nombrePedido={nombrePedido} />
          <h3 style={{ fontSize: '1rem' }}>Mensajes para pagos</h3>
          {facturasRes.map((r) => <pre key={r.factura.id} style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', background: 'rgba(0,0,0,0.25)', padding: 8, borderRadius: 6 }}>{mensajePagos(r, condiciones, nombrePedido)}</pre>)}
          {facturasRes.length > 0 && <Copiar etiqueta="📋 Copiar todos" texto={facturasRes.map((r) => mensajePagos(r, condiciones, nombrePedido)).join('\n\n')} />}
        </div>
      )}
    </div>
  );
}

function TarjetaFactura({ r, abierta, onAbrir, pedidos, nombrePedido, manual, condiciones, onAsignar, onBorrar, onDeposito }: {
  r: ResultadoFactura; abierta: boolean; onAbrir: () => void; pedidos: PedidoGuardado[]; nombrePedido: (id: string) => string;
  manual: string[]; condiciones: string; onAsignar: (ids: string[]) => void; onBorrar: () => void; onDeposito: () => void;
}) {
  const f = r.factura;
  const s = SEMAFORO[r.semaforo];
  const reclamo = reporteReclamo(r);
  return (
    <div style={{ border: `1px solid ${s.color}55`, borderRadius: 8, padding: '10px 12px', marginBottom: 10, background: `${s.color}0d` }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }} onClick={onAbrir}>
        <strong>{abierta ? '▾' : '▸'} Factura {f.numero}</strong>
        <span style={{ opacity: 0.8, fontSize: '0.85rem' }}>{fechaAr(f.fecha)} · {r.unidades} u. · {fmt(f.total)}{f.vencimiento ? ` · vence ${fechaAr(f.vencimiento)}` : ''}</span>
        <span style={{ color: s.color, fontWeight: 'bold' }}>{s.icono} {s.texto}</span>
        <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>Pedidos: {r.pedidosCubiertos.map(nombrePedido).join(' + ') || 'ninguno'} {r.pedidosCubiertos.length ? (r.pedidosCompletos ? '(completos)' : '(parcial)') : ''}</span>
      </div>
      {r.motivos.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '0.84rem' }}>{r.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {abierta && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: 6 }}>
            {f.remito && <>Remito {f.remito} · </>}{f.pedidoProveedor && <>Basada en pedidos del proveedor {f.pedidoProveedor} · </>}
            Subtotal {fmt(f.subtotal)} · IVA {fmt(f.iva)} · Perc. CABA {fmt(f.percepcionCaba)} · Perc. Bs.As. {fmt(f.percepcionBsAs)}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
              <thead><tr><th style={th}>Código</th><th style={th}>Descripción</th><th style={th}>Cant.</th><th style={th}>Precio</th><th style={th}>Bonif.</th><th style={th}>Total</th><th style={th}>Pedido asignado</th><th style={th}>Estado</th></tr></thead>
              <tbody>{r.renglones.map((x, i) => {
                const fr = f.renglones[i];
                const estado = x.posibleDobleCobro ? ['❌ doble cobro', '#f87171'] : x.sinPedir > 0 ? [`❌ ${x.sinPedir} sin pedir (${fmt(x.conImpuestosSinPedir)} c/imp.)`, '#f87171']
                  : x.difPrecio.length ? [`❌ precio ${fmt(x.difPrecio.reduce((t, d) => t + d.diferencia, 0))}`, '#f87171'] : !x.totalOk ? ['⚠️ renglón mal calculado', '#fbbf24']
                  : x.asignaciones.some((a) => a.adelanto) ? ['⚠️ adelanto', '#fbbf24'] : ['✅', '#34d399'];
                return <tr key={i}>
                  <td style={td}>{x.codigo}</td><td style={td}>{x.descripcion}</td><td style={td}>{x.cantidad}</td>
                  <td style={td}>{fmt(fr.precioUnitario)}</td><td style={td}>{fr.bonificacion}%</td><td style={td}>{fmt(fr.total)}</td>
                  <td style={td}>{x.asignaciones.map((a) => `${nombrePedido(a.pedidoId)} (${a.cantidad}${a.adelanto ? ', adelanto' : ''})`).join(', ') || '—'}</td>
                  <td style={{ ...td, color: estado[1] }}>{estado[0]}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <details style={{ marginTop: 8, fontSize: '0.82rem' }}>
            <summary style={{ cursor: 'pointer' }}>Asignar a mano a qué pedido corresponde ({manual.length ? manual.map(nombrePedido).join(', ') : 'automático'})</summary>
            <p style={{ opacity: 0.75, margin: '4px 0' }}>Los pedidos tildados se usan primero; el resto sigue por fecha.</p>
            {pedidos.map((p) => <label key={p.id} style={{ display: 'block' }}>
              <input type="checkbox" checked={manual.includes(p.id)}
                onChange={(e) => onAsignar(e.target.checked ? [...manual, p.id] : manual.filter((x) => x !== p.id))} /> {p.nroProveedor ? `N° ${p.nroProveedor}` : p.nombre} ({fechaAr(p.fecha)})
            </label>)}
          </details>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Copiar etiqueta="📋 Mensaje para pagos" texto={mensajePagos(r, condiciones, nombrePedido)} />
            {reclamo && <Copiar etiqueta="📋 Texto de reclamo" texto={reclamo} />}
            <button className="btn" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={onDeposito}>📦 Checklist del depósito</button>
            <button className="btn" style={{ fontSize: '0.8rem', padding: '4px 10px', background: 'transparent', color: '#f87171' }} onClick={onBorrar}>Borrar factura</button>
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
                  <button className="btn" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => {
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
              <button className="btn" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => {
                if (!extra.codigo.trim() || !(Number(extra.cantidad) > 0)) return;
                setRec((x) => ({ ...x, extras: [...x.extras, { codigo: extra.codigo.trim().toUpperCase(), talle: extra.talle.trim().toUpperCase(), cantidad: Number(extra.cantidad) }] }));
                setExtra({ codigo: '', talle: '', cantidad: '' });
              }}>Agregar</button>
            </div>
          </div>
          <textarea placeholder="Nota del depósito (opcional)" value={rec.nota || ''} onChange={(e) => setRec((x) => ({ ...x, nota: e.target.value }))}
            style={{ ...inputSt, width: '100%', minHeight: 50, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
            <button className="btn" onClick={async () => { if (await onGuardar(elegida, rec)) setGuardado('✔ Guardado'); }}>💾 Guardar lo recibido</button>
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
          <thead><tr><th style={th}>Pedido</th><th style={th}>Código</th><th style={th}>Descripción</th><th style={th}>Talle</th><th style={th}>Pedido</th><th style={th}>Pendiente</th></tr></thead>
          <tbody>{filas.map((p, i) => <tr key={i}><td style={td}>{nombrePedido(p.pedidoId)}</td><td style={td}>{p.codigo}</td><td style={td}>{p.descripcion}</td>
            <td style={td}>{p.talle}</td><td style={td}>{p.pedido}</td><td style={td}>{p.pendiente ?? 'a confirmar'}</td></tr>)}</tbody>
        </table>
      </div>
      <div style={{ marginTop: 6 }}><Copiar etiqueta="📋 Copiar pendientes (para Excel)" texto={texto} /></div>
    </div>
  );
}

/** Tarjetas del tablero de compras con Excel adjunto, para importarlas como pedidos. */
function Trello({ importados, onImportar }: { importados: Set<string>; onImportar: (t: TarjetaTrello, a: AdjuntoTrello, fecha: string) => Promise<void> }) {
  const [datos, setDatos] = useState<{ tablero: string; tarjetas: TarjetaTrello[] } | null>(null);
  const [estado, setEstado] = useState<'' | 'cargando' | string>('');
  const [fechas, setFechas] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState('');
  const [trabajando, setTrabajando] = useState('');

  async function cargar() {
    setEstado('cargando');
    try {
      const r = await fetch('/api/trello?accion=tarjetas', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setDatos(d); setEstado('');
    } catch (e) { setEstado(mensaje(e)); }
  }

  const conExcel = (datos?.tarjetas ?? []).filter((t) => t.adjuntos.length && (!filtro || `${t.nombre} ${t.lista} ${t.etiquetas.join(' ')}`.toLowerCase().includes(filtro.toLowerCase())));
  return (
    <details style={{ margin: '0 0 12px', border: '1px solid rgba(96,165,250,0.35)', borderRadius: 8, padding: '8px 10px' }}
      onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !datos && estado !== 'cargando') cargar(); }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>🗂️ Importar pedidos desde Trello{datos ? ` (${datos.tablero})` : ''}</summary>
      {estado === 'cargando' && <p style={{ fontSize: '0.82rem', opacity: 0.75 }}>Leyendo el tablero…</p>}
      {estado && estado !== 'cargando' && <p style={{ fontSize: '0.82rem', color: '#fbbf24' }}>⚠ {estado}</p>}
      {datos && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
          <input placeholder="Buscar tarjeta, lista o etiqueta" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ ...inputSt, width: 240, maxWidth: '100%' }} />
          <button className="btn" style={{ fontSize: '0.8rem', padding: '4px 10px' }} onClick={cargar}>↻ Actualizar</button>
          <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>{conExcel.length} tarjeta(s) con Excel. La fecha propuesta es la de creación de la tarjeta: corregila si no es la del envío.</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
            <thead><tr><th style={th}>Tarjeta</th><th style={th}>Lista</th><th style={th}>Excel</th><th style={th}>Fecha del pedido</th><th style={th}></th></tr></thead>
            <tbody>{conExcel.flatMap((t) => t.adjuntos.map((a) => {
              const ya = importados.has(`T-${a.id}`);
              const fecha = fechas[a.id] ?? (t.inicio || t.creada);
              return <tr key={a.id}>
                <td style={td}>{t.nombre}{t.etiquetas.length ? <span style={{ opacity: 0.65 }}> · {t.etiquetas.join(', ')}</span> : null}</td>
                <td style={td}>{t.lista}</td>
                <td style={td}>{a.nombre}</td>
                <td style={td}><input type="date" value={fecha} onChange={(e) => setFechas((x) => ({ ...x, [a.id]: e.target.value }))} style={inputSt} /></td>
                <td style={td}><button className="btn" disabled={!!trabajando || !fecha} style={{ fontSize: '0.78rem', padding: '3px 9px' }}
                  onClick={async () => { setTrabajando(a.id); await onImportar(t, a, fecha); setTrabajando(''); }}>
                  {trabajando === a.id ? 'Importando…' : ya ? '↻ Reimportar' : '⬇ Importar'}</button>{ya && <span style={{ color: '#34d399', marginLeft: 6 }}>✔ cargado</span>}</td>
              </tr>;
            }))}</tbody>
          </table>
        </div>
      </>}
    </details>
  );
}
