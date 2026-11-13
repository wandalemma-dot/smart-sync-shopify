import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

export default function AccessGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/session', { cache: 'no-store' }).then(r => r.json())
      .then(d => setAuthenticated(d.authenticated === true))
      .catch(() => setError('No se pudo verificar el acceso.'))
      .finally(() => setLoading(false));
  }, []);
  async function signIn(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo ingresar.');
      setKey(''); setAuthenticated(data.authenticated === true);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo ingresar.'); }
    finally { setLoading(false); }
  }
  if (authenticated) return <>
    <div role="status" style={{ padding: 12, background: '#fff3cd', color: '#332700' }}>
      Para actualizar el stock de ID, simulá los cambios y confirmalos en el panel de stock.
      <button style={{ marginLeft: 16 }} onClick={async () => {
        const r = await fetch('/api/session', { method: 'DELETE' });
        if (r.ok) setAuthenticated(false);
      }}>Cerrar sesión</button>
    </div>{children}
  </>;
  return <main style={{ maxWidth: 440, margin: '12vh auto', padding: 24 }}>
    <h1>Acceso a Stock INDY</h1>
    <p>Ingresá la clave de esta app desde tu gestor de contraseñas.</p>
    <form onSubmit={signIn}>
      <label htmlFor="access-key">Clave de acceso</label>
      <input id="access-key" type="password" autoComplete="current-password" value={key} onChange={e => setKey(e.target.value)} required style={{ display: 'block', width: '100%', margin: '12px 0' }} />
      <button disabled={loading}>{loading ? 'Verificando…' : 'Ingresar'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </main>;
}
