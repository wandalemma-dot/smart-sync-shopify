import { useState } from 'react';
import { processFiles, extractSheetNames, downloadUpdateCSV, downloadMatrixCSV, downloadInventoryCSV } from './utils/syncLogic';
import type { SyncConfig, SyncResult } from './utils/syncLogic';

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

  const handleProviderDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      if (config.brand === 'bloque' && !file.name.toLowerCase().endsWith('.pdf')) {
        alert("⚠️ Error: Para Bloque, por favor arrastrá el PRESUPUESTO en formato PDF.");
        return;
      }
      if (config.brand !== 'bloque' && !file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
        alert("⚠️ Error: Por favor, arrastrá el archivo Excel (.xlsx o .xls).");
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
    }
  };

  const handleRemitoDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert("⚠️ Error: Por favor, arrastrá el REMITO en formato PDF.");
        return;
      }
      setRemitoFile(file);
    }
  };

  const handleShopifyDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        alert("⚠️ Error: Arrastrá el CSV exportado de Shopify (products_export.csv).");
        return;
      }
      setShopifyFile(file);
    }
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

  return (
    <div className="app-container">
      <header>
        <h1>Sincronización de Stock e Inventario</h1>
        <p className="subtitle">Automatización Inteligente</p>
      </header>

      {!previewReady ? (
        <div className="main-grid">
          <div className="glass-panel dropzone-container">
            <h2>1. Archivos del Proveedor</h2>
            
            <div 
              className={`dropzone ${providerFile ? 'has-file' : ''}`}
              onDrop={handleProviderDrop} onDragOver={preventDefault}
            >
              <h3>{providerFile ? '📄 Archivo Principal Listo' : (config.brand === 'bloque' ? '📥 Arrastra el PRESUPUESTO (PDF)' : '📥 Arrastra el Excel del Proveedor')}</h3>
              <p>{providerFile?.name}</p>
            </div>

            {config.brand === 'bloque' && (
              <div 
                className={`dropzone ${remitoFile ? 'has-file' : ''}`}
                onDrop={handleRemitoDrop} onDragOver={preventDefault}
              >
                <h3>{remitoFile ? '📄 Remito Listo' : '📥 Arrastra el REMITO (PDF)'}</h3>
                <p>{remitoFile?.name}</p>
              </div>
            )}

            <div 
              className={`dropzone ${shopifyFile ? 'has-file' : ''}`}
              onDrop={handleShopifyDrop} onDragOver={preventDefault}
              style={{ marginTop: '0.8rem', borderColor: shopifyFile ? '#10b981' : '#6366f1' }}
            >
              <h3 style={{ color: shopifyFile ? '#10b981' : '#a5b4fc' }}>
                {shopifyFile ? '✅ Shopify CSV Listo' : '🛒 Arrastra el CSV de Shopify (products_export)'}
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
