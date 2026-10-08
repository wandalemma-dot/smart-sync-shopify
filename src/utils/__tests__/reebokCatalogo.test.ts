import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { existsSync, readFileSync } from 'node:fs';
import { parseReebokCalzado } from '../reebokCalzado';
import { parseReebok } from '../reebokLogic';
import { combinarReebok, ausenteReebok } from '../reebokCatalogo';
import { processFiles } from '../syncLogic';
import { planStockWrite } from '../writeStock';

const { graphql } = vi.hoisted(() => ({ graphql: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string,b: string) => a === b }));
const headers = ['SKU', 'Modelo color', 'Descripción del artículo', 'Stock x SKU', 'Mayorista', 'UDM', 'EAN'];
const code = 'RBK1100201449';
const row = (us = '6.5', ar = '36', qty = 5, codigo = code, udm = 'Pares', ean = '') =>
  [`${codigo}-${us}`, `${codigo}--`, `PHASE COURT - WHITE - ${ar}`, qty, 63982.4, udm, ean];
const lista = (nombre: string, rows: unknown[][]) => ({ nombre, datos: parseReebokCalzado([headers, ...rows]) });
const file = (name: string, rows: unknown[][], sheetName = 'Calzado') => {
  const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([headers,...rows]), sheetName);
  return { name, arrayBuffer: async () => XLSX.write(w,{type:'array',bookType:'xlsx'}) } as File;
};
const cfg = { brand:'reebok', reebokCalzado:true, sheetName:'Calzado' } as const;
const variant = (sku: string, title: string, qty = 10) => ({ node: { id:sku, sku, title, price:'100', inventoryItem: {
  id:`inv-${sku}`, inventoryLevel: { quantities: [{ name:'available', quantity:qty }] },
} } });
const product = (c: string, variants = [variant(`${c}-6.5`,'36')], title = 'Zapatillas Reebok Phase Court', vendor = 'Reebok') => ({
  id:c, handle:c.toLowerCase(), title, vendor, tags:[c], options:[{name:'Talle'}], variants:{edges:variants},
});
let products: ReturnType<typeof product>[];
beforeEach(() => {
  products = [];
  graphql.mockReset().mockImplementation(async (q: string, vars: any) => {
    if (q.includes('locations(')) return { locations:{edges:[{node:{id:'distri',name:'DISTRINANDO SA (Reebok - Kappa)'}},{node:{id:'martinez',name:'DEPOSITO MARTINEZ'}}]} };
    const ps = vars?.q?.includes('handle:') ? products.filter(p => vars.q.includes(p.handle)) : products;
    return {products:{edges:ps.map(node => ({node})),pageInfo:{hasNextPage:false}}};
  });
});

