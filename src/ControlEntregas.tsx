// ============================================================================
// PESTAÑA CONTROL DE ENTREGAS — factura contra nota de pedido, por proveedor
// ----------------------------------------------------------------------------
// 25-oct-2026, pedido de gax: reemplaza al Control de remitos / de carga. El
// depósito ya controla remito contra factura; acá se controla que TODO LO
// FACTURADO esté pedido, sin pasarse de cantidad y al MISMO COSTO. Lo pedido y
// no facturado es entrega parcial (pendiente), no error. Se eligen el
// proveedor y su formato de factura/nota. Se quitaron la lectura de fotos con
// IA y el control de quién cargó en Shopify (quedan en el historial de git).
// Lógica en utils/controlPedido.ts y un lector por proveedor (grupoBlanco.ts).
// SOLO LECTURA: no escribe nada en Shopify.
// ============================================================================
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { chequeosRemito, remitoDesdeFilas } from './utils/controlRemitos';
import type { Remito, RenglonRemito } from './utils/controlRemitos';
import { compararConPedido, notaDesdeFilas } from './utils/controlPedido';
import type { NotaPedido, TipoPedido, FilaPedido } from './utils/controlPedido';
import { facturaGrupoBlanco, lineasDePagina, notaGrupoBlanco } from './utils/grupoBlanco';

