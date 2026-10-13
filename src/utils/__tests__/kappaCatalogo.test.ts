import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync, existsSync } from 'node:fs';
import { parseKappa, leerKappa } from '../kappaLogic';
import { processFiles } from '../syncLogic';
import { planStockWrite } from '../writeStock';
const { graphql } = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a:string,b:string) => a===b }));
const h=['SKU','Modelo Color','Descripción del artículo','EAN','UDM','DISPONIBLE (inmediato)','Mayorista con descuento','Público','Mayorista Unitario','Descuento','GÉNERO'];
const row=['K1-B-40','K1-B','CLASSIC BLACK 40','07799087201358','Pares',2,600,1875.5,1000,40,'MEN'];
const config={brand:'kappa',kappaCalzado:true,sheetName:'CALZADO'} as const;
const file=(rows:unknown[][])=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),'CALZADO');return {name:'Kappa.xlsx',arrayBuffer:async()=>XLSX.write(w,{type:'array',bookType:'xlsx'})} as File;};
const variant=(sku:string,title:string,qty:number|null=5)=>({node:{id:sku,title,sku,price:'100',inventoryItem:{id:'i'+sku,unitCost:{amount:'50'},inventoryLevel:qty===null?null:{quantities:[{name:'available',quantity:qty}]},mar:{quantities:[{name:'available',quantity:99}]}}}});
const product=(code:string,variants= [variant(code+'-39','39')],title='Zapatillas Kappa Classic',vendor='Kappa')=>({id:code,handle:code.toLowerCase(),title,vendor,tags:[code],options:[{name:'Talle'}],variants:{edges:variants}});
let products:ReturnType<typeof product>[];
beforeEach(()=>{products=[];graphql.mockReset().mockImplementation(async(q:string,vars:any)=>q.includes('locations(')?{locations:{edges:[{node:{id:'loc',name:'DISTRINANDO SA (Reebok - Kappa)'}},{node:{id:'mar',name:'DEPOSITO MARTINEZ'}}]}}:{products:{edges:products.filter(p=>!vars?.q?.includes('handle:')||vars.q.includes(p.handle)).map(node=>({node})),pageInfo:{hasNextPage:false}}});});
describe('Kappa Calzado: ausencias del catálogo vigente',()=>{
 it('propone cero para modelos y talles ausentes, incluidos EAN; actualiza presentes y no escribe al simular',async()=>{
  products=[product('K1-B',[variant('07799087201358','40'),variant('1234567890123','39'),variant('desconocido','38')]),product('K2-C'),product('K3-D',[variant('K3-D-38','38')],'Pantalon Kappa'),product('K4-E',undefined,undefined,'Reebok'),product('sin-codigo'),product('K5-F',[variant('K5-F-39','39',null)])];
  const result=await processFiles(file([h,row]),null,null,config);
  expect(result.enPeligro.map(p=>p.handle)).toEqual(['k2-c']);
  const plan=await planStockWrite(result,config);
  expect(plan.locationId).toBe('loc');
  expect(plan.changes.map(c=>[c.sku,c.desired])).toEqual([['07799087201358',2],['1234567890123',0],['K2-C-39',0]]);
  expect(graphql.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
 });
 it('protege packs y ambos modelos de una fila con código incompatible',async()=>{
  const pack=[...row];pack[0]='K1-B-PACK';pack[4]='Pack de 12 Unidades';
  const mismatch=[...row];mismatch[0]='K2-C-39';mismatch[1]='K3-D';
  const missingSku=[...row];missingSku[0]='';missingSku[1]='K4-E';
  products=[product('K1-B',[variant('07799087201358','40'),variant('K1-B-39','39')]),product('K2-C'),product('K3-D'),product('K4-E')];
  const result=await processFiles(file([h,row,pack,mismatch,missingSku]),null,null,config);
  expect(result.kappaCobertura?.modelosProtegidos.sort()).toEqual(['K1-B','K2-C','K3-D','K4-E']);
  expect(result.enPeligro).toEqual([]);
  expect((await planStockWrite(result,config)).changes.map(c=>c.desired)).toEqual([2]);
 });
 it('conserva un AR presente con SKU distinto, aunque permite apagar otro AR ausente',async()=>{
  products=[product('K1-B',[variant('1234567890123','40'),variant('1234567890124','39')])];
  const result=await processFiles(file([h,row]),null,null,config);
  const plan=await planStockWrite(result,config);
  expect(plan.notFound).toHaveLength(1);
  expect(plan.changes.map(c=>[c.talle,c.desired])).toEqual([['39',0]]);
 });
 it('revalida la marca y códigos de los modelos ausentes al simular',async()=>{
  products=[product('K2-C')];
  const result=await processFiles(file([h,row]),null,null,config);
  expect(result.enPeligro).toHaveLength(1);
  products[0].vendor='Crocs';
  expect((await planStockWrite(result,config)).changes).toEqual([]);
  products[0].vendor='Kappa';products[0].tags.push('K1-B');
  expect((await planStockWrite(result,config)).changes).toEqual([]);
 });
 it('no aplica barrido con configuración de indumentaria ni sin cobertura',async()=>{
  products=[product('K2-C')];
  const result=await processFiles(file([h,row]),null,null,config);
  expect((await planStockWrite(result,{...config,kappaCalzado:false})).changes).toEqual([]);
  delete result.kappaCobertura;
  expect((await planStockWrite(result,config)).changes).toEqual([]);
 });
 it.skipIf(!existsSync('C:/Users/maxim/Downloads/Kappa Calzado 40% 006 09-10 (1).xlsx'))('verifica el Excel real 09-10 y protege sus packs y filas incompatibles',async()=>{
  const path='C:/Users/maxim/Downloads/Kappa Calzado 40% 006 09-10 (1).xlsx';
  const realFile={name:'Kappa.xlsx',arrayBuffer:async()=>{const b=readFileSync(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}} as File;
  const parsed=parseKappa(await leerKappa(realFile,true),true,'AR');
  expect(Object.keys(parsed.productos)).toHaveLength(360);
  expect(parsed.cobertura.modelosProtegidos.length).toBeGreaterThan(0);
  expect(parsed.productos['K132192YW-KA17B'].sizes).toMatchObject({'40':1,'41':3});
  const protectedCode=parsed.cobertura.modelosProtegidos[0];
  products=[product('K9999-OLD'),product(protectedCode)];
  const result=await processFiles(realFile,null,null,config);
  expect(result.enPeligro.map(p=>p.handle)).toEqual(['k9999-old']);
  expect((await planStockWrite(result,config)).changes.map(c=>[c.sku,c.desired])).toEqual([['K9999-OLD-39',0]]);
 });
});
