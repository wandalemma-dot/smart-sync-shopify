// ============================================================================
// PESTAÑA RECUPERAR — recrear productos borrados para las transferencias viejas
// ----------------------------------------------------------------------------
// Wanda pega el texto que copia de la pantalla de la transferencia de Shopify
// (título / talle / SKU, de a tres líneas), escribe las cantidades a mano, y la
// app recrea los productos CON EL MISMO SKU para que la transferencia se
// vuelva a enganchar.
//
// Se crean como BORRADOR y en $0: son productos de recuperación. Un producto
// en $0 publicado se podría vender a $0; en borrador, no.
// ============================================================================
import { useState, useEffect } from 'react';
import { parseRecrear, listarSucursales, crearProductosRecuperados } from './utils/recrearProductos';
import type { ParseRecrear, Sucursal } from './utils/recrearProductos';

// Ojo: la línea del medio va VACÍA cuando es un accesorio (sin talle).
const EJEMPLO = `Bermuda Quiksilver Slim Basic Blue Azul Claro
33
2221110009!20!33
Gorro Champion Bordo

7795456688744`;

export default function Recuperar() {
  const [texto, setTexto] = useState('');
  const [res, setRes] = useState<ParseRecrear | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [vendor, setVendor] = useState('');
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [locId, setLocId] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [creando, setCreando] = useState(false);
  const [hechos, setHechos] = useState(0);
  const [listo, setListo] = useState<string | null>(null);

  useEffect(() => {
    listarSucursales()
      .then((s) => { setSucursales(s); if (s.length) setLocId(s[0].id); })
      .catch(() => { /* si falla, se crea sin stock */ });
  }, []);

  const leer = () => {
    const r = parseRecrear(texto);
    setRes(r);
    setListo(null);
    // Sugerimos la marca a partir de la segunda palabra del título
    // ("Bermuda Quiksilver ..." -> Quiksilver). Wanda lo puede corregir.
    if (!vendor && r.productos.length) {
      const palabras = r.productos[0].titulo.split(/\s+/);
      if (palabras.length > 1) setVendor(palabras[1]);
    }
  };

  const crear = async () => {
    if (!res || !res.productos.length) return;
    setCreando(true); setListo(null); setHechos(0);
    try {
      const r = await crearProductosRecuperados(
        res.productos, { vendor, locationId: locId || null, cantidades }, setHechos,
      );
      setListo(`Creados ${r.creados} · fallidos ${r.fallidos}` + (r.errores.length ? ` · ${r.errores.slice(0, 2).join(' | ')}` : ''));
      setConfirm(false);
    } catch (e: any) {
      alert('Error creando: ' + e.message);
    } finally {
      setCreando(false);
    }
  };

  const totalTalles = res ? res.productos.reduce((s, p) => s + p.talles.length, 0) : 0;
  const totalUnidades = res ? res.lineas.reduce((s, l) => s + (Number(cantidades[l.sku]) || 0), 0) : 0;
  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', position: 'sticky', top: 0, background: '#1f2937' };
  const td: React.CSSProperties = { padding: '6px 10px' };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>♻️ Recuperar productos borrados</h2>
      <p style={{ fontSize: '0.9rem', opacity: 0.85, marginTop: 0 }}>
        Para las transferencias viejas que apuntan a productos que ya no existen. Copiá el texto de la
        pantalla de la transferencia y pegalo acá: recreo los productos <strong>con el mismo SKU</strong>,
        que es lo único que hace que la transferencia se vuelva a enganchar.
      </p>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={`Pegá acá, tal cual lo copiás (título, talle y SKU):\n\n${EJEMPLO}`}
        rows={8}
        style={{
          width: '100%', padding: '10px', borderRadius: 8, fontFamily: 'monospace', fontSize: '0.85rem',
          border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: 'inherit',
        }}
      />
      <button className="btn-primary" style={{ background: '#3b82f6', width: '100%', marginTop: '0.6rem' }}
        onClick={leer} disabled={!texto.trim()}>
        🔍 Leer lo pegado
      </button>

      {res && (
        <div style={{ marginTop: '1.2rem' }}>
          <div style={{ fontSize: '0.9rem', marginBottom: '0.7rem' }}>
            📦 <strong>{res.productos.length}</strong> productos · <strong>{totalTalles}</strong> talles
            {totalUnidades > 0 && <> · <strong>{totalUnidades}</strong> unidades</>}
            {res.sinTalleCount > 0 && <> · <span style={{ color: '#60a5fa' }}><strong>{res.sinTalleCount}</strong> sin talle (accesorios)</span></>}
            {res.ignoradas.length > 0 && <> · <span style={{ opacity: 0.7 }}>{res.ignoradas.length} líneas que no entendí</span></>}
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.8rem' }}>
            <div>
              <label style={{ fontSize: '0.8rem', opacity: 0.85, display: 'block' }}>Marca (Proveedor)</label>
              <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)}
                placeholder="Quiksilver"
                style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: 'inherit' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', opacity: 0.85, display: 'block' }}>Sucursal donde va el stock</label>
              <select value={locId} onChange={(e) => setLocId(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'var(--bg-color)', color: 'white' }}>
                {sucursales.length === 0 && <option value="">(no pude leer las sucursales)</option>}
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          </div>

          <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Producto</th>
                  <th style={th}>Variantes</th>
                  <th style={{ ...th, textAlign: 'center' }}>Talle</th>
                  <th style={th}>SKU</th>
                  <th style={{ ...th, textAlign: 'center' }}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {res.productos.map((p) => p.talles.map((t, j) => (
                  <tr key={t.sku} style={{ borderTop: j === 0 ? '2px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={td}>{j === 0 ? p.titulo : ''}</td>
                    <td style={{ ...td, textAlign: 'center', opacity: 0.85 }}>{j === 0 ? (p.sinTalle ? '1' : p.talles.length) : ''}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 'bold' }}>
                      {p.sinTalle ? <span style={{ color: '#60a5fa', fontWeight: 'normal', fontSize: '0.78rem' }}>sin talle</span> : t.talle}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.78rem', opacity: 0.9 }}>{t.sku}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <input type="number" min={0} value={cantidades[t.sku] ?? ''}
                        onChange={(e) => setCantidades({ ...cantidades, [t.sku]: Number(e.target.value) || 0 })}
                        style={{ width: 70, padding: '4px 6px', borderRadius: 5, textAlign: 'center',
                          border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'white' }} />
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.6rem' }}>
            Se crean como <strong>borrador</strong> y en <strong>$0</strong>. Es a propósito: así no se pueden
            vender por error mientras no tengan precio. Les ponés precio y los publicás desde Shopify.
            Los <strong>accesorios</strong> (gorros, medias, cartucheras) se crean <strong>sin variante de talle</strong>.
          </p>

          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            Revisé la lista y quiero <strong>&nbsp;crear estos productos&nbsp;</strong> en Shopify.
          </label>
          <button className="btn-primary"
            style={{ background: confirm ? '#8b5cf6' : '#6b7280', marginTop: '0.6rem' }}
            onClick={crear} disabled={!confirm || creando || res.productos.length === 0}>
            {creando ? <span className="loader"></span> : `♻️ Recrear ${res.productos.length} productos`}
          </button>
          {creando && hechos > 0 && <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>{hechos} de {res.productos.length}…</p>}
          {listo && <p style={{ marginTop: '0.7rem', color: '#a78bfa', fontWeight: 'bold' }}>✅ {listo}</p>}

          {res.ignoradas.length > 0 && (
            <details style={{ marginTop: '0.9rem', fontSize: '0.82rem' }}>
              <summary style={{ cursor: 'pointer', opacity: 0.8 }}>
                {res.ignoradas.length} líneas que no pude interpretar
              </summary>
              <pre style={{ fontSize: '0.75rem', opacity: 0.7, whiteSpace: 'pre-wrap' }}>{res.ignoradas.join('\n')}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
