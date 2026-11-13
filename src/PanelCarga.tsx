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
import { leerPrecio, precioAEscribir, resumenCarga, textoSeparar, type AjustePrecio, type EleccionesCarga, type ItemCarga, type ModoVenta, type OpcionCarga, type PlanCarga, type TablaItem } from './utils/cargaFamily';
import { margenPct } from './utils/margen';
import { ordenesQueSalen, type OrdenQueSale } from './utils/cargaId';
import { botonChico, botonPrincipal, inputSt } from './utils/entregasUi';
import { esTalleUS, talleUS } from './utils/talleDistrinando';

// Lo listo va en el color normal: solo resalta lo que necesita atención (12-nov-2026, gax: «hay mucho color»).
const COLOR_ITEM = { listo: 'inherit', elegir: '#fbbf24', bloqueado: '#f87171', cargado: '#94a3b8' } as const;
const VERDE = '#34d399', AMARILLO = '#fbbf24', ROJO = '#f87171', VIOLETA = '#a78bfa';
type Eleccion = EleccionesCarga[string];

export function PanelCarga({ plan, ocupado, onConfirmar, onCancelar, sucursal, explicacion, onModoVenta, onCantidad, onTabla, onDestino, sinTildar }: {
  plan: PlanCarga; ocupado: boolean; onConfirmar: (e: EleccionesCarga) => void; onCancelar: () => void;
  sucursal: string; explicacion: string;
  /** iD: lo vendido en iD se separa; «cargarlo igual» lo suma (si ya se separó antes); «pasar» lo suma y mueve la venta a Martínez. */
  onModoVenta?: (codigo: string, modo: ModoVenta) => void;
  /** iD (12-nov-2026, gax: «yo los voy seleccionando, así los voy controlando»): empiezan destildados. */
  sinTildar?: boolean;
  /** iD (12-nov-2026, gax): la cantidad de cada talle viene sola y se puede escribir a mano. */
  onCantidad?: (codigo: string, talle: string, n: number) => void;
  /** Distrinando (13-nov-2026, gax): la tabla de talle de cada modelo se elige en un desplegable. */
  onTabla?: (codigo: string, tabla: string) => void;
  /** Distrinando (13-nov-2026, gax): en qué talle de Shopify entra cada talle que llegó, editable ('' = automático). */
  onDestino?: (codigo: string, talle: string, destino: string) => void;
}) {
  const [elecciones, setElecciones] = useState<EleccionesCarga>(() =>
    Object.fromEntries(plan.items.filter((it) => it.opciones.length).map((it) => [it.codigo, { clave: sinTildar && esCasilla(it) ? 'no' : it.opciones[0].clave }])));
  // Un artículo que pasa a «listo» después (eligió la tabla, escribió una cantidad) empieza como los demás:
  // sin tildar si así empiezan. Lo que se confirma es exactamente lo que se ve.
  const efectivas: EleccionesCarga = { ...elecciones };
  for (const it of plan.items) if (it.opciones.length && !efectivas[it.codigo]) efectivas[it.codigo] = { clave: sinTildar && esCasilla(it) ? 'no' : it.opciones[0].clave };
  const casillas = plan.items.filter(esCasilla);
  const tildadas = casillas.filter((it) => efectivas[it.codigo].clave !== 'no').length;
  const elegir = (codigo: string, cambio: Partial<Eleccion>) =>
    setElecciones((x) => ({ ...x, [codigo]: { ...(x[codigo] ?? efectivas[codigo] ?? { clave: 'no' }), ...cambio } }));
  const res = resumenCarga(plan, efectivas);
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
      {plan.items.map((it) => <FilaCarga key={it.codigo} it={it} eleccion={efectivas[it.codigo]} onElegir={(c) => elegir(it.codigo, c)} sinTildar={sinTildar}
        onModoVenta={onModoVenta && ((m) => onModoVenta(it.codigo, m))} onCantidad={onCantidad && ((t, n) => onCantidad(it.codigo, t, n))}
        onTabla={onTabla && ((t) => onTabla(it.codigo, t))} onDestino={onDestino && ((t, d) => onDestino(it.codigo, t, d))} ocupado={ocupado} />)}
      <OrdenesQueSalen ordenes={ordenesQueSalen(plan, efectivas)} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <button style={{ ...botonPrincipal, opacity: res.lineas.length && !ocupado ? 1 : 0.5, cursor: res.lineas.length && !ocupado ? 'pointer' : 'not-allowed' }}
          disabled={!res.lineas.length || ocupado} onClick={() => onConfirmar(efectivas)}>✅ Confirmar y cargar</button>
        <button style={botonChico} disabled={ocupado} onClick={onCancelar}>Cancelar</button>
        <span style={{ fontSize: '0.84rem', opacity: 0.85 }}>
          {res.lineas.length ? `${res.altas ? `${res.altas} nuevo(s) y ` : ''}${res.reposiciones} reposición(es): ${res.unidades} unidades.` : 'No hay nada elegido para cargar.'}
        </span>
      </div>
    </div>
  );
}

