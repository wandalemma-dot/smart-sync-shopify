import { useState } from 'react';
import { analizarExclusionId } from './utils/pedidoId';
import type { ExclusionPedido, PlantillaId, ResultadoArmado } from './utils/pedidoId';

export default function ExclusionPedidoId({ exclusion, plantilla }: { exclusion: ExclusionPedido; plantilla: PlantillaId }) {
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoArmado | null>(null);
  const [error, setError] = useState('');
  async function analizar() {
    if (abierto) { setAbierto(false); return; }
    setAbierto(true); setOcupado(true); setError(''); setResultado(null);
    try { setResultado(await analizarExclusionId(exclusion.ordenId, plantilla)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'No se pudo consultar la orden.'); }
    finally { setOcupado(false); }
  }
  return <>
    <tr style={{ background: 'rgba(244,114,182,.12)', borderTop: '1px solid #f9a8d4' }}>
      <td colSpan={2} style={{ padding: 10 }}><strong>{exclusion.alcance === 'orden' ? 'Orden excluida de esta compra' : 'Preparación excluida de esta orden'}</strong><br/>Pago: {exclusion.pago}<br/>
        <button type="button" disabled={ocupado} aria-expanded={abierto} onClick={analizar} style={{ marginTop: 8 }}>{ocupado ? 'Consultando…' : abierto ? 'Ocultar análisis' : 'Analizar por separado'}</button>
      </td>
      <td><strong>{exclusion.orden}</strong></td><td>—</td><td>—</td><td><strong>0</strong></td><td>—</td>
      <td style={{ padding: 10, color: '#fbcfe8' }}>{exclusion.motivo}<br/><small>No se incluye en el Excel.</small></td>
    </tr>
    {abierto && <tr><td colSpan={8} style={{ padding: 16, border: '1px solid #f9a8d4' }}>
      <h4 style={{ marginTop: 0 }}>Análisis separado de {exclusion.orden}</h4>
      <p>Consulta los pendientes actuales de iD y los compara con la plantilla cargada. Las cantidades de esta revisión no se suman al Excel principal.</p>
      {ocupado && <p role="status">Consultando artículos y motivos actuales en Shopify…</p>}
      {error && <p role="alert" style={{ color: '#fda4af' }}>{error}</p>}
      {resultado && <>
        {resultado.avisos.length > 0 ? <ul>{resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul> : <p>La consulta actual no encontró una causa de exclusión. Volvé a «Armar y revisar pedido» para actualizar el panel general.</p>}
        {resultado.filas.length > 0 ? <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Artículo / código', 'Talle tienda → iD', 'Pendiente', 'Disponible', 'Cubriría la plantilla', 'Faltaría', 'Resultado'].map(t => <th key={t} style={{ textAlign: 'left', padding: 8 }}>{t}</th>)}</tr></thead>
          <tbody>{resultado.filas.map((f, i) => <tr key={i} style={{ borderTop: '1px solid #475569' }}>
            <td style={{ padding: 8 }}>{f.titulo}<br/><strong>{f.codigo}</strong>{f.pack > 1 && <div>Pack ×{f.pack}; disponible y cobertura en packs</div>}</td>
            <td>{f.talle || 'Único'} → {f.talleProveedor}</td><td>{f.necesaria}</td><td>{f.tope ? '+' : ''}{f.disponible}</td><td>{f.pedir}</td><td>{f.faltante}</td><td>{f.motivo || 'Disponible en la plantilla'}</td>
          </tr>)}</tbody>
        </table></div> : <p>No se encontraron artículos pendientes en preparaciones abiertas de iD para comparar.</p>}
        <p>Si corresponde corregir una etiqueta o el estado de la orden, hacelo en Shopify y volvé a analizar. Revisá lo ya comprado antes de incluirla.</p>
      </>}
    </td></tr>}
  </>;
}
