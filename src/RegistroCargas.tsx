// ============================================================================
// REGISTRO DE CARGAS EN SHOPIFY (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Botón «📋 Registro de cargas» al lado del título de Control de entregas: qué
// se cargó en Shopify desde la app, cuándo, con el número de remito y de
// factura de cada entrega. Solo lectura. Lógica: utils/registroCargas.ts.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  accionRegistro, agruparRegistro, enlaceShopify, estadoRegistro, filasExcel, filtrarRegistro, horaAr,
  NOMBRE_PROVEEDOR, textoFactura, textoTalles, unidadesEvento, type EventoRegistro,
} from './utils/registroCargas';
import { botonChico, enlace, fechaAr, inputSt, mensaje, td, th } from './utils/entregasUi';

const tdN: React.CSSProperties = { ...td, whiteSpace: 'nowrap' };

export default function RegistroCargas({ onVolver }: { onVolver: () => void }) {
  const [eventos, setEventos] = useState<EventoRegistro[]>([]);
  const [completo, setCompleto] = useState(true);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');

  const leer = useCallback(async () => {
    setCargando(true); setError('');
    try {
      const r = await fetch('/api/control-facturas?registro=1', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setEventos(Array.isArray(d.eventos) ? d.eventos : []);
      setCompleto(d.completo !== false);
    } catch (e) { setError(mensaje(e)); setEventos([]); }
    finally { setCargando(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura inicial
  useEffect(() => { leer(); }, [leer]);

  const grupos = useMemo(() => filtrarRegistro(agruparRegistro(eventos), buscar), [eventos, buscar]);

  function descargar() {
    const ws = XLSX.utils.aoa_to_sheet(filasExcel(grupos.flatMap((g) => g.eventos)));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Registro de cargas');
    XLSX.writeFile(wb, `Registro de cargas ${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button style={enlace} onClick={onVolver}>← Volver a las entregas</button>
        <strong style={{ fontSize: '1.02rem' }}>📋 Registro de cargas en Shopify</strong>
        <button style={botonChico} onClick={leer} disabled={cargando}>🔄 Actualizar</button>
        <button style={botonChico} onClick={descargar} disabled={!grupos.length}>📥 Descargar Excel</button>
      </div>
      <p style={{ fontSize: '0.8rem', opacity: 0.75, margin: '0 0 10px' }}>
        Todo lo que se cargó en Shopify desde Control de entregas: cuándo, de qué entrega (remito y factura) y qué productos, con sus talles.
        También queda anotado cuando alguien libera una marca para poder cargar otra vez. Hoy carga desde acá Family.
      </p>
      <input style={{ ...inputSt, width: '100%', maxWidth: 420, marginBottom: 12 }} placeholder="Buscar por código, producto, remito, factura o fecha (dd/mm/aaaa)"
        value={buscar} onChange={(e) => setBuscar(e.target.value)} />

      {cargando && <p style={{ fontSize: '0.85rem', opacity: 0.75 }}>Cargando…</p>}
      {error && <p style={{ color: '#f87171', fontWeight: 'bold' }}>⚠ {error}</p>}
      {!cargando && !error && !eventos.length && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Todavía no se cargó nada en Shopify desde Control de entregas.</p>}
      {!cargando && !!eventos.length && !grupos.length && <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>Nada coincide con «{buscar}».</p>}
      {!completo && <p style={{ fontSize: '0.8rem', color: '#fbbf24' }}>Se muestran los últimos movimientos; los más viejos quedan guardados pero no entran en esta pantalla.</p>}

      {grupos.map((g) => (
        <div key={g.clave} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 12px', marginBottom: 12, background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline', fontSize: '0.9rem', marginBottom: 6 }}>
            <strong>{NOMBRE_PROVEEDOR[g.proveedor] ?? g.proveedor}{g.entrega.fecha ? ` · Entrega del ${fechaAr(g.entrega.fecha)}` : ''}</strong>
            <span>Remito: <strong>{g.remito || 'sin número'}</strong></span>
            <span>Factura: <strong>{textoFactura(g.proveedor, g.factura)}</strong></span>
            <span style={{ opacity: 0.8 }}>{g.unidades} u. cargadas · última actividad {horaAr(g.ultima)}</span>
          </div>
          {g.entrega.nombre && <div style={{ fontSize: '0.78rem', opacity: 0.65, marginBottom: 6 }}>Planilla: {g.entrega.nombre}</div>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' }}>
              <thead><tr>
                <th style={th}>Fecha y hora</th><th style={th}>Código</th><th style={th}>Producto</th><th style={th}>Qué se hizo</th>
                <th style={th}>Talles</th><th style={th}>Unidades</th><th style={th}>Estado</th>
              </tr></thead>
              <tbody>
                {g.eventos.map((e, i) => {
                  const url = enlaceShopify(e.productoId);
                  const [ia, ta] = accionRegistro(e);
                  const [ie, te] = estadoRegistro(e);
                  return (
                    <tr key={`${e.hora}-${e.codigo}-${i}`} style={{ opacity: e.tipo === 'liberada' ? 0.8 : 1 }}>
                      <td style={tdN}>{horaAr(e.hora)}</td>
                      <td style={tdN}><strong>{e.codigo}</strong></td>
                      <td style={td}>
                        {url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{e.titulo || 'Ver en Shopify'}</a> : (e.titulo || '—')}
                        {e.mensaje && e.estado !== 'cargada' && <div style={{ fontSize: '0.75rem', opacity: 0.75 }}>{e.mensaje}</div>}
                        {e.deMarca && <div style={{ fontSize: '0.72rem', opacity: 0.6 }}>Anotado con la marca de carga (antes del registro o sin terminar).</div>}
                      </td>
                      <td style={tdN}>{ia} {ta}</td>
                      <td style={td}>{textoTalles(e.talles) || '—'}</td>
                      <td style={tdN}>{e.tipo === 'carga' ? unidadesEvento(e) : '—'}</td>
                      <td style={tdN}>{ie} {te}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