/**
 * Órdenes de iD que se llevan algo de esta entrega (12-nov-2026, gax): cuáles ya pueden salir (separalas y
 * dejalas apartadas) y cuáles todavía esperan otros artículos de iD.
 */
export function OrdenesQueSalen({ ordenes, titulo }: { ordenes: OrdenQueSale[]; titulo?: string }) {
  if (!ordenes.length) return null;
  const salen = ordenes.filter((o) => o.puede), esperan = ordenes.filter((o) => !o.puede);
  const fila = (o: OrdenQueSale) => (
    <li key={o.orden} style={{ marginTop: 2 }}>
      <strong>{o.orden}</strong>{o.pasa ? ' (se prepara desde Martínez)' : ''}: {o.llega.join(', ')}
      {o.faltan.length ? <span style={{ color: AMARILLO }}> — falta de iD: {o.faltan.join(', ')}</span> : null}
    </li>
  );
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, borderLeft: `4px solid ${VIOLETA}`, background: 'rgba(167,139,250,0.08)', fontSize: '0.84rem', lineHeight: 1.5 }}>
      <strong>{titulo ?? '📦 Órdenes de iD con lo que llegó'}</strong>
      {salen.length > 0 && <div style={{ marginTop: 4 }}>
        <span style={{ color: VERDE }}>✅ Ya pueden salir ({salen.length}):</span> separá esos artículos y dejalos apartados con la orden.
        <ul style={{ margin: '2px 0 0', paddingLeft: 20 }}>{salen.map(fila)}</ul>
      </div>}
      {esperan.length > 0 && <div style={{ marginTop: 6 }}>
        <span style={{ color: AMARILLO }}>⏳ Todavía no pueden salir ({esperan.length}):</span> esperan otros artículos de iD. Separá lo que llegó y guardalo hasta que llegue lo demás.
        <ul style={{ margin: '2px 0 0', paddingLeft: 20 }}>{esperan.map(fila)}</ul>
      </div>}
      <div style={{ opacity: 0.65, marginTop: 4, fontSize: '0.78rem' }}>Lo que esas órdenes tengan en Martínez lo doy por disponible.</div>
    </div>
  );
}

/** Con una sola cosa para hacer, una casilla deja dejarlo para otro día (lo que no llegó todavía). */
const esCasilla = (it: ItemCarga) => it.estado === 'listo' && it.opciones.length === 1;

