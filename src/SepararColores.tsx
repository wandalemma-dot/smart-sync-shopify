// Target — separar por colores lo que ya se cargó como un solo producto (21-nov-2026, gax).
// Lógica en utils/coloresTarget.ts. Lee Shopify al abrir; escribe solo después de confirmar.
import { useEffect, useMemo, useRef, useState } from 'react';
import { shopifyGraphQL } from './utils/shopify';
import { botonChico, botonPrincipal, inputSt } from './utils/entregasUi';
import {
  ejecutarSepararColores, leerGrupoColores, nombreBase, planSepararColores, textoPaso,
  type GrupoColores, type PlanColores, type ResultadoColores,
} from './utils/coloresTarget';
import { nombreColor } from './utils/cargaTarget';
import type { Gql } from './utils/confirmarStock';

const VERDE = '#34d399', NARANJA = '#fb923c', ROJO = '#f87171';
const leerN = (x: string) => (/^\s*\d+\s*$/.test(x) ? Number(x) : NaN);

/** Lo que cada artículo le cuenta a la lista: si está listo para separar y cómo hacerlo. */
export interface EstadoUno { listo: boolean; vacio: boolean; pasos: string[]; ejecutar: () => Promise<ResultadoColores | null> }

/** Un artículo ya cargado: lee Shopify solo al abrirse, se escriben los colores y se confirma (este solo o todos juntos). */
function SepararUno({ codigo, descripcion, gql, onEstado, ocupadoAfuera }: {
  codigo: string; descripcion: string; gql: Gql; onEstado: (codigo: string, e: EstadoUno | null) => void; ocupadoAfuera: boolean;
}) {
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
  // Todos los artículos se abren juntos (24-nov-2026, gax: «es muy tedioso cerrar uno, después abrir otro»): cada uno lee solo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void leer(); }, []);
  const plan: PlanColores | null = useMemo(() => (grupo ? planSepararColores(grupo, filas.map((f) => ({ color: f.color, cantidad: leerN(f.cant) })), base, descripcion) : null), [grupo, filas, base, descripcion]);
  const sinColores = filas.every((f) => !f.color.trim() && !f.cant.trim());
  // Ya separado (los colores de Shopify suman lo mismo): no cuenta como pendiente.
  const yaEsta = !!plan?.error?.startsWith('Ya está así');
  const vacio = sinColores || yaEsta;
  // Con las filas vacías, igual se avisa lo que impide separar (no está en Shopify, tiene talles, etc.).
  const errorGrupo = grupo && sinColores ? planSepararColores(grupo, [], base || codigo, descripcion).error : undefined;
  const estructural = errorGrupo && errorGrupo !== 'Escribí al menos un color.' ? errorGrupo : '';
  const suma = filas.reduce((s, f) => s + (Number.isFinite(leerN(f.cant)) ? leerN(f.cant) : 0), 0);
  const total = grupo ? grupo.miembros.reduce((s, m) => s + Math.max(0, m.disponible ?? 0), 0) : 0;
  async function ejecutar(): Promise<ResultadoColores | null> {
    if (!plan || plan.error || !grupo) return null;
    setEscribiendo(true);
    let r: ResultadoColores;
    try {
      r = await ejecutarSepararColores(plan, grupo, { gql, clave: () => crypto.randomUUID() });
    } catch (e) { r = { ok: false, hecho: [], faltan: [e instanceof Error ? e.message : 'error'] }; }
    setResultado(r);
    if (r.hecho.length) setGrupo(null);
    setEscribiendo(false);
    return r;
  }
  async function confirmar() {
    if (!plan || plan.error || !grupo) return;
    const texto = `Separar ${codigo} por colores en Shopify (DEPOSITO MARTINEZ):\n\n${plan.pasos.map((p) => `• ${textoPaso(p)}`).join('\n')}${plan.avisos.length ? `\n\nOjo:\n${plan.avisos.map((a) => `• ${a}`).join('\n')}` : ''}\n\n¿Confirmás?`;
    if (!confirm(texto)) return;
    await ejecutar();
  }
  const ejecutarRef = useRef(ejecutar);
  ejecutarRef.current = ejecutar;
  const listo = !!plan && !plan.error && !resultado;
  const pasosTexto = plan && !plan.error ? [...plan.pasos.map(textoPaso), ...plan.avisos.map((a) => `Ojo: ${a}`)] : [];
  const clavePasos = pasosTexto.join('\n');
  useEffect(() => {
    onEstado(codigo, { listo, vacio, pasos: pasosTexto, ejecutar: () => ejecutarRef.current() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo, listo, vacio, clavePasos]);
  useEffect(() => () => onEstado(codigo, null), [codigo, onEstado]);
  const ocupado = leyendo || escribiendo || ocupadoAfuera;
  return (
    <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>🎨 {codigo}</strong> <span style={{ opacity: 0.8 }}>{descripcion}</span>
        {grupo && sinColores && !estructural && !resultado && <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>(vacío = vino en un solo color, no se toca)</span>}
        {yaEsta && !resultado && <span style={{ color: VERDE, fontSize: '0.8rem' }}>ya está separado ✓</span>}
      </div>
      {!grupo && !resultado && <div style={{ marginTop: 6 }}>
        <button style={botonChico} disabled={ocupado} onClick={leer}>{leyendo ? 'Leyendo Shopify…' : 'Leer de nuevo'}</button>
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
        {plan?.error && !vacio && <div style={{ color: NARANJA, marginTop: 6 }}>{plan.error}</div>}
        {estructural && <div style={{ color: NARANJA, marginTop: 6 }}>{estructural}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button style={{ ...botonPrincipal, opacity: plan && !plan.error && !ocupado ? 1 : 0.5 }} disabled={!plan || !!plan.error || ocupado} onClick={confirmar}>
            {escribiendo ? 'Separando…' : '🎨 Separar solo este'}</button>
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

/**
 * Todos los artículos de Target ya cargados de una entrega, abiertos a la vez (24-nov-2026, gax: «lo mejor es desplegar todos
 * los productos… es muy tedioso cerrar uno, después abrir otro»). Abajo, un solo botón separa todos los que están completos.
 */
export function SepararColores({ articulos, gql = shopifyGraphQL as Gql, abiertoInicial = false }: {
  articulos: { codigo: string; descripcion: string }[]; gql?: Gql; abiertoInicial?: boolean;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const [estados, setEstados] = useState<Record<string, EstadoUno>>({});
  const [separando, setSeparando] = useState(false);
  const [resumen, setResumen] = useState('');
  const onEstado = useMemo(() => (codigo: string, e: EstadoUno | null) => setEstados((prev) => {
    const n = { ...prev };
    if (e) n[codigo] = e; else delete n[codigo];
    return n;
  }), []);
  if (!articulos.length) return null;
  const listos = articulos.filter((a) => estados[a.codigo]?.listo);
  const incompletos = articulos.filter((a) => estados[a.codigo] && !estados[a.codigo].listo && !estados[a.codigo].vacio);
  async function separarTodos() {
    if (!listos.length) return;
    const texto = `Separar por colores en Shopify (DEPOSITO MARTINEZ) ${listos.length} artículo(s):\n\n${listos.map((a) => `${a.codigo}:\n${estados[a.codigo].pasos.map((p) => `• ${p}`).join('\n')}`).join('\n\n')}${incompletos.length ? `\n\nNo se tocan (incompletos): ${incompletos.map((a) => a.codigo).join(', ')}.` : ''}\n\n¿Confirmás?`;
    if (!confirm(texto)) return;
    setSeparando(true); setResumen('');
    let ok = 0, mal = 0;
    // De a uno: cada artículo relee y escribe su parte; uno que falla no frena a los demás.
    for (const a of listos) {
      const r = await estados[a.codigo]?.ejecutar();
      if (r?.ok) ok++; else mal++;
    }
    setSeparando(false);
    setResumen(`${ok} separado(s)${mal ? `, ${mal} con problemas (mirá cada uno)` : ''}.`);
  }
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)' }}>
      <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontWeight: 'bold', fontSize: '0.95rem' }} onClick={() => setAbierto(!abierto)}>
        {abierto ? '▾' : '▸'} 🎨 ¿Algo vino en varios colores? Separarlo (ya cargado)
      </button>
      {abierto && <>
        <div style={{ opacity: 0.75, fontSize: '0.8rem', marginTop: 4 }}>
          Están todos los artículos abiertos. En cada uno escribí los colores con sus unidades (tienen que sumar lo que hay en Martínez);
          el que vino en un solo color dejalo vacío. Abajo, un solo botón separa todos los completos. No hay que borrar nada ni volver a cargar.
        </div>
        {articulos.map((a) => <SepararUno key={a.codigo} codigo={a.codigo} descripcion={a.descripcion} gql={gql} onEstado={onEstado} ocupadoAfuera={separando} />)}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <button style={{ ...botonPrincipal, opacity: listos.length && !separando ? 1 : 0.5 }} disabled={!listos.length || separando} onClick={separarTodos}>
            {separando ? 'Separando…' : `🎨 Separar por colores los ${listos.length} completos`}</button>
          {incompletos.length > 0 && <span style={{ color: NARANJA, fontSize: '0.85rem' }}>Sin completar: {incompletos.map((a) => a.codigo).join(', ')}</span>}
          {resumen && <span style={{ color: VERDE, fontWeight: 600 }}>{resumen}</span>}
        </div>
      </>}
    </div>
  );
}