describe('Unión Reebok Calzado', () => {
  it('combina talles, no suma repetidos y complementa EAN', () => {
    const a = lista('30.xlsx',[row()]);
    const b = lista('40.xlsx',[row('6.5','36',5,code,'Pares','04065419284966'),row('7.5','37',8)]);
    const p = combinarReebok([a,b]).productos[code];
    expect(p.sizes).toEqual({'36':5,'37':8});
    expect(p.skuPorTalle['36']).toBe('04065419284966');
    expect(p.tablaTalle).toContain('MUJER');
  });
  it('aparta cantidades distintas sin bloquear la unión; nunca suma', () => {
    const a = lista('30.xlsx',[row()]), b = lista('40.xlsx',[row('6.5','36',12)]);
    const result=combinarReebok([a,b]);
    expect(result.productos[code]).toBeUndefined();
    expect(result.cobertura.modelosPresentes).toContain(code);
    expect(result.cobertura.modelosProtegidos).toContain(code);
    expect(result.avisos.some(a=>a.includes('Modelo pendiente:'))).toBe(true);
    expect(combinarReebok([a,b],'40.xlsx').productos[code].sizes['36']).toBe(12);
    expect(combinarReebok([b,a],'30.xlsx').productos[code].sizes['36']).toBe(5);
  });
  it('no resuelve conflictos de identidad usando prioridad', () => {
    const a = lista('30.xlsx',[row()]), b = lista('40.xlsx',[row('7','36')]);
    expect(() => combinarReebok([a,b],'30.xlsx')).toThrow('identificadores distintos');
  });
  it('bloquea copias idénticas y un SKU con dos equivalencias AR', () => {
    const a=lista('30.xlsx',[row()]);
    expect(()=>combinarReebok([a,lista('copia.xlsx',[row()])])).toThrow('mismo contenido');
    expect(()=>combinarReebok([a,lista('40.xlsx',[row('6.5','37')])],'30.xlsx')).toThrow('distintos talles AR');
  });
  it('mantiene protegido un modelo con SKU vacío', () => {
    const r=row(); r[0]='';
    const datos=lista('30.xlsx',[r]).datos;
    expect(datos.modelosPresentes).toContain(code);
    expect(datos.modelosProtegidos).toContain(code);
  });
  it('conserva modelos con precios diferentes sin bloquear los demás', () => {
    const r=row('7.5','37'); r[4]=50000;
    const a=lista('30.xlsx',[row()]),b=lista('40.xlsx',[r]);
    const resultado=combinarReebok([a,b]);
    expect(resultado.productos[code]).toBeUndefined();
    expect(resultado.cobertura.modelosProtegidos).toContain(code);
    const p=combinarReebok([a,b],'40.xlsx').productos[code];
    expect(p.costo).toBe(30000);expect(p.sizes).toEqual({'36':5,'37':5});
  });
  it('rechaza listas vacías y conserva presencia de packs/talles desconocidos', () => {
    expect(() => combinarReebok([lista('vacío',[])])).toThrow('no hay calzado');
    const a = lista('30.xlsx',[row(),row('4','UK 7',1,'RBKDUDA'),row('8','39',1,'RBKPACK','Pack de 12 Unidades')]);
    expect(a.datos.modelosProtegidos).toEqual(['RBKDUDA','RBKPACK']);
    expect(a.datos.modelosPresentes).toContain('RBKPACK');
  });
  it('no mezcla tablas incompatibles de un mismo modelo', () => {
    const a=lista('30',[row()]),b=lista('40',[row('10','43')]);
    expect(combinarReebok([a,b]).productos[code].sizeConversion).toBeUndefined();
  });
  it('protege ropa, otras marcas y productos sin identificador del proveedor', () => {
    const c=combinarReebok([lista('30',[row()])]).cobertura;
    const p={title:'Zapatillas Reebok',vendor:'Reebok',tags:'RBKAUSENTE',variants:{edges:[{node:{sku:'1234567890123'}}]}};
    expect(ausenteReebok(p,c)).toBe(true);
    expect(ausenteReebok({...p,title:'Pantalón Reebok'},c)).toBe(false);
    expect(ausenteReebok({...p,vendor:'Kappa'},c)).toBe(false);
    expect(ausenteReebok({...p,tags:''},c)).toBe(false);
  });
  it('lee la hoja propia de cada Excel y simula ceros solo ausentes de la unión en DISTRINANDO', async () => {
    const f1=file('30.xlsx',[row()]);
    const f2=file('40.xlsx',[row('7.5','37',8),row('6.5','36',4,'RBKSOLO40')],'Promo 40');
    products=[product(code,[variant(`${code}-6.5`,'36'),variant(`${code}-7.5`,'37'),variant(`${code}-8`,'38')]),
      product('RBKSOLO40'),product('RBKAUSENTE'),product('RBKROPA',undefined,'Pantalón Reebok'),product('KAPPA',undefined,'Zapatillas Kappa','Kappa')];
    const result=await processFiles(f1,null,null,cfg,null,[{file:f1,sheetName:'Calzado'},{file:f2,sheetName:'Promo 40'}]);
    expect(result.enPeligro.map(p=>p.handle)).toEqual(['rbkausente']);
    const plan=await planStockWrite(result,cfg);
    expect(plan.locationId).toBe('distri');
    expect(plan.changes.filter(c=>c.desired===0).map(c=>c.sku).sort()).toEqual([`${code}-8`,'RBKAUSENTE-6.5'].sort());
    expect(plan.changes.find(c=>c.sku===`${code}-7.5`)?.desired).toBe(8);
    expect(graphql.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
    expect(graphql.mock.calls.filter(([q])=>q.includes('query($q:')).every(([,v])=>v.loc==='distri')).toBe(true);
  });
  it('una sola lista conserva productos y talles ausentes', async () => {
    products=[product(code,[variant(`${code}-6.5`,'36'),variant(`${code}-8`,'38')]),product('RBKAUSENTE')];
    const res=await processFiles(file('30.xlsx',[row()]),null,null,cfg);
    expect(res.enPeligro).toEqual([]);
    const plan=await planStockWrite(res,cfg);
    expect(plan.changes).toHaveLength(1); expect(plan.changes[0].desired).toBe(5);
  });
  it('sin elegir prioridad, compara ausentes aun cuando todos los modelos presentes tengan diferencias',async()=>{
    const f1=file('30.xlsx',[row()]),f2=file('40.xlsx',[row('6.5','36',12)]);
    products=[product(code,[variant(`${code}-6.5`,'36'),variant(`${code}-8`,'38')]),product('RBKAUSENTE')];
    const res=await processFiles(f1,null,null,cfg,null,[{file:f1,sheetName:'Calzado'},{file:f2,sheetName:'Calzado'}]);
    expect(res.excelMap).toEqual({});
    expect(res.updatesToApply).toEqual([]);expect(res.missingProducts).toEqual([]);
    expect(res.enPeligro.map(p=>p.handle)).toEqual(['rbkausente']);
    const plan=await planStockWrite(res,cfg);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({sku:'RBKAUSENTE-6.5',desired:0});
  });
  it('actualiza modelos sin diferencias de ambas listas aunque otro quede pendiente',async()=>{
    const f1=file('30.xlsx',[row(),row('6.5','36',6,'RBKSOLO30')]),f2=file('40.xlsx',[row('6.5','36',12),row('6.5','36',7,'RBKSOLO40')]);
    products=[product(code),product('RBKSOLO30'),product('RBKSOLO40'),product('RBKAUSENTE')];
    const res=await processFiles(f1,null,null,cfg,null,[{file:f1,sheetName:'Calzado'},{file:f2,sheetName:'Calzado'}]);
    const plan=await planStockWrite(res,cfg);
    expect(plan.changes.map(p=>[p.sku,p.desired])).toEqual([['RBKSOLO30-6.5',6],['RBKSOLO40-6.5',7],['RBKAUSENTE-6.5',0]]);
  });
  it('no pone a cero variantes de modelos con filas excluidas ni talles que no pudo ubicar', async () => {
    products=[product(code,[variant(`${code}-6.5`,'36'),variant(`${code}-8`,'38')]), product('RBKDUDA'),product('RBKPACK'),
      product('RBKNOUBICADO',[variant('distinto','39')])];
    const f1=file('30.xlsx',[row(),row('4','UK 7',1,code),row('4','UK 7',1,'RBKDUDA'),row('8','39',1,'RBKPACK','Pack de 12 Unidades')]);
    const f2=file('40.xlsx',[row('6.5','36',5,'RBKNOUBICADO')]);
    const res=await processFiles(f1,null,null,cfg,null,[{file:f1,sheetName:'Calzado'},{file:f2,sheetName:'Calzado'}]);
    expect(res.enPeligro).toEqual([]);
    const plan=await planStockWrite(res,cfg);
    expect(plan.changes.filter(c=>c.desired===0)).toEqual([]);
    expect(plan.notFound).toHaveLength(1);
  });
});

describe('Lista vigente Reebok Indumentaria', () => {
  const h=['SKU','Modelo color','Descripción del artículo','GRUPO','Stock x SKU','Mayorista con descuento','Precio Público','UDM'];
  const ropa=(codigo: string, size='S', grupo='T-SHIRT', udm='Unidades')=>[`${codigo}-${size}`,`${codigo}--`,`GRAPHIC - BLACK - ${size}`,grupo,5,20000,60000,udm];
  const archivo=(rows: unknown[][])=>{
    const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([h,...rows]),'Ropa');
    return {name:'Ropa.xlsx',arrayBuffer:async()=>XLSX.write(w,{type:'array',bookType:'xlsx'})} as File;
  };
  const config={brand:'reebok',sheetName:'Ropa'} as const;
  it('una lista pone a cero ropa antigua, conserva calzado/Kappa/desconocidos y protege packs/categorías excluidas',async()=>{
    products=[product('RBKROPA',[variant('RBKROPA-S','S'),variant('RBKROPA-M','M')],'Remera Reebok Negra'),
      product('RBKVIEJO',[variant('RBKVIEJO-L','L')],'Pantalón Reebok Viejo'),
      product('RBKCALZADO'),product('KAPPA',[variant('KAPPA-S','S')],'Remera Kappa','Kappa'),
      product('RBKDUDA',undefined,'Modelo sin identificar'),
      product('RBKPACK',[variant('RBKPACK-S','S')],'Remera Reebok Pack'),
      product('RBKCATEGORIA',[variant('RBKCATEGORIA-S','S')],'Buzo Reebok')];
    const res=await processFiles(archivo([ropa('RBKROPA'),ropa('RBKPACK','S','T-SHIRT','Pack de 12 Unidades'),ropa('RBKCATEGORIA','S','DESCONOCIDO')]),null,null,config);
    expect(res.enPeligro.map(p=>p.handle)).toEqual(['rbkviejo']);
    const plan=await planStockWrite(res,config);
    expect(plan.locationId).toBe('distri');
    expect(plan.changes.filter(p=>p.desired===0).map(p=>p.sku).sort()).toEqual(['RBKROPA-M','RBKVIEJO-L']);
    expect(plan.changes.find(p=>p.sku==='RBKROPA-S')?.desired).toBe(5);
    expect(graphql.mock.calls.every(([q])=>!q.includes('mutation'))).toBe(true);
  });
  it('un talle sin ubicar protege los demás talles del mismo modelo',async()=>{
    products=[product('RBKROPA',[variant('SKUOTRO','M')],'Remera Reebok Negra')];
    const res=await processFiles(archivo([ropa('RBKROPA')]),null,null,config);
    const plan=await planStockWrite(res,config);
    expect(plan.changes).toEqual([]);expect(plan.notFound).toHaveLength(1);
  });
  const path='C:/Users/maxim/Downloads/RBK Indumentaria 001 40% 05-10 (1).xlsx';
  it.skipIf(!existsSync(path))('lee el Excel vigente de indumentaria con presencia registrada antes de excluir filas',()=>{
    const w=XLSX.read(readFileSync(path));
    const datos=parseReebok(XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[w.SheetNames[0]],{header:1}));
    expect(Object.values(datos.productos).reduce((n,p)=>n+Object.keys(p.sizes).length,0)).toBe(157);
    for(const code of Object.keys(datos.productos))expect(datos.modelosPresentes).toContain(code);
    for(const code of datos.modelosProtegidos)expect(datos.modelosPresentes).toContain(code);
  });
});

