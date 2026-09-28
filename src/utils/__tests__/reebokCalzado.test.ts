import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync, existsSync } from 'node:fs';
import { parseReebokCalzado, precioReebokCalzado, tablaReebok, REEBOK_SIN_TABLA } from '../reebokCalzado';
import { buildMatrixProducts, processFiles, downloadMatrixCSV } from '../syncLogic';
import { createProducts } from '../createProducts';
const { graphql, download } = vi.hoisted(() => ({ graphql: vi.fn(), download: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string,b: string) => a===b }));
vi.mock('../csv', async orig => ({ ...await orig<typeof import('../csv')>(), triggerDownload: download }));
const headers = ['SKU','Modelo color','Descripción del artículo','GÉNERO','Stock x SKU','Mayorista con descuento','Público'];
const row = (us='6.5', ar='36', code='RBK1100201449') => [`${code}-${us}`,`${code}--`,`PHASE COURT - WHITE - ${ar}`,'UNISEX',1,123.456,200];
const config = { brand:'reebok', reebokCalzado:true, sheetName:'Calzado' } as const;
const file = (rows: unknown[][]) => { const w=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),'Calzado'); return {name:'Calzado.xlsx',arrayBuffer:async()=>XLSX.write(w,{type:'array',bookType:'xlsx'})} as File; };
beforeEach(()=>{ graphql.mockReset().mockImplementation(async(q:string)=>q.includes('locations(')?{locations:{edges:[{node:{id:'loc',name:'DISTRINANDO SA (Reebok - Kappa)'}}]}}:q.includes('mutation CrearProducto')?{productSet:{product:{id:'p'},userErrors:[]}}:q.includes('mutation GuardarTabla')?{metafieldsSet:{metafields:[{key:'size_conversion'}],userErrors:[]}}:{products:{edges:[],pageInfo:{hasNextPage:false}}}); });
describe('Reebok Calzado',()=>{
 it('UNISEX no obliga Hombre; valida todos los talles y omite ambigüedad',()=>{
  expect(tablaReebok([{us:'6.5',ar:'36'}]).tablaTalle).toContain('MUJER');
  expect(tablaReebok([{us:'8',ar:'38'},{us:'9.5',ar:'40'}]).tablaTalle).toContain('MUJER');
  expect(tablaReebok([{us:'6.5',ar:'38'}]).tablaTalle).toBe(REEBOK_SIN_TABLA);
  expect(tablaReebok([{us:'10',ar:'43'},{us:'8.5',ar:'41'}]).sizeConversion).toBeUndefined();
  expect(tablaReebok([{us:'11.5K',ar:'27'}]).tablaTalle).toContain('NIÑO');
  expect(tablaReebok([{us:'M8/W9.5',ar:'40'}]).tablaTalle).toBe(REEBOK_SIN_TABLA);
 });
 it('conserva AR, SKU, costo con centavos y JSON en alta y CSV',async()=>{
  const r=await processFiles(file([headers,row()]),null,null,config);
  const [p]=buildMatrixProducts(r,config);
  expect(p.tags).toContain('TABLA DE TALLE REEBOK MUJER');
  expect(p.variants[0]).toMatchObject({sku:'RBK1100201449-6.5',optionValue:'36',cost:123.46,price:990});
  expect(p.sizeConversion?.['36']).toEqual({arg:'36',us:'6.5',cm:'23.5'});
  downloadMatrixCSV(r,config);expect(download.mock.calls.at(-1)?.[0]).toContain('custom.size_conversion');
  await createProducts(r,config);
  const call=graphql.mock.calls.find(([q])=>q.includes('mutation GuardarTabla'))!;
  expect(call[1].metafields[0]).toMatchObject({ownerId:'p',namespace:'custom',key:'size_conversion',type:'json'});
 });
 it('crea AR claro sin tabla, sin escribir un JSON vacío ni convertir',async()=>{
  const r=await processFiles(file([headers,row('10.5','42')]),null,null,config);
  const [p]=buildMatrixProducts(r,config);expect(p.tags).toContain(REEBOK_SIN_TABLA);expect(p.sizeConversion).toBeUndefined();
  await createProducts(r,config);expect(graphql.mock.calls.some(([q])=>q.includes('mutation GuardarTabla'))).toBe(false);
 });
 it('packs y UK quedan pendientes y no permiten asignar tabla parcial al modelo',()=>{
  const uk=row('8','36');uk[2]='PHASE COURT UK 7';
  const p=parseReebokCalzado([headers,row(),uk,row('M12U 8/11.5 (123321)','CURVA')]);
  expect(p.avisos).toHaveLength(2);expect(p.productos.RBK1100201449.tablaTalle).toBe(REEBOK_SIN_TABLA);
  expect(Object.keys(p.productos.RBK1100201449.sizes)).toEqual(['36']);
 });
 it('precios de ambos formatos: ejemplo confirmado y margen estrictamente mayor al 50%',()=>{
  expect(precioReebokCalzado(59183.9)).toBe(145990);
  const rs=[headers.slice(0,-1),row().slice(0,-1)];
  expect(parseReebokCalzado(rs).productos.RBK1100201449.precio).toBe(990);
  for (const costo of [1, 400, 5999.99, 12000, 38389.44, 59183.9, 100000, 999999]) {
    const price=precioReebokCalzado(costo);
    expect((price-costo*1.21)/price).toBeGreaterThan(.5);
    expect(price%5000).toBe(990);
  }
 });
 it('si falla el JSON informa que ya se creó para evitar duplicar',async()=>{
  const r=await processFiles(file([headers,row()]),null,null,config);
  graphql.mockImplementation(async(q:string)=>q.includes('locations(')?{locations:{edges:[{node:{id:'loc',name:'DISTRINANDO SA (Reebok - Kappa)'}}]}}:q.includes('mutation CrearProducto')?{productSet:{product:{id:'p'},userErrors:[]}}:{metafieldsSet:{userErrors:[{message:'denegado'}]}});
  const result=await createProducts(r,config);expect(result.created).toBe(1);expect(result.errors[0]).toContain('no volver a crearlo');
 });
 for (const name of ['Reebok Calzado 006 40%  22-09.xlsx','Reebok PROMO  001 30%  22-09.xlsx']) {
  const path=`C:/Users/maxim/Downloads/${name}`;
  it.skipIf(!existsSync(path))(`archivo real ${name}`,()=>{
   const w=XLSX.read(readFileSync(path));const rs=XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[w.SheetNames[0]],{header:1});
   const r=parseReebokCalzado(rs); const ps=Object.values(r.productos);
   expect(ps.length).toBeGreaterThan(0);
   expect(ps.reduce((n,p)=>n+Object.keys(p.sizes).length,0)).toBe(name.includes('40%') ? 425 : 152);
   expect(r.avisos).toHaveLength(name.includes('40%') ? 27 : 0);
   expect(ps.every(p=>Object.keys(p.sizes).every(ar=>Number(ar)>=20))).toBe(true);
  });
 }
});

