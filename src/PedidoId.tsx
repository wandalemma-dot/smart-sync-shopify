import { useMemo, useState } from 'react';
import { idsOrdenes, ordenesPendientesId, marcaDePlantilla, leerPendientesId, leerPlantillaId, cruzarPedido, generarExcelPedido, detectarPedidosMixtos, marcaPedidoId } from './utils/pedidoId';
import type { PlantillaId, PendientesSucursal, OrdenesPendientesId } from './utils/pedidoId';
import ExclusionPedidoId from './ExclusionPedidoId';
import { entranteDe, textoEntrante } from './utils/entrantesId';
import { leerEntrantes, type Entrantes } from './utils/leerEntrantes';
import { fechaAr } from './utils/entregasUi';
import NumeroPedidoId, { guardarUltimaDescarga, leerUltimaDescarga, type UltimaDescarga } from './NumeroPedidoId';
import { etiquetarOrdenes, etiquetasPedidoId, hoyArgentina, ordenesAEtiquetar, type ResultadoEtiquetas } from './utils/etiquetaPedidoId';

export default function PedidoId() {
  // Por defecto las órdenes se leen directo de Shopify, por marca (25-nov-2026, gax); el CSV queda de respaldo.
  const [usarCsv, setUsarCsv] = useState(false);
  const [csv, setCsv] = useState<File | null>(null);
  const [marca, setMarca] = useState<'Converse' | 'Le Coq' | null>(null);
  const [marcaAuto, setMarcaAuto] = useState(false);
  const [salteadas, setSalteadas] = useState<OrdenesPendientesId | null>(null);
  const [excel, setExcel] = useState<File | null>(null);
  const [plantilla, setPlantilla] = useState<PlantillaId | null>(null);
  const [pendientes, setPendientes] = useState<(PendientesSucursal & { ordenes: number }) | null>(null);
  const [omitidas, setOmitidas] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const [revisado, setRevisado] = useState(false);
  const [entrantes, setEntrantes] = useState<Entrantes | null>(null);
  const [errorEntrantes, setErrorEntrantes] = useState('');
  const [etiquetas, setEtiquetas] = useState<ResultadoEtiquetas & { fecha: string } | null>(null);
  const [etiquetando, setEtiquetando] = useState(false);
  // Órdenes etiquetadas en la última descarga: ahí va después el número de pedido de iD (19-nov-2026).
  const [ultima, setUltima] = useState<UltimaDescarga | null>(() => leerUltimaDescarga());
  const cambiarUltima = (d: UltimaDescarga | null) => { setUltima(d); guardarUltimaDescarga(d); };
  const reset = () => { setSalteadas(null); setEtiquetas(null); setEntrantes(null); setErrorEntrantes(''); setPendientes(null); setPlantilla(null); setOmitidas([]); setRevisado(false); setError(''); setEstado(''); };
  const resultado = useMemo(() => pendientes && plantilla
    ? cruzarPedido(pendientes.lineas, plantilla, pendientes.avisos, pendientes.ordenes, omitidas) : null, [pendientes, plantilla, omitidas]);
  const mixtos = useMemo(() => detectarPedidosMixtos(pendientes?.lineas || [], pendientes?.etiquetadas || []), [pendientes]);
  const ordenesMixtas = new Set(mixtos.map(o => o.orden));
  // Órdenes que quedan etiquetadas «pedido id» al descargar (18-nov-2026, gax): solo las que se piden completas.
  const aEtiquetar = useMemo(() => pendientes && plantilla ? ordenesAEtiquetar(pendientes.lineas, plantilla, omitidas) : null, [pendientes, plantilla, omitidas]);
  async function elegirPlantilla(f: File | null) {
    setExcel(f);
    if (!f) return;
    try {
      const m = marcaDePlantilla(leerPlantillaId(new Uint8Array(await f.arrayBuffer())));
      if (m) { setMarca(m); setMarcaAuto(true); }
    } catch { /* el error de la plantilla se muestra al armar */ }
  }
  function seleccionar(id: string, incluir: boolean) {
    setOmitidas(actual => incluir ? actual.filter(x => x !== id) : [...new Set([...actual, id])]);
    setRevisado(false);
  }
  async function armar() {
    if (!excel || (usarCsv ? !csv : !marca)) return;
    reset(); setOcupado(true);
    // Lo que ya está en camino (Trello), en paralelo con Shopify. Si falla, el pedido se arma igual.
    let enCamino: Promise<void> | null = null;
    try {
      const p = leerPlantillaId(new Uint8Array(await excel.arrayBuffer()));
      const delaPlantilla = marcaDePlantilla(p);
      if (!usarCsv && marca && delaPlantilla && delaPlantilla !== marca) throw new Error(`La plantilla parece de ${delaPlantilla} y elegiste ${marca}. Elegí la marca de la plantilla.`);
      enCamino = leerEntrantes().then(setEntrantes, (e: unknown) => setErrorEntrantes(`No pude leer lo que está por entrar: ${(e as Error)?.message || e}. La columna «Entrantes» queda vacía.`));
      let ids: string[];
      if (usarCsv && csv) ids = idsOrdenes(await csv.text());
      else {
        setEstado(`Buscando en Shopify las órdenes de ${marca} pendientes en iD…`);
        const r = await ordenesPendientesId(marca!, n => setEstado(`Buscando en Shopify las órdenes de ${marca} pendientes en iD… ${n} encontradas`));
        setSalteadas(r);
        ids = r.ids;
        if (!ids.length) { await enCamino; setEstado(`No hay órdenes de ${marca} pagadas y sin preparar en iD (sin «pedido id» ni «solucionar»). No hay nada para pedir.`); return; }
      }
      setEstado(`Consultando 0 de ${ids.length} órdenes…`);
      const pendientes = await leerPendientesId(ids, n => setEstado(`Consultando ${n} de ${ids.length} órdenes…`));
      await enCamino;
      setPlantilla(p); setPendientes({ ...pendientes, ordenes: ids.length });
      setEstado('Revisión lista. El Excel todavía no se envió a iD.');
    } catch (e: any) { await enCamino?.catch(() => undefined); setError(e.message || 'No se pudo armar el pedido.'); setEstado(''); }
    finally { setOcupado(false); }
  }
  async function descargar() {
    if (!plantilla || !resultado || !revisado || etiquetando) return;
    const fecha = hoyArgentina();
    const lista = aEtiquetar?.etiquetar || [];
    if (lista.length && !confirm(`Se descarga la plantilla y, en Shopify, se agregan las etiquetas «${etiquetasPedidoId(fecha).join('» y «')}» a ${lista.length} orden(es): ${lista.map(o => o.orden).join(', ')}. Esas órdenes no vuelven a aparecer en el próximo armado. ¿Confirmás?`)) return;
    try {
      const bytes = generarExcelPedido(plantilla, resultado);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = `Pedido_iD_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) { setError(e.message); return; }
    if (!lista.length) return;
    setEtiquetando(true); setEtiquetas(null);
    try {
      const r = await etiquetarOrdenes(lista, etiquetasPedidoId(fecha));
      setEtiquetas({ ...r, fecha });
      if (r.ok.length) cambiarUltima({ fecha, ordenes: lista.filter(o => r.ok.includes(o.orden)) });
    }
    catch (e: any) { setEtiquetas({ ok: [], fallidas: lista.map(o => ({ orden: o.orden, error: e?.message?.slice(0, 160) || 'error' })), fecha }); }
    finally { setEtiquetando(false); }
  }
  const filas = resultado?.filas || [];
  const faltantes = filas.filter(f => f.faltante > 0 || f.motivo);
  const cantidad = filas.reduce((n, f) => n + f.pedir, 0);
  const exclusiones = pendientes?.exclusiones || [];
  const ordenesExcluidas = new Set(exclusiones.map(e => e.orden)).size;
  const avisosEnTabla = new Set(exclusiones.map(e => e.aviso));
  const otrosAvisos = (resultado?.avisos || []).filter(a => !avisosEnTabla.has(a));
  const entranteFila = (f: { codigo: string; talleProveedor: string }) => entrantes ? entranteDe(entrantes.mapa, f.codigo, f.talleProveedor) : null;
  const conEntrantes = filas.filter(f => entranteFila(f));
  return <section className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #6366f1' }}>
    <h2 style={{ color: '#a5b4fc', marginTop: 0 }}>📋 Armado de pedido iD</h2>
    <p>Órdenes pendientes → revisión por artículo y talle → Excel de iD completo.</p>
    <p style={{ opacity: .8 }}>Incluye únicamente cantidades pendientes asignadas a iD en órdenes abiertas y pagadas. Excluye etiquetas «pedido id» y «solucionar». Conserva Martínez. No envía pedidos. Al descargar, etiqueta «pedido id» y la fecha en las órdenes que se piden completas; después podés sumar el número de pedido de iD.</p>
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      <label className="dropzone" style={{ flex: 1, minWidth: 240 }}>1. Plantilla actual de iD (.xlsx)
        <input aria-label="Plantilla de iD" type="file" accept=".xlsx" disabled={ocupado} onChange={e => { reset(); elegirPlantilla(e.target.files?.[0] || null); }} />
      </label>
      {usarCsv
        ? <label className="dropzone" style={{ flex: 1, minWidth: 240 }}>2. Export de órdenes (.csv)
            <input aria-label="Export de órdenes" type="file" accept=".csv" disabled={ocupado} onChange={e => { reset(); setCsv(e.target.files?.[0] || null); }} />
          </label>
        : <div style={{ flex: 1, minWidth: 240, border: '1px dashed #6366f1', borderRadius: 8, padding: 12 }}>
            <div>2. Órdenes: se leen directo de Shopify, de la marca</div>
            <div role="radiogroup" aria-label="Marca del pedido" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {(['Le Coq', 'Converse'] as const).map(m => <button key={m} type="button" role="radio" aria-checked={marca === m} disabled={ocupado}
                onClick={() => { reset(); setMarca(m); setMarcaAuto(false); }}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #818cf8', background: marca === m ? '#6366f1' : 'transparent', color: 'inherit', fontWeight: marca === m ? 'bold' : undefined }}>{marca === m ? '✓ ' : ''}{m}</button>)}
            </div>
            {marca && marcaAuto && <div style={{ fontSize: '.8rem', opacity: .8, marginTop: 6 }}>Elegida según los códigos de la plantilla.</div>}
          </div>}
    </div>
    <p style={{ fontSize: '.85rem', opacity: .85 }}>{usarCsv
      ? <>Se usan solo las órdenes del CSV. <button type="button" disabled={ocupado} onClick={() => { reset(); setUsarCsv(false); setCsv(null); }} style={{ background: 'none', border: 'none', color: '#a5b4fc', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>Volver a leerlas de Shopify</button></>
      : <>Busca las órdenes de la marca con algo sin preparar en iD, pagadas y sin «pedido id» ni «solucionar» (lo mismo que filtrabas en Pedidos para exportar). <button type="button" disabled={ocupado} onClick={() => { reset(); setUsarCsv(true); }} style={{ background: 'none', border: 'none', color: '#a5b4fc', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>Prefiero subir un export de órdenes (.csv)</button></>}</p>
    <p>Podés procesar una plantilla por vez. Los artículos de otra plantilla aparecerán en «Revisar».</p>
    <button className="btn-primary" style={{ background: '#6366f1', marginTop: 12 }} disabled={!excel || (usarCsv ? !csv : !marca) || ocupado} onClick={armar}>{ocupado ? 'Consultando Shopify…' : 'Armar y revisar pedido'}</button>
    <p role="status">{estado}</p>
    {salteadas && (salteadas.pedidoId + salteadas.solucionar + salteadas.sinPagar) > 0 && <p style={{ fontSize: '.85rem', opacity: .8 }}>No se tienen en cuenta: {[
      salteadas.pedidoId && `${salteadas.pedidoId} con «pedido id» (ya pedidas)`,
      salteadas.solucionar && `${salteadas.solucionar} con «solucionar»`,
      salteadas.sinPagar && `${salteadas.sinPagar} sin pagar del todo`,
    ].filter(Boolean).join(' · ')}.</p>}
    {error && <p role="alert" style={{ color: '#fda4af', whiteSpace: 'pre-wrap' }}>{error}</p>}
    {ultima && !etiquetando && <NumeroPedidoId key={`${ultima.fecha}|${ultima.ordenes.map(o => o.ordenId).join(',')}`} ultima={ultima} onCambio={cambiarUltima} />}
    {resultado && <>
      <h3>{resultado.ordenes} órdenes consultadas · {cantidad} unidades de compra propuestas · {faltantes.length} renglones con faltantes o revisión · {ordenesExcluidas} órdenes con exclusiones</h3>
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
        <p style={{ opacity: .85 }}>La selección vale para este análisis. No cambia etiquetas ni preparaciones en Shopify. Solo se revisan las órdenes de este armado y sus artículos pendientes en iD.</p>
      </div>}
      {omitidas.length > 0 && <p style={{ color: '#e9d5ff' }}>{omitidas.length} artículo(s) excluido(s) manualmente de esta compra. Podés volver a tildarlos en los pedidos mixtos.</p>}
      {plantilla?.previas ? <p style={{ color: '#fcd34d' }}>La plantilla tenía {plantilla.previas} cantidades cargadas. La descarga las reemplaza por este pedido nuevo; no las suma.</p> : null}
      {faltantes.length > 0 && <p role="alert" style={{ color: '#fda4af', fontWeight: 'bold' }}>⚠ Hay artículos que no se pueden cubrir por completo. Revisá los renglones señalados y sus órdenes antes de descargar.</p>}
      <p>En packs, «Pedir» y «Disponible» son packs; «Necesitás» y «Faltan» son pares. +50 se toma como disponibilidad máxima de 50 en esta propuesta.</p>
      {exclusiones.length > 0 && <p style={{ color: '#fbcfe8' }}>Las órdenes con exclusiones aparecen primero, en rosa, dentro de esta misma lista. Podés analizarlas por separado para ver sus artículos y motivos. Su revisión no agrega cantidades a la compra.</p>}
      <div style={{ background: 'rgba(56,189,248,.1)', border: '1px solid #38bdf8', borderRadius: 8, padding: '10px 14px', margin: '12px 0' }}>
        <strong>🚚 Entrantes:</strong> lo que ya pediste a iD y todavía no llegó, por talle, según las notas de las listas de pedidos pendientes de Trello (pedido menos lo facturado y lo pintado en verde). Solo informa: no cambia «Pedir».
        {entrantes && <div style={{ marginTop: 6 }}>{entrantes.notas} nota(s) con pendientes · {conEntrantes.length} renglón(es) de este pedido ya tienen unidades en camino{conEntrantes.length > 0 && ': están en celeste, revisá si hace falta volver a pedirlas'}.</div>}
        {errorEntrantes && <div style={{ color: '#fcd34d', marginTop: 6 }}>{errorEntrantes}</div>}
        {entrantes?.avisos.map((a, i) => <div key={i} style={{ color: '#fcd34d', marginTop: 6 }}>{a}</div>)}
      </div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
        <thead><tr>{['Artículo / código', 'Talle tienda → iD', 'Órdenes', 'Entrantes', 'Necesitás', 'Disponible', 'Pedir', 'Faltan', 'Estado'].map(t => <th key={t} style={{ textAlign: 'left', padding: 10 }}>{t}</th>)}</tr></thead>
        <tbody>{plantilla && exclusiones.map(e => <ExclusionPedidoId key={e.aviso} exclusion={e} plantilla={plantilla} />)}{filas.map((f, i) => { const en = entranteFila(f); return <tr key={i} style={{ background: f.ordenes.some(o => ordenesMixtas.has(o)) ? 'rgba(168,85,247,.17)' : f.motivo ? 'rgba(245,158,11,.15)' : en ? 'rgba(56,189,248,.12)' : 'transparent', borderTop: '1px solid #475569' }}>
          <td style={{ padding: 10 }}>{f.titulo}<br/><strong>{f.codigo}</strong>{f.pack > 1 && <div>Pack ×{f.pack} · sobrante previsto: {f.excedente} pares</div>}</td>
          <td>{f.talle || 'Único'} → {f.talleProveedor}</td><td>{f.ordenes.map((o, j) => <span key={o}>{j > 0 && ', '}{o}{ordenesMixtas.has(o) && <strong style={{ color: '#e9d5ff' }}> (mixto)</strong>}</span>)}</td>
          <td style={{ color: en ? '#7dd3fc' : undefined }}>{en ? <><strong>{textoEntrante(en)}</strong>{en.notas.map(n => <div key={n.pedidoId} style={{ fontSize: '.75rem', opacity: .8 }}>{n.nombre} ({fechaAr(n.fecha)}): {n.cantidad ?? `hasta ${n.hasta}`}</div>)}</> : entrantes ? '0' : '—'}</td><td>{f.necesaria}</td><td>{f.tope ? '+' : ''}{f.disponible}</td><td><strong>{f.pedir}</strong></td><td>{f.faltante}</td><td style={{ color: f.motivo ? '#fcd34d' : undefined }}>{f.motivo || 'Listo para pedir'}</td>
        </tr>; })}</tbody>
      </table></div>
      {!filas.length && <p>No hay artículos incluidos en esta compra. Revisá los motivos y el análisis separado de las órdenes excluidas.</p>}
      {otrosAvisos.length > 0 && <details open><summary>Avisos de órdenes ({otrosAvisos.length})</summary><ul>{otrosAvisos.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
      <label style={{ display: 'block', margin: '20px 0' }}><input type="checkbox" checked={revisado} onChange={e => setRevisado(e.target.checked)} /> Revisé cantidades, packs, talles, faltantes y pedidos mixtos. Descargar solo lo que figura en «Pedir».</label>
      {aEtiquetar && <div style={{ background: 'rgba(99,102,241,.12)', border: '1px solid #818cf8', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
        <strong>🏷️ Etiqueta en Shopify:</strong> al descargar, {aEtiquetar.etiquetar.length
          ? <>se agrega «{etiquetasPedidoId(hoyArgentina()).join('» y «')}» a {aEtiquetar.etiquetar.length} orden(es): {aEtiquetar.etiquetar.map(o => o.orden).join(', ')}.</>
          : 'ninguna orden se pide completa, así que no se etiqueta ninguna.'}
        {aEtiquetar.noEtiquetar.length > 0 && <details style={{ marginTop: 6 }}><summary style={{ color: '#fcd34d' }}>No se etiquetan {aEtiquetar.noEtiquetar.length} orden(es): les queda algo sin pedir en este Excel</summary>
          <ul style={{ margin: '6px 0 0' }}>{aEtiquetar.noEtiquetar.map(o => <li key={o.orden}><strong>{o.orden}</strong>: {o.motivos.join(' · ')}</li>)}</ul>
          <p style={{ margin: '6px 0 0', opacity: .85 }}>Siguen apareciendo en el próximo armado. Si ya las resolviste, etiquetalas a mano.</p>
        </details>}
      </div>}
      <button className="btn-primary" style={{ background: '#6366f1' }} disabled={!revisado || !cantidad || etiquetando} onClick={() => void descargar()}>{etiquetando ? 'Etiquetando órdenes en Shopify…' : aEtiquetar?.etiquetar.length ? `Descargar plantilla y etiquetar ${aEtiquetar.etiquetar.length} orden(es)` : 'Descargar plantilla de pedido iD'}</button>
      {etiquetas && <div role="status" style={{ marginTop: 12 }}>
        {etiquetas.ok.length > 0 && <p style={{ color: '#86efac', margin: '4px 0' }}>✅ Etiquetadas «pedido id» y «{etiquetas.fecha}»: {etiquetas.ok.join(', ')}.</p>}
        {etiquetas.sinPermiso
          ? <p role="alert" style={{ color: '#fda4af', margin: '4px 0' }}>No se etiquetó ninguna orden: falta el permiso <strong>write_orders</strong> en la app de Shopify (Configuración → Apps → Desarrollar apps → la app → Admin API). La plantilla se descargó igual; etiquetalas a mano.</p>
          : etiquetas.fallidas.length > 0 && <p role="alert" style={{ color: '#fda4af', margin: '4px 0' }}>No se pudo etiquetar: {etiquetas.fallidas.map(f => `${f.orden} (${f.error})`).join(', ')}. Etiquetalas a mano.</p>}
      </div>}
      <p style={{ opacity: .7 }}>Revisá el Excel antes de subirlo al proveedor. Si descargás de nuevo, las órdenes ya etiquetadas no cambian; si volvés a armar el pedido, no aparecen.</p>
    </>}
  </section>;
}