const reales=['Reebok Calzado 001 30%  07-10.xlsx','RBK Calzado 006 40% 05-10 (2).xlsx'];
it.skipIf(!reales.every(n=>existsSync(`C:/Users/maxim/Downloads/${n}`)))('combina las dos listas reales de Wanda sin duplicar pares',()=>{
  const listas=reales.map(nombre=>{
    const w=XLSX.read(readFileSync(`C:/Users/maxim/Downloads/${nombre}`));
    return {nombre,datos:parseReebokCalzado(XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[w.SheetNames[0]],{header:1}))};
  });
  const result=combinarReebok(listas,reales[0]);
  const sinPrioridad=combinarReebok(listas);
  expect(sinPrioridad.cobertura.modelosPresentes).toEqual(result.cobertura.modelosPresentes);
  expect(sinPrioridad.avisos.some(a=>a.includes('Modelo pendiente:'))).toBe(true);
  for (const code of Object.keys(result.productos).filter(c=>!sinPrioridad.productos[c])) {
    expect(sinPrioridad.cobertura.modelosProtegidos).toContain(code);
  }
  const skus=new Set(listas.flatMap(l=>Object.values(l.datos.productos).flatMap(p=>Object.values(p.skuProveedorPorTalle!))));
  expect(Object.values(result.productos).reduce((n,p)=>n+Object.keys(p.sizes).length,0)).toBe(skus.size);
  for(const code of result.cobertura.modelosProtegidos) expect(result.cobertura.modelosPresentes).toContain(code);
  console.info('Listas reales Reebok:',JSON.stringify({modelos:Object.keys(result.productos).length,talles:skus.size,modelosProtegidos:result.cobertura.modelosProtegidos.length,avisos:result.avisos.length}));
});