function FilaCarga({ it, eleccion, onElegir, onModoVenta, onCantidad, onTabla, onDestino, ocupado, sinTildar }: {
  it: ItemCarga; eleccion?: Eleccion; onElegir: (c: Partial<Eleccion>) => void; onModoVenta?: (m: ModoVenta) => void;
  onCantidad?: (talle: string, n: number) => void; onTabla?: (tabla: string) => void; onDestino?: (talle: string, destino: string) => void;
  ocupado: boolean; sinTildar?: boolean;
}) {
  const op = it.opciones.find((o) => o.clave === (eleccion?.clave ?? it.opciones[0]?.clave));
  const a = op?.accion;
  const casilla = esCasilla(it);
  const fuera = casilla && !a;
  // El cartel «vendido en iD» se ve aunque el artículo todavía no esté tildado.
  const sep = op ?? (casilla ? it.opciones[0] : undefined);
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
      {onCantidad && it.talles?.length ? <div style={{ marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ opacity: 0.8 }}>✏️ Llegó para cargar:</span>
        {it.talles.map((t) => <span key={t.talle} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <CantidadTalle talle={t.talle} cantidad={t.cantidad} original={t.original} disabled={ocupado} onCambio={(n) => onCantidad(t.talle, n)} />
          {onDestino && t.destino !== undefined && <DestinoTalle talle={t.talle} destino={t.destino} manual={!!t.destinoManual} nuevo={!!t.nuevo} disabled={ocupado} onCambio={(d) => onDestino(t.talle, d)} />}
          {t.sku !== undefined && <span title={t.nuevo ? 'SKU que va a llevar el talle nuevo' : 'SKU que tiene hoy ese talle en Shopify'}
            style={{ fontFamily: 'monospace', fontSize: '0.78rem', padding: '1px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.2)', userSelect: 'all', opacity: t.sku ? 1 : 0.6 }}>
            {t.nuevo ? '🆕 ' : ''}SKU {t.sku || 'sin SKU'}
          </span>}
        </span>)}
        {onDestino && <AgregarTalle disabled={ocupado} existentes={it.talles.map((t) => t.talle)} onAgregar={(t, n) => onCantidad(t, n)} />}
      </div> : null}
      {it.tabla && <TablaTalle t={it.tabla} onTabla={onTabla} ocupado={ocupado} />}
      {sep?.separar?.length ? <Separar op={sep} onModoVenta={onModoVenta} ocupado={ocupado} /> : null}
      {it.motivo && <div style={{ color: COLOR_ITEM[it.estado], marginTop: 2 }}>{it.estado === 'bloqueado' ? '⛔ ' : ''}{it.motivo}</div>}
      {it.opciones.filter((o) => o.bloqueo && it.opciones.length > 1).map((o) => <div key={o.clave} style={{ opacity: 0.75 }}>· {o.etiqueta}: {o.bloqueo}</div>)}
      {a?.tipo === 'alta' && <div style={{ marginTop: 4 }}>
        🆕 Crear <input value={eleccion?.titulo ?? a.titulo} onChange={(ev) => onElegir({ titulo: ev.target.value })} style={{ ...inputSt, width: 'min(420px, 100%)' }} />
        <div style={{ opacity: 0.8, marginTop: 2 }}>
          Tipo {a.productType} · precio {fmt(a.precio)} · costo {fmt(a.costo)} · {a.variantes.map((v) => `${v.talle}:${v.cantidad}`).join(' ')} · SKU {a.variantes[0]?.sku}… · etiquetas {a.etiquetas.join(', ')}
        </div>
      </div>}
      {a?.tipo === 'reposicion' && <div style={{ marginTop: 6 }}>
        🔁 {a.lineas.length || a.crear?.length ? <>Sumar en «{a.titulo}»: </> : <>«{a.titulo}»: no se suma stock (vendido en iD), solo precio y costo</>}{[
          ...a.lineas.map((l) => (l.actual === null ? `${l.talle} alta con ${l.suma}` : `${l.talle} ${l.actual}→${l.actual + l.suma}`)),
          ...(a.crear ?? []).map((c) => `🆕 ${c.talle} (talle nuevo) con ${c.suma}`),
        ].join(' · ')}
        {a.etiquetas?.length ? <div style={{ opacity: 0.8 }}>🏷️ Etiquetas que se agregan: {a.etiquetas.join(', ')}{a.quitarEtiquetas?.length ? ` (se saca ${a.quitarEtiquetas.join(', ')})` : ''}</div> : null}
      </div>}
      {a?.tipo === 'reposicion' && a.ajuste && <Ajuste a={a.ajuste} precio={eleccion?.precio} onPrecio={(precio) => onElegir({ precio })} />}
      {op?.avisos.map((x, i) => <div key={i} style={{ color: AMARILLO, marginTop: 6, fontSize: '0.8rem' }}>⚠️ {x}</div>)}
    </div>
  );
}

/** Distrinando: la tabla de talle del modelo. Las que no coinciden con lo que informa el proveedor no se pueden elegir. */
function TablaTalle({ t, onTabla, ocupado }: { t: TablaItem; onTabla?: (tabla: string) => void; ocupado: boolean }) {
  const falta = t.hace && !t.elegida;
  const bloqueadas = t.opciones.filter((o) => o.bloqueo);
  return (
    <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.14)', borderLeft: `4px solid ${falta ? AMARILLO : 'transparent'}` }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>📏 Tabla de talle{t.actual ? ` (hoy: ${t.actual})` : ''}:</span>
        <select value={t.elegida} disabled={ocupado || !onTabla} onChange={(ev) => onTabla?.(ev.target.value)} aria-label="Tabla de talle"
          style={{ ...inputSt, maxWidth: '100%', borderColor: falta ? AMARILLO : undefined }}>
          {t.opciones.map((o) => <option key={o.clave} value={o.clave} disabled={!!o.bloqueo}>{o.etiqueta}{o.bloqueo ? ' (no coincide)' : ''}</option>)}
        </select>
      </div>
      {t.avisos.map((x, i) => <div key={i} style={{ color: AMARILLO, marginTop: 4, fontSize: '0.8rem' }}>⚠️ {x}</div>)}
      {bloqueadas.length > 0 && <div style={{ opacity: 0.65, marginTop: 4, fontSize: '0.78rem' }}>
        No se pueden elegir: {bloqueadas.map((o) => `${o.clave} (${o.bloqueo})`).join(' · ')}.
      </div>}
    </div>
  );
}

