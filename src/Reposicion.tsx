import { useState, useRef } from 'react';
import { analizarReposicion, LOC_MARTINEZ, LOC_ID } from './utils/reposicionLogic';
import type { ResultadoReposicion, FilaReposicion } from './utils/reposicionLogic';
import { leerPedidoPendiente } from './utils/pedidoPendiente';
import type { PedidoPendiente } from './utils/pedidoPendiente';
import { escapeCSV, triggerDownload, todayStamp } from './utils/csv';

// Fecha de ayer en formato YYYY-MM-DD (valor por defecto del "desde").
function ayer(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

export default function Reposicion() {
  const [desde, setDesde] = useState(ayer());
  const [loading, setLoading] = useState(false);
  const [escaneados, setEscaneados] = useState(0);
  const [res, setRes] = useState<ResultadoReposicion | null>(null);
  // Cantidades que Wanda ajusta a mano: clave "codigo|talleAr"
  const [cant, setCant] = useState<Record<string, number>>({});
  // Pedido ya hecho al proveedor: lo que viene en camino y no hay que volver a pedir.
  const [pedido, setPedido] = useState<PedidoPendiente | null>(null);
  const pedidoInputRef = useRef<HTMLInputElement>(null);

  const cargarPedido = async (file: File) => {
    try {
      const p = await leerPedidoPendiente(file);
      setPedido(p);
    } catch (e: any) {
      alert('No pude leer el Excel del pedido: ' + e.message);
    }
  };

  const keyDe = (f: FilaReposicion) => `${f.codigo || f.handle}|${f.talleAr}`;

  const analizar = async () => {
    setLoading(true); setRes(null); setEscaneados(0); setCant({});
    try {
      const r = await analizarReposicion(desde, setEscaneados, pedido?.items);
      setRes(r);
    } catch (e: any) {
      alert('Error armando la reposición: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const exportar = () => {
    if (!res) return;
    const headers = ['Código', 'Producto', 'Marca', 'Talle AR', 'Talle a pedir', 'Escala', 'Cantidad', 'Stock Martinez', 'Stock iD', 'Vendidos Martinez', 'Vendidos iD', 'Devueltos', 'En camino'];
    let csv = headers.join(',') + '\n';
    for (const f of res.filas) {
      const c = cant[keyDe(f)] ?? '';
      csv += [f.codigo || '', f.titulo, f.marca === 'lecoq' ? 'Le Coq' : 'Converse', f.talleAr, f.tallePedido || '', f.escala || '', c, f.stockMartinez, f.stockId, f.vendMartinez, f.vendId, f.devueltos, f.enCamino]
        .map(escapeCSV).join(',') + '\n';
    }
    if (res.revisar.length) {
      csv += '\n' + ['REVISAR — no se pudo convertir'].join(',') + '\n';
      csv += ['Código', 'Producto', 'Talle AR', 'Motivo', 'Stock Martinez', 'Stock iD'].join(',') + '\n';
      for (const f of res.revisar) {
        csv += [f.codigo || '', f.titulo, f.talleAr, f.motivoRevisar || '', f.stockMartinez, f.stockId].map(escapeCSV).join(',') + '\n';
      }
    }
    triggerDownload(csv, `Reposicion_iD_a_Martinez_${todayStamp()}.csv`);
  };

  // Color del semáforo según el stock en Martínez.
  const semaforo = (n: number) => (n === 0 ? '#dc2626' : n <= 2 ? '#f59e0b' : '#10b981');

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', position: 'sticky', top: 0, background: '#1f2937', fontSize: '0.8rem' };
  const td: React.CSSProperties = { padding: '6px 10px', fontSize: '0.85rem' };

  return (
    <div>
      <div className="glass-panel" style={{ padding: '1.2rem', marginBottom: '1.2rem' }}>
        <h2 style={{ marginTop: 0 }}>📦 Reposición — traer de iD a Martínez</h2>
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: 0 }}>
          Solo lectura: no toca Shopify. Mirá el stock de <strong>{LOC_MARTINEZ}</strong> y de <strong>{LOC_ID}</strong>, y decidí cuánto pedir.
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.9rem' }}>
            Ventas desde (tu último pedido):{' '}
            <input
              type="date"
              value={desde}
              onChange={e => setDesde(e.target.value)}
              style={{ padding: '8px', borderRadius: '6px', background: 'var(--bg-color)', color: 'white', border: '1px solid var(--glass-border)' }}
            />
          </label>
          <input
            ref={pedidoInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) cargarPedido(f); e.target.value = ''; }}
          />
          <button
            className="btn-primary"
            style={{ background: pedido ? '#8b5cf6' : '#4b5563', padding: '10px 18px' }}
            onClick={() => pedidoInputRef.current?.click()}
          >
            {pedido ? '🚚 Pedido cargado — cambiar' : '🚚 Subir pedido ya hecho (opcional)'}
          </button>

          <button className="btn-primary" style={{ background: '#10b981', padding: '10px 18px' }} onClick={analizar} disabled={loading}>
            {loading ? <span className="loader"></span> : '🔍 Armar reposición'}
          </button>
          {res && res.filas.length > 0 && (
            <button className="btn-primary" style={{ background: '#f59e0b', padding: '10px 18px' }} onClick={exportar}>
              📥 Exportar CSV
            </button>
          )}
        </div>
        {pedido && (
          <p style={{ marginTop: 10, fontSize: '0.85rem', color: '#c4b5fd' }}>
            🚚 {pedido.numero || 'Pedido'} {pedido.fecha && `· ${pedido.fecha}`} · <strong>{pedido.unidades}</strong> unidades en camino
            ({pedido.lineas} líneas). Se van a descontar de lo que falta pedir.
          </p>
        )}
        {loading && <p style={{ marginTop: 10, color: '#10b981' }}>Consultando Shopify… {escaneados > 0 && `(${escaneados} productos)`}</p>}
      </div>

      {res && (
        <>
          {!res.puedeLeerOrdenes && (
            <div style={{ padding: '0.9rem', marginBottom: '1rem', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.12)', borderRadius: '8px', fontSize: '0.9rem' }}>
              ⚠️ No pude leer las ventas (las columnas "Vend." van a estar en 0). El resto (stock de Martínez y de iD) sí es correcto.
              {/^.*ACCESS_DENIED.*$/.test(res.avisoOrdenes || '')
                ? <> Falta el permiso <strong>read_orders</strong>: hay que <strong>reautorizar la app</strong> en Shopify.</>
                : <> Detalle del error abajo.</>}
              <div style={{ opacity: 0.7, marginTop: 6, fontSize: '0.8rem' }}>{res.avisoOrdenes}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '0.8rem', fontSize: '0.9rem' }}>
            <span>🧩 A reponer: <strong>{res.filas.length}</strong></span>
            {res.filas.some(f => f.pendienteEntrega > 0) && (
              <span style={{ color: '#f87171' }}>⚠ Sin preparar (hay que entregar): <strong>{res.filas.filter(f => f.pendienteEntrega > 0).length}</strong></span>
            )}
            {res.posiblesEntregas.length > 0 && <span style={{ opacity: 0.75 }}>📥 Posibles entregas: <strong>{res.posiblesEntregas.length}</strong></span>}
            <span style={{ color: '#dc2626' }}>🔴 En 0 en Martínez: <strong>{res.filas.filter(f => f.stockMartinez === 0).length}</strong></span>
            <span style={{ color: '#f59e0b' }}>🟡 Bajo (1-2): <strong>{res.filas.filter(f => f.stockMartinez > 0 && f.stockMartinez <= 2).length}</strong></span>
            <span>🔎 Productos: {res.productosEscaneados}</span>
            {pedido && (
              <span style={{ color: '#c4b5fd' }}>🚚 Ya vienen en camino: <strong>{res.filas.filter(f => f.enCamino > 0).length}</strong> (fila violeta)</span>
            )}
          </div>

          <div style={{ maxHeight: '520px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Código</th>
                  <th style={th}>Producto</th>
                  <th style={{ ...th, textAlign: 'center' }}>Talle AR</th>
                  <th style={{ ...th, textAlign: 'center' }}>A pedir</th>
                  <th style={{ ...th, textAlign: 'center' }}>Stock Mart.</th>
                  <th style={{ ...th, textAlign: 'center' }}>Stock iD</th>
                  <th style={{ ...th, textAlign: 'center', color: '#fbbf24' }}>Vendidos</th>
                  <th style={{ ...th, textAlign: 'center', color: '#f87171' }}>⚠ Sin<br />preparar</th>
                  <th style={{ ...th, textAlign: 'center', color: '#34d399' }}>Mart.</th>
                  <th style={{ ...th, textAlign: 'center', color: '#c4b5fd' }}>iD</th>
                  <th style={{ ...th, textAlign: 'center' }}>Dev.</th>
                  {pedido && <th style={{ ...th, textAlign: 'center', color: '#c4b5fd' }}>🚚 En camino</th>}
                  <th style={{ ...th, textAlign: 'center' }}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {res.filas.map((f, i) => {
                  const yaViene = f.enCamino > 0;
                  // Línea gruesa cuando empieza otro producto: así cada modelo
                  // se ve como un bloque completo con todos sus talles.
                  const nuevoProducto = i === 0 || res.filas[i - 1].handle !== f.handle;
                  return (
                    <tr key={i} style={{
                      borderTop: nuevoProducto ? '3px solid #60a5fa' : '1px solid rgba(255,255,255,0.06)',
                      background: yaViene ? 'rgba(139,92,246,0.10)' : undefined,
                    }}>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: nuevoProducto ? 'bold' : undefined, opacity: nuevoProducto ? 1 : 0.35 }}>
                        {nuevoProducto ? f.codigo : '↳'}
                      </td>
                      <td style={{ ...td, fontWeight: nuevoProducto ? 'bold' : undefined }}>
                        {nuevoProducto ? (
                          <>
                            {f.titulo}
                            <span style={{ fontSize: '0.7rem', marginLeft: 6, opacity: 0.6 }}>{f.marca === 'lecoq' ? 'LE COQ' : 'CONVERSE'}</span>
                          </>
                        ) : <span style={{ opacity: 0.3 }}>·</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>{f.talleAr}</td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 'bold', color: '#60a5fa' }}>
                        {f.tallePedido}
                        {f.escala && f.escala !== '—' && (
                          <span style={{ fontSize: '0.65rem', opacity: 0.6, marginLeft: 4 }}>{f.escala === 'EU' ? 'EU' : 'US'}</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 'bold', color: semaforo(f.stockMartinez) }}>{f.stockMartinez}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{f.stockId}</td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 'bold', color: f.vendidos ? '#fbbf24' : undefined }}>{f.vendidos || ''}</td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 'bold', color: f.pendienteEntrega ? '#f87171' : undefined }}>{f.pendienteEntrega || ''}</td>
                      <td style={{ ...td, textAlign: 'center', color: f.vendMartinez ? '#34d399' : undefined }}>{f.vendMartinez || ''}</td>
                      <td style={{ ...td, textAlign: 'center', color: f.vendId ? '#c4b5fd' : undefined }}>{f.vendId || ''}</td>
                      <td style={{ ...td, textAlign: 'center', color: f.devueltos ? '#f59e0b' : undefined }}>{f.devueltos || ''}</td>
                      {pedido && (
                        <td style={{ ...td, textAlign: 'center', fontWeight: f.enCamino ? 'bold' : undefined, color: f.enCamino ? '#c4b5fd' : undefined }}>
                          {f.enCamino || ''}
                        </td>
                      )}
                      <td style={{ ...td, textAlign: 'center' }}>
                        <input
                          type="number" min={0}
                          value={cant[keyDe(f)] ?? ''}
                          onChange={e => setCant({ ...cant, [keyDe(f)]: parseInt(e.target.value) || 0 })}
                          style={{ width: 60, padding: '4px', borderRadius: '4px', background: 'var(--bg-color)', color: 'white', border: '1px solid var(--glass-border)', textAlign: 'center' }}
                        />
                      </td>
                    </tr>
                  );
                })}
                {res.filas.length === 0 && (
                  <tr><td colSpan={10} style={{ ...td, textAlign: 'center', opacity: 0.7 }}>Nada para reponer en este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {res.posiblesEntregas.length > 0 && (
            <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #6b7280', background: 'rgba(107,114,128,0.08)', borderRadius: '8px' }}>
              <h3 style={{ marginTop: 0, color: '#9ca3af' }}>📥 Posibles entregas ({res.posiblesEntregas.length})</h3>
              <p style={{ fontSize: '0.82rem', opacity: 0.8, marginTop: 0 }}>
                Productos que <strong>no tenés en Martínez</strong> (todas sus variantes en 0). No los reponés,
                pero se venden desde iD: acá los ves por si querés empezar a trabajarlos.
              </p>
              <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Código</th>
                      <th style={th}>Producto</th>
                      <th style={{ ...th, textAlign: 'center' }}>Talle AR</th>
                      <th style={{ ...th, textAlign: 'center' }}>A pedir</th>
                      <th style={{ ...th, textAlign: 'center' }}>Stock iD</th>
                      <th style={{ ...th, textAlign: 'center', color: '#fbbf24' }}>Vendidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.posiblesEntregas.map((f, i) => {
                      const nuevo = i === 0 || res.posiblesEntregas[i - 1].handle !== f.handle;
                      return (
                      <tr key={i} style={{ borderTop: nuevo ? '3px solid #6b7280' : '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ ...td, fontFamily: 'monospace', fontWeight: nuevo ? 'bold' : undefined, opacity: nuevo ? 1 : 0.35 }}>{nuevo ? f.codigo : '↳'}</td>
                        <td style={{ ...td, fontWeight: nuevo ? 'bold' : undefined }}>{nuevo ? f.titulo : <span style={{ opacity: 0.3 }}>·</span>}</td>
                        <td style={{ ...td, textAlign: 'center' }}>{f.talleAr}</td>
                        <td style={{ ...td, textAlign: 'center', color: '#60a5fa' }}>
                          {f.tallePedido}
                          {f.escala && f.escala !== '—' && <span style={{ fontSize: '0.65rem', opacity: 0.6, marginLeft: 4 }}>{f.escala === 'EU' ? 'EU' : 'US'}</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'center' }}>{f.stockId}</td>
                        <td style={{ ...td, textAlign: 'center', fontWeight: 'bold', color: f.vendidos ? '#fbbf24' : undefined }}>{f.vendidos || ''}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {res.revisar.length > 0 && (
            <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.08)', borderRadius: '8px' }}>
              <h3 style={{ color: '#f59e0b', marginTop: 0 }}>⚠️ Revisar a mano ({res.revisar.length})</h3>
              <p style={{ fontSize: '0.82rem', opacity: 0.8, marginTop: 0 }}>
                No pude convertir el talle de estas filas. No las descarto: revisalas vos.
              </p>
              <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {res.revisar.map((f, i) => (
                  <div key={i} style={{ padding: '0.5rem 0.7rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', fontSize: '0.82rem' }}>
                    <strong style={{ fontFamily: 'monospace' }}>{f.codigo || '(sin código)'}</strong> — {f.titulo} · talle {f.talleAr}
                    <span style={{ marginLeft: 8, opacity: 0.75 }}>Martínez {f.stockMartinez} · iD {f.stockId}</span>
                    <div style={{ color: '#fcd34d', marginTop: 2 }}>{f.motivoRevisar}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
