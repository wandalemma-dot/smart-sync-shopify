import { useState } from 'react';
import { processFiles, extractSheetNames, generateNewProductsCsv } from './utils/syncLogic';
import type { SyncConfig, SyncResult } from './utils/syncLogic';

export default function App() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [invFile, setInvFile] = useState<File | null>(null);
  const [prodFile, setProdFile] = useState<File | null>(null);
  
  const [sheets, setSheets] = useState<string[]>([]);
  
  const [config, setConfig] = useState<SyncConfig>({
    sheetName: '',
    brand: 'converse',
    marginMultiplier: 2.01,
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [tableSelections, setTableSelections] = useState<Record<string, number>>({});

  const handleExcelDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
        alert("⚠️ Error: Por favor, arrastrá el archivo Excel (.xlsx o .xls) del PROVEEDOR en esta primera caja.");
        return;
      }
      setExcelFile(file);
      try {
        const names = await extractSheetNames(file);
        setSheets(names);
        if (names.length > 0) {
          setConfig(prev => ({ ...prev, sheetName: names[0] }));
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleInvDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        alert("⚠️ Error: Por favor, arrastrá el CSV de INVENTARIO de Shopify en esta segunda caja.");
        return;
      }
      setInvFile(file);
    }
  };

  const handleProdDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        alert("⚠️ Error: Por favor, arrastrá el CSV de PRODUCTOS de Shopify en esta tercer caja.");
        return;
      }
      setProdFile(file);
    }
  };

  const preventDefault = (e: React.DragEvent) => e.preventDefault();

  const handleProcess = async () => {
    if (!excelFile || !invFile || !prodFile) return;
    setLoading(true);
    setResult(null);
    setTableSelections({});
    try {
      const res = await processFiles(excelFile, invFile, prodFile, config);
      setResult(res);
    } catch (err: any) {
      alert("Error procesando: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadNewProducts = () => {
    if (!result) return;
    const csv = generateNewProductsCsv(result.missingProducts, tableSelections, config, result.prodHeaders);
    downloadFile(csv, `NUEVOS_Productos_Faltantes_${config.brand}.csv`);
  };

  return (
    <div className="app-container">
      <header>
        <h1>Smart Sync Shopify</h1>
        <p className="subtitle">Actualización inteligente de Inventarios y Precios (Local y Privado)</p>
      </header>

      <div className="main-grid">
        <div className="glass-panel dropzone-container">
          <h2>1. Carga de Archivos</h2>
          
          <div 
            className={`dropzone ${excelFile ? 'has-file' : ''}`}
            onDrop={handleExcelDrop} onDragOver={preventDefault}
          >
            <h3>{excelFile ? '✅ Excel Proveedor' : '📄 Arrastra el Excel del Proveedor'}</h3>
            <p>{excelFile?.name || 'Ej: Plantilla STOCK ELEVE...xlsx'}</p>
          </div>

          <div 
            className={`dropzone ${invFile ? 'has-file' : ''}`}
            onDrop={handleInvDrop} onDragOver={preventDefault}
          >
            <h3>{invFile ? '✅ CSV Inventario' : '📊 Arrastra CSV Inventario Shopify'}</h3>
            <p>{invFile?.name || 'Ej: inventory_export_1.csv'}</p>
          </div>

          <div 
            className={`dropzone ${prodFile ? 'has-file' : ''}`}
            onDrop={handleProdDrop} onDragOver={preventDefault}
          >
            <h3>{prodFile ? '✅ CSV Productos' : '🛍️ Arrastra CSV Productos Shopify'}</h3>
            <p>{prodFile?.name || 'Ej: products_export_1.csv'}</p>
          </div>
        </div>

        <div className="glass-panel settings-panel">
          <h2>2. Configuración</h2>
          
          <div className="form-group">
            <label>Marca a procesar</label>
            <select 
              value={config.brand} 
              onChange={e => setConfig({...config, brand: e.target.value as 'lecoq' | 'converse'})}
            >
              <option value="converse">Converse</option>
              <option value="lecoq">Le Coq Sportif</option>
            </select>
          </div>

          {sheets.length > 0 && (
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
            onClick={handleProcess}
            disabled={!excelFile || !invFile || !prodFile || loading}
          >
            {loading ? <span className="loader"></span> : '🚀 Generar Archivos Shopify'}
          </button>
        </div>
      </div>

      {result && (
        <div className="glass-panel results-area" style={{ marginTop: '2rem' }}>
          <div className="results-header">
            <h2>🎉 ¡Archivos Generados con Éxito!</h2>
            <div className="download-actions">
              <button 
                className="btn-success"
                onClick={() => downloadFile(result.pricesCsv, `Precios_Actualizados_${config.brand}.csv`)}
              >
                ⬇️ Descargar Precios
              </button>
              <button 
                className="btn-success"
                onClick={() => downloadFile(result.inventoryCsv, `Inventario_Actualizado_${config.brand}.csv`)}
              >
                ⬇️ Descargar Inventario
              </button>
              {result.priceReviewsCsv && result.priceReviewsCsv !== '' && (
                <button 
                  className="btn-success"
                  style={{ background: '#f59e0b' }}
                  onClick={() => downloadFile(result.priceReviewsCsv, `Precios_a_Revisar_${config.brand}.csv`)}
                >
                  ⚠️ Descargar Precios a Revisar
                </button>
              )}
            </div>
          </div>

          {result.missingProducts.length > 0 && (
            <div className="missing-products-section" style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', borderRadius: '8px' }}>
              <h3 style={{ color: '#f59e0b', marginBottom: '1rem' }}>⚠️ Productos Nuevos a Crear ({result.missingProducts.length})</h3>
              <p style={{ marginBottom: '1rem' }}>Estos productos están en el Excel pero no en tu Shopify. Selecciona la tabla de talles para cada uno antes de descargar el CSV.</p>
              
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
              
              <button 
                className="btn-success"
                style={{ background: '#f59e0b', width: '100%' }}
                onClick={handleDownloadNewProducts}
              >
                Descargar CSV de Nuevos Productos Listos para Shopify
              </button>
            </div>
          )}

          {result.alerts.length > 0 ? (
            <div className="alerts-section" style={{ marginTop: '2rem' }}>
              <h3 style={{ marginBottom: '1rem' }}>🔔 Alertas y Avisos ({result.alerts.length})</h3>
              <div className="alerts-area">
                {result.alerts.map((alert, idx) => (
                  <div key={idx} className={`alert-card alert-${alert.type}`}>
                    <h4>{alert.title}</h4>
                    <p>{alert.message}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--success)', marginTop: '2rem' }}>✅ Todo procesado perfecto sin advertencias.</p>
          )}
        </div>
      )}
    </div>
  );
}
