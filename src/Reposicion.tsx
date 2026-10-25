// ============================================================================
// PESTAÑA REPOSICIÓN — qué traer de iD a Martínez según las ventas
// ----------------------------------------------------------------------------
// 25-oct-2026: reemplaza la Reposición anterior (export de órdenes en CSV +
// alertas de Martínez). Ahora se elige la marca y la app lee las ventas de
// Shopify de los últimos 15 y 3 días, con el stock de Martínez y de iD por talle.
// Lógica en utils/reposicionVentas.ts. SOLO LECTURA.
// ============================================================================
import { useRef, useState } from 'react';
import { consultarReposicion, filtrarModelos, descargarReposicion, MARCAS_ID, DIAS_LARGO, DIAS_CORTO } from './utils/reposicionVentas';
import type { MarcaId, Progreso, ResultadoReposicionVentas } from './utils/reposicionVentas';

export default function Reposicion() {
  const [marca, setMarca] = useState<MarcaId>('converse');
  const [loading, setLoading] = useState(false);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [error, setError] = useState('');
  const [res, setRes] = useState<ResultadoReposicionVentas | null>(null);
  const [minimo, setMinimo] = useState(6);
  const [soloCalzado, setSoloCalzado] = useState(true);
  const [conId, setConId] = useState(true);
  const [orden, setOrden] = useState<'v15' | 'v3'>('v15');
  const [buscar, setBuscar] = useState('');
  const solicitud = useRef(0);

  const analizar = async () => {
    const id = ++solicitud.current;
    setLoading(true); setError(''); setRes(null); setProgreso(null);
    try {
      const r = await consultarReposicion(marca, p => { if (id === solicitud.current) setProgreso(p); });
      if (id === solicitud.current) setRes(r);
    } catch (e) {
      if (id === solicitud.current) setError(e instanceof Error ? e.message : 'No se pudo leer Shopify.');
    } finally {
      if (id === solicitud.current) setLoading(false);
    }
  };

  const modelos = res ? filtrarModelos(res.modelos, { minimo, soloCalzado, orden, buscar }).filter(m => !conId || m.idStock > 0) : [];
  const campo: React.CSSProperties = { padding: '8px 10px', borderRadius: 6, background: '#1f2937', color: '#fff', border: '1px solid #64748b' };
  const th: React.CSSProperties = { textAlign: 'center', padding: '7px 10px', position: 'sticky', top: 0, background: '#1f2937', zIndex: 1 };
  const td: React.CSSProperties = { padding: '5px 10px', textAlign: 'center' };
  const stock = (n: number | null) => n === null ? <span style={{ opacity: 0.45 }} title="No está dada de alta en esta sucursal">—</span> : n;

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>📦 Reposición — qué traer de iD</h2>
      <p style={{ fontSize: '0.9rem', opacity: 0.85, marginTop: 0 }}>
        Elegí la marca y te muestro los modelos que más se vendieron en los últimos <strong>{DIAS_LARGO} días</strong> y
        en los últimos <strong>{DIAS_CORTO} días</strong>, talle por talle, con el stock de <strong>Martínez</strong> y
        de <strong>iD</strong>. Lee las ventas directo de Shopify. <strong>No toca nada de tu tienda.</strong>
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select aria-label="Marca" value={marca} onChange={e => { setMarca(e.target.value as MarcaId); setRes(null); }} style={campo} disabled={loading}>
          {(Object.keys(MARCAS_ID) as MarcaId[]).map(m => <option key={m} value={m}>{MARCAS_ID[m]}</option>)}
        </select>
        <button className="btn-primary" style={{ background: '#10b981', flex: '1 1 220px' }} onClick={() => void analizar()} disabled={loading}>
          {loading ? <span className="loader"></span> : '🔍 Analizar ventas'}
        </button>
      </div>
      {loading && progreso && (
        <p role="status" style={{ fontSize: '0.85rem', opacity: 0.8 }}>
          {progreso.etapa === 'ventas' ? `Leyendo órdenes: ${progreso.hechas}…` : `Leyendo stock: ${progreso.hechas} de ${progreso.total} modelos…`}
        </p>
      )}
      {error && <p role="alert" style={{ color: '#fca5a5' }}>No se completó la consulta: {error}</p>}

      {res && (
        <div style={{ marginTop: '1.2rem' }}>
          <p style={{ fontSize: '0.85rem', opacity: 0.85 }}>
            {MARCAS_ID[res.marca]} · {res.ordenes} órdenes con esta marca desde el {new Date(res.desde).toLocaleDateString('es-AR')} ·{' '}
            {res.modelos.length} modelos vendidos · Consulta: {new Date(res.generadoEn).toLocaleString('es-AR')}
          </p>
          {res.avisos.map((a, i) => <p key={i} style={{ fontSize: '0.8rem', color: '#fbbf24', margin: '0.2rem 0' }}>⚠️ {a}</p>)}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', margin: '0.8rem 0', fontSize: '0.85rem' }}>
            <label>Vendidos en {DIAS_LARGO} días, mínimo{' '}
              <input type="number" min={1} value={minimo} onChange={e => setMinimo(Math.max(1, Number(e.target.value) || 1))} style={{ ...campo, width: 70 }} />
            </label>
            <label>Ordenar por{' '}
              <select value={orden} onChange={e => setOrden(e.target.value as 'v15' | 'v3')} style={campo}>
                <option value="v15">Más vendidos en {DIAS_LARGO} días</option>
                <option value="v3">Más vendidos en {DIAS_CORTO} días</option>
              </select>
            </label>
            <label><input type="checkbox" checked={soloCalzado} onChange={e => setSoloCalzado(e.target.checked)} /> Solo zapatillas</label>
            <label><input type="checkbox" checked={conId} onChange={e => setConId(e.target.checked)} /> Solo modelos con stock en iD</label>
            <input type="text" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="🔎 Buscar modelo o código" style={{ ...campo, flex: '1 1 200px' }} />
          </div>

          {modelos.length === 0 ? <p>No hay modelos con estos filtros. Probá bajar el mínimo de ventas.</p> : <>
            <p style={{ fontSize: '0.85rem' }}>
              <strong>{modelos.length}</strong> modelos ·{' '}
              <strong>{modelos.reduce((s, m) => s + m.vendidos15, 0)}</strong> vendidos en {DIAS_LARGO} días ·{' '}
              <strong>{modelos.reduce((s, m) => s + m.vendidos3, 0)}</strong> en {DIAS_CORTO} días
            </p>
            <div style={{ maxHeight: 620, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
              <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Talle tienda</th>
                  <th style={th}>Talle iD</th>
                  <th style={th}>Vendidos {DIAS_LARGO} días</th>
                  <th style={th}>Vendidos {DIAS_CORTO} días</th>
                  <th style={th}>Stock Martínez</th>
                  <th style={th}>Stock iD</th>
                </tr></thead>
                {modelos.map(m => (
                  <tbody key={m.productId}>
                    <tr style={{ borderTop: '3px solid #94a3b8', background: 'rgba(148,163,184,0.12)' }}>
                      <td style={{ ...td, textAlign: 'left' }} colSpan={2}>
                        <strong>{m.titulo}</strong>
                        <div style={{ fontSize: '0.72rem', opacity: 0.7, fontFamily: 'monospace' }}>{m.codigo || 'Sin código'}
                          {m.estado !== 'ACTIVE' && <span style={{ color: '#fbbf24', fontFamily: 'inherit' }}> · {m.estado === 'DRAFT' ? 'Borrador' : 'Archivado'}</span>}
                        </div>
                        {m.aviso && <div style={{ fontSize: '0.72rem', color: '#fbbf24' }}>{m.aviso}</div>}
                      </td>
                      <td style={{ ...td, fontWeight: 'bold', fontSize: '1rem' }}>{m.vendidos15}</td>
                      <td style={{ ...td, fontWeight: 'bold', fontSize: '1rem' }}>{m.vendidos3}</td>
                      <td style={{ ...td, fontWeight: 'bold' }}>{m.martinez}</td>
                      <td style={{ ...td, fontWeight: 'bold', color: '#34d399' }}>{m.idStock}</td>
                    </tr>
                    {m.variantes.map(v => (
                      <tr key={v.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', opacity: v.vendidos15 || (v.idStock ?? 0) > 0 ? 1 : 0.55 }}>
                        <td style={{ ...td, textAlign: 'left' }}>{v.talle}</td>
                        <td style={td}>{v.tallePedido
                          ? <>{v.tallePedido}{v.escala && v.escala !== '—' && <span style={{ fontSize: '0.7rem', opacity: 0.6 }}> {v.escala}</span>}</>
                          : <span style={{ color: '#fbbf24' }} title={v.motivo}>a revisar</span>}</td>
                        <td style={{ ...td, fontWeight: v.vendidos15 ? 'bold' : undefined }}>{v.vendidos15 || ''}</td>
                        <td style={{ ...td, fontWeight: v.vendidos3 ? 'bold' : undefined }}>{v.vendidos3 || ''}</td>
                        <td style={{ ...td, color: v.martinez !== null && v.martinez <= 0 ? '#fca5a5' : undefined }}>{stock(v.martinez)}</td>
                        <td style={{ ...td, color: (v.idStock ?? 0) > 0 ? '#34d399' : undefined }}>{stock(v.idStock)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
            <p style={{ fontSize: '0.75rem', opacity: 0.7 }}>
              Vendidos = unidades vendidas menos devoluciones; no cuenta órdenes canceladas. «—» = el talle no está dado de alta en esa sucursal.
              «a revisar» = no se pudo saber el talle de iD (no se adivina).
            </p>
            <button className="btn-primary" style={{ background: '#f59e0b', marginTop: '0.4rem' }} onClick={() => descargarReposicion(modelos, res.marca)}>
              📥 Exportar lo que se ve (CSV)
            </button>
          </>}
        </div>
      )}
    </div>
  );
}
