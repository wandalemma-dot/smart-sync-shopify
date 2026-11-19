// Número de pedido de iD como etiqueta (19-nov-2026, gax: «una etiqueta pedido id, otra el número de pedido y
// otra la fecha»). La web de iD da el número recién cuando se sube el Excel, así que se escribe acá después:
// la app agrega ese número, solo, como etiqueta a las órdenes que etiquetó en la última descarga.
// Solo agrega (tagsAdd), nunca borra ni reemplaza etiquetas.
import { useState } from 'react';
import { etiquetarOrdenes, numeroPedidoId, type OrdenEtiqueta, type ResultadoEtiquetas } from './utils/etiquetaPedidoId';

export interface UltimaDescarga { fecha: string; ordenes: OrdenEtiqueta[]; numero?: string }
const CLAVE = 'pedidoId.ultimaDescarga';

export function leerUltimaDescarga(): UltimaDescarga | null {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE) || 'null');
    return d && typeof d.fecha === 'string' && Array.isArray(d.ordenes) ? d : null;
  } catch { return null; }
}
export function guardarUltimaDescarga(d: UltimaDescarga | null) {
  try { if (d) localStorage.setItem(CLAVE, JSON.stringify(d)); else localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento: queda en pantalla */ }
}

export default function NumeroPedidoId({ ultima, onCambio }: { ultima: UltimaDescarga; onCambio: (d: UltimaDescarga) => void }) {
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [res, setRes] = useState<ResultadoEtiquetas & { numero: string } | null>(null);
  const numero = numeroPedidoId(texto);
  async function agregar() {
    if (!numero || ocupado) return;
    if (!confirm(`En Shopify se agrega la etiqueta «${numero}» a ${ultima.ordenes.length} orden(es) del pedido del ${ultima.fecha}: ${ultima.ordenes.map(o => o.orden).join(', ')}. ¿Confirmás?`)) return;
    setOcupado(true); setRes(null);
    try {
      const r = await etiquetarOrdenes(ultima.ordenes, [numero]);
      setRes({ ...r, numero });
      if (r.ok.length) onCambio({ ...ultima, numero });
    } catch (e) {
      setRes({ ok: [], fallidas: ultima.ordenes.map(o => ({ orden: o.orden, error: (e as Error)?.message?.slice(0, 160) || 'error' })), numero });
    } finally { setOcupado(false); }
  }
  return <div style={{ background: 'rgba(99,102,241,.12)', border: '1px solid #818cf8', borderRadius: 8, padding: '10px 14px', margin: '12px 0' }}>
    <strong>🏷️ Número de pedido de iD</strong>
    <p style={{ margin: '4px 0' }}>Pedido del {ultima.fecha}: {ultima.ordenes.length} orden(es) etiquetadas ({ultima.ordenes.map(o => o.orden).join(', ')}).
      {ultima.numero ? <> Ya llevan la etiqueta «{ultima.numero}».</> : <> Cuando subas el Excel a la web de iD, escribí acá el número que te da y se agrega como etiqueta a esas órdenes.</>}</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input aria-label="Número de pedido de iD" inputMode="numeric" placeholder="Ej.: 00002616" value={texto} disabled={ocupado} onChange={e => setTexto(e.target.value)} style={{ width: 160 }} />
      <button className="btn-primary" style={{ background: '#6366f1' }} disabled={!numero || ocupado} onClick={() => void agregar()}>{ocupado ? 'Etiquetando…' : 'Agregar número como etiqueta'}</button>
    </div>
    {texto.trim() && !numero && <p style={{ color: '#fcd34d', margin: '4px 0' }}>Escribí solo el número, como lo da iD (por ejemplo 00002616).</p>}
    {res && <div role="status">
      {res.ok.length > 0 && <p style={{ color: '#86efac', margin: '4px 0' }}>✅ Etiqueta «{res.numero}» agregada: {res.ok.join(', ')}.</p>}
      {res.sinPermiso
        ? <p role="alert" style={{ color: '#fda4af', margin: '4px 0' }}>No se etiquetó: falta el permiso <strong>write_orders</strong> en la app de Shopify.</p>
        : res.fallidas.length > 0 && <p role="alert" style={{ color: '#fda4af', margin: '4px 0' }}>No se pudo etiquetar: {res.fallidas.map(f => `${f.orden} (${f.error})`).join(', ')}. Etiquetalas a mano.</p>}
    </div>}
  </div>;
}
