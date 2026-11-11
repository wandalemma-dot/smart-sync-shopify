// ============================================================================
// ENLACES RÁPIDOS (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Arriba a la derecha de Control de entregas: botones que abren planillas
// propias en otra pestaña (por ejemplo «Control de ingreso de mercadería» en
// Google Sheets). El enlace lo pega la usuaria una vez y queda guardado en la
// base (cf:config, campo «enlaces»), nunca en el código: el repositorio es público.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { apiControl, boton, botonChico, inputSt, mensaje } from './utils/entregasUi';

interface EnlaceRapido { nombre: string; url: string }
const MAX = 5;
const NOMBRE_SUGERIDO = 'Control de ingreso de mercadería';

/** Valida lo que se va a guardar (el servidor vuelve a validar). Devuelve el error o ''. */
function errorEnlaces(lista: EnlaceRapido[]): string {
  if (lista.length > MAX) return `Se pueden guardar hasta ${MAX} enlaces.`;
  for (const e of lista) {
    let u: URL;
    try { u = new URL(e.url); } catch { return `«${e.url.slice(0, 60)}» no es una dirección web: copiá el enlace completo desde el navegador.`; }
    if (u.protocol !== 'https:') return 'El enlace tiene que empezar con https://.';
  }
  return '';
}

export default function EnlacesRapidos() {
  const [enlaces, setEnlaces] = useState<EnlaceRapido[]>([]);
  // Si no se pudieron leer, NO se muestra como «sin enlaces»: guardar desde ahí borraría los que hay.
  const [estado, setEstado] = useState<'leyendo' | 'ok' | 'error'>('leyendo');
  const [editando, setEditando] = useState<EnlaceRapido[] | null>(null);
  /** La lista guardada cuando se abrió el editor: el servidor no guarda si cambió en el medio. */
  const [base, setBase] = useState<EnlaceRapido[]>([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const leer = useCallback(async () => {
    setEstado('leyendo');
    try {
      const r = await fetch('/api/control-facturas?enlaces=1', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(d?.enlaces)) throw new Error(d?.error || `Error ${r.status}`);
      setEnlaces(d.enlaces); setEstado('ok');
    } catch { setEstado('error'); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura inicial
  useEffect(() => { leer(); }, [leer]);

  function abrir() {
    setError(''); setBase(enlaces);
    setEditando(enlaces.length ? enlaces.map((e) => ({ ...e })) : [{ nombre: NOMBRE_SUGERIDO, url: '' }]);
  }
  const cambiar = (i: number, campo: keyof EnlaceRapido, valor: string) =>
    setEditando((l) => l && l.map((e, j) => (j === i ? { ...e, [campo]: valor } : e)));

  async function guardar() {
    if (!editando) return;
    // Las filas sin enlace no se guardan (así se quita uno: borrando su enlace o con «Quitar»).
    const lista = editando.map((e) => ({ nombre: e.nombre.trim(), url: e.url.trim() })).filter((e) => e.url);
    const err = errorEnlaces(lista);
    if (err) { setError(err); return; }
    setGuardando(true); setError('');
    try {
      const d = await apiControl({ accion: 'guardarEnlaces', enlaces: lista, antes: base });
      setEnlaces(Array.isArray(d.enlaces) ? d.enlaces : lista);
      setEditando(null);
    } catch (e) {
      setError(mensaje(e));
      // Otra pantalla los cambió: se leen de nuevo para que al volver a abrir se parta de lo guardado.
      if (/cambiaron/.test(mensaje(e))) { setEditando(null); await leer(); }
    }
    finally { setGuardando(false); }
  }

  return (
    <>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {enlaces.map((e, i) => (
          <a key={i} href={e.url} target="_blank" rel="noopener noreferrer" title={`Abrir «${e.nombre}» en otra pestaña`}
            style={{ ...boton, textDecoration: 'none', background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.55)' }}>
            📊 {e.nombre}
          </a>
        ))}
        {estado === 'error' && (
          <span style={{ fontSize: '0.8rem', color: '#fbbf24' }}>
            No pude leer las planillas guardadas. <button style={botonChico} onClick={leer}>🔄 Reintentar</button>
          </span>
        )}
        {estado === 'ok' && (
          <button style={enlaces.length ? botonChico : boton} onClick={() => (editando ? setEditando(null) : abrir())}
            title={enlaces.length ? 'Agregar, cambiar o quitar planillas' : 'Guardar el enlace de una planilla para abrirla desde acá'}>
            {enlaces.length ? '✏️' : '➕ Agregar planilla (Excel)'}
          </button>
        )}
      </div>
      {editando && (
        <div style={{ flexBasis: '100%', padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.84rem' }}>
          <div style={{ marginBottom: 8, opacity: 0.85 }}>
            Pegá el enlace de la planilla (Google Sheets, Drive, OneDrive…), tal como lo copiás del navegador. Se abre en otra pestaña y queda guardado para todos los que usan la app.
          </div>
          {editando.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
              <input style={{ ...inputSt, width: 240 }} placeholder="Nombre del botón" value={e.nombre} maxLength={60}
                onChange={(ev) => cambiar(i, 'nombre', ev.target.value)} />
              <input style={{ ...inputSt, flex: 1, minWidth: 220 }} placeholder="https://docs.google.com/spreadsheets/…" value={e.url}
                onChange={(ev) => cambiar(i, 'url', ev.target.value)} />
              <button style={botonChico} onClick={() => setEditando((l) => l && l.filter((_, j) => j !== i))}>Quitar</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
            <button style={{ ...boton, background: '#6366f1', border: '1px solid #6366f1' }} disabled={guardando} onClick={guardar}>💾 Guardar</button>
            <button style={botonChico} disabled={guardando} onClick={() => setEditando(null)}>Cancelar</button>
            {editando.length < MAX && <button style={botonChico} onClick={() => setEditando((l) => l && [...l, { nombre: '', url: '' }])}>➕ Otra planilla</button>}
            {guardando && <span style={{ opacity: 0.7 }}>Guardando…</span>}
          </div>
          {error && <div style={{ color: '#f87171', marginTop: 6, fontWeight: 'bold' }}>⚠ {error}</div>}
        </div>
      )}
    </>
  );
}
