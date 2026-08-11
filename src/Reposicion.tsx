import { useState } from 'react';
import { analizarReposicion, LOC_MARTINEZ, LOC_ID } from './utils/reposicionLogic';
import type { ResultadoReposicion, FilaReposicion } from './utils/reposicionLogic';
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

  const keyDe = (f: FilaReposicion) => `${f.codigo || f.handle}|${f.talleAr}`;

  const analizar = async () => {
    setLoading(true); setRes(null); setEscaneados(0); setCant({});
    try {
      const r = await analizarReposicion(desde, setEscaneados);
      setRes(r);
    } catch (e: any) {
      alert('Error armando la reposición: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const exportar = () => {
    if (!res) return;
    const headers = ['Código', 'Producto', 'Marca', 'Talle AR', 'Talle a pedir', 'Escala', 'Cantidad', 'Stock Martinez', 'Stock iD', 'Vendidos Martinez', 'Vendidos iD', 'Devueltos'];
    let csv = headers.join(',') + '\n';
    for (const f of res.filas) {
      const c = cant[keyDe(f)] ?? '';
      csv += [f.codigo || '', f.titulo, f.marca === 'lecoq' ? 'Le Coq' : 'Converse', f.talleAr, f.tallePedido || '', f.escala || '', c, f.stockMartinez, f.stockId, f.vendMartinez, f.vendId, f.devueltos]
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
          <button className="btn-primary" style={{ background: '#10b981', padding: '10px 18px' }} onClick={analizar} disabled={loading}>
            {loading ? <span className="loader"></span> : '🔍 Armar reposición'}
          </button>
          {res && res.filas.length > 0 && (
            <button className="btn-primary" style={{ background: '#f59e0b', padding: '10px 18px' }} onClick={exportar}>
              📥 Exportar CSV
            </button>
          )}
        </div>
        {loading && <p style={{ marginTop: 10, color: '#10b981' }}>Consultando Shopify… {escaneados > 0 && `(${escaneados} productos)`}</p>}
      </div>

      {res && (
        <>
          {!res.puedeLeerOrdenes && (
            <div style={{ padding: '0.9rem', marginBottom: '1rem', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.12)', borderRadius: '8px', fontSize: '0.9rem' }}>
              ⚠️ No pude leer las ventas (la columna "Vendidos" va a estar en 0). Suele ser porque el permiso <strong>read_orders</strong> es nuevo y hay que <strong>reautorizar la app</strong> en Shopify. El resto (stock de Martínez y de iD) sí es correcto.
              <div style={{ opacity: 0.7, marginTop: 6, fontSize: '0.8rem' }}>{res.avisoOrdenes}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '0.8rem', fontSize: '0.9rem' }}>
            <span>🧩 Para pedir: <strong>{res.filas.length}</strong></span>
            <span style={{ color: '#dc2626' }}>🔴 En 0 en Martínez: <strong>{res.filas.filter(f => f.stockMartinez === 0).length}</strong></span>
            <span style={{ color: '#f59e0b' }}>🟡 Bajo (1-2): <strong>{res.filas.filter(f => f.stockMartinez > 0 && f.stockMartinez <= 2).length}</strong></span>
            <span>🔎 Productos: {res.productosEscaneados}</span>
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
                  <th style={{ ...th, textAlign: 'center', color: '#34d399' }}>Vend. Mart.</th>
                  <th style={{ ...th, textAlign: 'center', color: '#c4b5fd' }}>Vend. iD</th>
                  <th style={{ ...th, textAlign: 'center' }}>Dev.</th>
                  <th style={{ ...th, textAlign: 'center' }}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {res.filas.map((f, i) => {
                  return (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{f.codigo}</td>
                      <td style={td}>
                        {f.titulo}
                        <span style={{ fontSize: '0.7rem', marginLeft: 6, opacity: 0.6 }}>{f.marca === 'lecoq' ? 'LE COQ' : 'CONVERSE'}</span>
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
                      <td style={{ ...td, textAlign: 'center', fontWeight: f.vendMartinez ? 'bold' : undefined, color: f.vendMartinez ? '#34d399' : undefined }}>{f.vendMartinez || ''}</td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: f.vendId ? 'bold' : undefined, color: f.vendId ? '#c4b5fd' : undefined }}>{f.vendId || ''}</td>
                      <td style={{ ...td, textAlign: 'center', color: f.devueltos ? '#f59e0b' : undefined }}>{f.devueltos || ''}</td>
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
