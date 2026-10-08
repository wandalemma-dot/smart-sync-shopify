import { useMemo, useState } from 'react';
import { idsOrdenes, type PendienteId } from './utils/pedidoId';
import { leerExcelDistrinando, leerPendientesDistrinando, cruzarDistrinando, type ArchivoDistrinando } from './utils/pedidoDistrinando';
import { generarExcelDistrinando, generarZipDistrinando } from './utils/excelPedidoDistrinando';

export default function PedidoDistrinando() {
  const [csvs,setCsvs]=useState<File[]>([]), [excels,setExcels]=useState<File[]>([]);
  const [archivos,setArchivos]=useState<ArchivoDistrinando[]>([]), [lineas,setLineas]=useState<PendienteId[]>([]);
  const [elecciones,setElecciones]=useState<Record<string,string>>({});
  const [avisos,setAvisos]=useState<string[]>([]), [ordenes,setOrdenes]=useState(0);
  const [listo,setListo]=useState(false), [ocupado,setOcupado]=useState(false), [revisado,setRevisado]=useState(false);
  const [estado,setEstado]=useState(''), [error,setError]=useState('');
  const filas=useMemo(()=>cruzarDistrinando(lineas,archivos,elecciones),[lineas,archivos,elecciones]);
  const necesarias=filas.reduce((n,f)=>n+f.necesaria,0), pedir=filas.reduce((n,f)=>n+f.pedir,0);
  const reset=()=>{setListo(false);setArchivos([]);setLineas([]);setElecciones({});setAvisos([]);setRevisado(false);setError('');setEstado('');};
  async function armar() {
    if (!csvs.length || !excels.length) return;
    reset();setOcupado(true);
    try {
      const ps: ArchivoDistrinando[]=[];
      for (let i=0;i<excels.length;i++) {
        setEstado(`Leyendo Excel ${i+1} de ${excels.length}…`);
        ps.push(leerExcelDistrinando(new Uint8Array(await excels[i].arrayBuffer()),excels[i].name,String(i)));
      }
      const ids=[...new Set((await Promise.all(csvs.map(async f=>idsOrdenes(await f.text())))).flat())];
      setEstado(`Consultando 0 de ${ids.length} órdenes en Shopify…`);
      const p=await leerPendientesDistrinando(ids,n=>setEstado(`Consultando ${n} de ${ids.length} órdenes en Shopify…`));
      setArchivos(ps);setLineas(p.lineas);setAvisos([...p.avisos,...ps.flatMap(p=>p.avisos)]);setOrdenes(ids.length);setListo(true);
      setEstado(`Revisión lista · consulta ${new Date().toLocaleString('es-AR')}.`);
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo armar el pedido.');setEstado('');}
    finally {setOcupado(false);}
  }
  function descargar(p?: ArchivoDistrinando) {
    if (!listo || !revisado || ocupado) return;
    try {
      const bytes=p?generarExcelDistrinando(p,filas):generarZipDistrinando(archivos,filas);
      const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:p?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/zip'}));
      const a=document.createElement('a');a.href=url;a.download=p?`Pedido_${p.nombre}`:`Pedidos_Distrinando_${new Date().toISOString().slice(0,10)}.zip`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo descargar.');}
  }
  const resumen=archivos.map(p=>({p,qty:filas.filter(f=>f.elegido?.archivoId===p.id).reduce((n,f)=>n+f.pedir,0)}));
  return <section className="glass-panel" style={{padding:'1.5rem',border:'1px solid #6366f1'}}>
    <h2 style={{color:'#a5b4fc',marginTop:0}}>📋 Armado de pedidos DISTRINANDO</h2>
    <p>Subí las órdenes y las listas de Reebok y Kappa. Cada artículo queda en la columna Pedido de su Excel.</p>
    <p style={{opacity:.8}}>Solo cantidades todavía pendientes en <strong>DISTRINANDO SA (Reebok - Kappa)</strong>, en órdenes abiertas pagadas o parcialmente reembolsadas. Excluye canceladas y etiquetas «pedido distrinando» / «solucionar». No modifica Shopify ni envía el pedido al proveedor.</p>
    <div style={{display:'flex',gap:'1rem',flexWrap:'wrap'}}>
      <label className="dropzone" style={{flex:1,minWidth:240}}>1. Export de órdenes de Shopify (.csv)
        <input aria-label="Órdenes DISTRINANDO" type="file" multiple accept=".csv" disabled={ocupado} onChange={e=>{reset();setCsvs(Array.from(e.target.files||[]));}}/>
        {csvs.map((f,i)=><div key={i}>{f.name}</div>)}
      </label>
      <label className="dropzone" style={{flex:1,minWidth:240}}>2. Todos los Excel del proveedor (.xlsx)
        <input aria-label="Listas DISTRINANDO" type="file" multiple accept=".xlsx" disabled={ocupado} onChange={e=>{reset();setExcels(Array.from(e.target.files||[]));}}/>
        {excels.map((f,i)=><div key={i}>{f.name}</div>)}
      </label>
    </div>
    <p>Elegí la versión vigente de cada lista. Podés seleccionar varios archivos juntos. Para .xlsb, guardá primero una copia como .xlsx en Excel.</p>
    <button className="btn-primary" disabled={ocupado||!csvs.length||!excels.length} onClick={armar}>{ocupado?'Analizando…':listo?'Volver a consultar y armar':'Armar y revisar pedidos'}</button>
    <p role="status">{estado}</p>
    {error&&<p role="alert" style={{color:'#fda4af'}}>{error}</p>}
    {listo&&<>
      <h3>{ordenes} órdenes consultadas · {necesarias} unidades pendientes · {pedir} para pedir · {necesarias-pedir} sin cubrir</h3>
      <p>Los packs y las hojas ocultas se omiten. Si la misma variante aparece en varias listas, elegí una. «+50» se toma como 50 disponibles.</p>
      {archivos.some(p=>p.previas>0)&&<p style={{color:'#fcd34d'}}>Hay cantidades ya escritas en las plantillas. La descarga las reemplaza por este pedido nuevo, también en las filas excluidas.</p>}
      {necesarias>pedir&&<p role="alert" style={{color:'#fcd34d'}}>Hay unidades sin cubrir. Revisá las coincidencias y los faltantes antes de descargar.</p>}
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:'.85rem'}}>
        <thead><tr>{['Producto / talle','Órdenes','Necesitás','Excel y fila','Disponible','Pedir','Faltan','Estado'].map(t=><th key={t} style={{textAlign:'left',padding:8}}>{t}</th>)}</tr></thead>
        <tbody>{filas.map(f=><tr key={f.id} style={{borderTop:'1px solid #475569',background:f.faltante?'rgba(245,158,11,.12)':'transparent'}}>
          <td style={{padding:8}}><strong>{f.titulo}</strong><br/>{f.sku}<br/>Talle: {f.talle||'Sin identificar'}</td>
          <td>{f.ordenes.join(', ')}</td><td>{f.necesaria}</td>
          <td style={{padding:8,minWidth:230}}>{f.candidatos.length>0?<>
            <select aria-label={`Excel para ${f.titulo}, talle ${f.talle}`} style={{maxWidth:340,width:'100%'}} value={f.elegido?.id||''} onChange={e=>{setElecciones(prev=>({...prev,[f.id]:e.target.value}));setRevisado(false);setError('');}}>
              <option value="">Dejar pendiente / elegir lista</option>
              {f.candidatos.map(a=><option key={a.id} value={a.id}>{a.archivo} · {a.hoja} · fila {a.fila} · disp. {a.disponible}</option>)}
            </select>
            {f.elegido&&<div>{f.elegido.sku} · {f.elegido.celda} · talle {f.elegido.talle||'sin equivalencia'}</div>}
          </>: 'Sin coincidencia'}</td>
          <td>{f.elegido?`${f.elegido.tope?'+':''}${f.elegido.disponible}`:'—'}</td><td><strong>{f.pedir}</strong></td><td>{f.faltante}</td><td>{f.motivo||'Listo para pedir'}</td>
        </tr>)}</tbody>
      </table></div>
      {!filas.length&&<p>No hay unidades pendientes de DISTRINANDO en estas órdenes. Revisá los avisos.</p>}
      {avisos.length>0&&<details><summary>Avisos de órdenes y planillas ({avisos.length})</summary><ul>{avisos.map((a,i)=><li key={i}>{a}</li>)}</ul></details>}
      <h3>Pedidos por Excel</h3>
      <label style={{display:'block',margin:'16px 0'}}><input type="checkbox" checked={revisado} onChange={e=>setRevisado(e.target.checked)}/> Revisé las listas elegidas, talles y faltantes. Descargar las cantidades de «Pedir».</label>
      {resumen.map(({p,qty})=><div key={p.id} style={{display:'flex',gap:16,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}><span>{p.nombre} · <strong>{qty} unidades</strong></span><button disabled={!revisado||!qty} onClick={()=>descargar(p)}>Descargar este Excel</button></div>)}
      <button className="btn-primary" disabled={!revisado||!pedir} onClick={()=>descargar()}>Descargar todos los pedidos (.zip)</button>
      <p style={{opacity:.8}}>Conserva fotos, hojas y formato. Abrí los Excel para revisar los importes y recalcular sus fórmulas antes de enviarlos. La descarga no marca órdenes como pedidas: repetir el proceso puede repetir el mismo pedido.</p>
    </>}
  </section>;
}
