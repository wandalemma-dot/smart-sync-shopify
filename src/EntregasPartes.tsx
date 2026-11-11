// Botones y recuadros compartidos de Control de entregas.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { boton, botonChico } from './utils/entregasUi';

export function Copiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [ok, setOk] = useState(false);
  return <button style={botonChico}
    onClick={() => navigator.clipboard.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}>
    {ok ? '✔ Copiado' : etiqueta}</button>;
}

/** Botón que abre el selector de archivos. */
export function Archivo({ etiqueta, accept, multiple, disabled, estilo = boton, onArchivos }: {
  etiqueta: string; accept: string; multiple?: boolean; disabled?: boolean; estilo?: CSSProperties; onArchivos: (f: File[]) => void;
}) {
  return (
    <label style={{ ...estilo, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
      {etiqueta}
      <input type="file" accept={accept} multiple={multiple} hidden disabled={disabled}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onArchivos(f); }} />
    </label>
  );
}

export function Parte({ ok, titulo, detalle, children }: { ok: boolean; titulo: string; detalle: string; children?: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${ok ? 'rgba(52,211,153,0.35)' : 'rgba(251,191,36,0.6)'}`, borderRadius: 8, padding: '6px 10px', background: ok ? 'rgba(52,211,153,0.06)' : 'rgba(251,191,36,0.08)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.84rem' }}>
      <span><strong>{ok ? '✔' : '✗'} {titulo}</strong> <span style={{ opacity: 0.8 }}>{detalle}</span></span>
      {children}
    </div>
  );
}
