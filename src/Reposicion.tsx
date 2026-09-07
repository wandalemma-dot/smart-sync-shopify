// ============================================================================
// PESTAÑA REPOSICIÓN — armar el pedido a iD desde el export de ventas
// ----------------------------------------------------------------------------
// Wanda baja de Shopify el export de órdenes, lo sube acá, y la app le dice qué
// talle pedirle al proveedor por cada cosa que se vendió.
//
// Reemplazó (07-sep-2026) a la versión que leía Shopify en vivo y calculaba
// stock de Martínez, pedido en camino, etc. Decisión de Wanda: la lista muestra
// TODO LO VENDIDO, TAL CUAL. No se descuenta nada.
// La versión vieja está en el historial de git, por si alguna vez se extraña.
//
// SOLO LECTURA: esta pestaña no escribe absolutamente nada en Shopify.
// ============================================================================
import { useState, useRef } from 'react';
import { leerVentasCsv, armarPedidoDesdeVentas, descargarPedidoCSV } from './utils/ventasCsv';
import type { ResultadoPedido, FilaPedido } from './utils/ventasCsv';

export default function Reposicion() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [leidos, setLeidos] = useState(0);
  const [res, setRes] = useState<ResultadoPedido | null>(null);
  const [buscar, setBuscar] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const cargar = async (f: File) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { alert('Subí el archivo .csv que baja Shopify (Órdenes → Exportar).'); return; }
    setArchivo(f); setRes(null);
  };

  const armar = async () => {
    if (!archivo) return;
    setLoading(true); setRes(null); setLeidos(0);
    try {
      const texto = await archivo.text();
      const lineas = leerVentasCsv(texto);
      if (!lineas.length) { alert('No encontré ninguna línea de producto en ese archivo. ¿Es el export de Órdenes?'); return; }
      setRes(await armarPedidoDesdeVentas(lineas, setLeidos));
    } catch (e: any) {
      alert('Error armando el pedido: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const q = buscar.trim().toUpperCase();
  const filtrar = (fs: FilaPedido[]) => !q ? fs : fs.filter(f =>
    (f.codigo || '').includes(q) || f.titulo.toUpperCase().includes(q) || String(f.tallePedido || '').includes(q));

  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', position: 'sticky', top: 0, background: '#1f2937' };
  const td: React.CSSProperties = { padding: '6px 10px' };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>📦 Reposición — qué pedirle a iD</h2>
      <p style={{ fontSize: '0.9rem', opacity: 0.85, marginTop: 0 }}>
        Bajá de Shopify <strong>Órdenes → Exportar</strong> y subí ese CSV. Te digo, por cada cosa que se
        vendió, <strong>en qué talle pedirla</strong>. <strong>No toca nada de tu tienda.</strong>
      </p>

      <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) cargar(f); e.target.value = ''; }} />
      <div
        className={`dropzone ${archivo ? 'has-file' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) cargar(f); }}
        onDragOver={e => e.preventDefault()}
        style={{ cursor: 'pointer', marginBottom: '1rem' }}
      >
        <h3>{archivo ? '📄 Archivo de ventas listo' : '📥 Arrastrá o hacé clic: export de Órdenes (.csv)'}</h3>
        <p>{archivo?.name}</p>
      </div>

      <button className="btn-primary" style={{ background: '#10b981', width: '100%' }}
        onClick={armar} disabled={!archivo || loading}>
        {loading ? <span className="loader"></span> : '🔍 Armar el pedido'}
      </button>
      {loading && leidos > 0 && (
        <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>Leyendo productos de Shopify: {leidos}…</p>
      )}

      {res && (
        <div style={{ marginTop: '1.2rem' }}>
          <div style={{ fontSize: '0.9rem', marginBottom: '0.7rem' }}>
            🧾 <strong>{res.filas.length}</strong> líneas para pedir ·{' '}
            <strong>{res.filas.reduce((s, f) => s + f.cantidad, 0)}</strong> unidades
            {res.revisar.length > 0 && <> · <span style={{ color: '#fb923c' }}>a revisar: <strong>{res.revisar.length}</strong></span></>}
            {res.ignoradas > 0 && <> · <span style={{ opacity: 0.7 }}>{res.ignoradas} de otras marcas (no son de iD)</span></>}
          </div>

          <input type="text" value={buscar} onChange={e => setBuscar(e.target.value)}
            placeholder="🔎 Buscar por código, producto o talle"
            style={{ width: '100%', padding: '8px 10px', marginBottom: '0.6rem', borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: 'inherit', fontSize: '0.85rem' }} />

          <div style={{ maxHeight: '460px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Producto</th>
                  <th style={th}>Código</th>
                  <th style={{ ...th, textAlign: 'center' }}>Talle en tu tienda</th>
                  <th style={{ ...th, textAlign: 'center' }}>Talle a pedir</th>
                  <th style={{ ...th, textAlign: 'center' }}>Escala</th>
                  <th style={{ ...th, textAlign: 'center' }}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {filtrar(res.filas).map((f, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={td}>
                      {f.titulo}
                      <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>{f.marca === 'lecoq' ? 'Le Coq Sportif' : 'Converse'}</div>
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', opacity: 0.85 }}>{f.codigo || '—'}</td>
                    <td style={{ ...td, textAlign: 'center', opacity: 0.7 }}>{f.talleAr}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 'bold', color: '#34d399', fontSize: '1rem' }}>{f.tallePedido}</td>
                    <td style={{ ...td, textAlign: 'center', fontSize: '0.72rem', opacity: 0.7 }}>{f.escala}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 'bold' }}>{f.cantidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn-primary" style={{ background: '#f59e0b', marginTop: '0.8rem' }}
            onClick={() => descargarPedidoCSV(res)}>
            📥 Exportar CSV
          </button>

          {res.revisar.length > 0 && (
            <div style={{ marginTop: '1.2rem', padding: '0.9rem', border: '1px solid #fb923c', borderRadius: 8, background: 'rgba(251,146,60,0.10)' }}>
              <strong style={{ color: '#fb923c' }}>⚠️ A revisar ({res.revisar.length}) — no pude saber qué talle pedir</strong>
              <p style={{ fontSize: '0.8rem', opacity: 0.85, margin: '0.4rem 0' }}>
                Estos se vendieron, pero no supe a qué talle del proveedor corresponden.
                <strong> No los adivino a propósito:</strong> el mismo talle de tu tienda da un talle distinto
                según el modelo, así que inventarlo sería hacerte pedir el par equivocado.
              </p>
              <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}>
                <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Producto</th>
                      <th style={th}>Código</th>
                      <th style={{ ...th, textAlign: 'center' }}>Talle</th>
                      <th style={{ ...th, textAlign: 'center' }}>Cant</th>
                      <th style={th}>Por qué</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.revisar.map((f, i) => (
                      <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={td}>{f.titulo}</td>
                        <td style={{ ...td, fontFamily: 'monospace', opacity: 0.85 }}>{f.codigo || '—'}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{f.talleAr}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{f.cantidad}</td>
                        <td style={{ ...td, fontSize: '0.75rem', opacity: 0.85 }}>{f.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
