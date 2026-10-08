// Pruebas optativas: los archivos privados nunca se incorporan al repositorio.
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import { idsOrdenes } from '../pedidoId';
import { leerExcelDistrinando, cruzarDistrinando, leerPendientesDistrinando } from '../pedidoDistrinando';
import { generarExcelDistrinando } from '../excelPedidoDistrinando';

const dir=process.env.DISTRINANDO_FIXTURES;
const nombres=['Reebok Calzado 001 30%  07-10.xlsx','Kappa Calzado 40%  006 05-10 (2).xlsx','RBK Calzado 006 40% 05-10 (3).xlsx','RBK Indumentaria 001 40% 05-10 (1).xlsx','Kappa Indumentaria 30%  001 29-09.xlsx'];
it.skipIf(!dir)('planillas reales: filas, cantidades y preservación de todas las partes originales',()=>{
 const ps=nombres.map((n,i)=>leerExcelDistrinando(new Uint8Array(readFileSync(join(dir!,n))),n,String(i)));
 for(const p of ps) {
  const sample=p.articulos.filter(a=>a.disponible>0&&a.talle).slice(0,3);
  const ls=sample.map(a=>({id:a.id,orden:'#PRUEBA',titulo:a.titulo,sku:a.ean||a.sku,talle:a.talle,cantidad:1,tags:[a.codigo],vendor:a.marca}));
  const filas=cruzarDistrinando(ls,[p]);expect(filas.reduce((n,f)=>n+f.pedir,0)).toBe(sample.length);
  const out=generarExcelDistrinando(p,filas), wb=XLSX.read(out,{type:'array'});
  for(const a of p.articulos)expect(Number(wb.Sheets[a.hoja][a.celda]?.v)||0).toBe(sample.includes(a)?1:0);
  const before=unzipSync(p.original),after=unzipSync(out);
  expect(Object.keys(before)).toEqual(Object.keys(after));
  const allowed=['xl/workbook.xml',...p.hojas.map(h=>h.path)];
  for(const path of Object.keys(before))if(!allowed.includes(path))expect(Buffer.compare(before[path],after[path])).toBe(0);
  console.log(p.nombre,JSON.stringify({articulos:p.articulos.length,avisos:p.avisos.length,hojas:p.hojas.length}));
 }
 expect(idsOrdenes(readFileSync(join(dir!,'orders_export (1).csv'),'utf8'))).toHaveLength(17);
},60000);

it.skipIf(!dir||process.env.DISTRINANDO_LIVE!=='1')('lectura real de Shopify y cruce, sin escribir ni enviar pedidos',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=(input,init)=>originalFetch(input==='/api/shopify'?'https://smart-sync-shopify.vercel.app/api/shopify':input,init);
 try {
  const ps=nombres.map((n,i)=>leerExcelDistrinando(new Uint8Array(readFileSync(join(dir!,n))),n,String(i)));
  const ids=idsOrdenes(readFileSync(join(dir!,'orders_export (1).csv'),'utf8'));
  const p=await leerPendientesDistrinando(ids);
  const fs=cruzarDistrinando(p.lineas,ps);
  expect(fs.reduce((n,f)=>n+f.necesaria,0)).toBe(p.lineas.reduce((n,l)=>n+l.cantidad,0));
  console.log('LIVE',JSON.stringify({ordenes:ids.length,pendientes:p.lineas.length,unidades:p.lineas.reduce((n,l)=>n+l.cantidad,0),pedir:fs.reduce((n,f)=>n+f.pedir,0),sinCoincidencia:fs.filter(f=>!f.candidatos.length).length,ambiguos:fs.filter(f=>f.candidatos.length>1).length,avisos:p.avisos.length}));
  console.log('REVISION',JSON.stringify(fs.filter(f=>f.motivo).map(f=>({sku:f.sku,talle:f.talle,motivo:f.motivo,candidatos:f.candidatos.map(a=>({archivo:a.archivo,fila:a.fila}))}))));
  if(process.env.DISTRINANDO_REPORT)writeFileSync(process.env.DISTRINANDO_REPORT,JSON.stringify({archivos:ps.map(p=>({nombre:p.nombre,articulos:p.articulos.length,avisos:p.avisos.length})),ordenes:ids.length,lineas:p.lineas,filas:fs,avisos:p.avisos},null,2));
 } finally {globalThis.fetch=originalFetch;}
},120000);
