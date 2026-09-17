import { useEffect, useRef, useState } from 'react';
import { consultarAlertasMartinez, descargarAlertasMartinez } from './utils/alertasMartinez';
import type { ResultadoAlertas } from './utils/alertasMartinez';

export default function AlertasMartinez({ revision }: { revision: number }) {
  const [resultado, setResultado] = useState<ResultadoAlertas | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [leidas, setLeidas] = useState(0);
  const [buscar, setBuscar] = useState('');
  const [marca, setMarca] = useState('');
  const solicitud = useRef(0);
  async function consultar() {
    const id = ++solicitud.current;
    setLoading(true); setError(''); setResultado(null); setLeidas(0);
    try {
      const res = await consultarAlertasMartinez(n => { if (id === solicitud.current) setLeidas(n); });
      if (id === solicitud.current) setResultado(res);
    } catch (e) {
      if (id === solicitud.current) setError(e instanceof Error ? e.message : 'No se pudo consultar el stock.');
    } finally {
      if (id === solicitud.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (revision > 0) void consultar();
    return () => { solicitud.current++; };
  }, [revision]);
  const q = buscar.trim().toLocaleLowerCase();
  const filas = resultado?.filas.filter(f => (!marca || f.marca === marca) &&
    `${f.codigo || ''} ${f.titulo} ${f.variante} ${f.tallePedido || ''}`.toLocaleLowerCase().includes(q)) || [];
  const celda = { padding: '9px 10px', textAlign: 'left' as const };
  const campo = { padding: '9px', borderRadius: 6, background: '#1f2937', color: '#fff', border: '1px solid #64748b' };
  return <section style={{ marginTop: '2rem', borderTop: '1px solid #475569', paddingTop: '1.3rem' }}>
    <h3 style={{ marginTop: 0 }}>Alerta de reposición — Martínez</h3>
    <p>Converse y Le Coq con <strong>3 unidades o menos en Martínez</strong> y disponibilidad en iD.
      Vos elegís cuánto pedir. Esta lista no suma ni descuenta unidades de las órdenes.</p>
    <button className="btn-primary" onClick={() => void consultar()} disabled={loading}>
      {loading ? 'Consultando stock…' : resultado ? 'Actualizar alertas de Martínez' : 'Consultar alertas de Martínez'}
    </button>
    <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>Podés consultarlo sin subir órdenes. Stock disponible registrado en Shopify; no modifica tu tienda.
      Solo incluye variantes dadas de alta en ambos depósitos.</p>
    {loading && <p role="status">Leyendo variantes: {leidas}…</p>}
    {error && <p role="alert" style={{ color: '#fca5a5' }}>No se completó la consulta: {error}</p>}
    {resultado && <>
      <p><strong>{resultado.filas.length}</strong> alertas · Consulta: {new Date(resultado.generadoEn).toLocaleString('es-AR')}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <input aria-label="Buscar alertas de Martínez" placeholder="Buscar código, producto o talle" value={buscar} onChange={e => setBuscar(e.target.value)} style={{ ...campo, flex: '1 1 220px' }} />
        <select aria-label="Filtrar alertas por marca" value={marca} onChange={e => setMarca(e.target.value)} style={campo}>
          <option value="">Ambas marcas</option><option>Converse</option><option>Le Coq Sportif</option>
        </select>
      </div>
      {filas.length === 0 ? <p>{resultado.filas.length ? 'No hay coincidencias con estos filtros.' : 'No hay variantes con 3 unidades o menos en Martínez y disponibilidad en iD.'}</p> : <>
        <p style={{ fontSize: '0.85rem' }}>Mostrando {filas.length} alertas, de menor a mayor stock en Martínez.</p>
        <div style={{ overflow: 'auto', maxHeight: 500, border: '1px solid #475569', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr>{['Producto / código', 'Talle tienda', 'Talle iD', 'Stock Martínez', 'Disponible iD'].map(t =>
              <th key={t} style={{ ...celda, position: 'sticky', top: 0, background: '#1f2937' }}>{t}</th>)}</tr></thead>
            <tbody>{filas.map(f => <tr key={f.id} style={{ borderTop: '1px solid #374151' }}>
              <td style={celda}><strong>{f.titulo}</strong><div>{f.codigo || 'Sin código'} · {f.marca}</div>
                {f.estado !== 'ACTIVE' && <div style={{ color: '#fbbf24' }}>{f.estado === 'DRAFT' ? 'Borrador' : 'Archivado'}</div>}
                {f.variante !== f.talleAr && <div>{f.variante}</div>}
                {f.motivo && <div style={{ color: '#fbbf24' }}>Revisar: {f.motivo}</div>}</td>
              <td style={celda}>{f.talleAr || '—'}</td>
              <td style={celda}>{f.tallePedido || 'A revisar'}<div style={{ opacity: 0.7 }}>{f.escala}</div></td>
              <td style={{ ...celda, fontWeight: 'bold', color: f.stockMartinez <= 0 ? '#fca5a5' : '#fde68a' }}>{f.stockMartinez}</td>
              <td style={celda}>{f.stockId}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => descargarAlertasMartinez(filas)}>Exportar alertas visibles CSV</button>
      </>}
    </>}
  </section>;
}