/**
 * Distrinando: el talle de Shopify donde entra lo que llegó (gax: «que se puedan poner los talles en donde realmente
 * entraron»). Viene el que da el SKU, la nota o la tabla; se puede escribir otro. Vacío = vuelve al automático.
 */
function DestinoTalle({ talle, destino, manual, nuevo, disabled, onCambio }: {
  talle: string; destino: string; manual: boolean; nuevo: boolean; disabled: boolean; onCambio: (d: string) => void;
}) {
  const [texto, setTexto] = useState(destino);
  const [antes, setAntes] = useState(destino);
  if (antes !== destino) { setAntes(destino); setTexto(destino); }
  const aplicar = () => {
    const t = texto.trim().replace(',', '.');
    if (t === destino) return;
    if (!t) { onCambio(''); return; }
    if (/^\d{2}(\.5)?$/.test(t)) onCambio(t); else setTexto(destino);
  };
  return (
    <label style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }} title={`Talle de Shopify donde entra el ${talle}. Escribí otro si entra en otro talle; borralo para volver al automático.`}>
      <span style={{ opacity: 0.75 }}>→ talle</span>
      <input value={texto} disabled={disabled} inputMode="decimal" placeholder="?" aria-label={`Talle de Shopify para ${talle}`}
        onChange={(ev) => setTexto(ev.target.value)} onBlur={aplicar} onKeyDown={(ev) => { if (ev.key === 'Enter') aplicar(); }}
        style={{ ...inputSt, width: 48, padding: '2px 4px', borderColor: manual ? AMARILLO : !destino ? ROJO : undefined }} />
      {nuevo && destino && <span style={{ fontSize: '0.72rem', color: AMARILLO }}>🆕</span>}
      {manual && <span style={{ fontSize: '0.72rem', color: AMARILLO }}>(a mano)</span>}
    </label>
  );
}

/**
 * Distrinando (13-nov-2026, gax: «no me llegó el producto, me entró directamente en otro talle, en 13 americano»):
 * agregar un talle US que no figura en el remito. Queda en amarillo «(remito 0)» y entra en el mail del final.
 */
function AgregarTalle({ existentes, disabled, onAgregar }: { existentes: string[]; disabled: boolean; onAgregar: (talle: string, n: number) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [us, setUs] = useState('');
  const [n, setN] = useState('1');
  const [error, setError] = useState('');
  if (!abierto) return <button style={{ ...botonChico, padding: '1px 8px' }} disabled={disabled} onClick={() => setAbierto(true)}>＋ Agregar talle</button>;
  const agregar = () => {
    const t = talleUS(us);
    const c = Number(n.trim());
    if (!esTalleUS(t)) { setError('Escribí el talle americano (US), por ejemplo 13 o 8.5.'); return; }
    if (existentes.includes(`US ${t}`)) { setError(`El US ${t} ya está: cambiá su cantidad.`); return; }
    if (!Number.isInteger(c) || c <= 0 || c > 9999) { setError('Escribí cuántos pares llegaron.'); return; }
    onAgregar(`US ${t}`, c);
    setAbierto(false); setUs(''); setN('1'); setError('');
  };
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ opacity: 0.8 }}>Talle que no está en el remito: US</span>
      <input value={us} onChange={(ev) => setUs(ev.target.value)} inputMode="decimal" placeholder="13" aria-label="Talle US a agregar" style={{ ...inputSt, width: 48, padding: '2px 4px' }} />
      <span style={{ opacity: 0.8 }}>pares</span>
      <input value={n} onChange={(ev) => setN(ev.target.value)} inputMode="numeric" aria-label="Pares del talle agregado" style={{ ...inputSt, width: 48, padding: '2px 4px' }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') agregar(); }} />
      <button style={{ ...botonChico, padding: '1px 8px' }} disabled={disabled} onClick={agregar}>Agregar</button>
      <button style={{ ...botonChico, padding: '1px 8px' }} onClick={() => { setAbierto(false); setError(''); }}>Cancelar</button>
      {error && <span style={{ color: ROJO, fontSize: '0.78rem' }}>{error}</span>}
    </span>
  );
}

