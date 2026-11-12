// ============================================================================
// VISTA PREVIA DE UNA CARGA EN SHOPIFY (Family e iD)
// ----------------------------------------------------------------------------
// Qué se crea y qué se suma, artículo por artículo. Nada se escribe hasta confirmar.
// iD (12-nov-2026, gax): cada reposición muestra el margen con el costo nuevo de la
// factura. 50% o más = verde; menos = amarillo y hay que poner un precio nuevo para
// TODA la curva (los básicos tienen precio impuesto: se avisa, no obliga).
// ============================================================================
import { useState } from 'react';
import { fmt } from './utils/controlFacturas';
import { leerPrecio, precioAEscribir, resumenCarga, textoSeparar, type AjustePrecio, type EleccionesCarga, type ItemCarga, type OpcionCarga, type PlanCarga } from './utils/cargaFamily';
import { margenPct } from './utils/margen';
import { botonChico, botonPrincipal, inputSt } from './utils/entregasUi';

// Lo listo va en el color normal: solo resalta lo que necesita atención (12-nov-2026, gax: «hay mucho color»).
const COLOR_ITEM = { listo: 'inherit', elegir: '#fbbf24', bloqueado: '#f87171', cargado: '#94a3b8' } as const;
const VERDE = '#34d399', AMARILLO = '#fbbf24', ROJO = '#f87171', VIOLETA = '#a78bfa';
type Eleccion = EleccionesCarga[string];

export function PanelCarga({ plan, ocupado, onConfirmar, onCancelar, sucursal, explicacion, onCargarIgual, sinTildar }: {
  plan: PlanCarga; ocupado: boolean; onConfirmar: (e: EleccionesCarga) => void; onCancelar: () => void;
  sucursal: string; explicacion: string;
  /** iD: lo vendido en iD se separa; «cargarlo igual» lo suma (si ya se separó antes). */
  onCargarIgual?: (codigo: string, si: boolean) => void;
  /** iD (12-nov-2026, gax: «yo los voy seleccionando, así los voy controlando»): empiezan destildados. */
  sinTildar?: boolean;
}) {
  const [elecciones, setElecciones] = useState<EleccionesCarga>(() =>
    Object.fromEntries(plan.items.filter((it) => it.opciones.length).map((it) => [it.codigo, { clave: sinTildar && esCasilla(it) ? 'no' : it.opciones[0].clave }])));
  const casillas = plan.items.filter(esCasilla);
  const tildadas = casillas.filter((it) => (elecciones[it.codigo]?.clave ?? it.opciones[0].clave) !== 'no').length;
  const elegir = (codigo: string, cambio: Partial<Eleccion>) =>
    setElecciones((x) => ({ ...x, [codigo]: { ...(x[codigo] ?? { clave: 'no' }), ...cambio } }));
  const res = resumenCarga(plan, elecciones);
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.6)', background: 'rgba(99,102,241,0.08)' }}>
      <strong>⬆️ Carga en Shopify ({sucursal}): revisá antes de confirmar</strong>
      <div style={{ fontSize: '0.8rem', opacity: 0.8, margin: '4px 0 8px' }}>{explicacion}</div>
      {plan.avisos.map((a, i) => <div key={i} style={{ color: AMARILLO, fontSize: '0.84rem' }}>⚠️ {a}</div>)}
      {casillas.length > 0 && (sinTildar
        ? <div style={{ fontSize: '0.84rem', marginBottom: 4 }}>
          ☑️ <strong>Tildá cada artículo a medida que lo controlás:</strong> solo se carga lo tildado ({tildadas} de {casillas.length}). Lo que no tildes queda pendiente y lo cargás otro día con el mismo botón.
        </div>
        : <div style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: 4 }}>
          ¿Algo no llegó todavía? Destildalo: queda pendiente y lo cargás otro día con el mismo botón.
        </div>)}
      {plan.items.map((it) => <FilaCarga key={it.codigo} it={it} eleccion={elecciones[it.codigo]} onElegir={(c) => elegir(it.codigo, c)} sinTildar={sinTildar}
        onCargarIgual={onCargarIgual && ((si) => onCargarIgual(it.codigo, si))} ocupado={ocupado} />)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <button style={{ ...botonPrincipal, opacity: res.lineas.length && !ocupado ? 1 : 0.5, cursor: res.lineas.length && !ocupado ? 'pointer' : 'not-allowed' }}
          disabled={!res.lineas.length || ocupado} onClick={() => onConfirmar(elecciones)}>✅ Confirmar y cargar</button>
        <button style={botonChico} disabled={ocupado} onClick={onCancelar}>Cancelar</button>
        <span style={{ fontSize: '0.84rem', opacity: 0.85 }}>
          {res.lineas.length ? `${res.altas ? `${res.altas} nuevo(s) y ` : ''}${res.reposiciones} reposición(es): ${res.unidades} unidades.` : 'No hay nada elegido para cargar.'}
        </span>
      </div>
    </div>
  );
}

