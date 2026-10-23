// ============================================================================
// PESTAÑA CONTROL DE REMITOS — ¿se cargó bien lo que llegó?
// ----------------------------------------------------------------------------
// Wanda saca foto al remito/factura del proveedor → la IA lo pasa a tabla →
// se revisa → la app trae de Shopify QUIÉN cargó stock en esas fechas y
// compara talle por talle. SOLO LECTURA: no escribe nada en Shopify.
// Lógica en utils/controlRemitos.ts (con tests).
// ============================================================================
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  chequeosRemito, compararRemito, netoPorVariante, personasDe, sumarDias, remitoDesdeFilas,
  traerMovimientos, traerVariantes, variantesHuerfanas,
} from './utils/controlRemitos';
import type { Movimiento, Remito, RenglonRemito, VarianteInfo, FilaControl, TipoFila } from './utils/controlRemitos';
import { compararConPedido, notaDesdeFilas } from './utils/controlPedido';
import type { NotaPedido, TipoPedido, FilaPedido } from './utils/controlPedido';
import { facturaGrupoBlanco, lineasDePagina, notaGrupoBlanco } from './utils/grupoBlanco';

// Cada proveedor trae su factura y su nota de pedido en un formato propio.
// «Otro proveedor» usa el Excel genérico (el que arma Claude desde las fotos).
type Proveedor = 'generico' | 'grupoBlanco';
const PROVEEDORES: { id: Proveedor; nombre: string }[] = [
  { id: 'generico', nombre: 'Otro proveedor (Excel genérico)' },
  { id: 'grupoBlanco', nombre: 'Grupo Blanco (Timberland)' },
];

/** Texto del PDF, página por página y renglón por renglón (PDF.js se carga en index.html). */
async function paginasPdf(file: File): Promise<string[][]> {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) throw new Error('No cargó el lector de PDF. Refrescá la página con Ctrl+Shift+R.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const paginas: string[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    paginas.push(lineasDePagina((await page.getTextContent()).items));
  }
  return paginas;
}

interface Foto { nombre: string; mediaType: string; data: string; vista: string }

// Achica la foto en el navegador (lado mayor 2000 px, JPG) para que viaje
// liviana. A esa resolución la IA lee perfecto una hoja A4.
async function prepararFoto(file: File): Promise<Foto> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No pude abrir ' + file.name)); i.src = url;
    });
    const MAX = 2000;
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const vista = c.toDataURL('image/jpeg', 0.85);
    return { nombre: file.name, mediaType: 'image/jpeg', data: vista.split(',')[1], vista };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const hoy = () => new Date().toISOString().slice(0, 10);

const ESTILO_TIPO: Record<TipoFila, { icono: string; texto: string; color: string; fondo: string }> = {
  ok: { icono: '✅', texto: 'Coincide', color: '#34d399', fondo: 'rgba(52,211,153,0.06)' },
  diferencia: { icono: '⚠️', texto: 'Cantidad distinta', color: '#fbbf24', fondo: 'rgba(251,191,36,0.10)' },
  talle: { icono: '🔁', texto: 'Talle cambiado', color: '#f472b6', fondo: 'rgba(244,114,182,0.10)' },
  falta: { icono: '❌', texto: 'No se cargó', color: '#f87171', fondo: 'rgba(248,113,113,0.10)' },
  extra: { icono: '❓', texto: 'Cargado y no está en el remito', color: '#60a5fa', fondo: 'rgba(96,165,250,0.10)' },
};

const ESTILO_PEDIDO: Record<TipoPedido, { icono: string; texto: string; color: string; fondo: string }> = {
  ok: { icono: '✅', texto: 'Pedido y mismo costo', color: '#34d399', fondo: 'rgba(52,211,153,0.06)' },
  excede: { icono: '⚠️', texto: 'Facturaron más de lo pedido', color: '#fbbf24', fondo: 'rgba(251,191,36,0.10)' },
  costo: { icono: '💲', texto: 'Costo distinto al pedido', color: '#f472b6', fondo: 'rgba(244,114,182,0.10)' },
  noPedido: { icono: '❌', texto: 'Facturado y no pedido', color: '#f87171', fondo: 'rgba(248,113,113,0.10)' },
};
const pesos = (n: number | null) => (n == null ? '' : '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const inputSt: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: '0.82rem',
};

