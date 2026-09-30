import { it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { excluirAltaPorStock, processFiles, buildMatrixProducts } from '../syncLogic';
vi.mock('../shopify', () => ({ shopifyGraphQL: vi.fn(async (q: string) => q.includes('locations(') ? {locations:{edges:[{node:{id:'loc',name:'DISTRINANDO SA (Reebok - Kappa)'}}]}} : {products:{edges:[],pageInfo:{hasNextPage:false}}}), mismaSucursal:(a:string,b:string)=>a===b }));
it.each(['reebok','kappa'] as const)('%s: cuenta talles positivos y respeta el límite de tres', brand => {
  for (const qty of [1,2,3]) expect(excluirAltaPorStock(brand,{S:qty,M:0})).toBe(true);
  for (const sizes of [{S:4},{S:1,M:1},{S:1,M:2},{S:0}] as Record<string,number>[]) expect(excluirAltaPorStock(brand,sizes)).toBe(false);
});
it('no aplica a otras marcas',()=>expect(excluirAltaPorStock('converse',{S:1})).toBe(false));
it.each(['reebok','kappa'] as const)('%s: filtra altas después de agrupar y conserva excelMap',async brand=>{
  const headers=['SKU','Modelo color','Descripción del artículo','GRUPO','Stock x SKU','Mayorista','Mayorista con descuento','Precio Público','UDM','Mayorista Unitario','Descuento','EAN','GÉNERO'];
  if(brand==='kappa'){headers[4]='DISPONIBLE';headers[7]='Público';}
  const rows=[headers,...[['A','S',3],['A','M',0],['B','S',1],['B','M',1],['C','S',4]].map(([code,size,qty])=>[`${code}-${size}`,code,`LOGO BLACK - ${size}`,'T-SHIRT',qty,1000,600,1900,'Unidades',1000,40,'','MEN'])];
  const sheetName=brand==='kappa'?'INDUMENTARIA 30%':'Ropa';
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheetName);
  const file={name:'Ropa.xlsx',arrayBuffer:async()=>XLSX.write(wb,{type:'array',bookType:'xlsx'})} as File;
  const config={brand,sheetName};
  const result=await processFiles(file,null,null,config);
  expect(result.missingProducts.map(p=>p.coditm)).toEqual(['B','C']);
  expect(result.excelMap.A.sizes).toEqual({S:3,M:0});
  expect(result.alerts.some(a=>a.title==='Modelo excluido de nuevas cargas')).toBe(true);
  const stale={...result,missingProducts:[{...result.missingProducts[0],sizes:{S:3,M:0}}]};
  expect(buildMatrixProducts(stale,config)).toEqual([]);
});