/** Con una sola cosa para hacer, una casilla deja dejarlo para otro día (lo que no llegó todavía). */
const esCasilla = (it: ItemCarga) => it.estado === 'listo' && it.opciones.length === 1;

function FilaCarga({ it, eleccion, onElegir, onCargarIgual, ocupado, sinTildar }: {
  it: ItemCarga; eleccion?: Eleccion; onElegir: (c: Partial<Eleccion>) => void; onCargarIgual?: (si: boolean) => void; ocupado: boolean; sinTildar?: boolean;
}) {
  const op = it.opciones.find((o) => o.clave === (eleccion?.clave ?? it.opciones[0]?.clave));
  const a = op?.accion;
  const casilla = esCasilla(it);
  const fuera = casilla && !a;
  return (
    <div style={{ borderTop: '2px solid rgba(255,255,255,0.2)', padding: '14px 0 12px', fontSize: '0.84rem', lineHeight: 1.55 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {casilla && <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title={sinTildar ? 'Tildalo cuando lo controlaste: solo se carga lo tildado' : 'Destildalo si todavía no llegó: queda pendiente'}>
          <input type="checkbox" checked={!fuera} onChange={(ev) => onElegir({ clave: ev.target.checked ? it.opciones[0].clave : 'no' })} />
        </label>}
        <strong style={{ color: COLOR_ITEM[it.estado], opacity: fuera ? 0.55 : 1 }}>{it.codigo}</strong>
        <span style={{ opacity: fuera ? 0.5 : 0.8 }}>{it.descripcion} · {it.unidades} u.</span>
        {fuera && (sinTildar
          ? <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>sin tildar: no se carga</span>
          : <span style={{ fontSize: '0.8rem', color: AMARILLO }}>queda pendiente: no se carga ahora</span>)}
        {it.opciones.length > 1 && <select value={eleccion?.clave ?? it.opciones[0].clave} onChange={(ev) => onElegir({ clave: ev.target.value })} style={{ ...inputSt, maxWidth: '100%' }}>
          {it.opciones.map((o) => <option key={o.clave} value={o.clave} disabled={!!o.bloqueo}>{o.etiqueta}{o.bloqueo ? ' (no se puede)' : ''}</option>)}
        </select>}
      </div>
      {op?.separar?.length ? <Separar op={op} onCargarIgual={onCargarIgual} ocupado={ocupado} /> : null}
      {it.motivo && <div style={{ color: COLOR_ITEM[it.estado], marginTop: 2 }}>{it.estado === 'bloqueado' ? '⛔ ' : ''}{it.motivo}</div>}
      {it.opciones.filter((o) => o.bloqueo && it.opciones.length > 1).map((o) => <div key={o.clave} style={{ opacity: 0.75 }}>· {o.etiqueta}: {o.bloqueo}</div>)}
      {a?.tipo === 'alta' && <div style={{ marginTop: 4 }}>
        🆕 Crear <input value={eleccion?.titulo ?? a.titulo} onChange={(ev) => onElegir({ titulo: ev.target.value })} style={{ ...inputSt, width: 'min(420px, 100%)' }} />
        <div style={{ opacity: 0.8, marginTop: 2 }}>
          Tipo {a.productType} · precio {fmt(a.precio)} · costo {fmt(a.costo)} · {a.variantes.map((v) => `${v.talle}:${v.cantidad}`).join(' ')} · SKU {a.variantes[0]?.sku}… · etiquetas {a.etiquetas.join(', ')}
        </div>
      </div>}
      {a?.tipo === 'reposicion' && <div style={{ marginTop: 6 }}>
        🔁 {a.lineas.length ? <>Sumar en «{a.titulo}»: </> : <>«{a.titulo}»: no se suma stock (vendido en iD), solo precio y costo</>}{a.lineas.map((l) => (l.actual === null ? `${l.talle} alta con ${l.suma}` : `${l.talle} ${l.actual}→${l.actual + l.suma}`)).join(' · ')}
      </div>}
      {a?.tipo === 'reposicion' && a.ajuste && <Ajuste a={a.ajuste} precio={eleccion?.precio} onPrecio={(precio) => onElegir({ precio })} />}
      {op?.avisos.map((x, i) => <div key={i} style={{ color: AMARILLO, marginTop: 6, fontSize: '0.8rem' }}>⚠️ {x}</div>)}
    </div>
  );
}

/** Cartel «vendido en iD: separar» (12-nov-2026, gax): no se suma a Martínez, salvo «cargarlo igual». */
function Separar({ op, onCargarIgual, ocupado }: { op: OpcionCarga; onCargarIgual?: (si: boolean) => void; ocupado: boolean }) {
  const xs = op.separar ?? [];
  const u = xs.reduce((s, x) => s + x.cantidad, 0);
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, borderLeft: `4px solid ${VIOLETA}`, background: 'rgba(167,139,250,0.12)' }}>
      {op.separarAplicado
        ? <><strong>🏷️ Vendido en iD: separá {u} u. antes de cargar</strong> — {textoSeparar(xs)}. No se suman a Martínez.</>
        : <><strong>🏷️ Vendido en iD ({u} u.)</strong> — {textoSeparar(xs)}. Elegiste cargarlo igual: se suma todo a Martínez.</>}
      {onCargarIgual && <div style={{ marginTop: 4 }}>
        <button style={{ ...botonChico, padding: '2px 8px' }} disabled={ocupado} onClick={() => onCargarIgual(!!op.separarAplicado)}>
          {op.separarAplicado ? 'Ya lo separé antes: cargarlo igual' : 'Volver a separarlo'}
        </button>
      </div>}
    </div>
  );
}