// Cada proveedor trae su factura y su nota de pedido en un formato propio.
// «Otro proveedor» usa el Excel genérico (el que arma Claude desde las fotos).
type Proveedor = 'generico' | 'grupoBlanco';
const PROVEEDORES: { id: Proveedor; nombre: string }[] = [
  { id: 'grupoBlanco', nombre: 'Grupo Blanco (Timberland)' },
  { id: 'generico', nombre: 'Otro proveedor (Excel genérico)' },
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

export default function ControlEntregas() {
  const [proveedor, setProveedor] = useState<Proveedor>('grupoBlanco');
  const [remito, setRemito] = useState<Remito | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notas, setNotas] = useState<NotaPedido[]>([]);
  const [avisosNotas, setAvisosNotas] = useState<string[]>([]);
  const [verOkPedido, setVerOkPedido] = useState(false);

  const subirFactura = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setRemito(null);
    try {
      if (proveedor === 'grupoBlanco') {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('la factura de Grupo Blanco se sube en PDF, tal cual la mandan.');
        setRemito(facturaGrupoBlanco(await paginasPdf(file)));
      } else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        setRemito(remitoDesdeFilas(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })));
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
    setRemito({ ...remito, renglones });
  };
  const borrar = (i: number) => { if (remito) setRemito({ ...remito, renglones: remito.renglones.filter((_, j) => j !== i) }); };
  const agregar = () => { if (remito) setRemito({ ...remito, renglones: [...remito.renglones, { codigo: '', descripcion: '', color: '', talle: '', cantidad: 1 }] }); };

  const resPedido = useMemo(() => (remito && notas.length ? compararConPedido(remito, notas) : null), [remito, notas]);
  const avisos = remito ? chequeosRemito(remito) : [];
  const unidades = remito ? remito.renglones.reduce((s, r) => s + (Number(r.cantidad) || 0), 0) : 0;

  const exportar = () => {
    if (!resPedido || !remito) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resPedido.filas.map((f: FilaPedido) => ({
      Resultado: ESTILO_PEDIDO[f.tipo].texto, Código: f.codigo, Artículo: f.descripcion, Color: f.color, Talle: f.porModelo ? 'Modelo completo' : f.talle,
      Facturado: f.cantFacturada, Pedido: f.cantPedida, 'Costo factura': f.costoFacturado ?? '', 'Costo pedido': f.costoPedido ?? '',
      'Notas de pedido': f.notas.join(', '), Nota: f.nota || '',
    }))), 'Factura vs pedido');
    if (resPedido.pendientes.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resPedido.pendientes.map((p) => ({
      Código: p.codigo, Artículo: p.descripcion, Talle: p.talle || 'Modelo completo', Pedido: p.pedido, Facturado: p.facturado, Pendiente: p.falta, 'Notas de pedido': p.notas.join(', '),
    }))), 'Pendiente de entrega');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(remito.renglones.map((r, i) => ({ Renglón: i + 1, ...r }))), 'Factura leída');
    XLSX.writeFile(wb, `Control entrega ${remito.proveedor || ''} ${remito.numero || ''}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', position: 'sticky', top: 0, background: '#1f2937', fontSize: '0.78rem' };
  const td: React.CSSProperties = { padding: '5px 8px', fontSize: '0.82rem', verticalAlign: 'top' };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>🧾 Control de entregas</h2>
      <p style={{ fontSize: '0.9rem', opacity: 0.85, marginTop: 0 }}>
        Elegí el proveedor, subí la factura (ya controlada contra el remito) y las notas de pedido. La app controla que
        <strong> todo lo facturado esté pedido, sin pasarse, y al mismo costo</strong>. Lo pedido que todavía no llegó queda
        como pendiente de entrega. <strong>No cambia nada en Shopify.</strong>
      </p>

      <label style={{ fontSize: '0.9rem', display: 'block', margin: '0.6rem 0 0.8rem' }}>
        <strong>Proveedor</strong>{' '}
        <select value={proveedor} style={{ ...inputSt, background: 'var(--bg-color)', fontSize: '0.9rem' }}
          onChange={(e) => { setProveedor(e.target.value as Proveedor); setRemito(null); setNotas([]); setAvisosNotas([]); setError(null); }}>
          {PROVEEDORES.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </label>

      {/* ---- 1. FACTURA ---- */}
      <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>1 · La factura</h3>
      {proveedor === 'grupoBlanco' ? (
        <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
          <strong>Factura de Grupo Blanco</strong> <span style={{ opacity: 0.75, fontSize: '0.82rem' }}>(el PDF tal cual lo mandan)</span>
          <p style={{ fontSize: '0.82rem', opacity: 0.85, margin: '4px 0 8px' }}>
            La factura viene por curva y sin talles: se controla el total de unidades de cada modelo. Del PDF se lee solo el Original.
          </p>
          <input type="file" accept=".pdf" onChange={(e) => { subirFactura(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      ) : (
        <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
          <strong>Excel de la factura</strong>
          <p style={{ fontSize: '0.82rem', opacity: 0.85, margin: '4px 0 8px' }}>
            Pasale las fotos de la factura a Claude en el chat y pedile «el Excel para Control de entregas». Subí acá ese Excel.
          </p>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { subirFactura(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}

      {error && <p style={{ color: '#f87171', fontWeight: 'bold', marginTop: '0.8rem' }}>⚠ {error}</p>}

      {/* ---- NOTAS DE PEDIDO ---- */}
      <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, padding: '10px 12px', marginTop: 14 }}>
        <strong>2 · Notas de pedido</strong> <span style={{ opacity: 0.75, fontSize: '0.82rem' }}>
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

      {/* ---- FACTURA LEÍDA ---- */}
      {remito && (
        <div style={{ marginTop: '1.4rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>3 · Revisá la factura</h3>
          <div style={{ fontSize: '0.9rem', marginBottom: 8 }}>
            <strong>{remito.proveedor}</strong> · {remito.tipo_comprobante} <strong>{remito.numero}</strong> · Fecha{' '}
            <input type="date" value={remito.fecha || ''} style={inputSt}
              onChange={(e) => setRemito({ ...remito, fecha: e.target.value })} />
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

          {resPedido && <button onClick={exportar} style={{ ...inputSt, cursor: 'pointer', marginTop: 10 }}>⬇ Descargar Excel del control</button>}
          {!resPedido && <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: 10 }}>Subí la nota de pedido para ver el control.</p>}
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
