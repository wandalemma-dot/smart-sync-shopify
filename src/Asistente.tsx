// ============================================================================
// PESTAÑA ASISTENTE — chat con IA para el día a día de iD (Converse y Le Coq)
// ----------------------------------------------------------------------------
// 9-nov-2026, pedido de gax. Ayuda con carga de stock, costos ponderados,
// órdenes pendientes y control de remito / factura / nota de pedido.
// El servidor (api/asistente.js) hace las consultas a Shopify, SOLO LECTURA.
// El conocimiento de cada marca está en server/conocimiento/.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

type Adjunto = { nombre: string; tipo: 'texto' | 'pdf' | 'imagen'; datos: string; media?: string };
type Turno = { rol: 'user' | 'assistant'; texto: string; adjuntos?: Adjunto[] };
type Marca = { id: string; nombre: string; proveedor: string };

// Vercel acepta hasta ~4,5 MB por pedido: dejamos margen.
const LIMITE_BYTES = 4_000_000;

const ATAJOS: { titulo: string; texto: string }[] = [
  { titulo: '📦 Órdenes pendientes', texto: '¿Qué órdenes tienen unidades pendientes en iD para esta marca? Agrupalas por producto y talle.' },
  { titulo: '⚖️ Costo ponderado', texto: 'Con la factura adjunta, calculá el costo ponderado de cada artículo usando el stock actual de Martínez y el costo guardado en Shopify.' },
];

