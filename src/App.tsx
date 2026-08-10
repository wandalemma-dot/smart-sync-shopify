import { useState, useRef } from 'react';
import { processFiles, extractSheetNames, downloadUpdateCSV, downloadMatrixCSV, downloadInventoryCSV } from './utils/syncLogic';
import type { SyncConfig, SyncResult } from './utils/syncLogic';
import { analyzeRestock, downloadRestockCSV } from './utils/restockLogic';
import type { RestockResult } from './utils/restockLogic';
import { planStockWrite, executeStockWrite, addProviderTags } from './utils/writeStock';
import type { StockPlan } from './utils/writeStock';
import { createProducts } from './utils/createProducts';

export default function App() {
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
  const [tagging, setTagging] = useState(false);
  const [tagDone, setTagDone] = useState<string | null>(null);

  const handleAddTags = async () => {
    if (!result) return;
    setTagging(true); setTagDone(null);
    try {
      const res = await addProviderTags(result, config);
      setTagDone(`Etiquetados ${res.updated} · fallidos ${res.failed}` + (res.errors.length ? ` · ${res.errors.slice(0, 2).join(' | ')}` : ''));
    } catch (e: any) {
      alert('Error agregando etiquetas: ' + e.message);
    } finally {
      setTagging(false);
    }
  };

  // ---- CREAR PRODUCTOS NUEVOS EN SHOPIFY (borrador) ----
  const [creating, setCreating] = useState(false);
  const [createConfirm, setCreateConfirm] = useState(false);
  const [createDone, setCreateDone] = useState<string | null>(null);

  const handleCreateProducts = async (limit?: number) => {
    if (!result || result.missingProducts.length === 0) return;
    setCreating(true); setCreateDone(null);
    try {
      const res = await createProducts(result, config, limit);
      setCreateDone(`Creados ${res.created} · fallidos ${res.failed}` + (res.errors.length ? ` · ${res.errors.slice(0, 2).join(' | ')}` : ''));
    } catch (e: any) {
      alert('Error creando productos: ' + e.message);
    } finally {
      setCreating(false);
    }
  };

  // ---- CAJITA DE ÓRDENES (mini-asistente sin costo) ----
  const [cmdInput, setCmdInput] = useState('');
  const [cmdLog, setCmdLog] = useState<{ from: 'yo' | 'app'; text: string }[]>([]);
  const say = (from: 'yo' | 'app', text: string) => setCmdLog(prev => [...prev, { from, text }]);

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

  // Interpreta una orden corta escrita en la cajita y ejecuta la acción.
  const runCommand = async () => {
    const raw = cmdInput.trim();
    if (!raw) return;
    say('yo', raw);
    setCmdInput('');
    const t = raw.toLowerCase();

    // 1) Detectar marca mencionada
    const brandWords: [string, SyncConfig['brand']][] = [
      ['orchard', 'orchard'], ['converse', 'converse'], ['le coq', 'lecoq'],
      ['lecoq', 'lecoq'], ['coq', 'lecoq'], ['bloque', 'bloque'], ['luxo', 'luxo'],
    ];
    let brand: SyncConfig['brand'] | null = null;
    for (const [w, b] of brandWords) { if (t.includes(w)) { brand = b; break; } }
    if (brand) { setConfig(prev => ({ ...prev, brand: brand! })); }

    // 2) Detectar intención
    if (t.includes('ayuda') || t.includes('help') || t.trim() === '?') {
      say('app', 'Podés escribir: "analizá orchard", "pedido" (reposición Converse/Le Coq), "simular stock", o el nombre de una marca para elegirla. Recordá subir arriba el Excel del proveedor antes de analizar.');
      return;
    }
    if (t.includes('pedido') || t.includes('reposic') || t.includes('repon')) {
      say('app', 'Dale, analizo el pedido de reposición (Converse y Le Coq)…');
      handleAnalyzeRestock();
      return;
    }
    if (t.includes('simular') || t.includes('escrib') || (t.includes('stock') && !t.includes('analiz'))) {
      if (!result) { say('app', 'Primero analizá una marca (ej: "analizá orchard"). Después puedo simular el stock.'); return; }
      say('app', 'Simulo la escritura de stock y te muestro qué cambiaría abajo…');
      handleSimulateStock();
      return;
    }
    if (t.includes('analiz') || t.includes('revis') || t.includes('resumen')) {
      if (!providerFile) { say('app', 'Subí primero el Excel del proveedor en el casillero de arriba y volvé a escribirme.'); return; }
      say('app', `Analizo${brand ? ' ' + raw.match(/orchard|converse|le coq|lecoq|coq|bloque|luxo/i)?.[0] : ''}…`);
      handleAnalyze(brand || undefined);
      return;
    }
    if (brand) { say('app', `Listo, marca puesta en "${brand}". Ahora escribime "analizá" (con el Excel ya subido).`); return; }
    say('app', 'No te entendí 🤔. Probá: "analizá orchard", "pedido", "simular stock", o "ayuda".');
  };

  // ---- ANÁLISIS PARA PEDIDO (stock en vivo de la sucursal iD) ----
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockScanned, setRestockScanned] = useState(0);
  const [restockResult, setRestockResult] = useState<RestockResult | null>(null);

  // Inputs de archivo ocultos: permiten seleccionar con un clic además de arrastrar.
  const providerInputRef = useRef<HTMLInputElement>(null);

  const handleAnalyzeRestock = async () => {
    setRestockLoading(true);
    setRestockScanned(0);
    setRestockResult(null);
    try {
      const res = await analyzeRestock(setRestockScanned);
      setRestockResult(res);
      if (!res.locationFound) {
        alert(`No encontré la sucursal "${res.locationName}" en Shopify. Revisá el nombre exacto de la ubicación.`);
      }
    } catch (err: any) {
      alert('Error analizando el pedido: ' + err.message);
    } finally {
      setRestockLoading(false);
    }
  };

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
      const res = await processFiles(providerFile, null, null, cfg);
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

  const totalTalles = restockResult?.items.reduce((acc, it) => acc + it.sizes.length, 0) || 0;

  return (
    <div className="app-container">
      <header>
        <h1>Sincronización de Stock e Inventario</h1>
        <p className="subtitle">Automatización Inteligente</p>
      </header>

      {/* ====== CAJITA DE ÓRDENES ====== */}
      <div className="glass-panel" style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #6366f1' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem' }}>💬 Escribile a la app</h2>
        {cmdLog.length > 0 && (
          <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0' }}>
            {cmdLog.map((m, i) => (
              <div key={i} style={{ alignSelf: m.from === 'yo' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '6px 10px', borderRadius: '10px', fontSize: '0.85rem', background: m.from === 'yo' ? '#6366f1' : 'rgba(255,255,255,0.08)' }}>
                {m.text}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={cmdInput}
            onChange={e => setCmdInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runCommand(); }}
            placeholder='Ej: "analizá orchard", "pedido", "simular stock", "ayuda"'
            style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'var(--bg-color)', color: 'white' }}
          />
          <button className="btn-primary" style={{ background: '#6366f1', padding: '10px 18px' }} onClick={runCommand}>Enviar</button>
        </div>
      </div>

      {/* ====== ANÁLISIS PARA PEDIDO (stock en vivo iD) ====== */}
      <div className="glass-panel" style={{ marginBottom: '1.5rem', padding: '1.2rem', border: '1px solid #10b981' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>🛒 Pedido de reposición — Converse y Le Coq</h2>
            <p style={{ margin: '4px 0 0', opacity: 0.8, fontSize: '0.9rem' }}>
              Consulta Shopify en vivo y lista los talles agotados (stock 0 o 1) en la sucursal iD.
            </p>
          </div>
          <button
            className="btn-primary"
            style={{ background: '#10b981', padding: '14px 20px' }}
            onClick={handleAnalyzeRestock}
            disabled={restockLoading}
          >
            {restockLoading ? <span className="loader"></span> : '🔍 Analizar pedido ahora'}
          </button>
        </div>
        {restockLoading && (
          <p style={{ marginTop: '10px', textAlign: 'center', color: '#10b981' }}>
            Consultando stock en vivo de la sucursal iD...
            {restockScanned > 0 && <> ({restockScanned} productos escaneados)</>}
          </p>
        )}

        {restockResult && restockResult.locationFound && (
          <div style={{ marginTop: '1.2rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginBottom: '1rem', fontSize: '0.9rem', opacity: 0.9 }}>
              <span>📍 Sucursal: <strong>{restockResult.locationName}</strong></span>
              <span>📦 Talles a reponer: <strong style={{ color: '#f59e0b' }}>{totalTalles}</strong></span>
              <span>🧩 Modelos: <strong>{restockResult.items.length}</strong></span>
              <span>🔎 Productos escaneados: {restockResult.productsScanned}</span>
            </div>

            {restockResult.items.length === 0 ? (
              <p style={{ padding: '1rem', background: 'rgba(16,185,129,0.1)', borderRadius: '8px' }}>
                ✅ No hay talles agotados en la sucursal iD. ¡Nada para pedir!
              </p>
            ) : (
              <>
                <button
                  className="btn-primary"
                  style={{ background: '#f59e0b', padding: '12px 18px', marginBottom: '1rem' }}
                  onClick={() => downloadRestockCSV(restockResult)}
                >
                  📥 Descargar CSV del pedido
                </button>

                <div style={{ maxHeight: '460px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {restockResult.items.map((it, idx) => (
                    <div key={idx} style={{ padding: '0.8rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px',
                          background: it.brand === 'lecoq' ? '#3b82f6' : '#8b5cf6', color: 'white', marginRight: '8px'
                        }}>
                          {it.brand === 'lecoq' ? 'LE COQ' : 'CONVERSE'}
                        </span>
                        <strong>{it.title}</strong>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {it.sizes.map((s, si) => (
                          <span key={si} style={{
                            fontSize: '0.8rem', padding: '4px 8px', borderRadius: '6px',
                            border: `1px solid ${s.available === 0 ? '#dc2626' : '#f59e0b'}`,
                            color: s.available === 0 ? '#fca5a5' : '#fcd34d',
                            background: s.available === 0 ? 'rgba(220,38,38,0.12)' : 'rgba(245,158,11,0.12)'
                          }}>
                            Talle {s.shopifyTalle}
                            {s.pedidoTalle !== s.shopifyTalle && <> → pedido {s.pedidoTalle}</>}
                            {' '}· stock {s.available}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

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
                <option value="bloque">Bloque (PDFs)</option>
              </select>
            </div>

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

          {/* ====== CREAR PRODUCTOS NUEVOS DIRECTO EN SHOPIFY ====== */}
          {result?.missingProducts && result.missingProducts.length > 0 && (
            <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #8b5cf6', borderRadius: '8px', background: 'rgba(139,92,246,0.06)' }}>
              <h3 style={{ color: '#a78bfa', marginTop: 0 }}>🚀 Crear los nuevos directo en Shopify</h3>
              <p style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 0 }}>
                Crea los {result.missingProducts.length} productos nuevos en <strong>Activo</strong>, publicados <strong>solo en Point of Sale</strong>, con el stock del archivo. Probá primero con 1.
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button className="btn-primary" style={{ background: '#3b82f6' }} onClick={() => handleCreateProducts(1)} disabled={creating}>
                  {creating ? <span className="loader"></span> : '🧪 Crear 1 de prueba (borrador)'}
                </button>
              </div>
              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '0.8rem', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={createConfirm} onChange={e => setCreateConfirm(e.target.checked)} />
                Ya probé con 1 y quiero <strong>&nbsp;crear todos&nbsp;</strong> en Shopify (como borrador).
              </label>
              <button
                className="btn-primary"
                style={{ background: createConfirm ? '#8b5cf6' : '#6b7280', marginTop: '0.6rem' }}
                onClick={() => handleCreateProducts()}
                disabled={!createConfirm || creating}
              >
                {creating ? <span className="loader"></span> : `🚀 Crear todos (${result.missingProducts.length}) en Shopify`}
              </button>
              {createDone && <p style={{ marginTop: '0.8rem', color: '#a78bfa', fontWeight: 'bold' }}>✅ {createDone}</p>}
            </div>
          )}

          {/* ====== ESCRIBIR STOCK DIRECTO EN SHOPIFY ====== */}
          <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #10b981', borderRadius: '8px', background: 'rgba(16,185,129,0.06)' }}>
            <h3 style={{ color: '#10b981', marginTop: 0 }}>✍️ Escribir stock directo en Shopify</h3>
            <p style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 0 }}>
              Primero simulá: te muestro exactamente qué cambiaría, sin tocar nada. Recién si tildás la confirmación, se escribe.
            </p>
            <button className="btn-primary" style={{ background: '#3b82f6' }} onClick={handleSimulateStock} disabled={stockPlanning || stockWriting}>
              {stockPlanning ? <span className="loader"></span> : '🧪 Simular (ver qué cambiaría)'}
            </button>

            {(config.brand === 'converse' || config.brand === 'lecoq') && (
              <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <button className="btn-primary" style={{ background: '#0ea5e9' }} onClick={handleAddTags} disabled={tagging}>
                  {tagging ? <span className="loader"></span> : '🏷️ Agregar código del proveedor a las etiquetas'}
                </button>
                <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: '6px 0 0' }}>
                  Suma el Código Item (SKU) del Excel a las etiquetas de cada producto que ya existe, sin borrar las que tiene.
                </p>
                {tagDone && <p style={{ marginTop: '0.5rem', color: '#0ea5e9', fontWeight: 'bold' }}>✅ {tagDone}</p>}
              </div>
            )}

            {stockPlan && stockPlan.locationFound && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.9rem', marginBottom: '0.6rem' }}>
                  📍 Sucursal: <strong>{stockPlan.locationName}</strong> · Cambios: <strong style={{ color: '#f59e0b' }}>{stockPlan.changes.length}</strong> · Sin cambios: {stockPlan.unchanged}
                  {stockPlan.notFound.length > 0 && <> · No ubicados: {stockPlan.notFound.length}</>}
                </div>
                {stockPlan.changes.length === 0 ? (
                  (stockPlan.unchanged === 0 && stockPlan.notFound.length === 0) ? (
                    <p style={{ padding: '0.8rem', background: 'rgba(245,158,11,0.12)', border: '1px solid #f59e0b', borderRadius: '6px' }}>
                      ⚠️ No encontré en Shopify ninguno de esos productos. Casi siempre es porque el SKU del proveedor no coincide con el de Shopify (o la sucursal). Revisá el SKU.
                    </p>
                  ) : (
                    <p style={{ padding: '0.8rem', background: 'rgba(16,185,129,0.1)', borderRadius: '6px' }}>✅ El stock ya coincide con el proveedor. Nada para escribir.</p>
                  )
                ) : (
                  <>
                    <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px' }}>
                      <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ position: 'sticky', top: 0, background: '#1f2937' }}>
                            <th style={{ textAlign: 'left', padding: '6px 10px' }}>Producto</th>
                            <th style={{ padding: '6px' }}>Talle</th>
                            <th style={{ padding: '6px' }}>Actual</th>
                            <th style={{ padding: '6px' }}>Nuevo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockPlan.changes.map((c, i) => (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                              <td style={{ padding: '6px 10px' }}>{c.title}</td>
                              <td style={{ padding: '6px', textAlign: 'center' }}>{c.talle}</td>
                              <td style={{ padding: '6px', textAlign: 'center', opacity: 0.7 }}>{c.current}</td>
                              <td style={{ padding: '6px', textAlign: 'center', fontWeight: 'bold', color: '#10b981' }}>{c.desired}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
                  </>
                )}
              </div>
            )}
            {writeDone && <p style={{ marginTop: '0.8rem', color: '#10b981', fontWeight: 'bold' }}>✅ {writeDone}</p>}
          </div>

          {result?.missingProducts && result.missingProducts.length > 0 && (
            <div className="missing-products-section" style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', borderRadius: '8px' }}>
              <h3 style={{ color: '#f59e0b', marginBottom: '1rem' }}>Configurar Tablas para Nuevos Productos</h3>

              <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem' }}>
                {result.missingProducts.map(p => (
                  <div key={p.coditm} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <div>
                      <strong>{p.coditm.toUpperCase()}</strong> - {p.title}
                    </div>
                    {config.brand === 'converse' && (
                      <select
                        value={tableSelections[p.coditm] || 1}
                        onChange={e => setTableSelections({...tableSelections, [p.coditm]: parseInt(e.target.value)})}
                        style={{ padding: '0.3rem', borderRadius: '4px', background: 'var(--bg-color)', color: 'white', border: '1px solid var(--glass-border)' }}
                      >
                        <option value={1}>Tabla 1 (Empieza en ARG 34 = US 3)</option>
                        <option value={2}>Tabla 2 (Empieza en ARG 35 = US 3)</option>
                        <option value={3}>Tabla Mujer (Empieza en ARG 35 = US 5)</option>
                        <option value={4}>Tabla Niño (Empieza en ARG 27 = US 10.5)</option>
                        <option value={5}>Tabla Bebe (Empieza en ARG 20 = US 4)</option>
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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
    </div>
  );
}