/** Un talle con su cantidad: se escribe y se aplica al salir del casillero o con Enter. */
function CantidadTalle({ talle, cantidad, original, disabled, onCambio }: {
  talle: string; cantidad: number; original: number; disabled: boolean; onCambio: (n: number) => void;
}) {
  const [texto, setTexto] = useState(String(cantidad));
  const [antes, setAntes] = useState(cantidad);
  if (antes !== cantidad) { setAntes(cantidad); setTexto(String(cantidad)); }
  const aplicar = () => {
    const n = Number(texto.trim());
    if (Number.isInteger(n) && n >= 0 && n <= 9999) { if (n !== cantidad) onCambio(n); } else setTexto(String(cantidad));
  };
  const cambiado = cantidad !== original;
  return (
    <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} title={cambiado ? `El remito dice ${original}` : 'Lo que dice el remito: cambialo si llegó otra cantidad'}>
      <strong>{talle}</strong>
      <input type="number" min={0} max={9999} step={1} inputMode="numeric" value={texto} disabled={disabled} aria-label={`Cantidad talle ${talle}`}
        onChange={(ev) => setTexto(ev.target.value)} onBlur={aplicar} onKeyDown={(ev) => { if (ev.key === 'Enter') aplicar(); }}
        style={{ ...inputSt, width: 56, padding: '2px 4px', borderColor: cambiado ? AMARILLO : undefined }} />
      {cambiado && <span style={{ fontSize: '0.75rem', color: AMARILLO }}>(remito {original})</span>}
    </label>
  );
}

/**
 * Cartel «vendido en iD» (12-nov-2026, gax): por defecto se separa y no se suma a Martínez. «Cargarlo igual»
 * suma todo (ya se separó antes). «Cargar y pasar la venta a Martínez» suma todo y, después, la orden pasa a
 * prepararse desde Martínez (cuando espera otro artículo que todavía no llegó).
 */
function Separar({ op, onModoVenta, ocupado }: { op: OpcionCarga; onModoVenta?: (m: ModoVenta) => void; ocupado: boolean }) {
  const xs = op.separar ?? [];
  const u = xs.reduce((s, x) => s + x.cantidad, 0);
  const modo = op.modoVenta ?? (op.separarAplicado ? 'separar' : 'igual');
  const boton = (m: ModoVenta, texto: string, titulo: string, habilitado = true) => (
    <button key={m} style={{ ...botonChico, padding: '2px 8px', opacity: habilitado ? 1 : 0.5 }} disabled={ocupado || !habilitado} title={titulo} onClick={() => onModoVenta?.(m)}>{texto}</button>
  );
  const sinMover = !op.movibles;
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, borderLeft: `4px solid ${VIOLETA}`, background: 'rgba(167,139,250,0.12)' }}>
      {modo === 'separar' && <><strong>🏷️ Vendido en iD: separá {u} u. antes de cargar</strong> — {textoSeparar(xs)}. No se suman a Martínez.</>}
      {modo === 'igual' && <><strong>🏷️ Vendido en iD ({u} u.)</strong> — {textoSeparar(xs)}. Elegiste cargarlo igual: se suma todo a Martínez.</>}
      {modo === 'pasar' && <><strong>🔀 Vendido en iD ({u} u.)</strong> — {textoSeparar(xs)}. Elegiste cargarlo y pasar la venta a Martínez: se suma a Martínez y, después de cargar, esa orden se prepara desde Martínez.</>}
      {onModoVenta && <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {modo !== 'separar' && boton('separar', 'Volver a separarlo', 'No se suma a Martínez: queda para esas órdenes de iD')}
        {modo !== 'igual' && boton('igual', 'Ya lo separé antes: cargarlo igual', 'Se suma todo a Martínez; la orden sigue asignada a iD')}
        {modo !== 'pasar' && boton('pasar', 'Cargar y pasar la venta a Martínez',
          sinMover ? 'En Shopify esa preparación figura en curso en iD: no se puede mover desde la app' : 'Para órdenes que esperan otro artículo: se suma a Martínez y la venta pasa a prepararse desde Martínez', !sinMover)}
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
