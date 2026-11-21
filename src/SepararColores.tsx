// Target — separar por colores lo que ya se cargó como un solo producto (21-nov-2026, gax).
// Lógica en utils/coloresTarget.ts. Lee Shopify al abrir; escribe solo después de confirmar.
import { useMemo, useState } from 'react';
import { shopifyGraphQL } from './utils/shopify';
import { botonChico, botonPrincipal, inputSt } from './utils/entregasUi';
import {
  ejecutarSepararColores, leerGrupoColores, nombreBase, planSepararColores, textoPaso,
  type GrupoColores, type ResultadoColores,
} from './utils/coloresTarget';
import { nombreColor } from './utils/cargaTarget';
import type { Gql } from './utils/confirmarStock';

const VERDE = '#34d399', NARANJA = '#fb923c', ROJO = '#f87171';
const leerN = (x: string) => (/^\s*\d+\s*$/.test(x) ? Number(x) : NaN);

/** Un artículo ya cargado: lee Shopify, se escriben los colores y se confirma. */
function SepararUno({ codigo, descripcion, gql, onCerrar }: { codigo: string; descripcion: string; gql: Gql; onCerrar: () => void }) {
  const [grupo, setGrupo] = useState<GrupoColores | null>(null);
  const [error, setError] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [escribiendo, setEscribiendo] = useState(false);
  const [base, setBase] = useState('');
  const [filas, setFilas] = useState<{ color: string; cant: string }[]>([]);
  const [resultado, setResultado] = useState<ResultadoColores | null>(null);
  async function leer() {
    setLeyendo(true); setError(''); setResultado(null);
    try {
      const g = await leerGrupoColores(codigo, gql);
      setGrupo(g);
      setBase(nombreBase(g));
      // Los colores que ya existen vienen en la lista; si no hay ninguno, una fila vacía.
      const ya = g.miembros.filter((m) => m.color).map((m) => ({ color: nombreColor(m.color), cant: String(m.disponible ?? 0) }));
      setFilas(ya.length ? ya : [{ color: '', cant: '' }, { color: '', cant: '' }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'No pude leer Shopify.'); }
    setLeyendo(false);
  }
  const plan = useMemo(() => (grupo ? planSepararColores(grupo, filas.map((f) => ({ color: f.color, cantidad: leerN(f.cant) })), base, descripcion) : null), [grupo, filas, base, descripcion]);
  const suma = filas.reduce((s, f) => s + (Number.isFinite(leerN(f.cant)) ? leerN(f.cant) : 0), 0);
  const total = grupo ? grupo.miembros.reduce((s, m) => s + Math.max(0, m.disponible ?? 0), 0) : 0;
  async function confirmar() {
    if (!plan || plan.error || !grupo) return;
    const texto = `Separar ${codigo} por colores en Shopify (DEPOSITO MARTINEZ):\n\n${plan.pasos.map((p) => `• ${textoPaso(p)}`).join('\n')}${plan.avisos.length ? `\n\nOjo:\n${plan.avisos.map((a) => `• ${a}`).join('\n')}` : ''}\n\n¿Confirmás?`;
    if (!confirm(texto)) return;
    setEscribiendo(true);
    try {
      const r = await ejecutarSepararColores(plan, grupo, { gql, clave: () => crypto.randomUUID() });
      setResultado(r);
      if (r.hecho.length) setGrupo(null);
    } catch (e) { setResultado({ ok: false, hecho: [], faltan: [e instanceof Error ? e.message : 'error'] }); }
    setEscribiendo(false);
  }
  const ocupado = leyendo || escribiendo;
  return (
    <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>🎨 {codigo}</strong> <span style={{ opacity: 0.8 }}>{descripcion}</span>
        <button style={{ ...botonChico, marginLeft: 'auto' }} disabled={escribiendo} onClick={onCerrar}>Cerrar</button>
      </div>
      {!grupo && !resultado && <div style={{ marginTop: 6 }}>
        <button style={botonChico} disabled={ocupado} onClick={leer}>{leyendo ? 'Leyendo Shopify…' : 'Leer cómo está en Shopify'}</button>
      </div>}
      {error && <div style={{ color: ROJO, marginTop: 6 }}>{error}</div>}
      {grupo && <>
        <div style={{ marginTop: 6, fontSize: '0.88rem' }}>
          Hoy en Shopify ({grupo.miembros.length ? `${total} u. disponibles en Martínez` : 'nada'}):
          <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
            {grupo.miembros.map((m) => <li key={m.id}>«{m.titulo}» · SKU {m.sku || '—'} · {m.disponible ?? 'sin alta'} u.{m.comprometido ? ` (+${m.comprometido} vendidas sin preparar)` : ''}</li>)}
          </ul>
        </div>
        <div style={{ marginTop: 6 }}>
          Nombre (se le agrega el color): <input value={base} disabled={ocupado} onChange={(e) => setBase(e.target.value)} style={{ ...inputSt, width: 'min(360px, 100%)' }} />
        </div>
        <div style={{ opacity: 0.75, fontSize: '0.8rem', marginTop: 4 }}>El primer color nuevo se queda con el producto que ya existe (fotos y ventas incluidas); los demás se crean con el mismo precio y costo.</div>
        {filas.map((f, i) => {
          const n = leerN(f.cant);
          return (
            <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
              <input value={f.color} disabled={ocupado} placeholder="Color (ej. Negro)" aria-label={`Color ${i + 1}`}
                onChange={(e) => setFilas(filas.map((g, j) => (j === i ? { ...g, color: e.target.value } : g)))}
                style={{ ...inputSt, width: 150, borderColor: f.color.trim() ? undefined : NARANJA }} />
              <input value={f.cant} disabled={ocupado} inputMode="numeric" aria-label={`Unidades de ${f.color || `color ${i + 1}`}`}
                onChange={(e) => setFilas(filas.map((g, j) => (j === i ? { ...g, cant: e.target.value } : g)))} onFocus={(e) => e.target.select()}
                style={{ ...inputSt, width: 56, borderColor: Number.isFinite(n) ? undefined : ROJO }} />
              <span>u.</span>
              {filas.length > 1 && <button style={{ ...botonChico, padding: '1px 8px' }} disabled={ocupado} onClick={() => setFilas(filas.filter((_, j) => j !== i))}>Quitar</button>}
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <button style={{ ...botonChico, padding: '1px 10px' }} disabled={ocupado} onClick={() => setFilas([...filas, { color: '', cant: '' }])}>＋ Agregar color</button>
          <span style={{ color: suma === total ? VERDE : NARANJA, fontWeight: 600 }}>
            Suman {suma} de {total} u.{suma === total ? ' ✓' : suma < total ? ` · faltan ${total - suma}` : ` · sobran ${suma - total}`}
          </span>
        </div>
        {plan && !plan.error && <div style={{ marginTop: 8, fontSize: '0.88rem' }}>
          <strong>Así va a quedar:</strong>
          <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>{plan.pasos.map((p, i) => <li key={i}>{textoPaso(p)}</li>)}</ul>
        </div>}
        {plan && plan.avisos.length > 0 && <ul style={{ margin: '6px 0 0 18px', padding: 0, color: NARANJA, fontSize: '0.85rem' }}>{plan.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        {plan?.error && <div style={{ color: NARANJA, marginTop: 6 }}>{plan.error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button style={{ ...botonPrincipal, opacity: plan && !plan.error && !ocupado ? 1 : 0.5 }} disabled={!plan || !!plan.error || ocupado} onClick={confirmar}>
            {escribiendo ? 'Separando…' : '🎨 Separar por colores en Shopify'}</button>
          <button style={botonChico} disabled={ocupado} onClick={leer}>Leer de nuevo</button>
        </div>
      </>}
      {resultado && <div style={{ marginTop: 8, fontSize: '0.88rem' }}>
        <div style={{ color: resultado.ok ? VERDE : NARANJA, fontWeight: 600 }}>{resultado.ok ? '✅ Listo: quedó separado por colores.' : resultado.hecho.length ? '⚠️ Quedó una parte: lo que falta, hacelo a mano.' : '⚠️ No se cambió nada.'}</div>
        {resultado.hecho.length > 0 && <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>{resultado.hecho.map((h, i) => <li key={i}>{h}</li>)}</ul>}
        {resultado.faltan.length > 0 && <ul style={{ margin: '2px 0 0 18px', padding: 0, color: NARANJA }}>{resultado.faltan.map((h, i) => <li key={i}>{h}</li>)}</ul>}
        {!resultado.hecho.length && <button style={{ ...botonChico, marginTop: 6 }} onClick={leer}>Leer de nuevo</button>}
      </div>}
    </div>
  );
}

/** Lista de artículos de Target ya cargados de una entrega, con el botón para separar cada uno. */
export function SepararColores({ articulos, gql = shopifyGraphQL as Gql }: { articulos: { codigo: string; descripcion: string }[]; gql?: Gql }) {
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  if (!articulos.length) return null;
  const art = articulos.find((a) => a.codigo === elegido);
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)' }}>
      <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontWeight: 'bold', fontSize: '0.95rem' }} onClick={() => setAbierto(!abierto)}>
        {abierto ? '▾' : '▸'} 🎨 ¿Algo vino en varios colores? Separarlo (ya cargado)
      </button>
      {abierto && <>
        <div style={{ opacity: 0.75, fontSize: '0.8rem', marginTop: 4 }}>
          Si se cargó como un solo producto y en realidad vino en varios colores: elegí el artículo, escribí cada color con sus unidades
          (tienen que sumar lo que hay en Martínez) y la app lo separa en un producto por color. No hay que borrar nada ni volver a cargar.
        </div>
        {!art && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {articulos.map((a) => <button key={a.codigo} style={botonChico} onClick={() => setElegido(a.codigo)} title={a.descripcion}>{a.codigo} · {a.descripcion.slice(0, 40)}</button>)}
        </div>}
        {art && <SepararUno key={art.codigo} codigo={art.codigo} descripcion={art.descripcion} gql={gql} onCerrar={() => setElegido(null)} />}
      </>}
    </div>
  );
}
