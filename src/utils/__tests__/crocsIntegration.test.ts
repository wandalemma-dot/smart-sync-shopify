import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { processFiles, buildMatrixProducts, downloadMatrixCSV } from '../syncLogic';
import { createProducts } from '../createProducts';
import { planStockWrite } from '../writeStock';
import { parseCrocs } from '../crocsLogic';
import { talleCrocs } from '../crocsTalles';
const { graphql, download } = vi.hoisted(() => ({ graphql:vi.fn(), download:vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL:graphql, mismaSucursal:(a:string,b:string)=>a===b }));
vi.mock('../csv', async orig => ({ ...await orig<typeof import('../csv')>(), triggerDownload:download }));
const config = { brand:'crocs', sheetName:'Sheet1' } as const;
const headers = ['Foto','SKU','Modelo','Categoría','Familia','Tipo de Producto','Modelo-Color','Descripción','UdM','Disponible','Disponible u','Módulo Mayorista','Individual Mayorista','COSTO DESCUENTO','PUBLICO DESCUENTO'];
const row = ['', 'C10001-C001-M8/W10','','','','CALZADO','C10001-C001','CLASSIC BLACK 40','Pares',5,5,31990.93,99999,23993.2,123];
const file = (rows:unknown[][]) => {
  const w=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),'Sheet1');
  return { name:'Crocs.xlsx', arrayBuffer:async()=>XLSX.write(w,{type:'array',bookType:'xlsx'}) } as File;
};
const locations = { locations:{edges:[{node:{id:'loc',name:'DISTRINANDO SA (Reebok - Kappa)'}},{node:{id:'mar',name:'DEPOSITO MARTINEZ'}}]} };
beforeEach(() => { graphql.mockReset().mockImplementation(async(q:string) => q.includes('locations(') ? locations : {products:{edges:[],pageInfo:{hasNextPage:false}}}); });

describe('Crocs integrado en sincronización', () => {
  it('comparte fórmula L, costo N, SKU y JSON entre vista previa y CSV', async () => {
    const result=await processFiles(file([headers,row]),null,null,config);
    const p=buildMatrixProducts(result,config)[0];
    expect(p.vendor).toBe('Crocs');
    expect(p.variants[0]).toMatchObject({sku:'C10001-C001-M8/W10',optionValue:'40',cost:23993.2,price:59999,qty:5});
    expect(p.variants[0].barcode).toBeUndefined();
    expect(p.tags).toEqual(expect.arrayContaining(['C10001-C001','C10001-C001-M8/W10','TABLA DE TALLE CROCS HOMBRE']));
    expect(p.sizeConversion?.['40']).toEqual({arg:'39-40',us:'M8/W10',cm:'25.5'});
    downloadMatrixCSV(result,config);
    const csv=download.mock.calls.at(-1)![0];
    expect(csv).toContain('product.metafields.custom.size_conversion');
    expect(csv).toContain('C10001-C001-M8/W10');
    expect(csv).toContain('59999');
  });

  it('alta simulada escribe JSON y stock únicamente en Distrinando; requiere sucursal', async () => {
    const result=await processFiles(file([headers,row]),null,null,config);
    graphql.mockImplementation(async(q:string) => q.includes('locations(') ? locations : q.includes('mutation CrearProducto') ? {productSet:{product:{id:'p'},userErrors:[]}} : q.includes('mutation GuardarTabla') ? {metafieldsSet:{userErrors:[]}} : {});
    expect((await createProducts(result,config)).created).toBe(1);
    const input=graphql.mock.calls.find(([q])=>q.includes('mutation CrearProducto'))![1].input;
    expect(input.variants[0]).toMatchObject({price:'59999',inventoryItem:{sku:'C10001-C001-M8/W10',cost:'23993.2'},inventoryQuantities:[{locationId:'loc',name:'available',quantity:5}]});
    const meta=graphql.mock.calls.find(([q])=>q.includes('mutation GuardarTabla'))![1].metafields[0];
    expect(meta).toMatchObject({ownerId:'p',namespace:'custom',key:'size_conversion',type:'json'});
    expect(JSON.parse(meta.value)['40'].us).toBe('M8/W10');
    graphql.mockReset().mockResolvedValue({locations:{edges:[]}});
    await expect(createProducts(result,config)).rejects.toThrow('sucursal');
    expect(graphql.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
  });

  it('stock y precios requieren SKU exacto, conservan talles y modelos ausentes', async () => {
    const variant=(sku:string,id:string,title:string)=>({node:{id,title,sku,price:'100',inventoryItem:{id:'i'+id,unitCost:{amount:'50'},inventoryLevel:{quantities:[{name:'available',quantity:9}]}}}});
    const product={id:'p',handle:'crocs',vendor:'Crocs',title:'Calzado Crocs Classic',tags:['C10001-C001'],variants:{edges:[variant('C10001-C001-M8/W10','v','40'),variant('otro','v2','40'),variant('C10001-C001-M9/W11','v3','41')]}};
    const absent={...product,id:'p2',handle:'absent',tags:['C999-C001'],variants:{edges:[variant('C999-C001-M8','v4','40')]}};
    graphql.mockImplementation(async(q:string)=>q.includes('locations(')?locations:{products:{edges:[{node:product},{node:absent}],pageInfo:{hasNextPage:false}}});
    const result=await processFiles(file([headers,row]),null,null,config);
    expect(result.updatesToApply.map(v=>v.variantId)).toEqual(['v']);
    expect(result.enPeligro).toEqual([]);
    const plan=await planStockWrite(result,config);
    expect(plan.locationId).toBe('loc'); expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({desired:5,inventoryItemId:'iv'});
    expect(graphql.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
  });

  it('niños usan talle web, no el rango ARG, y dobles quedan pendientes',()=>{
    expect(talleCrocs('C2')).toMatchObject({talleWeb:'19',tipo:'NIÑO'});
    expect(talleCrocs('J3')).toMatchObject({talleWeb:'33',tipo:'NIÑO'});
    expect(talleCrocs('C6/7')).toBeNull();
    const child=[...row]; child[1]='C10001-C001-J1'; child[7]='CLASSIC BLACK 31';
    const p=parseCrocs([headers,child]).productos['C10001-C001'];
    expect(p.sizes).toEqual({'31':5}); expect(p.sizeConversion?.['31']).toEqual({arg:'29-30',us:'J1',cm:'20'});
  });

  const path='C:/Users/maxim/Downloads/STOCKPROMOCROCS (1).xlsx';
  it.skipIf(!existsSync(path))('archivo real: toda alta conserva costo N, base L, SKU y talla respaldada',()=>{
    const w=XLSX.read(readFileSync(path)), rows=XLSX.utils.sheet_to_json<unknown[]>(w.Sheets.Sheet1,{header:1});
    const result=parseCrocs(rows), products=Object.values(result.productos);
    expect(products.length).toBeGreaterThan(0);
    for(const p of products) for(const [size,sku] of Object.entries(p.skuPorTalle)) {
      const r=rows.find(r=>r[1]===sku)!;
      expect(r[8]).toBe('Pares'); expect(r[13]).not.toBeNull(); expect(r[13]).not.toBeUndefined();
      expect(p.costo).toBe(Math.round(Number(r[13])*100)/100);
      expect(p.precio).toBe(Math.max(999,Math.round((Number(r[11])*1.8755+1)/1000)*1000-1));
      expect(size).toBe(String(r[7]).match(/(\d+)$/)?.[1]);
    }
  });
});