const pct = (m: number | null) => (m === null ? '—' : `${Math.floor(m * 10) / 10}%`.replace('.', ','));
/** Margen con el costo nuevo de la factura y, si no llega al 50%, el precio nuevo para toda la curva. */
function Ajuste({ a, precio, onPrecio }: { a: AjustePrecio; precio?: number; onPrecio: (p: number | undefined) => void }) {
  const [texto, setTexto] = useState(precio === undefined ? '' : String(precio));
  const escribir = precioAEscribir(a, precio);
  const falta = Number.isNaN(escribir);
  const obliga = !a.basico && (a.precioActual === null || !a.ok);
  const nuevoMargen = precio !== undefined && Number.isFinite(precio) ? margenPct(precio, a.costoNuevo) : null;
  const cambiar = (s: string) => { setTexto(s); onPrecio(leerPrecio(s)); };
  const color = a.precioActual !== null && a.ok ? VERDE : AMARILLO;
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.14)' }}>
      <div>
        {a.precioActual === null
          ? <span style={{ color }}>⚠️ Los talles tienen precios distintos ({a.precios.map(fmt).join(', ') || 'sin precio'}): poné un precio para toda la curva.</span>
          : <>{a.ok ? '✅' : '⚠️'} Margen con el costo nuevo ({fmt(a.costoNuevo)}) y el precio actual ({fmt(a.precioActual)}): <strong style={{ color }}>{pct(a.margen)}</strong>{a.ok ? '' : <span style={{ color }}> — no llega al 50%</span>}.</>}
        {a.basico && !a.ok && a.precioActual !== null && ' Es un básico (precio impuesto): podés dejar el precio como está.'}
      </div>
      {(obliga || a.basico || precio !== undefined) && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        <span>{obliga ? 'Precio nuevo para toda la curva (obligatorio):' : 'Precio nuevo para toda la curva (opcional):'}</span>
        <input value={texto} onChange={(ev) => cambiar(ev.target.value)} placeholder={a.precioActual !== null ? String(a.precioActual) : ''} inputMode="numeric"
          style={{ ...inputSt, width: 110, borderColor: falta && texto ? ROJO : undefined }} />
        <button style={{ ...botonChico, padding: '2px 8px' }} onClick={() => cambiar(String(a.sugerido))}>usar {fmt(a.sugerido)} ({pct(margenPct(a.sugerido, a.costoNuevo))})</button>
        {nuevoMargen !== null && <span style={{ color: falta ? ROJO : VERDE }}>margen {pct(nuevoMargen)}</span>}
      </div>}
      {falta && <div style={{ color: ROJO, marginTop: 2 }}>
        {precio !== undefined && !Number.isNaN(precio) && Number.isInteger(precio) && precio > 0
          ? 'Con ese precio el margen no llega al 50%: este artículo no se carga hasta que lo corrijas.'
          : precio !== undefined && precio !== a.precioActual ? 'Escribí el precio en pesos, sin centavos: este artículo no se carga hasta que lo corrijas.'
          : 'Este artículo no se carga hasta que pongas el precio nuevo.'}
      </div>}
      {!falta && escribir !== null && <div style={{ marginTop: 4 }}>Se cambia el precio de todos los talles ({a.variantes.length}) a {fmt(escribir)}.</div>}
      {a.costos.length > 0 && <div style={{ opacity: 0.7, marginTop: 6, fontSize: '0.8rem' }}>
        Costo nuevo {fmt(a.costoNuevo)} en {a.costos.map((c) => `${c.talle}${c.actual !== null ? ` (antes ${fmt(c.actual)})` : ''}`).join(', ')}.
      </div>}
      {a.ponderados.length > 0 && <div style={{ opacity: 0.7, marginTop: 2, fontSize: '0.8rem' }}>
        Costo promedio (ya tenían stock en Martínez): {a.ponderados.map((c) => `${c.talle} ${c.stock} a ${fmt(c.actual)} + ${c.suma} a ${fmt(a.costoNuevo)} → ${fmt(c.costo)}`).join(' · ')}.
      </div>}
      {a.conservan.some((c) => !c.motivo) && <div style={{ opacity: 0.6, marginTop: 2, fontSize: '0.8rem' }}>
        Conservan su costo (tienen stock en Martínez y no llegan ahora): {a.conservan.filter((c) => !c.motivo).map((c) => `${c.talle} (${c.stock} u.${c.costo !== null ? `, ${fmt(c.costo)}` : ''})`).join(', ')}.
      </div>}
    </div>
  );
}
