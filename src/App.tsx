import { useState } from 'react';
import { processFiles, extractSheetNames, processDirectSync } from './utils/syncLogic';
import type { SyncConfig, SyncResult } from './utils/syncLogic';

export default function App() {
  const [providerFile, setProviderFile] = useState<File | null>(null);
  const [remitoFile, setRemitoFile] = useState<File | null>(null); // Solo para Bloque
  
  const [sheets, setSheets] = useState<string[]>([]);
  
  const [config, setConfig] = useState<SyncConfig>({
    sheetName: '',
    brand: 'converse',
    marginMultiplier: 2.01,
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
      const res = await processFiles(providerFile, remitoFile, config);
      setResult(res);
      setPreviewReady(true);
    } catch (err: any) {
      alert("Error analizando: " + err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleConfirmSync = async () => {
    if (!result) return;
    setLoading(true);
    setLoadingText('Impactando cambios en Shopify... ¡No cierres esta ventana!');
    try {
      await processDirectSync(result, config, tableSelections);
      alert('✅ ¡Sincronización completada con éxito!');
      setPreviewReady(false);
      setResult(null);
      setProviderFile(null);
      setRemitoFile(null);
    } catch (err: any) {
      alert("Error al sincronizar: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Stock y Ventas Sync Shopify</h1>
        <p className="subtitle">Conexión Directa por API (Nivel Dios)</p>
      </header>

      {!previewReady ? (
        <div className="main-grid">
          <div className="glass-panel dropzone-container">
            <h2>1. Archivos del Proveedor</h2>
            
            <div 
              className={`dropzone ${providerFile ? 'has-file' : ''}`}
              onDrop={handleProviderDrop} onDragOver={preventDefault}
            >
              <h3>{providerFile ? '✅ Archivo Principal Listo' : (config.brand === 'bloque' ? '📄 Arrastra el PRESUPUESTO (PDF)' : '📄 Arrastra el Excel del Proveedor')}</h3>
              <p>{providerFile?.name}</p>
            </div>

            {config.brand === 'bloque' && (
              <div 
                className={`dropzone ${remitoFile ? 'has-file' : ''}`}
                onDrop={handleRemitoDrop} onDragOver={preventDefault}
              >
                <h3>{remitoFile ? '✅ Remito Listo' : '📄 Arrastra el REMITO (PDF)'}</h3>
                <p>{remitoFile?.name}</p>
              </div>
            )}
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

            <div className="form-group">
              <label>Multiplicador de Ganancia (Default: 2.01)</label>
              <input 
                type="number" 
                step="0.01" 
                value={config.marginMultiplier} 
                onChange={e => setConfig({...config, marginMultiplier: parseFloat(e.target.value) || 2.01})}
              />
            </div>

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
            <h2>⚠️ RESUMEN ANTES DE SINCRONIZAR</h2>
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
              <h3>🔄 Actualizaciones de Stock y Precio</h3>
              <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{result?.updatesToApply.length || 0} variantes</p>
            </div>
            <div className="stat-card" style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '20px', borderRadius: '10px', border: '1px solid #f59e0b' }}>
              <h3 style={{ color: '#f59e0b' }}>✨ Faltantes (Se crearán nuevos)</h3>
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

          <div style={{ marginTop: '30px', display: 'flex', justifyContent: 'center' }}>
            <button 
              className="btn-primary" 
              style={{ fontSize: '1.2rem', padding: '15px 40px', background: '#10b981' }}
              onClick={handleConfirmSync}
              disabled={loading}
            >
              {loading ? <span className="loader"></span> : '🚀 CONFIRMAR Y SINCRONIZAR A SHOPIFY'}
            </button>
          </div>
          {loading && <p style={{marginTop: '10px', textAlign: 'center', color: '#10b981'}}>{loadingText}</p>}
        </div>
      )}
    </div>
  );
}
