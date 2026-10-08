import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { leerExcelDistrinando, cruzarDistrinando, leerPendientesDistrinando } from '../pedidoDistrinando';
import { generarExcelDistrinando, generarZipDistrinando } from '../excelPedidoDistrinando';
import type { PendienteId } from '../pedidoId';
const { api } = vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../shopify',async original=>({...await original<typeof import('../shopify')>(),shopifyGraphQL:api}));
const headers=['SKU','Modelo color','Descripción del artículo','EAN','UDM','Stock x SKU','Pedido','Valorizado','Mayorista con descuento'];
const row=(sku='RBK1100A-8',ar='40',qty=3,ean='0012345678901')=>[sku,'RBK1100A--',`ZAPATILLA WHITE - ${ar}`,ean,'Pares',qty,7,0,10];
function bytes(rows: unknown[][], hidden=false) {
 const w=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet([[],[],[],headers,...rows]);
 s.H2={t:'n',f:`SUBTOTAL(9,H5:H${4+rows.length})`,v:999};
 s['!ref']=`A1:I${4+rows.length}`;
 rows.forEach((_,i)=>{s[`H${i+5}`]={t:'n',f:`G${i+5}*I${i+5}`,v:70};});
 XLSX.utils.book_append_sheet(w,s,'Lista');
 if(hidden){XLSX.utils.book_append_sheet(w,s,'Oculta');w.Workbook={Sheets:[{name:'Lista',Hidden:0},{name:'Oculta',Hidden:1}]};}
 return new Uint8Array(XLSX.write(w,{type:'array',bookType:'xlsx'}));
}
const file=(rows:unknown[][]=[row()],id='0')=>leerExcelDistrinando(bytes(rows),'Lista.xlsx',id);
const line=(patch:Partial<PendienteId>={}):PendienteId=>({id:'fo1',orden:'#1',titulo:'Zapatillas Reebok',sku:'0012345678901',talle:'40',cantidad:1,tags:['RBK1100A'],vendor:'Reebok',...patch});
const conn=(nodes:any[],next:string|null=null)=>({nodes,pageInfo:{hasNextPage:!!next,endCursor:next}});
beforeEach(()=>{api.mockReset();});

describe('planillas DISTRINANDO',()=>{
 it('detecta encabezados, conserva EAN textual y omite packs/hojas ocultas',()=>{
  const pack=row('RBK1100A---M12U 8/11.5 (123321)');pack[4]='Pack de 12 Unidades';pack[3]='';
  const p=leerExcelDistrinando(bytes([row(),pack],true),'Lista.xlsx','0');
  expect(p.hojas).toHaveLength(1);expect(p.articulos).toHaveLength(1);
  expect(p.articulos[0]).toMatchObject({ean:'0012345678901',talle:'40',fila:5,celda:'G5'});
  expect(p.hojas[0].limpiar).toEqual(['G5','G6']);expect(p.previas).toBe(2);
 });
 it('acepta formato Número de artículo, STOCK y sin EAN',()=>{
  const w=XLSX.read(bytes([row()]),{type:'array'}),s=w.Sheets.Lista;
  s.A4.v='Número de artículo';s.F4.v='STOCK';s.D4.v='Color';
  const p=leerExcelDistrinando(new Uint8Array(XLSX.write(w,{type:'array',bookType:'xlsx'})),'Promo.xlsx','0');
  expect(p.articulos[0].ean).toBe('');
 });
 it('UK y W usan la misma referencia de sincronización; no adivina desconocidos',()=>{
  const r=row('RBK1100A-10W','UK 7.5');
  expect(file([r]).articulos[0].talle).toBe('40.5');
  expect(file([row('RBK1100A-8','UK 99')]).articulos[0].talle).toBe('');
 });
 it('conserva talles de ropa y calzado Kappa en AR',()=>{
  const k=['K123-K999-38','K123-K999','KAPPA WHITE 38','','Pares',1,'',0,10];
  expect(file([k]).articulos[0].talle).toBe('38');
  const r=row('RBK1100A-2XL','2XL');r[4]='Unidades';
  expect(file([r]).articulos[0].talle).toBe('2XL');
 });
 it('no redondea EAN, ni tolera SKU duplicado, ni toma TOTAL PARES como stock',()=>{
  expect(file([row(),row()]).articulos).toHaveLength(1);
  expect(()=>file([row(),row('RBK1100A-8','40',9)])).toThrow('repetido');
  expect(()=>file([row('RBK1100A-8','40',3,'1.234E+12')])).toThrow('EAN');
  const w=XLSX.read(bytes([row()]),{type:'array'});w.Sheets.Lista.F4.v='TOTAL PARES';
  expect(()=>leerExcelDistrinando(new Uint8Array(XLSX.write(w,{type:'array',bookType:'xlsx'})),'x.xlsx','0')).toThrow('faltan');
 });
});

