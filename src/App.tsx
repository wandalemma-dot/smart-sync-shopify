import { useState, useRef } from 'react';
import { processFiles, extractSheetNames, downloadUpdateCSV, downloadMatrixCSV, downloadInventoryCSV } from './utils/syncLogic';
import type { SyncConfig, SyncResult } from './utils/syncLogic';
import { analyzeRestock, downloadRestockCSV } from './utils/restockLogic';
import type { RestockResult } from './utils/restockLogic';

export default function App() {
  const [providerFile, setProviderFile] = useState<File | null>(null);
  const [remitoFile, setRemitoFile] = useState<File | null>(null); // Solo para Bloque
  const [shopifyFile, setShopifyFile] = useState<File | null>(null); // CSV exportado de Shopify

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

  // ---- ANÁLISIS PARA PEDIDO (stock en vivo de la sucursal iD) ----
  const [restockLoading, setRestockLoading] = useState(false);
  const [restockScanned, setRestockScanned] = useState(0);
  const [restockResult, setRestockResult] = useState<RestockResult | null>(null);

  // Inputs de archivo ocultos: permiten seleccionar con un clic además de arrastrar.
  const providerInputRef = useRef<HTMLInputElement>(null);
  const remitoInputRef = useRef<HTMLInputElement>(null);
  const shopifyInputRef = useRef<HTMLInputElement>(null);

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
    if (config.brand === 'bloque' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert("⚠️ Error: Para Bloque, por favor subí el PRESUPUESTO en formato PDF.");
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

  const processRemitoFile = (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert("⚠️ Error: Por favor, subí el REMITO en formato PDF.");
      return;
    }
    setRemitoFile(file);
  };

  const processShopifyFile = (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert("⚠️ Error: Subí el CSV exportado de Shopify (products_export.csv).");
      return;
    }
    setShopifyFile(file);
  };

  const handleProviderDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processProviderFile(file);
  };

  const handleRemitoDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processRemitoFile(file);
  };

  const handleShopifyDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processShopifyFile(file);
  };

  const preventDefault = (e: React.DragEvent) => e.preventDefault();

  const handleAnalyze = async () => {
    if (!providerFile) return;
    if (config.brand === 'bloque' && !remitoFile) {
      alert("⚠️ Error: Para Bloque necesitas subir también el PDF del Remito.");
      return;
    }

    setLoading(true);
    setLoadingText('Analizando archivos y conectando con Shopify...');
    setResult(null);
    setPreviewReady(false);

    try {
      const res = await processFiles(providerFile, remitoFile, shopifyFile, config);
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
              accept={config.brand === 'bloque' ? '.pdf' : '.xlsx,.xls'}
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) processProviderFile(f); e.target.value = ''; }}
            />
            <div
              className={`dropzone ${providerFile ? 'has-file' : ''}`}
              onDrop={handleProviderDrop} onDragOver={preventDefault}
              onClick={() => providerInputRef.current?.click()}
              style={{ cursor: 'pointer' }}
            >
              <h3>{providerFile ? '📄 Archivo Principal Listo' : (config.brand === 'bloque' ? '📥 Arrastrá o hacé clic: PRESUPUESTO (PDF)' : '📥 Arrastrá o hacé clic: Excel del Proveedor')}</h3>
              <p>{providerFile?.name}</p>
            </div>

            {config.brand === 'bloque' && (
              <>
                <input
                  ref={remitoInputRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) processRemitoFile(f); e.target.value = ''; }}
                />
                <div
                  className={`dropzone ${remitoFile ? 'has-file' : ''}`}
                  onDrop={handleRemitoDrop} onDragOver={preventDefault}
                  onClick={() => remitoInputRef.current?.click()}
                  style={{ cursor: 'pointer' }}
                >
                  <h3>{remitoFile ? '📄 Remito Listo' : '📥 Arrastrá o hacé clic: REMITO (PDF)'}</h3>
                  <p>{remitoFile?.name}</p>
                </div>
              </>
            )}

            <input
              ref={shopifyInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) processShopifyFile(f); e.target.value = ''; }}
            />
            <div
              className={`dropzone ${shopifyFile ? 'has-file' : ''}`}
              onDrop={handleShopifyDrop} onDragOver={preventDefault}
              onClick={() => shopifyInputRef.current?.click()}
              style={{ marginTop: '0.8rem', borderColor: shopifyFile ? '#10b981' : '#6366f1', cursor: 'pointer' }}
            >
              <h3 style={{ color: shopifyFile ? '#10b981' : '#a5b4fc' }}>
                {shopifyFile ? '✅ Shopify CSV Listo' : '🛒 Arrastrá o hacé clic: CSV de Shopify (products_export)'}
              </h3>
              <p>{shopifyFile?.name || 'Necesario para detectar si los productos ya existen'}</p>
            </div>
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
                  setRemitoFile(null);
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
              onClick={handleAnalyze}
              disabled={!providerFile || (config.brand === 'bloque' && !remitoFile) || loading}
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
