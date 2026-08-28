import { useState, useRef } from 'react';
import { processFiles, extractSheetNames, downloadUpdateCSV, downloadMatrixCSV, downloadInventoryCSV, autoConverseTable } from './utils/syncLogic';
import type { SyncConfig, SyncResult } from './utils/syncLogic';
import { planStockWrite, executeStockWrite, activarEnSucursal } from './utils/writeStock';
import type { StockPlan } from './utils/writeStock';
import { createProducts } from './utils/createProducts';
import { aplicarPrecios, actualizacionesAplicables, sinCambios, margenPct } from './utils/updatePrices';
import Reposicion from './Reposicion';

export default function App() {
  // Pestaña activa: sincronización (lo de siempre) o reposición (pedido a iD).
  const [tab, setTab] = useState<'sync' | 'reposicion'>('sync');
  const [providerFile, setProviderFile] = useState<File | null>(null);

  const [sheets, setSheets] = useState<string[]>([]);

  const [config, setConfig] = useState<SyncConfig>({
    sheetName: '',
    brand: 'converse'
  });

  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [tableSelections, setTableSelections] = useState<Record<string, number>>({});

  // Resumen antes de confirmar
  const [previewReady, setPreviewReady] = useState(false);

  // ---- ESCRITURA DE STOCK EN SHOPIFY (simular -> confirmar -> escribir) ----
  const [stockPlan, setStockPlan] = useState<StockPlan | null>(null);
  const [stockPlanning, setStockPlanning] = useState(false);
  const [stockWriting, setStockWriting] = useState(false);
  const [writeConfirm, setWriteConfirm] = useState(false);
  const [writeDone, setWriteDone] = useState<string | null>(null);
  // Buscador del simulador: filtra las 3 tablas por código, producto o talle.
  // Es SOLO visual: no cambia lo que se escribe en Shopify.
  const [stockBuscar, setStockBuscar] = useState('');
  // Alta en sucursal: paso APARTE, con su propia confirmación.
  const [altaConfirm, setAltaConfirm] = useState(false);
  const [altaLoading, setAltaLoading] = useState(false);
  const [altaDone, setAltaDone] = useState<string | null>(null);

  const handleActivar = async () => {
    if (!stockPlan || stockPlan.sinActivar.length === 0) return;
    setAltaLoading(true); setAltaDone(null);
    try {
      const res = await activarEnSucursal(stockPlan);
      setAltaDone(`Dadas de alta ${res.written} · fallidas ${res.failed}` + (res.errors.length ? ` · ${res.errors.slice(0, 2).join(' | ')}` : ''));
      setAltaConfirm(false);
    } catch (e: any) {
      alert('Error dando de alta: ' + e.message);
    } finally {
      setAltaLoading(false);
    }
  };

  // ---- ACTUALIZAR PRECIOS Y COSTOS DIRECTO EN SHOPIFY ----
  const [precioConfirm, setPrecioConfirm] = useState(false);
  const [precioLoading, setPrecioLoading] = useState(false);
  const [precioDone, setPrecioDone] = useState<string | null>(null);
  // Qué se toca y de qué variantes (por defecto: todo).
  const [tocarPrecio, setTocarPrecio] = useState(true);
  const [tocarCosto, setTocarCosto] = useState(true);
  const [excluidas, setExcluidas] = useState<Record<string, boolean>>({});

  // Los que YA están en Martínez vienen destildados: ese stock ya se compró al
  // costo viejo, así que no se les cambia el precio (se puede tildar a mano).
  const vieneDestildada = (u: { variantId: string; stockMartinez?: number }) =>
    excluidas[u.variantId] ?? ((u.stockMartinez || 0) > 0);

  const seleccionadas = (r: SyncResult) =>
    actualizacionesAplicables(r).filter(u => !vieneDestildada(u));

  const handleAplicarPrecios = async () => {
    if (!result) return;
    setPrecioLoading(true); setPrecioDone(null);
    try {
      const res = await aplicarPrecios(seleccionadas(result), { precio: tocarPrecio, costo: tocarCosto });
      setPrecioDone(`Actualizadas ${res.actualizadas} variantes · fallidas ${res.fallidas}` + (res.errores.length ? ` · ${res.errores.slice(0, 2).join(' | ')}` : ''));
      setPrecioConfirm(false);
    } catch (e: any) {
      alert('Error actualizando precios: ' + e.message);
    } finally {
      setPrecioLoading(false);
    }
  };

  // ---- CREAR PRODUCTOS NUEVOS EN SHOPIFY (borrador) ----
  const [creating, setCreating] = useState(false);
  const [createConfirm, setCreateConfirm] = useState(false);
  const [createDone, setCreateDone] = useState<string | null>(null);
  // Productos que NO se van a crear. Por defecto se crean todos; acá quedan los
  // que Wanda destilda (cordones, medias sueltas, cosas que no quiere publicar).
  const [noCrear, setNoCrear] = useState<Record<string, boolean>>({});

  const paraCrear = (r: SyncResult) => r.missingProducts.filter(p => !noCrear[p.coditm]);

  const handleCreateProducts = async (limit?: number) => {
    if (!result) return;
    const elegidos = paraCrear(result).map(p => p.coditm);
    if (elegidos.length === 0) { alert('No hay ningún producto tildado para crear.'); return; }
    setCreating(true); setCreateDone(null);
    try {
      const res = await createProducts(result, config, tableSelections, elegidos, limit);
      setCreateDone(`Creados ${res.created} · fallidos ${res.failed}` + (res.errors.length ? ` · ${res.errors.slice(0, 2).join(' | ')}` : ''));
    } catch (e: any) {
      alert('Error creando productos: ' + e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSimulateStock = async () => {
    if (!result) return;
    setStockPlanning(true); setStockPlan(null); setWriteDone(null); setWriteConfirm(false);
    try {
      const plan = await planStockWrite(result, config);
      setStockPlan(plan);
      if (!plan.locationFound) alert(`No encontré la sucursal "${plan.locationName}" en Shopify. Revisá el nombre exacto.`);
    } catch (e: any) {
      alert('Error simulando: ' + e.message);
    } finally {
      setStockPlanning(false);
    }
  };

  const handleWriteStock = async () => {
    if (!stockPlan || stockPlan.changes.length === 0) return;
    setStockWriting(true); setWriteDone(null);
    try {
      const res = await executeStockWrite(stockPlan);
      setWriteDone(`Escritos ${res.written} · fallidos ${res.failed}` + (res.errors.length ? ` · ${res.errors.slice(0, 2).join('; ')}` : ''));
      setStockPlan(null); setWriteConfirm(false);
    } catch (e: any) {
      alert('Error escribiendo: ' + e.message);
    } finally {
      setStockWriting(false);
    }
  };

  // Inputs de archivo ocultos: permiten seleccionar con un clic además de arrastrar.
  const providerInputRef = useRef<HTMLInputElement>(null);

  // La SÁBANA DE PRECIOS se sacó el 20-ago-2026: la PlantillaPedido de iD ya
  // trae el precio de lista, y el sugerido de los básicos se calcula (x1,87).
  // processFiles() sigue aceptando una sábana por compatibilidad, pero la app
  // ya no la pide.

  // --- Lógica central de cada archivo, reutilizada por drag & drop y por clic ---
  const processProviderFile = async (file: File) => {
    if (!file) return;
    if (config.brand === 'bloque' && !/\.(pdf|xlsx|xls)$/i.test(file.name)) {
      alert("⚠️ Error: Para Bloque subí el PRESUPUESTO en PDF, o un Excel (.xlsx).");
      return;
    }
    if (config.brand !== 'bloque' && !file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
      alert("⚠️ Error: Por favor, subí el archivo Excel (.xlsx o .xls).");
      return;
    }
    setProviderFile(file);
    try {
      if (config.brand !== 'bloque') {
        const names = await extractSheetNames(file);
        setSheets(names);
        if (names.length > 0) {
          setConfig(prev => ({ ...prev, sheetName: names[0] }));
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleProviderDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processProviderFile(file);
  };

  const preventDefault = (e: React.DragEvent) => e.preventDefault();

  const handleAnalyze = async (overrideBrand?: SyncConfig['brand']) => {
    if (!providerFile) return;
    // La cajita de órdenes puede pedir analizar una marca distinta a la elegida.
    const cfg: SyncConfig = overrideBrand ? { ...config, brand: overrideBrand } : config;
    if (overrideBrand && overrideBrand !== config.brand) setConfig(cfg);

    setLoading(true);
    setLoadingText('Analizando archivos y conectando con Shopify...');
    setResult(null);
    setPreviewReady(false);

    try {
      const res = await processFiles(providerFile, null, null, cfg, null);
      setResult(res);
      setPreviewReady(true);
    } catch (err: any) {
      alert("Error analizando: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (type: 'updates' | 'matrix' | 'inventory') => {
    if (!result) return;
    try {
      if (type === 'updates') {
        downloadUpdateCSV(result, config);
      } else if (type === 'matrix') {
        downloadMatrixCSV(result, config, tableSelections);
      } else if (type === 'inventory') {
        downloadInventoryCSV(result, config);
      }
    } catch (err: any) {
      alert("Error al generar CSV: " + err.message);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Sincronización de Stock e Inventario</h1>
        <p className="subtitle">Automatización Inteligente</p>
      </header>

      {/* ====== PESTAÑAS ====== */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1.2rem' }}>
        {([['sync', '🔄 Sincronización'], ['reposicion', '📦 Reposición']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '10px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold',
              border: tab === id ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.15)',
              background: tab === id ? '#6366f1' : 'rgba(255,255,255,0.05)',
              color: 'white',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'reposicion' ? <Reposicion /> : (<>

      {!previewReady ? (
        <div className="main-grid">
          <div className="glass-panel dropzone-container">
            <h2>1. Archivos del Proveedor</h2>

            <input
              ref={providerInputRef}
              type="file"
              accept={config.brand === 'bloque' ? '.pdf,.xlsx,.xls' : '.xlsx,.xls'}
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) processProviderFile(f); e.target.value = ''; }}
            />
            <div
              className={`dropzone ${providerFile ? 'has-file' : ''}`}
              onDrop={handleProviderDrop} onDragOver={preventDefault}
              onClick={() => providerInputRef.current?.click()}
              style={{ cursor: 'pointer' }}
            >
              <h3>{providerFile ? '📄 Archivo Principal Listo' : (config.brand === 'bloque' ? '📥 Arrastrá o hacé clic: PRESUPUESTO (PDF) o Excel' : '📥 Arrastrá o hacé clic: Excel del Proveedor')}</h3>
              <p>{providerFile?.name}</p>
            </div>

            <p style={{ marginTop: '0.8rem', fontSize: '0.85rem', opacity: 0.75, textAlign: 'center' }}>
              🔗 La app se conecta sola a Shopify. No necesitás subir ningún CSV.
            </p>
          </div>

          <div className="glass-panel settings-panel">
            <h2>2. Configuración</h2>

            <div className="form-group">
              <label>Marca a procesar</label>
              <select
                value={config.brand}
                onChange={e => {
                  setConfig({...config, brand: e.target.value as any});
                  setProviderFile(null);
                }}
              >
                <option value="converse">Converse</option>
                <option value="lecoq">Le Coq Sportif</option>
                <option value="orchard">Orchard</option>
                <option value="luxo">Luxo</option>
                <option value="vart">Vart</option>
                <option value="bloque">Bloque (PDFs)</option>
              </select>
            </div>

            {config.brand === 'vart' && (
              <p style={{ fontSize: '0.8rem', color: '#fbbf24', marginTop: '0.4rem' }}>
                🆕 <strong>Vart</strong> usa la <strong>plantilla de carga de INDY</strong> (hoja «Carga Productos»).
                El <strong>precio</strong> sale de la columna del Excel y los <strong>talles van tal cual</strong> (no hay conversión).
                Pendientes: el <strong>descuento comercial</strong> y el nombre exacto de la <strong>sucursal</strong> en Shopify.
              </p>
            )}

            {config.brand !== 'bloque' && sheets.length > 0 && (
              <div className="form-group">
                <label>Pestaña del Excel</label>
                <select
                  value={config.sheetName}
                  onChange={e => setConfig({...config, sheetName: e.target.value})}
                >
                  {sheets.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            <button
              className="btn-primary"
              onClick={() => handleAnalyze()}
              disabled={!providerFile || loading}
            >
              {loading ? <span className="loader"></span> : '🔍 Analizar y Preparar Resumen'}
            </button>
            {loading && <p style={{marginTop: '10px', textAlign: 'center'}}>{loadingText}</p>}
          </div>
        </div>
      ) : (
        <div className="glass-panel results-area" style={{ marginTop: '2rem' }}>
          <div className="results-header">
            <h2>📊 RESUMEN ANTES DE SINCRONIZAR</h2>
            <button
              className="btn-success"
              style={{ background: '#dc2626', marginLeft: '10px' }}
              onClick={() => { setResult(null); setPreviewReady(false); }}
            >
              ❌ Cancelar
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
            <div className="stat-card" style={{ background: 'rgba(255,255,255,0.1)', padding: '20px', borderRadius: '10px' }}>
              <h3>🔄 Actualizaciones de Precio</h3>
              <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{result?.updatesToApply.length || 0} variantes</p>
            </div>
            <div className="stat-card" style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '20px', borderRadius: '10px', border: '1px solid #f59e0b' }}>
              <h3 style={{ color: '#f59e0b' }}>📦 Faltantes (Nuevos)</h3>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>{result?.missingProducts.length || 0} modelos</p>
            </div>
          </div>

          {result?.alerts && result.alerts.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ marginBottom: '0.8rem' }}>
                🔎 Revisión de stock y precios ({result.alerts.length})
              </h3>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '0.8rem', fontSize: '0.85rem', opacity: 0.9 }}>
                <span>📦 Stock distinto: <strong>{result.alerts.filter(a => a.title === 'Stock distinto').length}</strong></span>
                <span>💲 Precio distinto: <strong>{result.alerts.filter(a => a.title === 'Precio distinto').length}</strong></span>
                <span>➕ Talles faltantes: <strong>{result.alerts.filter(a => a.type === 'info').length}</strong></span>
              </div>
              <div style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {result.alerts.map((a, i) => {
                  const color = a.type === 'danger' ? '#dc2626' : a.type === 'warning' ? '#f59e0b' : '#6366f1';
                  const bg = a.type === 'danger' ? 'rgba(220,38,38,0.10)' : a.type === 'warning' ? 'rgba(245,158,11,0.10)' : 'rgba(99,102,241,0.10)';
                  return (
                    <div key={i} style={{ padding: '0.5rem 0.7rem', borderLeft: `3px solid ${color}`, background: bg, borderRadius: '4px', fontSize: '0.85rem' }}>
                      <strong style={{ color }}>{a.title}</strong> — {a.message}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ====== ACTUALIZAR PRECIOS Y COSTOS DIRECTO EN SHOPIFY ====== */}
          {result && (actualizacionesAplicables(result).length > 0 || sinCambios(result).length > 0) && (
            <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #3b82f6', borderRadius: '8px', background: 'rgba(59,130,246,0.06)' }}>
              <h3 style={{ color: '#60a5fa', marginTop: 0 }}>💲 Actualizar precios y costos en Shopify</h3>
              <p style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 0 }}>
                Cambia <strong>solo precio y costo</strong> de {actualizacionesAplicables(result).length} variantes.
                No toca fotos, descripciones ni canales de venta (a diferencia de importar un CSV).
                {sinCambios(result).length > 0 && (
                  <> Las <strong style={{ color: '#6ee7b7' }}>{sinCambios(result).length} en verde</strong> ya están bien: no se tocan.</>
                )}
              </p>
              {/* Qué se toca */}
              <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.7rem', fontSize: '0.9rem' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={tocarPrecio} onChange={e => setTocarPrecio(e.target.checked)} />
                  Cambiar <strong style={{ color: '#60a5fa' }}>&nbsp;precio</strong>
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={tocarCosto} onChange={e => setTocarCosto(e.target.checked)} />
                  Cambiar <strong style={{ color: '#34d399' }}>&nbsp;costo</strong>
                </label>
                <span style={{ opacity: 0.6 }}>|</span>
                <button onClick={() => setExcluidas({})}
                  style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: 'white', fontSize: '0.8rem' }}>
                  Marcar todos
                </button>
                <button onClick={() => setExcluidas(Object.fromEntries(actualizacionesAplicables(result).map(u => [u.variantId, true])))}
                  style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: 'white', fontSize: '0.8rem' }}>
                  Desmarcar todos
                </button>
                <span style={{ marginLeft: 'auto', opacity: 0.85 }}>
                  Seleccionadas: <strong>{seleccionadas(result).length}</strong> de {actualizacionesAplicables(result).length}
                </span>
              </div>
              {actualizacionesAplicables(result).some(u => (u.stockMartinez || 0) > 0) && (
                <p style={{ fontSize: '0.8rem', color: '#fbbf24', marginTop: 0 }}>
                  📦 Los que ya tienen stock en <strong>Martínez</strong> vienen <strong>destildados</strong>: ese stock
                  ya lo compraste al costo viejo. Si igual querés cambiarles el precio, tildalos a mano.
                </p>
              )}
              {(() => {
                // Cuántas cambian el precio de venta y cuántas solo el costo.
                // Las de "solo costo" son casi siempre los básicos de Converse,
                // que van fijos al precio sugerido del proveedor.
                const todas = actualizacionesAplicables(result);
                const conPrecio = todas.filter(u => u.newPrice !== undefined && u.oldPrice !== undefined && Number(u.newPrice) !== Number(u.oldPrice)).length;
                const soloCosto = todas.length - conPrecio;
                if (!todas.length) return null;
                return (
                  <p style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: 0 }}>
                    🔢 <strong>{conPrecio}</strong> cambian el <strong>precio de venta</strong> · <strong>{soloCosto}</strong> cambian
                    {' '}<strong>solo el costo</strong> (los básicos de Converse van siempre al precio sugerido).
                    {' '}Primero te muestro las que cambian de precio.
                    {todas.length > 300 && <> Se listan las primeras <strong>300</strong> de {todas.length}; se aplican todas las tildadas.</>}
                  </p>
                );
              })()}

              <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', marginBottom: '0.8rem' }}>
                <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: '#1f2937' }}>
                      <th style={{ padding: '6px' }}></th>
                      <th style={{ textAlign: 'left', padding: '6px 10px' }}>Producto</th>
                      <th style={{ padding: '6px' }}>Talle</th>
                      <th style={{ padding: '6px' }}>Precio</th>
                      <th style={{ padding: '6px' }}>Costo</th>
                      <th style={{ padding: '6px' }}>Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actualizacionesAplicables(result).slice(0, 300).map((u, i) => {
                      const off = vieneDestildada(u);
                      const enMartinez = (u.stockMartinez || 0) > 0;
                      // Margen que va a quedar según lo que se aplique.
                      const pFinal = tocarPrecio ? (u.newPrice ?? 0) : (u.oldPrice ?? 0);
                      const cFinal = tocarCosto ? (u.newCost ?? 0) : (u.oldCost ?? 0);
                      const m = margenPct(pFinal, cFinal);
                      return (
                      <tr key={`c${i}`} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', opacity: off ? 0.35 : 1 }}>
                        <td style={{ padding: '6px', textAlign: 'center' }}>
                          <input type="checkbox" checked={!off}
                            onChange={e => setExcluidas({ ...excluidas, [u.variantId]: !e.target.checked })} />
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          {u.title}
                          {enMartinez && (
                            <div style={{ fontSize: '0.7rem', color: '#fbbf24' }}>
                              📦 Ya está en Martínez ({u.stockMartinez}) — no se le cambia el precio
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '6px', textAlign: 'center' }}>{u.optionValue}</td>
                        <td style={{ padding: '6px', textAlign: 'center', opacity: tocarPrecio ? 1 : 0.35 }}>
                          <span style={{ opacity: 0.6 }}>{u.oldPrice}</span> → <strong style={{ color: '#60a5fa' }}>{tocarPrecio ? u.newPrice : '(sin tocar)'}</strong>
                        </td>
                        <td style={{ padding: '6px', textAlign: 'center', opacity: tocarCosto ? 1 : 0.35 }}>
                          <span style={{ opacity: 0.6 }}>{u.oldCost ?? '—'}</span> → <strong style={{ color: '#34d399' }}>{tocarCosto ? u.newCost : '(sin tocar)'}</strong>
                        </td>
                        <td style={{ padding: '6px', textAlign: 'center', fontWeight: 'bold', color: m === null ? undefined : m >= 50 ? '#34d399' : m >= 40 ? '#f59e0b' : '#f87171' }}>
                          {m === null ? '—' : `${m.toFixed(1)}%`}
                        </td>
                      </tr>
                      );
                    })}
                    {/* Al final, en verde: las que ya están bien y NO se tocan */}
                    {sinCambios(result).slice(0, 300).map((u, i) => (
                      <tr key={`s${i}`} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(16,185,129,0.10)', color: '#6ee7b7' }}>
                        <td style={{ padding: '6px 10px' }}>✅ {u.title}</td>
                        <td style={{ padding: '6px', textAlign: 'center' }}>{u.optionValue}</td>
                        <td style={{ padding: '6px', textAlign: 'center' }}>{u.oldPrice}</td>
                        <td style={{ padding: '6px', textAlign: 'center' }}>{u.oldCost ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={precioConfirm} onChange={e => setPrecioConfirm(e.target.checked)} />
                Revisé la lista y quiero <strong>&nbsp;aplicar estos precios y costos&nbsp;</strong> en Shopify.
              </label>
              <button
                className="btn-primary"
                style={{ background: precioConfirm ? '#3b82f6' : '#6b7280', marginTop: '0.6rem' }}
                onClick={handleAplicarPrecios}
                disabled={!precioConfirm || precioLoading || actualizacionesAplicables(result).length === 0}
              >
                {precioLoading ? <span className="loader"></span> : `💲 Aplicar en ${actualizacionesAplicables(result).length} variantes`}
              </button>
              {precioDone && <p style={{ marginTop: '0.8rem', color: '#60a5fa', fontWeight: 'bold' }}>✅ {precioDone}</p>}
            </div>
          )}

          {/* ====== CREAR PRODUCTOS NUEVOS DIRECTO EN SHOPIFY ======
               Antes esto estaba partido en dos cajas separadas: el botón acá y
               la tabla de talles al final de todo. Wanda pidió tenerlo junto,
               y poder elegir producto por producto cuál crear (hay cordones y
               cosas sueltas que no quiere publicar). */}
          {result?.missingProducts && result.missingProducts.length > 0 && (() => {
            const elegidos = paraCrear(result);
            const total = result.missingProducts.length;
            return (
            <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #8b5cf6', borderRadius: '8px', background: 'rgba(139,92,246,0.06)' }}>
              <h3 style={{ color: '#a78bfa', marginTop: 0 }}>🚀 Crear los nuevos directo en Shopify</h3>
              <p style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 0 }}>
                Se crean en <strong>Activo</strong>, publicados <strong>solo en Point of Sale</strong>, con el stock del archivo.
                Destildá lo que no quieras publicar. Probá primero con 1.
              </p>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.6rem', fontSize: '0.85rem' }}>
                <button style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: 'white', fontSize: '0.8rem' }}
                  onClick={() => setNoCrear({})}>Marcar todos</button>
                <button style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: 'white', fontSize: '0.8rem' }}
                  onClick={() => setNoCrear(Object.fromEntries(result.missingProducts.map(p => [p.coditm, true])))}>Desmarcar todos</button>
                <span style={{ marginLeft: 'auto', opacity: 0.85 }}>
                  Se van a crear: <strong style={{ color: '#a78bfa' }}>{elegidos.length}</strong> de {total}
                </span>
              </div>

              <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', marginBottom: '0.8rem' }}>
                {result.missingProducts.map(p => {
                  const off = !!noCrear[p.coditm];
                  const talles = Object.entries(p.sizes);
                  const unidades = talles.reduce((a, [, q]) => a + (Number(q) || 0), 0);
                  return (
                    <div key={p.coditm} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '0.5rem 0.6rem', borderBottom: '1px solid rgba(255,255,255,0.08)', opacity: off ? 0.4 : 1 }}>
                      <input type="checkbox" checked={!off}
                        onChange={e => setNoCrear({ ...noCrear, [p.coditm]: !e.target.checked })} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem' }}>
                          <strong style={{ fontFamily: 'monospace' }}>{p.coditm.toUpperCase()}</strong> — {p.title}
                        </div>
                        <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>
                          {talles.length} {talles.length === 1 ? 'talle' : 'talles'} · {unidades} unidades
                          {' · '}{talles.slice(0, 8).map(([t, q]) => `${t}:${q}`).join('  ')}{talles.length > 8 ? ' …' : ''}
                        </div>
                      </div>
                      {config.brand === 'converse' && (
                        <select
                          value={tableSelections[p.coditm] ?? autoConverseTable(p.coditm, p.sizes)}
                          onChange={e => setTableSelections({ ...tableSelections, [p.coditm]: parseInt(e.target.value) })}
                          disabled={off}
                          style={{ padding: '0.3rem', borderRadius: '4px', background: 'var(--bg-color)', color: 'white', border: '1px solid var(--glass-border)', fontSize: '0.78rem', maxWidth: '260px' }}
                        >
                          <option value={0}>🎒 Accesorio (sin talle)</option>
                          <option value={-1}>👕 Indumentaria (talle como viene)</option>
                          <option value={1}>👟 Tabla 1 (Empieza en ARG 34 = US 3)</option>
                          <option value={2}>👟 Tabla 2 (Empieza en ARG 35 = US 3)</option>
                          <option value={3}>👟 Tabla Mujer (Empieza en ARG 35 = US 5)</option>
                          <option value={4}>👟 Tabla Niño (Empieza en ARG 27 = US 10.5)</option>
                          <option value={5}>👟 Tabla Bebe (Empieza en ARG 20 = US 4)</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button className="btn-primary" style={{ background: '#3b82f6' }} onClick={() => handleCreateProducts(1)} disabled={creating || elegidos.length === 0}>
                  {creating ? <span className="loader"></span> : '🧪 Crear 1 de prueba (el primero tildado)'}
                </button>
              </div>
              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={createConfirm} onChange={e => setCreateConfirm(e.target.checked)} />
                Ya probé con 1 y quiero <strong>&nbsp;crear los tildados&nbsp;</strong> en Shopify.
              </label>
              <button
                className="btn-primary"
                style={{ background: createConfirm && elegidos.length > 0 ? '#8b5cf6' : '#6b7280', marginTop: '0.6rem' }}
                onClick={() => handleCreateProducts()}
                disabled={!createConfirm || creating || elegidos.length === 0}
              >
                {creating ? <span className="loader"></span> : `🚀 Crear ${elegidos.length} en Shopify`}
              </button>
              {createDone && <p style={{ marginTop: '0.8rem', color: '#a78bfa', fontWeight: 'bold' }}>✅ {createDone}</p>}
            </div>
            );
          })()}

          {/* ====== ESCRIBIR STOCK DIRECTO EN SHOPIFY ====== */}
          <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #10b981', borderRadius: '8px', background: 'rgba(16,185,129,0.06)' }}>
            <h3 style={{ color: '#10b981', marginTop: 0 }}>✍️ Escribir stock directo en Shopify</h3>
            <p style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 0 }}>
              Primero simulá: te muestro exactamente qué cambiaría, sin tocar nada. Recién si tildás la confirmación, se escribe.
            </p>
            <button className="btn-primary" style={{ background: '#3b82f6' }} onClick={handleSimulateStock} disabled={stockPlanning || stockWriting}>
              {stockPlanning ? <span className="loader"></span> : '🧪 Simular (ver qué cambiaría)'}
            </button>

            {stockPlan && stockPlan.locationFound && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.9rem', marginBottom: '0.6rem' }}>
                  📍 Sucursal: <strong>{stockPlan.locationName}</strong> · Cambios: <strong style={{ color: '#f59e0b' }}>{stockPlan.changes.length}</strong> · Sin cambios: {stockPlan.unchanged}
                  {stockPlan.notFound.length > 0 && <> · No ubicados: {stockPlan.notFound.length}</>}
                  {stockPlan.sinActivar.length > 0 && <> · <span style={{ color: '#c084fc' }}>Sin alta en la sucursal: <strong>{stockPlan.sinActivar.length}</strong></span></>}
                  {stockPlan.changes.some(c => c.motivo) && (
                    <> · <span style={{ color: '#f87171' }}>🗑️ A poner en 0 (el proveedor ya no los tiene): <strong>{stockPlan.changes.filter(c => c.motivo).length}</strong></span></>
                  )}
                </div>
                {/* Buscador: para poder confirmar qué pasó con UN producto puntual.
                    Filtra solo lo que se ve; NO cambia lo que se escribe. */}
                <input
                  type="text"
                  value={stockBuscar}
                  onChange={e => setStockBuscar(e.target.value)}
                  placeholder="🔎 Buscar por código, producto o talle (ej: A10564C)"
                  style={{
                    width: '100%', padding: '8px 10px', marginBottom: '0.6rem',
                    borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(0,0,0,0.25)', color: 'inherit', fontSize: '0.85rem',
                  }}
                />
                {(() => {
                  const q = stockBuscar.trim().toLowerCase();
                  const coincide = (r: { title: string; code: string; talle: string }) =>
                    !q || r.code.toLowerCase().includes(q)
                      || r.title.toLowerCase().includes(q)
                      || String(r.talle).toLowerCase().includes(q);
                  const fCambios = stockPlan.changes.filter(coincide);
                  const fIguales = stockPlan.unchangedRows.filter(coincide);
                  const fNoUbic = stockPlan.notFound.filter(coincide);
                  const fSinAlta = stockPlan.sinActivar.filter(coincide);

                  const caja = { maxHeight: '300px', overflowY: 'auto' as const, border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px' };
                  const th = { textAlign: 'left' as const, padding: '6px 10px' };
                  const tabla = { width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' as const };
                  const cab = { position: 'sticky' as const, top: 0, background: '#1f2937' };

                  return (
                    <>
                      {q && fCambios.length + fIguales.length + fNoUbic.length + fSinAlta.length === 0 && (
                        <p style={{ padding: '0.8rem', background: 'rgba(245,158,11,0.12)', border: '1px solid #f59e0b', borderRadius: '6px' }}>
                          ⚠️ <strong>«{stockBuscar}»</strong> no está en ninguna de las tres listas. Eso quiere decir que la app
                          no lo encontró en Shopify: fijate más abajo en <strong>Faltantes (Nuevos)</strong>.
                        </p>
                      )}

                      {/* --- 1) LO QUE SÍ SE VA A ESCRIBIR --- */}
                      {fCambios.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.85rem', margin: '0.4rem 0', color: '#f59e0b' }}>
                            ✍️ <strong>Se van a cambiar ({fCambios.length}{q ? ` de ${stockPlan.changes.length}` : ''})</strong>
                          </div>
                          <div style={caja}>
                            <table style={tabla}>
                              <thead>
                                <tr style={cab}>
                                  <th style={th}>Producto</th>
                                  <th style={{ ...th, padding: '6px' }}>Código</th>
                                  <th style={{ padding: '6px' }}>Talle</th>
                                  <th style={{ padding: '6px' }}>Actual</th>
                                  <th style={{ padding: '6px' }}>Nuevo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fCambios.map((c, i) => (
                                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: c.motivo ? 'rgba(220,38,38,0.10)' : undefined }}>
                                    <td style={{ padding: '6px 10px' }}>
                                      {c.title}
                                      {c.motivo && <div style={{ fontSize: '0.7rem', color: '#f87171' }}>🗑️ {c.motivo}</div>}
                                    </td>
                                    <td style={{ padding: '6px', fontFamily: 'monospace', opacity: 0.85 }}>{c.code}</td>
                                    <td style={{ padding: '6px', textAlign: 'center' }}>{c.talle}</td>
                                    <td style={{ padding: '6px', textAlign: 'center', opacity: 0.7 }}>{c.current}</td>
                                    <td style={{ padding: '6px', textAlign: 'center', fontWeight: 'bold', color: '#10b981' }}>{c.desired}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}

                      {/* --- 2) YA ESTABAN BIEN (no se tocan) --- */}
                      {fIguales.length > 0 && (
                        <details open={!!q} style={{ marginTop: '0.8rem' }}>
                          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#10b981' }}>
                            ✅ <strong>Ya estaban bien ({fIguales.length}{q ? ` de ${stockPlan.unchangedRows.length}` : ''})</strong>
                            <span style={{ opacity: 0.7 }}> — el stock de Shopify ya es igual al del proveedor. No se tocan.</span>
                          </summary>
                          <div style={{ ...caja, marginTop: '0.4rem' }}>
                            <table style={tabla}>
                              <thead>
                                <tr style={cab}>
                                  <th style={th}>Producto</th>
                                  <th style={{ ...th, padding: '6px' }}>Código</th>
                                  <th style={{ padding: '6px' }}>Talle proveedor</th>
                                  <th style={{ padding: '6px' }}>Talle Shopify</th>
                                  <th style={{ padding: '6px' }}>Stock</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fIguales.map((r, i) => (
                                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(16,185,129,0.07)' }}>
                                    <td style={{ padding: '6px 10px' }}>{r.title}</td>
                                    <td style={{ padding: '6px', fontFamily: 'monospace', opacity: 0.85 }}>{r.code}</td>
                                    <td style={{ padding: '6px', textAlign: 'center', opacity: 0.7 }}>{r.talleProveedor}</td>
                                    <td style={{ padding: '6px', textAlign: 'center' }}>{r.talle}</td>
                                    <td style={{ padding: '6px', textAlign: 'center', fontWeight: 'bold', color: '#10b981' }}>{r.current}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )}

                      {/* --- 3) NO UBICADOS: el producto existe, pero ese TALLE no --- */}
                      {fNoUbic.length > 0 && (
                        <details open={!!q} style={{ marginTop: '0.8rem' }}>
                          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#f59e0b' }}>
                            ❓ <strong>No ubicados ({fNoUbic.length}{q ? ` de ${stockPlan.notFound.length}` : ''})</strong>
                            <span style={{ opacity: 0.7 }}> — el producto está en Shopify, pero ese talle no existe ahí.</span>
                          </summary>
                          <div style={{ ...caja, marginTop: '0.4rem' }}>
                            <table style={tabla}>
                              <thead>
                                <tr style={cab}>
                                  <th style={th}>Producto</th>
                                  <th style={{ ...th, padding: '6px' }}>Código</th>
                                  <th style={{ padding: '6px' }}>Talle proveedor</th>
                                  <th style={{ padding: '6px' }}>Talle buscado</th>
                                  <th style={{ padding: '6px' }}>Cantidad</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fNoUbic.map((r, i) => (
                                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(245,158,11,0.07)' }}>
                                    <td style={{ padding: '6px 10px' }}>{r.title}</td>
                                    <td style={{ padding: '6px', fontFamily: 'monospace', opacity: 0.85 }}>{r.code}</td>
                                    <td style={{ padding: '6px', textAlign: 'center', opacity: 0.7 }}>{r.talleProveedor}</td>
                                    <td style={{ padding: '6px', textAlign: 'center' }}>{r.talle}</td>
                                    <td style={{ padding: '6px', textAlign: 'center' }}>{r.desired}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      )}
                      {/* --- 4) SIN ALTA EN LA SUCURSAL: hay que activarlas --- */}
                      {fSinAlta.length > 0 && (
                        <details open={!!q} style={{ marginTop: '0.8rem' }}>
                          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#c084fc' }}>
                            🏷️ <strong>Sin alta en la sucursal ({fSinAlta.length}{q ? ` de ${stockPlan.sinActivar.length}` : ''})</strong>
                            <span style={{ opacity: 0.7 }}> — existen en la tienda pero no están dadas de alta en {stockPlan.locationName}.</span>
                          </summary>
                          <p style={{ fontSize: '0.78rem', opacity: 0.85, margin: '0.4rem 0' }}>
                            Shopify no deja ponerles stock hasta darlas de alta. No es que tengan cero:
                            en esa sucursal directamente no existen. <strong>No se tocan con el botón rojo de arriba.</strong>
                          </p>
                          <div style={{ ...caja, marginTop: '0.4rem' }}>
                            <table style={tabla}>
                              <thead>
                                <tr style={cab}>
                                  <th style={th}>Producto</th>
                                  <th style={{ ...th, padding: '6px' }}>Código</th>
                                  <th style={{ padding: '6px' }}>Talle proveedor</th>
                                  <th style={{ padding: '6px' }}>Talle Shopify</th>
                                  <th style={{ padding: '6px' }}>Stock a cargar</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fSinAlta.map((r, i) => (
                                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(192,132,252,0.10)' }}>
                                    <td style={{ padding: '6px 10px' }}>{r.title}</td>
                                    <td style={{ padding: '6px', fontFamily: 'monospace', opacity: 0.85 }}>{r.code}</td>
                                    <td style={{ padding: '6px', textAlign: 'center', opacity: 0.7 }}>{r.talleProveedor}</td>
                                    <td style={{ padding: '6px', textAlign: 'center' }}>{r.talle}</td>
                                    <td style={{ padding: '6px', textAlign: 'center', fontWeight: 'bold', color: '#c084fc' }}>{r.desired}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '0.6rem', fontSize: '0.85rem' }}>
                            <input type="checkbox" checked={altaConfirm} onChange={e => setAltaConfirm(e.target.checked)} />
                            Entiendo que esto va a <strong>&nbsp;dar de alta estas variantes en {stockPlan.locationName}&nbsp;</strong> y cargarles ese stock.
                          </label>
                          <button
                            className="btn-primary"
                            style={{ background: altaConfirm ? '#9333ea' : '#6b7280', marginTop: '0.5rem' }}
                            onClick={handleActivar}
                            disabled={!altaConfirm || altaLoading}
                          >
                            {altaLoading ? <span className="loader"></span> : `🏷️ Dar de alta ${stockPlan.sinActivar.length} variantes y cargarles el stock`}
                          </button>
                          {altaDone && <p style={{ marginTop: '0.5rem', color: '#c084fc', fontWeight: 'bold' }}>✅ {altaDone}</p>}
                        </details>
                      )}

                    </>
                  );
                })()}

                {stockPlan.changes.length === 0 ? (
                  (stockPlan.unchanged === 0 && stockPlan.notFound.length === 0) ? (
                    <p style={{ marginTop: '0.8rem', padding: '0.8rem', background: 'rgba(245,158,11,0.12)', border: '1px solid #f59e0b', borderRadius: '6px' }}>
                      ⚠️ No encontré en Shopify ninguno de esos productos. Casi siempre es porque el SKU del proveedor no coincide con el de Shopify (o la sucursal). Revisá el SKU.
                    </p>
                  ) : (
                    <p style={{ marginTop: '0.8rem', padding: '0.8rem', background: 'rgba(16,185,129,0.1)', borderRadius: '6px' }}>✅ El stock ya coincide con el proveedor. Nada para escribir.</p>
                  )
                ) : (
                  <>
                    <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={writeConfirm} onChange={e => setWriteConfirm(e.target.checked)} />
                      Entiendo que esto va a <strong>&nbsp;modificar el stock real&nbsp;</strong> en Shopify.
                    </label>
                    <button
                      className="btn-primary"
                      style={{ background: writeConfirm ? '#dc2626' : '#6b7280', marginTop: '0.6rem' }}
                      onClick={handleWriteStock}
                      disabled={!writeConfirm || stockWriting}
                    >
                      {stockWriting ? <span className="loader"></span> : `✍️ Escribir ${stockPlan.changes.length} cambios en Shopify`}
                    </button>
                    {stockBuscar.trim() && (
                      <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.3rem' }}>
                        El buscador es solo para mirar: se escriben los {stockPlan.changes.length} cambios completos.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {writeDone && <p style={{ marginTop: '0.8rem', color: '#10b981', fontWeight: 'bold' }}>✅ {writeDone}</p>}
          </div>

          <div style={{ marginTop: '30px', display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', width: '100%', maxWidth: '900px', justifyContent: 'center' }}>
              <button
                className="btn-primary"
                style={{ background: '#3b82f6', padding: '15px', fontSize: '0.9rem' }}
                onClick={() => handleDownload('updates')}
                disabled={loading || !result || result.updatesToApply.length === 0}
              >
                📥 CSV de Precios
              </button>
              <button
                className="btn-primary"
                style={{ background: '#10b981', padding: '15px', fontSize: '0.9rem' }}
                onClick={() => handleDownload('inventory')}
                disabled={loading || !result || Object.keys(result.excelMap).length === 0}
              >
                📥 CSV de Stock (Inventario)
              </button>
              <button
                className="btn-primary"
                style={{ background: '#f59e0b', padding: '15px', fontSize: '0.9rem' }}
                onClick={() => handleDownload('matrix')}
                disabled={loading || !result || result.missingProducts.length === 0}
              >
                📥 CSV de Nuevos (Matriz)
              </button>
            </div>
          </div>
          {loading && <p style={{marginTop: '15px', textAlign: 'center', color: '#10b981', fontWeight: 'bold'}}>{loadingText}</p>}
        </div>
      )}

      </>)}
    </div>
  );
}