function base64(buf: ArrayBuffer): string {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function imagenReducida(file: File): Promise<Adjunto> {
  const bmp = await createImageBitmap(file);
  const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { nombre: file.name, tipo: 'imagen', media: 'image/jpeg', datos: dataUrl.split(',')[1] };
}

async function leerAdjunto(file: File): Promise<Adjunto> {
  const nombre = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return imagenReducida(file);
  if (nombre.endsWith('.pdf')) return { nombre: file.name, tipo: 'pdf', datos: base64(await file.arrayBuffer()) };
  if (/\.(xlsx|xls|xlsb|csv)$/.test(nombre)) {
    const wb = XLSX.read(await file.arrayBuffer());
    const hojas = wb.SheetNames.filter((_, i) => !wb.Workbook?.Sheets?.[i]?.Hidden);
    const texto = hojas.map(h => `### Hoja ${h}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[h], { blankrows: false })).join('\n\n');
    return { nombre: file.name, tipo: 'texto', datos: texto };
  }
  if (/\.(txt|md)$/.test(nombre)) return { nombre: file.name, tipo: 'texto', datos: await file.text() };
  throw new Error(`No sé leer «${file.name}». Subí Excel, CSV, PDF o una foto.`);
}

/** Markdown mínimo: títulos, negrita, listas y tablas. */
function Texto({ texto }: { texto: string }) {
  const bloques: React.ReactNode[] = [];
  const lineas = texto.split('\n');
  const negrita = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p);
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (l.trim().startsWith('|')) {
      const filas: string[][] = [];
      while (i < lineas.length && lineas[i].trim().startsWith('|')) {
        const celdas = lineas[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!celdas.every(c => /^:?-{2,}:?$/.test(c))) filas.push(celdas);
        i++;
      }
      i--;
      const [cab, ...resto] = filas;
      bloques.push(<div key={i} style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead><tr>{cab.map((c, j) => <th key={j} style={celda(true)}>{negrita(c)}</th>)}</tr></thead>
        <tbody>{resto.map((f, k) => <tr key={k}>{f.map((c, j) => <td key={j} style={celda(false)}>{negrita(c)}</td>)}</tr>)}</tbody>
      </table></div>);
    } else if (/^#{1,4} /.test(l)) bloques.push(<div key={i} style={{ fontWeight: 'bold', marginTop: 10 }}>{negrita(l.replace(/^#+ /, ''))}</div>);
    else if (/^\s*[-*] /.test(l)) bloques.push(<div key={i} style={{ paddingLeft: 14 }}>• {negrita(l.replace(/^\s*[-*] /, ''))}</div>);
    else bloques.push(<div key={i} style={{ minHeight: l.trim() ? undefined : 8 }}>{negrita(l)}</div>);
  }
  return <>{bloques}</>;
}
const celda = (cab: boolean): React.CSSProperties => ({ border: '1px solid rgba(255,255,255,0.15)', padding: '4px 8px', textAlign: 'left', background: cab ? 'rgba(255,255,255,0.08)' : undefined });

export default function Asistente() {
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [configurado, setConfigurado] = useState<boolean | null>(null);
  const [marca, setMarca] = useState('converse');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/asistente', { cache: 'no-store' }).then(r => r.json())
      .then(d => { setMarcas(d.marcas || []); setConfigurado(d.configurado === true); })
      .catch(() => setError('No se pudo conectar con el asistente.'));
  }, []);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth' }); }, [turnos, cargando]);

  async function agregarArchivos(files: FileList | null) {
    if (!files) return;
    setError('');
    try {
      const nuevos = await Promise.all([...files].map(leerAdjunto));
      setAdjuntos(a => [...a, ...nuevos].slice(0, 10));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.'); }
  }

  async function enviar(mensaje = texto) {
    if (!mensaje.trim() || cargando) return;
    const nuevos: Turno[] = [...turnos, { rol: 'user', texto: mensaje.trim(), adjuntos: adjuntos.length ? adjuntos : undefined }];
    const body = JSON.stringify({ marca, turnos: nuevos });
    if (body.length > LIMITE_BYTES) {
      setError('Los archivos de esta conversación pesan demasiado. Empezá una conversación nueva o subí menos fotos.');
      return;
    }
    setTurnos(nuevos); setTexto(''); setAdjuntos([]); setError(''); setCargando(true);
    try {
      const r = await fetch('/api/asistente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'El asistente no pudo responder.');
      setTurnos([...nuevos, { rol: 'assistant', texto: d.texto }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'El asistente no pudo responder.');
      setTurnos(turnos); setTexto(mensaje); setAdjuntos(nuevos[nuevos.length - 1].adjuntos || []);
    } finally { setCargando(false); }
  }

  const caja: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 16 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...caja, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <strong>🤖 Asistente</strong>
        <label>Marca:{' '}
          <select value={marca} onChange={e => { setMarca(e.target.value); setTurnos([]); }} disabled={cargando}>
            {marcas.map(m => <option key={m.id} value={m.id}>{m.nombre} ({m.proveedor})</option>)}
          </select>
        </label>
        <button onClick={() => { setTurnos([]); setAdjuntos([]); setError(''); }} disabled={cargando}>Nueva conversación</button>
        <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Solo consulta: no cambia stock, precios ni productos.</span>
      </div>

      {configurado === false && <div role="alert" style={{ ...caja, borderColor: '#fbbf24' }}>
        Falta cargar la clave <code>ANTHROPIC_API_KEY</code> en Vercel para que el asistente funcione.
      </div>}

      {turnos.length === 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ATAJOS.map(a => <button key={a.titulo} onClick={() => setTexto(a.texto)} style={{ padding: '8px 12px' }}>{a.titulo}</button>)}
      </div>}

      <div style={{ ...caja, minHeight: 200, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {turnos.length === 0 && <div style={{ opacity: 0.7 }}>
          Preguntá por un código, pedí las órdenes pendientes o calculá un costo ponderado. Para controlar una entrega usá «Nueva entrega», arriba.
        </div>}
        {turnos.map((t, i) => <div key={i} style={{ alignSelf: t.rol === 'user' ? 'flex-end' : 'stretch', maxWidth: t.rol === 'user' ? '80%' : '100%',
          background: t.rol === 'user' ? 'rgba(99,102,241,0.25)' : 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 12px', whiteSpace: t.rol === 'user' ? 'pre-wrap' : undefined }}>
          {t.rol === 'user' ? t.texto : <Texto texto={t.texto} />}
          {t.adjuntos?.length ? <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: 6 }}>📎 {t.adjuntos.map(a => a.nombre).join(', ')}</div> : null}
        </div>)}
        {cargando && <div style={{ opacity: 0.7 }}>Pensando… (puede tardar un minuto si consulta Shopify o lee varios documentos)</div>}
        <div ref={fin} />
      </div>

      {error && <div role="alert" style={{ color: '#f87171' }}>{error}</div>}

      <div style={{ ...caja, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {adjuntos.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {adjuntos.map((a, i) => <span key={i} style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: 6 }}>
            📎 {a.nombre} <button onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))} style={{ padding: '0 4px' }}>✕</button>
          </span>)}
        </div>}
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} placeholder="Escribí tu consulta…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: 8 }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ cursor: 'pointer' }}>📎 Adjuntar (Excel, CSV, PDF o fotos)
            <input type="file" multiple accept=".xlsx,.xls,.xlsb,.csv,.pdf,.txt,image/*" style={{ display: 'none' }}
              onChange={e => { agregarArchivos(e.target.files); e.target.value = ''; }} />
          </label>
          <button onClick={() => enviar()} disabled={cargando || !texto.trim() || configurado === false} style={{ marginLeft: 'auto', padding: '8px 18px' }}>Enviar</button>
        </div>
      </div>
    </div>
  );
}