describe('cruce sin duplicar pedidos',()=>{
 it('usa EAN o SKU exactos y suma órdenes antes de limitar disponibilidad',()=>{
  const p=file();const r=cruzarDistrinando([line({cantidad:2}),line({id:'fo2',orden:'#2',cantidad:2})],[p]);
  expect(r).toHaveLength(1);expect(r[0]).toMatchObject({necesaria:4,pedir:3,faltante:1,ordenes:['#1','#2']});
  expect(cruzarDistrinando([line({sku:'RBK1100A-8'})],[p])[0].pedir).toBe(1);
 });
 it('no duplica la misma línea ni el stock entre dos variantes Shopify',()=>{
  const p=file();const l=line({cantidad:2});
  expect(cruzarDistrinando([l,l],[p])[0].necesaria).toBe(2);
  const r=cruzarDistrinando([l,line({id:'fo2',variantId:'other',cantidad:2})],[p]);
  expect(r.reduce((n,f)=>n+f.pedir,0)).toBe(3);
 });
 it('variante presente en dos listas exige elegir, sin duplicar ni sumar stock',()=>{
  const ps=[file(),file([row()],'1')];
  let r=cruzarDistrinando([line({cantidad:4})],ps);expect(r[0].pedir).toBe(0);
  r=cruzarDistrinando([line({cantidad:4})],ps,{[r[0].id]:ps[1].articulos[0].id});
  expect(r[0]).toMatchObject({pedir:3,faltante:1});expect(r[0].elegido?.archivoId).toBe('1');
  expect(Object.keys(unzipSync(generarZipDistrinando(ps,r)))).toEqual(['2_Pedido_Lista.xlsx']);
 });
 it('si dos grupos eligen distintas listas para el mismo SKU, quedan pendientes',()=>{
  const ps=[file(),file([row()],'1')],ls=[line(),line({id:'fo2',variantId:'other'})];
  const r=cruzarDistrinando(ls,ps);
  const rr=cruzarDistrinando(ls,ps,{[r[0].id]:ps[0].articulos[0].id,[r[1].id]:ps[1].articulos[0].id});
  expect(rr.every(f=>f.pedir===0&&f.motivo.includes('más de una lista'))).toBe(true);
 });
 it('tags del producto no son SKU de variante; usa modelo + AR exacto en lista sin EAN',()=>{
  const ps=[file([row('RBK1100A-8','40',3,''),row('RBK1100A-9','41',2,'')])];
  const r=cruzarDistrinando([line({talle:'41',tags:['RBK1100A-8','RBK1100A-9']})],ps);
  expect(r[0].elegido?.sku).toBe('RBK1100A-9');
  expect(cruzarDistrinando([line({talle:'42'})],ps)[0].pedir).toBe(0);
  expect(cruzarDistrinando([line({tags:['RBK1100A0']})],ps)[0].pedir).toBe(0);
 });
 it('bloquea contradicciones SKU/EAN y de talle; permite identificador exacto sin AR conocido',()=>{
  const p=file([row(),row('RBK1100A-9','41',2,'1111111111111')]);
  expect(cruzarDistrinando([line({barcode:'1111111111111'})],[p])[0].pedir).toBe(0);
  expect(cruzarDistrinando([line({talle:'41'})],[p])[0].pedir).toBe(0);
  expect(cruzarDistrinando([line()],[file([row('RBK1100A-8','UK 99')])])[0].pedir).toBe(1);
 });
 it('pendiente manual y falta de stock dejan faltantes explícitos',()=>{
  const p=file([row('RBK1100A-8','40',0)]),r=cruzarDistrinando([line()],[p]);
  expect(r[0]).toMatchObject({pedir:0,faltante:1});
  expect(cruzarDistrinando([line()],[file()],{[cruzarDistrinando([line()],[file()])[0].id]:''})[0].elegido).toBeUndefined();
 });
});