export default function ControlRemitos() {
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [remito, setRemito] = useState<Remito | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [movs, setMovs] = useState<Movimiento[] | null>(null);
  const [variantes, setVariantes] = useState<VarianteInfo[]>([]);
  const [corte, setCorte] = useState(false);
  const [personasSel, setPersonasSel] = useState<Set<string>>(new Set());
  const [sucursalSel, setSucursalSel] = useState('');
  const [verOk, setVerOk] = useState(false);
  const [proveedor, setProveedor] = useState<Proveedor>('generico');
  const [notas, setNotas] = useState<NotaPedido[]>([]);
  const [avisosNotas, setAvisosNotas] = useState<string[]>([]);
  const [verOkPedido, setVerOkPedido] = useState(false);

  // ---------- 1) Fotos ----------
  const agregarFotos = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    try {
      const nuevas = await Promise.all([...files].map(prepararFoto));
      setFotos((f) => [...f, ...nuevas].slice(0, 8));
    } catch (e: any) { setError(e.message); }
  };

  const leer = async () => {
    setLeyendo(true); setError(null); setRemito(null); setMovs(null);
    try {
      const r = await fetch('/api/remito', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fotos: fotos.map((f) => ({ mediaType: f.mediaType, data: f.data })) }),
      });
      const txt = await r.text();
      let j: any; try { j = JSON.parse(txt); } catch { throw new Error(`Error ${r.status}: ${txt.slice(0, 150)}`); }
      if (!r.ok) throw new Error((j.error || `Error ${r.status}`) + (/ANTHROPIC_API_KEY/.test(j.error || '') ? ' Mientras tanto usá la Opción A (Excel).' : ''));
      const rem: Remito = j.remito;
      rem.renglones = (rem.renglones || []).map((x: RenglonRemito) => ({
        ...x, codigo: String(x.codigo ?? ''), descripcion: String(x.descripcion ?? ''), color: String(x.color ?? ''),
        talle: String(x.talle ?? ''), cantidad: Number(x.cantidad) || 0,
      }));
      setRemito(rem);
      if (/^\d{4}-\d{2}-\d{2}$/.test(rem.fecha || '')) {
        setDesde(rem.fecha);
        const h = sumarDias(rem.fecha, 7);
        setHasta(h > hoy() ? hoy() : h);
      }
      if (j.corto) setError('El remito es muy largo y la IA no llegó a leerlo entero: subilo en dos partes.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLeyendo(false);
    }
  };

  // Camino gratis: el Excel que arma Claude en el chat a partir de las fotos.
  const subirExcel = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setRemito(null); setMovs(null);
    try {
      let rem: Remito;
      if (/\.pdf$/i.test(file.name)) {
        if (proveedor !== 'grupoBlanco') throw new Error('para leer una factura en PDF elegí primero el proveedor.');
        rem = facturaGrupoBlanco(await paginasPdf(file));
      } else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const hoja = wb.Sheets[wb.SheetNames[0]];
        rem = remitoDesdeFilas(XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: '' }));
      }
      setRemito(rem);
      if (/^\d{4}-\d{2}-\d{2}$/.test(rem.fecha || '')) {
        setDesde(rem.fecha);
        const h = sumarDias(rem.fecha, 7);
        setHasta(h > hoy() ? hoy() : h);
      }
    } catch (e: any) {
      setError('No pude leer la factura: ' + e.message);
    }
  };

  // Notas de pedido: se pueden subir varias (iD arma varias notas para una factura).
  const subirNotas = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const nuevas: NotaPedido[] = [];
    const errores: string[] = [];
    const avisosN: string[] = [];
    let orden = notas.reduce((m, n) => Math.max(m, n.orden), 0);
    for (const file of [...files]) {
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const filasDe = (nombre: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombre], { header: 1, raw: true, defval: '' });
        let n: NotaPedido;
        if (proveedor === 'grupoBlanco') {
          const visibles = wb.SheetNames.filter((nombre, i) => !wb.Workbook?.Sheets?.[i]?.Hidden);
          const r = notaGrupoBlanco(visibles.map((nombre) => ({ nombre, filas: filasDe(nombre) })), file.name, ++orden);
          n = r.nota;
          avisosN.push(...r.avisos.map((a) => `${file.name}: ${a}`));
        } else {
          n = notaDesdeFilas(filasDe(wb.SheetNames[0]), file.name, ++orden);
        }
        if (!n.fecha) n.fecha = new Date(file.lastModified).toISOString().slice(0, 10);
        nuevas.push(n);
      } catch (e: any) { errores.push(e.message); }
    }
    setNotas((ns) => [...ns, ...nuevas]);
    setAvisosNotas((a) => [...a, ...avisosN]);
    if (errores.length) setError('No pude leer: ' + errores.join(' · '));
  };

  const editar = (i: number, campo: keyof RenglonRemito, valor: string) => {
    if (!remito) return;
    const renglones = remito.renglones.map((r, j) => j !== i ? r : {
      ...r, [campo]: campo === 'cantidad' || campo === 'precio_unitario' ? Number(valor) || 0 : valor, dudoso: false,
    });
    setRemito({ ...remito, renglones }); setMovs(null);
  };
  const borrar = (i: number) => { if (remito) { setRemito({ ...remito, renglones: remito.renglones.filter((_, j) => j !== i) }); setMovs(null); } };
  const agregar = () => { if (remito) setRemito({ ...remito, renglones: [...remito.renglones, { codigo: '', descripcion: '', color: '', talle: '', cantidad: 1 }] }); };

  // ---------- 2) Shopify ----------
  const buscar = async () => {
    if (!desde || !hasta) return;
    setBuscando(true); setError(null); setMovs(null);
    try {
      const { movimientos, posibleCorte } = await traerMovimientos(desde, hasta);
      const vs = await traerVariantes(movimientos.map((m) => m.variantId));
      setVariantes([...vs, ...variantesHuerfanas(movimientos, vs)]);
      setMovs(movimientos);
      setCorte(posibleCorte);
      setPersonasSel(new Set());
      setSucursalSel('');
    } catch (e: any) {
      const m = String(e.message || e);
      setError(/access|denied|scope|permis|shopifyqlQuery/i.test(m)
        ? 'Shopify no dejó leer el historial de stock. Falta darle a la app el permiso «read_reports» (Leer informes) en Shopify. Detalle: ' + m.slice(0, 200)
        : m);
    } finally {
      setBuscando(false);
    }
  };

  // ---------- 3) Comparación (se recalcula al cambiar filtros) ----------
  const movsFiltrados = useMemo(
    () => (movs || []).filter((m) => !sucursalSel || m.sucursal === sucursalSel),
    [movs, sucursalSel],
  );
  const personas = useMemo(() => personasDe(movsFiltrados), [movsFiltrados]);
  const sucursales = useMemo(() => [...new Set((movs || []).map((m) => m.sucursal).filter(Boolean))].sort(), [movs]);
  const resultado = useMemo(() => {
    if (!remito || !movs) return null;
    return compararRemito(remito, variantes, netoPorVariante(movsFiltrados, personasSel));
  }, [remito, movs, variantes, movsFiltrados, personasSel]);

  const resPedido = useMemo(() => (remito && notas.length ? compararConPedido(remito, notas) : null), [remito, notas]);

  const avisos = remito ? chequeosRemito(remito) : [];
  const unidades = remito ? remito.renglones.reduce((s, r) => s + (Number(r.cantidad) || 0), 0) : 0;

  const exportar = () => {
    if (!resultado || !remito) return;
    const fila = (f: FilaControl) => ({
      Resultado: ESTILO_TIPO[f.tipo].texto, Código: f.codigo, Artículo: f.descripcion, Color: f.color,
      'Talle remito': f.talleRemito, 'Cant. remito': f.cantRemito, 'Talle cargado': f.talleCargado, 'Cant. cargada': f.cantCargada,
      'Producto en Shopify': f.producto, SKU: f.sku,
      'Cargó': Object.entries(f.personas).map(([p, n]) => `${p} (${n})`).join(', '),
      Días: f.dias.join(', '), Sucursal: f.sucursales.join(', '), Nota: f.nota || '',
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resultado.filas.map(fila)), 'Control');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(remito.renglones.map((r, i) => ({ Renglón: i + 1, ...r }))), 'Remito leído');
    if (resPedido) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resPedido.filas.map((f: FilaPedido) => ({
        Resultado: ESTILO_PEDIDO[f.tipo].texto, Código: f.codigo, Artículo: f.descripcion, Talle: f.porModelo ? 'Modelo completo' : f.talle,
        Facturado: f.cantFacturada, Pedido: f.cantPedida, 'Costo factura': f.costoFacturado ?? '', 'Costo pedido': f.costoPedido ?? '',
        'Notas de pedido': f.notas.join(', '), Nota: f.nota || '',
      }))), 'Factura vs pedido');
      if (resPedido.pendientes.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resPedido.pendientes.map((p) => ({
        Código: p.codigo, Artículo: p.descripcion, Talle: p.talle || 'Modelo completo', Pedido: p.pedido, Facturado: p.facturado, Pendiente: p.falta, 'Notas de pedido': p.notas.join(', '),
      }))), 'Pendiente de entrega');
    }
    if (resultado.otrasCargas.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resultado.otrasCargas.map(fila)), 'Otras cargas');
    XLSX.writeFile(wb, `Control ${remito.proveedor || 'remito'} ${remito.numero || ''}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', position: 'sticky', top: 0, background: '#1f2937', fontSize: '0.78rem' };
  const td: React.CSSProperties = { padding: '5px 8px', fontSize: '0.82rem', verticalAlign: 'top' };
  const filasVisibles = resultado ? resultado.filas.filter((f) => verOk || f.tipo !== 'ok') : [];

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>🧾 Control de carga</h2>
      <p style={{ fontSize: '0.9rem', opacity: 0.85, marginTop: 0 }}>
        Subí la factura (ya controlada contra el remito) y las notas de pedido: la app controla que <strong>todo lo facturado
        esté pedido y al mismo costo</strong>. Después busca en Shopify <strong>quién cargó stock</strong> y te muestra si se cargó
        bien. <strong>No cambia nada en Shopify.</strong>
      </p>

      <label style={{ fontSize: '0.9rem', display: 'block', margin: '0.6rem 0 0.4rem' }}>
        <strong>Proveedor</strong>{' '}
        <select value={proveedor} style={{ ...inputSt, background: 'var(--bg-color)', fontSize: '0.9rem' }}
          onChange={(e) => { setProveedor(e.target.value as Proveedor); setRemito(null); setMovs(null); setNotas([]); setAvisosNotas([]); setError(null); }}>
          {PROVEEDORES.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>

      {/* ---- 1. FACTURA: Excel (gratis) o fotos (con clave de IA) ---- */}
      <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>1 · La factura</h3>
      {proveedor === 'grupoBlanco' ? (
        <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
          <strong>Factura de Grupo Blanco</strong> <span style={{ opacity: 0.75, fontSize: '0.82rem' }}>(el PDF tal cual lo mandan)</span>
          <p style={{ fontSize: '0.82rem', opacity: 0.85, margin: '4px 0 8px' }}>
            La factura viene por curva y sin talles: se controla el total de unidades de cada modelo. Del PDF se lee solo el Original.
          </p>
          <input type="file" accept=".pdf" onChange={(e) => { subirExcel(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      ) : (<>
      <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
        <strong>Opción A · Excel de la factura</strong> <span style={{ opacity: 0.75, fontSize: '0.82rem' }}>(gratis)</span>
        <p style={{ fontSize: '0.82rem', opacity: 0.85, margin: '4px 0 8px' }}>
          Pasale las fotos de la factura a Claude en el chat y pedile «el Excel para Control de carga». Subí acá ese Excel.
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { subirExcel(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <strong>Opción B · Fotos</strong> <span style={{ opacity: 0.75, fontSize: '0.82rem' }}>(la app las lee sola; necesita la clave de Anthropic en Vercel)</span>
      <br />
      <input type="file" accept="image/*" multiple onChange={(e) => { agregarFotos(e.target.files); e.target.value = ''; }} />
      {fotos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {fotos.map((f, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={f.vista} alt={f.nombre} style={{ height: 110, borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)' }} />
              <button onClick={() => setFotos(fotos.filter((_, j) => j !== i))} title="Quitar"
                style={{ position: 'absolute', top: 2, right: 2, background: '#dc2626', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.7rem' }}>✕</button>
              <div style={{ fontSize: '0.7rem', textAlign: 'center', opacity: 0.7 }}>Foto {i + 1}</div>
            </div>
          ))}
        </div>
      )}
      <button className="btn-primary" style={{ background: '#3b82f6', width: '100%', marginTop: '0.7rem' }}
        onClick={leer} disabled={!fotos.length || leyendo}>
        {leyendo ? <><span className="loader"></span> Leyendo el remito (puede tardar 30-60 segundos)…</> : `🔍 Leer remito (${fotos.length} foto${fotos.length === 1 ? '' : 's'})`}
      </button>
      </>)}

      {error && <p style={{ color: '#f87171', fontWeight: 'bold', marginTop: '0.8rem' }}>⚠ {error}</p>}

      {/* ---- NOTAS DE PEDIDO ---- */}
      <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, padding: '10px 12px', marginTop: 14 }}>
        <strong>Notas de pedido</strong> <span style={{ opacity: 0.75, fontSize: '0.82rem' }}>
          {proveedor === 'grupoBlanco'
            ? '(el Excel de la temporada, con todas sus hojas: se cuenta PEDIDO × unidades por módulo y el costo es $MAYORISTA)'
            : '(una o varias; Excel con Código o Descripción, Cantidad y, si los tiene, Talle y Costo)'}
        </span>
        <p style={{ fontSize: '0.82rem', opacity: 0.85, margin: '4px 0 8px' }}>
          Si la factura junta varias notas, subilas todas: se suman. Si un artículo tiene costos distintos, manda la nota más nueva.
          Lo pedido y no facturado no es error: queda como pendiente de entrega.
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" multiple onChange={(e) => { subirNotas(e.target.files); e.target.value = ''; }} />
        {avisosNotas.map((a, i) => <p key={i} style={{ color: '#fbbf24', fontSize: '0.8rem', margin: '4px 0' }}>⚠ {a}</p>)}
        {notas.length > 0 && (
          <table style={{ marginTop: 8, borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <tbody>
              {notas.map((n) => (
                <tr key={n.orden}>
                  <td style={{ padding: '3px 8px' }}>{n.nombre}</td>
                  <td style={{ padding: '3px 8px', opacity: 0.75 }}>{n.renglones.length} renglones · {n.renglones.reduce((s, r) => s + r.cantidad, 0)} u.</td>
                  <td style={{ padding: '3px 8px' }}>Fecha <input type="date" value={n.fecha} style={inputSt}
                    onChange={(e) => setNotas(notas.map((x) => x.orden === n.orden ? { ...x, fecha: e.target.value } : x))} /></td>
                  <td><button onClick={() => setNotas(notas.filter((x) => x.orden !== n.orden))} title="Quitar"
                    style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- 2. REMITO LEÍDO ---- */}
      {remito && (
        <div style={{ marginTop: '1.4rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>2 · Revisá la factura</h3>
          <div style={{ fontSize: '0.9rem', marginBottom: 8 }}>
            <strong>{remito.proveedor}</strong> · {remito.tipo_comprobante} <strong>{remito.numero}</strong> · Fecha{' '}
            <input type="date" value={remito.fecha || ''} style={inputSt}
              onChange={(e) => { setRemito({ ...remito, fecha: e.target.value }); setDesde(e.target.value); }} />
            {' '}· <strong>{remito.renglones.length}</strong> renglones · <strong>{unidades}</strong> unidades
            {remito.cantidad_total_impresa ? <span style={{ opacity: 0.7 }}> (impreso: {remito.filas_impresas || '?'} filas, {remito.cantidad_total_impresa} u.)</span> : null}
          </div>
          {avisos.length === 0
            ? <p style={{ color: '#34d399', fontSize: '0.85rem', margin: '4px 0 8px' }}>✅ Las cantidades cuadran con los totales impresos del comprobante.</p>
            : avisos.map((a, i) => <p key={i} style={{ color: '#fbbf24', fontSize: '0.85rem', margin: '4px 0' }}>⚠ {a}</p>)}
          {remito.observaciones && <p style={{ fontSize: '0.8rem', opacity: 0.75 }}>Nota de la lectura: {remito.observaciones}</p>}

          <details open={remito.renglones.length <= 25 || avisos.length > 0}>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', opacity: 0.85, margin: '6px 0' }}>Ver / corregir renglones</summary>
            <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>#</th><th style={th}>Código</th><th style={th}>Artículo</th><th style={th}>Color</th>
                  <th style={th}>Talle</th><th style={th}>Cant.</th><th style={th}>Precio unit.</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {remito.renglones.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: r.dudoso ? 'rgba(251,191,36,0.15)' : undefined }}>
                      <td style={{ ...td, opacity: 0.6 }}>{i + 1}</td>
                      <td style={td}><input style={{ ...inputSt, width: 95, fontFamily: 'monospace' }} value={r.codigo} onChange={(e) => editar(i, 'codigo', e.target.value)} /></td>
                      <td style={td}><input style={{ ...inputSt, width: '100%' }} value={r.descripcion} onChange={(e) => editar(i, 'descripcion', e.target.value)} /></td>
                      <td style={td}><input style={{ ...inputSt, width: 90 }} value={r.color} onChange={(e) => editar(i, 'color', e.target.value)} /></td>
                      <td style={td}><input style={{ ...inputSt, width: 50, textAlign: 'center' }} value={r.talle} onChange={(e) => editar(i, 'talle', e.target.value)} /></td>
                      <td style={td}><input type="number" style={{ ...inputSt, width: 55, textAlign: 'center' }} value={r.cantidad} onChange={(e) => editar(i, 'cantidad', e.target.value)} /></td>
                      <td style={td}><input type="number" step="0.01" style={{ ...inputSt, width: 95, textAlign: 'right' }} value={r.precio_unitario ?? ''} onChange={(e) => editar(i, 'precio_unitario', e.target.value)} /></td>
                      <td style={td}><button onClick={() => borrar(i)} title="Borrar renglón" style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={agregar} style={{ ...inputSt, marginTop: 6, cursor: 'pointer' }}>＋ Agregar renglón</button>
          </details>

          {/* ---- FACTURA CONTRA PEDIDO ---- */}
          {resPedido && (
            <div style={{ marginTop: '1.2rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Factura contra nota de pedido</h3>
              {resPedido.avisos.map((a, i) => <p key={i} style={{ color: '#fbbf24', fontSize: '0.85rem', margin: '4px 0' }}>⚠ {a}</p>)}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 }}>
                <Tarjeta titulo="Unidades facturadas" valor={resPedido.totales.facturado} color="#e5e7eb" />
                <Tarjeta titulo="Unidades pedidas" valor={resPedido.totales.pedido} color="#e5e7eb" />
                {(['ok', 'noPedido', 'excede', 'costo'] as TipoPedido[]).map((t) => (
                  <Tarjeta key={t} titulo={`${ESTILO_PEDIDO[t].icono} ${ESTILO_PEDIDO[t].texto}`} valor={resPedido.totales[t]} color={ESTILO_PEDIDO[t].color} />
                ))}
                <Tarjeta titulo="🕓 Pendiente de entrega (u.)" valor={resPedido.totales.pendiente} color="#93c5fd" />
              </div>
              <label style={{ fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0' }}>
                <input type="checkbox" checked={verOkPedido} onChange={(e) => setVerOkPedido(e.target.checked)} /> Mostrar también lo que está bien
              </label>
              {resPedido.filas.filter((f) => verOkPedido || f.tipo !== 'ok').length === 0
                ? <p style={{ color: '#34d399', fontWeight: 'bold' }}>✅ Todo lo facturado estaba pedido y al mismo costo.</p>
                : (
                  <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={th}>Resultado</th><th style={th}>Artículo</th><th style={th}>Talle</th><th style={th}>Facturado</th>
                        <th style={th}>Pedido</th><th style={th}>Costo factura</th><th style={th}>Costo pedido</th>
                      </tr></thead>
                      <tbody>
                        {resPedido.filas.filter((f) => verOkPedido || f.tipo !== 'ok').map((f, i) => {
                          const e = ESTILO_PEDIDO[f.tipo];
                          return (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: e.fondo }}>
                              <td style={{ ...td, color: e.color, fontWeight: 'bold', whiteSpace: 'nowrap' }}>{e.icono} {e.texto}
                                {f.tipo === 'excede' && f.costoDistinto && <div style={{ color: ESTILO_PEDIDO.costo.color }}>💲 y costo distinto</div>}</td>
                              <td style={td}>{f.descripcion} <span style={{ opacity: 0.7 }}>{f.color}</span><br /><span style={{ fontFamily: 'monospace', fontSize: '0.72rem', opacity: 0.6 }}>{f.codigo}</span>
                                {f.nota && <div style={{ fontSize: '0.72rem', opacity: 0.8 }}>{f.nota}</div>}</td>
                              <td style={{ ...td, textAlign: 'center' }}>{f.porModelo ? 'todos' : f.talle}</td>
                              <td style={{ ...td, textAlign: 'center', fontWeight: 'bold' }}>{f.cantFacturada}</td>
                              <td style={{ ...td, textAlign: 'center' }}>{f.cantPedida}</td>
                              <td style={{ ...td, textAlign: 'right' }}>{pesos(f.costoFacturado)}</td>
                              <td style={{ ...td, textAlign: 'right' }}>{pesos(f.costoPedido)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              {resPedido.pendientes.length > 0 && (
                <details style={{ marginTop: 10, fontSize: '0.82rem' }}>
                  <summary style={{ cursor: 'pointer', opacity: 0.85 }}>
                    🕓 {resPedido.totales.pendiente} unidades pedidas que todavía no se facturaron (entrega parcial, no es error)
                  </summary>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                    <thead><tr><th style={th}>Artículo</th><th style={th}>Talle</th><th style={th}>Pedido</th><th style={th}>Facturado</th><th style={th}>Pendiente</th></tr></thead>
                    <tbody>
                      {resPedido.pendientes.map((p, i) => (
                        <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <td style={td}>{p.descripcion} <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', opacity: 0.6 }}>{p.codigo}</span></td>
                          <td style={{ ...td, textAlign: 'center' }}>{p.talle || 'todos'}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{p.pedido}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{p.facturado}</td>
                          <td style={{ ...td, textAlign: 'center', fontWeight: 'bold' }}>{p.falta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          )}

          {/* ---- 3. BUSCAR EN SHOPIFY ---- */}
          <h3 style={{ fontSize: '1rem', margin: '1.3rem 0 0.5rem' }}>3 · Buscar qué se cargó en Shopify</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: '0.8rem' }}>Desde<br /><input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setMovs(null); }} style={inputSt} /></label>
            <label style={{ fontSize: '0.8rem' }}>Hasta<br /><input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setMovs(null); }} style={inputSt} /></label>
            <button className="btn-primary" style={{ background: '#8b5cf6', flex: 1, minWidth: 200 }} onClick={buscar} disabled={!desde || !hasta || buscando}>
              {buscando ? <span className="loader"></span> : '📥 Traer las cargas de Shopify y comparar'}
            </button>
          </div>
          <p style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: 6 }}>
            Por defecto miro desde la fecha del remito hasta 7 días después (a veces se carga unos días más tarde).
            No cuento las ventas: solo los ajustes de stock (cargas, correcciones, transferencias recibidas).
          </p>
        </div>
      )}

      {/* ---- 4. RESULTADO ---- */}
      {remito && movs && resultado && (
        <div style={{ marginTop: '1.2rem' }}>
          {corte && <p style={{ color: '#fbbf24', fontSize: '0.85rem' }}>⚠ Hubo muchísimos movimientos en esas fechas y Shopify pudo haber cortado la lista. Achicá el rango de días.</p>}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <div style={{ fontSize: '0.8rem' }}>
              ¿Quién cargó? <span style={{ opacity: 0.6 }}>(sin marcar = todos)</span><br />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                {personas.length === 0 && <span style={{ opacity: 0.7 }}>Nadie cargó stock en esas fechas.</span>}
                {personas.map((p) => (
                  <label key={p.nombre} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={personasSel.has(p.nombre)} onChange={(e) => {
                      const s = new Set(personasSel); if (e.target.checked) s.add(p.nombre); else s.delete(p.nombre); setPersonasSel(s);
                    }} />
                    {p.nombre} <span style={{ opacity: 0.6 }}>({p.unidades > 0 ? '+' : ''}{p.unidades} u.)</span>
                  </label>
                ))}
              </div>
            </div>
            {sucursales.length > 1 && (
              <label style={{ fontSize: '0.8rem' }}>Sucursal<br />
                <select value={sucursalSel} onChange={(e) => setSucursalSel(e.target.value)} style={{ ...inputSt, background: 'var(--bg-color)' }}>
                  <option value="">Todas</option>
                  {sucursales.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
            <Tarjeta titulo="Unidades en remito" valor={resultado.totales.unidadesRemito} color="#e5e7eb" />
            <Tarjeta titulo="Unidades cargadas" valor={resultado.totales.unidadesCargadas}
              color={resultado.totales.unidadesCargadas === resultado.totales.unidadesRemito ? '#34d399' : '#fbbf24'} />
            {(['ok', 'falta', 'talle', 'diferencia', 'extra'] as TipoFila[]).map((t) => (
              <Tarjeta key={t} titulo={`${ESTILO_TIPO[t].icono} ${ESTILO_TIPO[t].texto}`} valor={resultado.totales[t]} color={ESTILO_TIPO[t].color} />
            ))}
          </div>

          {Object.keys(resultado.porPersona).length > 0 && (
            <p style={{ fontSize: '0.85rem' }}>
              👤 Cargado de este remito: {Object.entries(resultado.porPersona).map(([p, n]) => <span key={p} style={{ marginRight: 12 }}><strong>{p}</strong> {n} u.</span>)}
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '6px 0' }}>
            <label style={{ fontSize: '0.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={verOk} onChange={(e) => setVerOk(e.target.checked)} /> Mostrar también lo que coincide
            </label>
            <button onClick={exportar} style={{ ...inputSt, cursor: 'pointer', marginLeft: 'auto' }}>⬇ Descargar Excel del control</button>
          </div>

          {filasVisibles.length === 0
            ? <p style={{ color: '#34d399', fontWeight: 'bold' }}>✅ Todo lo del remito se cargó bien.</p>
            : (
              <div style={{ maxHeight: 520, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>Resultado</th><th style={th}>Artículo del remito</th><th style={th}>Talle rem.</th><th style={th}>Cant. rem.</th>
                    <th style={th}>Talle cargado</th><th style={th}>Cant. cargada</th><th style={th}>Producto en Shopify</th><th style={th}>Quién / cuándo</th>
                  </tr></thead>
                  <tbody>
                    {filasVisibles.map((f, i) => {
                      const e = ESTILO_TIPO[f.tipo];
                      return (
                        <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: e.fondo }}>
                          <td style={{ ...td, color: e.color, fontWeight: 'bold', whiteSpace: 'nowrap' }}>{e.icono} {e.texto}</td>
                          <td style={td}>{f.descripcion} <span style={{ opacity: 0.7 }}>{f.color}</span><br /><span style={{ fontFamily: 'monospace', fontSize: '0.72rem', opacity: 0.6 }}>{f.codigo}</span>
                            {f.nota && <div style={{ fontSize: '0.72rem', opacity: 0.8 }}>{f.nota}</div>}</td>
                          <td style={{ ...td, textAlign: 'center', fontWeight: 'bold' }}>{f.talleRemito || (f.cantRemito ? '—' : '')}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{f.cantRemito || ''}</td>
                          <td style={{ ...td, textAlign: 'center', fontWeight: 'bold' }}>{f.talleCargado}</td>
                          <td style={{ ...td, textAlign: 'center' }}>{f.cantCargada || (f.tipo === 'falta' ? 0 : '')}</td>
                          <td style={td}>{f.producto}{f.sku && <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', opacity: 0.6 }}>{f.sku}</div>}</td>
                          <td style={{ ...td, fontSize: '0.75rem' }}>
                            {Object.entries(f.personas).map(([p, n]) => <div key={p}>{p} ({n})</div>)}
                            <span style={{ opacity: 0.6 }}>{f.dias.join(', ')}{f.sucursales.length ? ` · ${f.sucursales.join(', ')}` : ''}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          {resultado.otrasCargas.length > 0 && (
            <details style={{ marginTop: 12, fontSize: '0.82rem' }}>
              <summary style={{ cursor: 'pointer', opacity: 0.85 }}>
                {resultado.otrasCargas.length} cargas de otros productos en esas fechas (no parecen de este remito)
              </summary>
              <p style={{ opacity: 0.7, fontSize: '0.78rem' }}>
                Si ves acá algo que SÍ es de este remito, es que se cargó en un producto con otro nombre: revisalo a mano.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {resultado.otrasCargas.map((f, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={td}>{f.producto}</td><td style={td}>{f.talleCargado}</td><td style={td}>{f.cantCargada > 0 ? '+' : ''}{f.cantCargada}</td>
                      <td style={td}>{Object.keys(f.personas).join(', ')}</td><td style={{ ...td, opacity: 0.6 }}>{f.dias.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <p style={{ fontSize: '0.75rem', opacity: 0.65, marginTop: 10 }}>
            Ojo: si en esas mismas fechas entró otro remito con el mismo artículo, esas unidades se suman y puede aparecer
            «cantidad distinta». En ese caso achicá las fechas o filtrá por persona.
          </p>
        </div>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, color }: { titulo: string; valor: number; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: '0.72rem', opacity: 0.8 }}>{titulo}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color }}>{valor}</div>
    </div>
  );
}
