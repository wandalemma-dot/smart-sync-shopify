import { parseReebok } from '../reebokLogic';
import { describe,it,expect,vi,beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync,existsSync } from 'node:fs';
import { parseKappa,leerKappa,coincideVarianteKappa } from '../kappaLogic';
import { createProducts } from '../createProducts';
import { planStockWrite } from '../writeStock';
import { processFiles,buildMatrixProducts,downloadMatrixCSV } from '../syncLogic';
const {graphql,download}=vi.hoisted(()=>({graphql:vi.fn(),download:vi.fn()}));
vi.mock('../shopify',()=>({shopifyGraphQL:graphql,mismaSucursal:(a:string,b:string)=>a===b}));
vi.mock('../csv',async orig=>({...await orig<typeof import('../csv')>(),triggerDownload:download}));
const h=['SKU','Modelo Color','Descripción del artículo','EAN','UDM','DISPONIBLE (inmediato)','Mayorista con descuento','Público','Mayorista Unitario','Descuento','GÉNERO'];
const r=['K1-B-40','K1-B','CLASSIC BLACK 40','07799087201358','Pares',2,600,1875.5,1000,40,'MEN'];
const config={brand:'kappa',kappaCalzado:true,kappaSistema:'EU',sheetName:'CALZADO'} as const;
const file=(rows:unknown[][])=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),'CALZADO');return {name:'Kappa.xlsx',arrayBuffer:async()=>XLSX.write(w,{type:'array',bookType:'xlsx'})} as File;};
beforeEach(()=>{graphql.mockReset().mockImplementation(async(q:string)=>q.includes('locations(')?{locations:{edges:[{node:{id:'loc',name:'DISTRINANDO SA (Reebok - Kappa)'}}]}}:{products:{edges:[],pageInfo:{hasNextPage:false}}});});
describe('Kappa carga',()=>{
 it('Reebok indumentaria también excluye packs antes de procesar talles',()=>{
  const headers=['SKU','Modelo color','Descripción del artículo','GRUPO','Stock x SKU','Mayorista con descuento','Precio Público','UDM'];
  const individual=['R-S','R','LOGO - S','T-SHIRT',1,100,200,'Unidades'];
  const pack=['R-M9U','R','LOGO M9U S/XXL','T-SHIRT',2,100,200,'Pack de 9 Unidades'];
  const result=parseReebok([headers,individual,pack]);
  expect(result.productos.R.sizes).toEqual({S:1});expect(result.avisos[0]).toContain('pack/curva excluido');
 });
 it('comparte EAN, AR y tabla en vista previa, altas y CSV',async()=>{
  const result=await processFiles(file([h,r]),null,null,config);
  const p=buildMatrixProducts(result,config)[0];
  expect(p.vendor).toBe('Kappa');expect(p.variants[0]).toMatchObject({sku:'07799087201358',barcode:'07799087201358',optionValue:'39',cost:600,price:1875.5,qty:2});
  expect(p.tags).toEqual(expect.arrayContaining(['K1-B','K1-B-40','TABLA DE TALLE KAPPA UNISEX']));
  expect(p.sizeConversion?.['39']).toEqual({arg:'39',us:null,eu:'40',cm:'25.7'});
  downloadMatrixCSV(result,config);expect(download.mock.calls.at(-1)?.[0]).toContain('07799087201358');
  expect(result.missingProducts[0].costoMargen).toBe(600);
 });
 it('no suma duplicados idénticos y frena contradicciones',()=>{
  const p=parseKappa([h,r,r],true,'EU');expect(p.productos['K1-B'].sizes).toEqual({'39':2});expect(p.avisos[0]).toContain('duplicada');
  const other=[...r];other[5]=3;expect(()=>parseKappa([h,r,other],true,'EU')).toThrow('diferentes');
 });
 it('excluye packs sin convertir cantidades y no inventa equivalencias',()=>{
  const pack=[...r];pack[0]='K1-B-PACK';pack[4]='Pack de 12 Unidades';
  const unknown=[...r];unknown[0]='K1-B-39.5';unknown[2]='CLASSIC BLACK 39.5';
  const p=parseKappa([h,r,pack,unknown],true,'EU');expect(p.avisos).toHaveLength(2);expect(p.productos['K1-B'].sizes).toEqual({'39':2});
 });
 it('indumentaria conserva talle y usa descuento propio, no 40% fijo',()=>{
  const hs=[...h];hs[5]='DISPONIBLE';const row=[...r];row[0]='K1-B-XXL';row[2]='CLASSIC BLACK XXL';row[4]='Unidades';row[6]=700;row[9]=30;
  const p=parseKappa([hs,row],false,'AR').productos['K1-B'];expect(p.costoMargen).toBe(700);expect(p.sizes).toEqual({XXL:2});expect(p.sizeConversion).toBeUndefined();
 });
 it('EAN vacío usa SKU; no cruza por talle solamente',()=>{
  const row=[...r];row[3]='';const p=parseKappa([h,row],true,'EU').productos['K1-B'];expect(p.skuPorTalle['39']).toBe('K1-B-40');
  expect(coincideVarianteKappa(p,'39',{sku:'otro'})).toBe(false);
  expect(coincideVarianteKappa(p,'39',{sku:'K1-B-40'})).toBe(true);
 });
 it('alta usa Distrinando, EAN y JSON; no crea si falta sucursal',async()=>{
  const result=await processFiles(file([h,r]),null,null,config);
  graphql.mockImplementation(async(q:string)=>q.includes('locations(')?{locations:{edges:[{node:{id:'loc',name:'DISTRINANDO SA (Reebok - Kappa)'}}]}}:q.includes('mutation CrearProducto')?{productSet:{product:{id:'p'},userErrors:[]}}:q.includes('mutation GuardarTabla')?{metafieldsSet:{userErrors:[]}}:{});
  expect((await createProducts(result,config)).created).toBe(1);
  const calls=graphql.mock.calls;
  const input=calls.find(([q])=>q.includes('mutation CrearProducto'))![1].input;
  expect(input.variants[0]).toMatchObject({barcode:'07799087201358',inventoryItem:{sku:'07799087201358',cost:'600'},inventoryQuantities:[{locationId:'loc',name:'available',quantity:2}]});
  expect(calls.some(([q])=>q.includes('mutation GuardarTabla'))).toBe(true);
  graphql.mockReset().mockResolvedValue({locations:{edges:[]}});
  await expect(createProducts(result,config)).rejects.toThrow('sucursal');
 });
 it('stock y precios solo cambian variantes del archivo en Distrinando',async()=>{
  const variant=(sku:string,id:string,title:string)=>({node:{id,title,sku,price:'100',inventoryItem:{id:'i'+id,unitCost:{amount:'50'},inventoryLevel:{quantities:[{name:'available',quantity:5}]},mar:{quantities:[{name:'available',quantity:9}]}}}});
  const product={id:'p',handle:'kappa',title:'Kappa Classic',vendor:'Kappa',tags:['K1-B'],variants:{edges:[variant('07799087201358','v','39'),variant('otro','v2','38')]}};
  graphql.mockImplementation(async(q:string)=>q.includes('locations(')?{locations:{edges:[{node:{id:'loc',name:'DISTRINANDO SA (Reebok - Kappa)'}},{node:{id:'mar',name:'DEPOSITO MARTINEZ'}}]}}:{products:{edges:[{node:product}],pageInfo:{hasNextPage:false}}});
  const result=await processFiles(file([h,r]),null,null,config);
  expect(result.updatesToApply.map(u=>u.variantId)).toEqual(['v']);expect(result.enPeligro).toEqual([]);
  const plan=await planStockWrite(result,config);
  expect(plan.locationId).toBe('loc');expect(plan.changes).toHaveLength(1);expect(plan.changes[0].desired).toBe(2);
  expect(graphql.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
 });
 for(const [name,calzado] of [['Kappa Calzado 40 006 29-09.xlsx',true],['Kappa Indumentaria 30%  001 29-09.xlsx',false]] as const){
 const path='C:/Users/Wanda/Downloads/'+name;
 it.skipIf(!existsSync(path))('archivo real '+name,async()=>{
  const f={name,arrayBuffer:async()=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}} as File;
  const rows=await leerKappa(f,calzado);const result=parseKappa(rows,calzado,'EU');
  const ps=Object.values(result.productos);expect(ps.length).toBeGreaterThan(0);
  expect(ps.length).toBe(calzado?366:198);
  expect(ps.reduce((n,p)=>n+Object.keys(p.sizes).length,0)).toBe(calzado?707:419);
  expect(result.avisos.filter(a=>a.includes('pack excluido'))).toHaveLength(calzado?87:14);
 });}
});