describe('exportación conserva plantillas',()=>{
 it.each([false,true])('reemplaza pedidos, limpia packs y conserva fotos/formato/otras hojas; prefijo XML %s', prefijo=>{
  const pack=row('RBK1100A---M12U 8/11.5 (123321)');pack[4]='Pack de 12 Unidades';pack[3]='';
  const zip=unzipSync(bytes([row(),pack],true));zip['xl/media/image1.jpeg']=new Uint8Array([1,2,3]);
  if(prefijo)for(const path of ['xl/workbook.xml','xl/worksheets/sheet1.xml'])zip[path]=strToU8(strFromU8(zip[path]).replace('xmlns="','xmlns:x="').replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g,'<$1x:$2'));
  zip['xl/worksheets/sheet1.xml']=strToU8(strFromU8(zip['xl/worksheets/sheet1.xml']).replace(/<(?:x:)?c\b[^>]*\br="G5"[^>]*>[\s\S]*?<\/(?:x:)?c>/,''));
  const p=leerExcelDistrinando(zipSync(zip),'x.xlsx','0');
  const out=generarExcelDistrinando(p,cruzarDistrinando([line({cantidad:2})],[p]));
  const ws=XLSX.read(out,{type:'array'}).Sheets.Lista;
  expect(ws.G5.v).toBe(2);expect(ws.G6.v).toBe(0);expect(ws.H5.f).toBe('G5*I5');expect(ws.H5.v).toBe(20);expect(ws.H2.v).toBe(20);
  const after=unzipSync(out);expect(Object.keys(after)).toEqual(Object.keys(zip));
  for(const path of Object.keys(zip))if(!['xl/workbook.xml',p.hojas[0].path].includes(path))expect(after[path]).toEqual(zip[path]);
 });
});

describe('lectura pendiente por ubicación',()=>{
 it('lee solo DISTRINANDO, pagina ambos niveles, conserva talla/barcode y no usa cantidad vendida',async()=>{
  api.mockImplementation(async(q:string,v:any)=>{
   if(q.includes('Permisos'))return {currentAppInstallation:{accessScopes:[{handle:'read_merchant_managed_fulfillment_orders'}]}};
   if(q.includes('PedidoIdOrder'))return {order:{name:'#1',displayFinancialStatus:'PARTIALLY_REFUNDED',tags:['pedido id'],fulfillmentOrders:conn(v.after?[{id:'d',status:'OPEN',assignedLocation:{name:'DISTRINANDO SA (Reebok - Kappa)'}}]:[{id:'m',status:'OPEN',assignedLocation:{name:'DEPOSITO MARTINEZ'}}],v.after?null:'next')}};
   expect(v.id).toBe('d');return {fulfillmentOrder:{lineItems:conn(v.after?[]:[{id:'l',remainingQuantity:2,lineItem:{title:'Zapatilla',sku:'ean',variantTitle:'Black / 40',variant:{id:'v',barcode:'ean',selectedOptions:[{name:'Color',value:'Black'},{name:'Talle',value:'40'}]}}}],v.after?null:'lines2')}};
  });
  const r=await leerPendientesDistrinando(['id','id']);expect(r.lineas).toHaveLength(1);expect(r.lineas[0]).toMatchObject({cantidad:2,talle:'40',barcode:'ean'});
  expect(api.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
 });
 it('permiso faltante detiene el pedido, no usa CSV como sustituto',async()=>{
  api.mockResolvedValue({currentAppInstallation:{accessScopes:[]}});
  await expect(leerPendientesDistrinando(['id'])).rejects.toThrow('read_merchant');
 });
 it.each([{cancelledAt:'date'},{closed:true},{displayFinancialStatus:'REFUNDED'},{displayFinancialStatus:'PENDING'},{tags:['pedido distrinando']},{tags:['solucionar']}])('excluye orden %j',async patch=>{
  api.mockImplementation(async(q:string)=>q.includes('Permisos')?{currentAppInstallation:{accessScopes:[{handle:'read_merchant_managed_fulfillment_orders'}]}}:{order:{name:'#1',displayFinancialStatus:'PAID',tags:[],...patch}});
  expect((await leerPendientesDistrinando(['id'])).lineas).toHaveLength(0);
 });
 it('una lectura incompleta o cursor repetido bloquea todo',async()=>{
  api.mockImplementation(async(q:string)=>q.includes('Permisos')?{currentAppInstallation:{accessScopes:[{handle:'read_merchant_managed_fulfillment_orders'}]}}:{order:{name:'#1',displayFinancialStatus:'PAID',fulfillmentOrders:conn([],'repeat')}});
  await expect(leerPendientesDistrinando(['id'])).rejects.toThrow('completar');
 });
});
