import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { processFiles, type SyncConfig } from '../syncLogic';
import { planStockWrite } from '../writeStock';
import { parseCrocs, leerCrocs } from '../crocsLogic';
const { graphql }=vi.hoisted(()=>({graphql:vi.fn()}));
vi.mock('../shopify',()=>({shopifyGraphQL:graphql,mismaSucursal:(a:string,b:string)=>a===b}));
const hK=['SKU','Modelo Color','Descripción del artículo','EAN','UDM','DISPONIBLE','Mayorista con descuento','Público','Mayorista Unitario','Descuento','GÉNERO'];
const rK=['K1-B-S','K1-B','LOGO BLACK S','1234567890123','Unidades',3,700,1875.5,1000,30,'MEN'];
const hC=['SKU','Modelo-Color','Tipo de Producto','Descripción','UdM','Disponible','COSTO DESCUENTO','Módulo Mayorista'];
const rC=['C10001-C001-M8/W10','C10001-C001','CALZADO','CLASSIC BLACK 40','Pares',3,700,1000];
const kCfg={brand:'kappa',kappaCalzado:false,sheetName:'INDUMENTARIA 30%'} as const;
const cCfg={brand:'crocs',sheetName:'Sheet1'} as const;
const file=(rows:unknown[][],sheetName='Sheet1',hidden=false)=>{
 const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),sheetName);
 if(hidden)w.Workbook={Sheets:[{name:sheetName,Hidden:1}]};
 return {name:'Proveedor.xlsx',arrayBuffer:async()=>XLSX.write(w,{type:'array',bookType:'xlsx'})} as File;
};
const v=(sku:string,title:string,qty:number|null=7)=>({node:{id:sku,sku,title,price:'100',inventoryItem:{id:'i'+sku,unitCost:{amount:'50'},inventoryLevel:qty===null?null:{quantities:[{name:'available',quantity:qty}]},mar:{quantities:[{name:'available',quantity:100}]}}}});
const p=(code:string,vendor:string,title:string,variants:ReturnType<typeof v>[],tags:string[]=[code])=>({id:code,handle:code.toLowerCase(),title,vendor,tags,options:[{name:'Talle'}],variants:{edges:variants}});
const crocs=(code:string,variants=[v(code+'-M8','40')])=>p(code,'Crocs','Crocs Classic',variants,[code,'TABLA DE TALLE CROCS HOMBRE']);
let products:ReturnType<typeof p>[];
beforeEach(()=>{
 products=[];
 graphql.mockReset().mockImplementation(async(q:string,vars:any)=>q.includes('locations(')?{locations:{edges:[{node:{id:'distri',name:'DISTRINANDO SA (Reebok - Kappa)'}},{node:{id:'mar',name:'DEPOSITO MARTINEZ'}}]}}:{products:{edges:products.filter(p=>!vars?.q?.includes('handle:')||vars.q.includes(p.handle)).map(node=>({node})),pageInfo:{hasNextPage:false}}});
});
describe('Catálogos de Kappa Indumentaria y Crocs',()=>{
 it('Kappa ropa propone cero para ausentes individuales y preserva calzado, otra marca, desconocidos y otra sucursal',async()=>{
  products=[p('K1-B','Kappa','Indumentaria Kappa Logo',[v('1234567890123','S'),v('1234567890124','M'),v('desconocido','L')]),
   p('K2-B','Kappa','Pantalón Kappa Logo',[v('K2-B-L','L')]),p('K3-B','Kappa','Zapatillas Kappa',[v('K3-B-40','40')]),
   p('K4-B','Reebok','Remera Reebok',[v('K4-B-S','S')]),p('K5-B','Kappa','Modelo sin identificar',[v('K5-B-S','S')]),
   p('K6-B','Kappa','Remera Kappa',[v('K6-B-S','S',null)])];
  const result=await processFiles(file([hK,rK],kCfg.sheetName),null,null,kCfg);
  expect(result.kappaCobertura?.categoria).toBe('indumentaria');
  expect(result.enPeligro.map(p=>p.handle)).toEqual(['k2-b']);
  const plan=await planStockWrite(result,kCfg);
  expect(plan.locationId).toBe('distri');
  expect(plan.changes.map(c=>[c.sku,c.desired])).toEqual([['1234567890123',3],['1234567890124',0],['K2-B-L',0]]);
  expect(graphql.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
 });
 it('Kappa ropa protege packs, conserva talle presente con distinto EAN y no confunde categorías',async()=>{
  const pack=[...rK];pack[0]='K2-B-PACK';pack[1]='K2-B';pack[4]='Pack de 12 Unidades';
  products=[p('K1-B','Kappa','Remera Kappa',[v('9999999999999','S'),v('K1-B-M','M')]),p('K2-B','Kappa','Remera Kappa',[v('K2-B-L','L')])];
  const result=await processFiles(file([hK,rK,pack],kCfg.sheetName),null,null,kCfg);
  const plan=await planStockWrite(result,kCfg);
  expect(plan.notFound).toHaveLength(0);expect(plan.changes.map(c=>c.sku)).toEqual(['9999999999999','K1-B-M']);
  await expect(planStockWrite(result,{...kCfg,kappaCalzado:true})).rejects.toThrow('categoría Kappa');
 });
 it('Crocs separa agotados de modelos pendientes por costo, packs, accesorios o talle doble infantil',async()=>{
  const pending=(code:string)=>{const r=[...rC];r[0]=code+'-M8/W10';r[1]=code;return r;};
  const cost=pending('C10002-C001');cost[6]='';
  const pack=pending('C10003-C001');pack[4]='Pack de 12 Unidades';
  const kids=pending('C10004-C001');kids[0]='C10004-C001-C6/7';
  const acc=pending('C10005-C001');acc[2]='ACCESORIO';
  const missing=pending('C10006-C001');missing[0]='';
  products=[crocs('C10001-C001',[v(rC[0] as string,'40'),v('C10001-C001-M9/W11','41'),v('C10001-C001-C6/7','23'),v('desconocido','42')]),
   ...['C10002-C001','C10003-C001','C10004-C001','C10005-C001','C10006-C001','C99999-C001'].map(c=>crocs(c)),
   p('C99998-C001','Crocs','Jibbitz Crocs',[v('C99998-C001-M8','40')]),p('C99997-C001','Kappa','Calzado Crocs',[v('C99997-C001-M8','40')]),
   crocs('C99996-C001',[v('C99996-C001-M8','40',null)])];
  const result=await processFiles(file([hC,rC,cost,pack,kids,acc,missing]),null,null,cCfg);
  expect(result.enPeligro.map(p=>p.handle)).toEqual(['c99999-c001']);
  const plan=await planStockWrite(result,cCfg);
  expect(plan.changes.map(c=>[c.sku,c.desired])).toEqual([[rC[0],3],['C10001-C001-M9/W11',0],['C99999-C001-M8',0]]);
  expect(plan.locationId).toBe('distri');expect(graphql.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
 });
 it('Crocs protege el modelo completo si una fila tiene pack y no apaga talles mal convertidos ni presentes con otro SKU',async()=>{
  const pack=[...rC];pack[0]='C10001-C001-PACK';pack[4]='Pack de 12 Unidades';
  products=[crocs('C10001-C001',[v(rC[0] as string,'40'),v('C10001-C001-M9/W11','41')])];
  const result=await processFiles(file([hC,rC,pack]),null,null,cCfg);
  expect((await planStockWrite(result,cCfg)).changes.map(c=>c.desired)).toEqual([3]);
  products=[crocs('C10001-C001',[v('C10001-C001-M8','40'),v('C10001-C001-M9/W11','38'),v('C10001-C001-M10/W12','42')])];
  const clean=await processFiles(file([hC,rC]),null,null,cCfg);
  const plan=await planStockWrite(clean,cCfg);
  expect(plan.notFound).toHaveLength(1);expect(plan.changes.map(c=>c.talle)).toEqual(['42']);
 });
 it('Crocs bloquea hoja oculta, catálogo vacío y costos inválidos antes de proponer ceros',async()=>{
  await expect(leerCrocs(file([hC,rC],'Sheet1',true),'Sheet1')).rejects.toThrow('visible');
  await expect(processFiles(file([hC]),null,null,cCfg)).rejects.toThrow('no hay calzado');
  const invalid=[...rC];invalid[6]=-1;
  await expect(processFiles(file([hC,invalid]),null,null,cCfg)).rejects.toThrow('revisar stock');
  expect(graphql).not.toHaveBeenCalled();
 });
 it('Crocs revalida marca y presencia en vivo; no barre un resultado antiguo sin cobertura',async()=>{
  products=[crocs('C99999-C001')];
  const result=await processFiles(file([hC,rC]),null,null,cCfg);
  expect(result.enPeligro).toHaveLength(1);
  products[0].tags.push('C10001-C001');
  expect((await planStockWrite(result,cCfg)).changes).toEqual([]);
  products[0].tags.pop();products[0].vendor='Reebok';
  expect((await planStockWrite(result,cCfg)).changes).toEqual([]);
  products[0].vendor='Crocs';delete result.crocsCobertura;
  expect((await planStockWrite(result,cCfg)).changes).toEqual([]);
 });
});

const realFiles:[string,SyncConfig][]=[
 ['Kappa Indumentaria 30%  001 29-09 (2).xlsx',kCfg],
 ['RBK Indumentaria 001 40% 09-10 (1).xlsx',{brand:'reebok',sheetName:'INDUMENTARIA 40 %'}],
 ['STOCKPROMOCROCS.xlsx',cCfg],
];
for(const [name,cfg] of realFiles){
 const path='C:/Users/maxim/Downloads/'+name;
 it.skipIf(!existsSync(path))('archivo real y simulación de ausentes: '+name,async()=>{
  const realFile={name,arrayBuffer:async()=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}} as File;
  const code=cfg.brand==='kappa'?'K99999-OLD':cfg.brand==='reebok'?'RBK999999OLD':'C99999-OLD';
  const size=cfg.brand==='crocs'?'40':'S',sku=code+'-'+(cfg.brand==='crocs'?'M8':size);
  products=[cfg.brand==='crocs'?crocs(code,[v(sku,size)]):p(code,cfg.brand==='reebok'?'Reebok':'Kappa',cfg.brand==='reebok'?'Remera Reebok':'Indumentaria Kappa',[v(sku,size)])];
  const result=await processFiles(realFile,null,null,cfg);
  const coverage=result.kappaCobertura || result.reebokCobertura || result.crocsCobertura!;
  expect(coverage.modelosPresentes.length).toBeGreaterThan(0);
  expect(Object.keys(result.excelMap).length).toBeGreaterThan(0);
  expect(result.enPeligro.map(p=>p.handle)).toEqual([code.toLowerCase()]);
  const plan=await planStockWrite(result,cfg);
  expect(plan.changes.map(c=>[c.sku,c.desired])).toEqual([[sku,0]]);
  expect(plan.locationId).toBe('distri');
  if(cfg.brand==='crocs'){
   const parsed=parseCrocs(await leerCrocs(realFile,cfg.sheetName));
   expect(parsed.cobertura.modelosProtegidos).toContain('C10001-C001');
   products=[crocs('C10001-C001')];
   expect((await processFiles(realFile,null,null,cfg)).enPeligro).toEqual([]);
  }
 });
}
