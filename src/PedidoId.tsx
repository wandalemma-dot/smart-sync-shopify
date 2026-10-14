import { useMemo, useState } from 'react';
import { idsOrdenes, leerPendientesId, leerPlantillaId, cruzarPedido, generarExcelPedido, detectarPedidosMixtos, marcaPedidoId } from './utils/pedidoId';
import type { PlantillaId, PendientesSucursal } from './utils/pedidoId';

export default function PedidoId() {
  const [csv, setCsv] = useState<File | null>(null);
  const [excel, setExcel] = useState<File | null>(null);
  const [plantilla, setPlantilla] = useState<PlantillaId | null>(null);
  const [pendientes, setPendientes] = useState<(PendientesSucursal & { ordenes: number }) | null>(null);
  const [omitidas, setOmitidas] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const [revisado, setRevisado] = useState(false);
  const reset = () => { setPendientes(null); setPlantilla(null); setOmitidas([]); setRevisado(false); setError(''); setEstado(''); };
  const resultado = useMemo(() => pendientes && plantilla
    ? cruzarPedido(pendientes.lineas, plantilla, pendientes.avisos, pendientes.ordenes, omitidas) : null, [pendientes, plantilla, omitidas]);
  const mixtos = useMemo(() => detectarPedidosMixtos(pendientes?.lineas || [], pendientes?.etiquetadas || []), [pendientes]);
  const ordenesMixtas = new Set(mixtos.map(o => o.orden));
  function seleccionar(id: string, incluir: boolean) {
    setOmitidas(actual => incluir ? actual.filter(x => x !== id) : [...new Set([...actual, id])]);
    setRevisado(false);
  }
  async function armar() {
    if (!csv || !excel) return;
    reset(); setOcupado(true);
    try {
      const p = leerPlantillaId(new Uint8Array(await excel.arrayBuffer()));
      const ids = idsOrdenes(await csv.text());
      setEstado(`Consultando 0 de ${ids.length} órdenes…`);
      const pendientes = await leerPendientesId(ids, n => setEstado(`Consultando ${n} de ${ids.length} órdenes…`));
      setPlantilla(p); setPendientes({ ...pendientes, ordenes: ids.length });
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
      {mixtos.length > 0 && <div style={{ background: 'rgba(168,85,247,.17)', border: '1px solid #c084fc', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: '#e9d5ff', marginTop: 0 }}>Pedidos mixtos: Converse + Le Coq ({mixtos.length})</h3>
        <p>El violeta señala órdenes con pendientes de ambas marcas en iD. El amarillo indica faltantes o problemas de coincidencia. Un pedido mixto también puede tener faltantes; el estado de cada artículo sigue visible abajo.</p>
        <p>Destildá lo que ya compraste o no vas a pedir ahora. Se recalculan las cantidades del Excel. Antes de etiquetar toda la orden como «pedido id» en Shopify, revisá que no quede pendiente la otra marca.</p>
        {mixtos.map(o => <details key={o.orden} open style={{ marginTop: 12, borderTop: '1px solid #a78bfa', paddingTop: 10 }}>
          <summary><strong>{o.orden} · Converse + Le Coq</strong>{o.etiquetado ? ' · Ya tiene «pedido id»: excluido del Excel' : ' · Revisar ambas marcas'}</summary>
          {o.etiquetado && <p style={{ color: '#fcd34d' }}>Estos artículos no se suman al pedido. Comprobá qué compraste y corregí la etiqueta en Shopify si corresponde; después volvé a analizar y destildá lo ya comprado.</p>}
          {o.lineas.map(l => {
            const f = plantilla ? cruzarPedido([l], plantilla).filas[0] : undefined;
            return <label key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'start', margin: '12px 0' }}>
              <input type="checkbox" aria-label={`Incluir ${l.titulo}, ${l.talle || 'Único'}, ${o.orden}`} disabled={o.etiquetado} checked={!o.etiquetado && !omitidas.includes(l.id)} onChange={e => seleccionar(l.id, e.target.checked)} />
              <span><strong>{marcaPedidoId(l.vendor) || l.vendor || 'Marca sin identificar'} · {f?.codigo}</strong> — {l.titulo}<br/>
                Talle {l.talle || 'Único'} · {l.cantidad} pendiente(s) · {f?.celda ? 'En esta plantilla' : 'Revisar código o talle en esta plantilla'}
                {!o.etiquetado && omitidas.includes(l.id) && <strong> · Excluido manualmente de esta compra</strong>}
              </span>
            </label>;
          })}
        </details>)}
        <p style={{ opacity: .85 }}>La selección vale para este análisis. No cambia etiquetas ni preparaciones en Shopify. Solo se revisan las órdenes incluidas en el CSV y sus artículos pendientes en iD.</p>
      </div>}
      {omitidas.length > 0 && <p style={{ color: '#e9d5ff' }}>{omitidas.length} artículo(s) excluido(s) manualmente de esta compra. Podés volver a tildarlos en los pedidos mixtos.</p>}
      {plantilla?.previas ? <p style={{ color: '#fcd34d' }}>La plantilla tenía {plantilla.previas} cantidades cargadas. La descarga las reemplaza por este pedido nuevo; no las suma.</p> : null}
      {faltantes.length > 0 && <p role="alert" style={{ color: '#fda4af', fontWeight: 'bold' }}>⚠ Hay artículos que no se pueden cubrir por completo. Revisá los renglones señalados y sus órdenes antes de descargar.</p>}
      <p>En packs, «Pedir» y «Disponible» son packs; «Necesitás» y «Faltan» son pares. +50 se toma como disponibilidad máxima de 50 en esta propuesta.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead><tr>{['Artículo / código', 'Talle tienda → iD', 'Órdenes', 'Necesitás', 'Disponible', 'Pedir', 'Faltan', 'Estado'].map(t => <th key={t} style={{ textAlign: 'left', padding: 10 }}>{t}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i} style={{ background: f.ordenes.some(o => ordenesMixtas.has(o)) ? 'rgba(168,85,247,.17)' : f.motivo ? 'rgba(245,158,11,.15)' : 'transparent', borderTop: '1px solid #475569' }}>
          <td style={{ padding: 10 }}>{f.titulo}<br/><strong>{f.codigo}</strong>{f.pack > 1 && <div>Pack ×{f.pack} · sobrante previsto: {f.excedente} pares</div>}</td>
          <td>{f.talle || 'Único'} → {f.talleProveedor}</td><td>{f.ordenes.map((o, j) => <span key={o}>{j > 0 && ', '}{o}{ordenesMixtas.has(o) && <strong style={{ color: '#e9d5ff' }}> (mixto)</strong>}</span>)}</td><td>{f.necesaria}</td><td>{f.tope ? '+' : ''}{f.disponible}</td><td><strong>{f.pedir}</strong></td><td>{f.faltante}</td><td style={{ color: f.motivo ? '#fcd34d' : undefined }}>{f.motivo || 'Listo para pedir'}</td>
        </tr>)}</tbody>
      </table></div>
      {!filas.length && <p>No hay artículos pendientes de iD para armar con estas órdenes. Revisá también los avisos.</p>}
      {resultado.avisos.length > 0 && <details open><summary>Avisos de órdenes ({resultado.avisos.length})</summary><ul>{resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
      <label style={{ display: 'block', margin: '20px 0' }}><input type="checkbox" checked={revisado} onChange={e => setRevisado(e.target.checked)} /> Revisé cantidades, packs, talles, faltantes y pedidos mixtos. Descargar solo lo que figura en «Pedir».</label>
      <button className="btn-primary" style={{ background: '#6366f1' }} disabled={!revisado || !cantidad} onClick={descargar}>Descargar plantilla de pedido iD</button>
      <p style={{ opacity: .7 }}>Revisá el Excel antes de subirlo al proveedor. Descargarlo no etiqueta las órdenes como «pedido id»; repetir el proceso podría repetir el mismo pedido.</p>
    </>}
  </section>;
}
