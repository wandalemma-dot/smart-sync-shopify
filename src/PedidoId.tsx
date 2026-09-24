import { useState } from 'react';
import { idsOrdenes, leerPendientesId, leerPlantillaId, cruzarPedido, generarExcelPedido } from './utils/pedidoId';
import type { PlantillaId, ResultadoArmado } from './utils/pedidoId';

export default function PedidoId() {
  const [csv, setCsv] = useState<File | null>(null);
  const [excel, setExcel] = useState<File | null>(null);
  const [plantilla, setPlantilla] = useState<PlantillaId | null>(null);
  const [resultado, setResultado] = useState<ResultadoArmado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const [revisado, setRevisado] = useState(false);
  const reset = () => { setResultado(null); setPlantilla(null); setRevisado(false); setError(''); setEstado(''); };
  async function armar() {
    if (!csv || !excel) return;
    reset(); setOcupado(true);
    try {
      const p = leerPlantillaId(new Uint8Array(await excel.arrayBuffer()));
      const ids = idsOrdenes(await csv.text());
      setEstado(`Consultando 0 de ${ids.length} órdenes…`);
      const pendientes = await leerPendientesId(ids, n => setEstado(`Consultando ${n} de ${ids.length} órdenes…`));
      setPlantilla(p); setResultado(cruzarPedido(pendientes.lineas, p, pendientes.avisos, ids.length));
      setEstado('Revisión lista. El Excel todavía no se envió a iD.');
    } catch (e: any) { setError(e.message || 'No se pudo armar el pedido.'); setEstado(''); }
    finally { setOcupado(false); }
  }
  function descargar() {
    if (!plantilla || !resultado || !revisado) return;
    try {
      const bytes = generarExcelPedido(plantilla, resultado);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = `Pedido_iD_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) { setError(e.message); }
  }
  const filas = resultado?.filas || [];
  const faltantes = filas.filter(f => f.faltante > 0 || f.motivo);
  const cantidad = filas.reduce((n, f) => n + f.pedir, 0);
  return <section className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #6366f1' }}>
    <h2 style={{ color: '#a5b4fc', marginTop: 0 }}>📋 Armado de pedido iD</h2>
    <p>Órdenes pendientes → revisión por artículo y talle → Excel de iD completo.</p>
    <p style={{ opacity: .8 }}>Incluye únicamente cantidades pendientes asignadas a iD en órdenes abiertas y pagadas. Excluye etiquetas «pedido id» y «solucionar». Conserva Martínez. No envía pedidos ni cambia Shopify.</p>
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      <label className="dropzone" style={{ flex: 1, minWidth: 240 }}>1. Export de órdenes (.csv)
        <input aria-label="Export de órdenes" type="file" accept=".csv" disabled={ocupado} onChange={e => { reset(); setCsv(e.target.files?.[0] || null); }} />
      </label>
      <label className="dropzone" style={{ flex: 1, minWidth: 240 }}>2. Plantilla actual de iD (.xlsx)
        <input aria-label="Plantilla de iD" type="file" accept=".xlsx" disabled={ocupado} onChange={e => { reset(); setExcel(e.target.files?.[0] || null); }} />
      </label>
    </div>
    <p>Podés procesar una plantilla por vez. Los artículos de otra plantilla aparecerán en «Revisar».</p>
    <button className="btn-primary" style={{ background: '#6366f1', marginTop: 12 }} disabled={!csv || !excel || ocupado} onClick={armar}>{ocupado ? 'Consultando Shopify…' : 'Armar y revisar pedido'}</button>
    <p role="status">{estado}</p>
    {error && <p role="alert" style={{ color: '#fda4af', whiteSpace: 'pre-wrap' }}>{error}</p>}
    {resultado && <>
      <h3>{resultado.ordenes} órdenes consultadas · {cantidad} unidades de compra propuestas · {faltantes.length} renglones con faltantes o revisión</h3>
      {plantilla?.previas ? <p style={{ color: '#fcd34d' }}>La plantilla tenía {plantilla.previas} cantidades cargadas. La descarga las reemplaza por este pedido nuevo; no las suma.</p> : null}
      {faltantes.length > 0 && <p role="alert" style={{ color: '#fda4af', fontWeight: 'bold' }}>⚠ Hay artículos que no se pueden cubrir por completo. Revisá los renglones señalados y sus órdenes antes de descargar.</p>}
      <p>En packs, «Pedir» y «Disponible» son packs; «Necesitás» y «Faltan» son pares. +50 se toma como disponibilidad máxima de 50 en esta propuesta.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead><tr>{['Artículo / código', 'Talle tienda → iD', 'Órdenes', 'Necesitás', 'Disponible', 'Pedir', 'Faltan', 'Estado'].map(t => <th key={t} style={{ textAlign: 'left', padding: 10 }}>{t}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i} style={{ background: f.motivo ? 'rgba(245,158,11,.15)' : 'transparent', borderTop: '1px solid #475569' }}>
          <td style={{ padding: 10 }}>{f.titulo}<br/><strong>{f.codigo}</strong>{f.pack > 1 && <div>Pack ×{f.pack} · sobrante previsto: {f.excedente} pares</div>}</td>
          <td>{f.talle || 'Único'} → {f.talleProveedor}</td><td>{f.ordenes.join(', ')}</td><td>{f.necesaria}</td><td>{f.tope ? '+' : ''}{f.disponible}</td><td><strong>{f.pedir}</strong></td><td>{f.faltante}</td><td>{f.motivo || 'Listo para pedir'}</td>
        </tr>)}</tbody>
      </table></div>
      {!filas.length && <p>No hay artículos pendientes de iD para armar con estas órdenes. Revisá también los avisos.</p>}
      {resultado.avisos.length > 0 && <details open><summary>Avisos de órdenes ({resultado.avisos.length})</summary><ul>{resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
      <label style={{ display: 'block', margin: '20px 0' }}><input type="checkbox" checked={revisado} onChange={e => setRevisado(e.target.checked)} /> Revisé cantidades, packs, talles y faltantes. Descargar solo lo que figura en «Pedir».</label>
      <button className="btn-primary" style={{ background: '#6366f1' }} disabled={!revisado || !cantidad} onClick={descargar}>Descargar plantilla de pedido iD</button>
      <p style={{ opacity: .7 }}>Revisá el Excel antes de subirlo al proveedor. Descargarlo no etiqueta las órdenes como «pedido id»; repetir el proceso podría repetir el mismo pedido.</p>
    </>}
  </section>;
}
