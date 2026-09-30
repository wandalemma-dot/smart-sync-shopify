import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { existsSync, readFileSync } from 'node:fs';
import { parseReebokCalzado } from '../reebokCalzado';
import { coincideVarianteReebok } from '../reebokMatching';

const header = ['Número de artículo','Descripción del artículo','EAN','Modelo Color','UDM','DISPONIBLE (inmediato)','TOTAL PARES','Mayorista unit. + PP','Mayorista Unitario'];
const row = (ean: string | number = '04065419284966') => ['RBK1100006321-10.5','CLUB C DOUBLE - WHITE - 41',ean,'RBK1100006321--','Pares',2,20,90000,53318.58];
describe('Reebok inmediato y compatibilidad', () => {
 it('usa Unitario y Disponible, conserva EAN y código del proveedor por AR', () => {
  const p=parseReebokCalzado([header,row()]).productos.RBK1100006321;
  expect(p).toMatchObject({sizes:{'41':2},costo:31991.15,precio:99999,skuPorTalle:{'41':'04065419284966'},skuProveedorPorTalle:{'41':'RBK1100006321-10.5'}});
 });
 it('sin EAN conserva SKU y rechaza EAN mal formado o duplicado', () => {
  expect(parseReebokCalzado([header,row('')]).productos.RBK1100006321.skuPorTalle['41']).toBe('RBK1100006321-10.5');
  expect(()=>parseReebokCalzado([header,row('4.06E+12')])).toThrow('EAN inválido');
  const other=row();other[0]='RBK1100006321-9';other[1]='CLUB C DOUBLE - WHITE - 39';
  expect(()=>parseReebokCalzado([header,row(),other])).toThrow('EAN repetido');
 });
 it.each(['Mayorista Unitario','Mayorista'])('excluye packs por UDM antes de leer precios o talles: %s', mayorista => {
  const h=[...header];h[8]=mayorista;if(mayorista==='Mayorista') h[5]='STOCK';
  const r=row();r[4]='Pack de   12 Unidades';r[8]='';
  const result=parseReebokCalzado([h,r]);expect(result.productos).toEqual({});expect(result.avisos[0]).toContain('pack excluido');
 });
 it('cruza EAN y SKU anterior; lista vieja cruza AR solo en modelo ya identificado',()=>{
  const p=parseReebokCalzado([header,row()]).productos.RBK1100006321;
  expect(coincideVarianteReebok(p,'41',{sku:'RBK1100006321-10.5'},true)).toBe(true);
  expect(coincideVarianteReebok(p,'41',{sku:'04065419284966'},true)).toBe(true);
  const old={skuPorTalle:p.skuProveedorPorTalle};
  expect(coincideVarianteReebok(old,'41',{sku:'04065419284966',title:'41'},true)).toBe(true);
  expect(coincideVarianteReebok(old,'41',{sku:'04065419284966',title:'40'},true)).toBe(false);
  expect(coincideVarianteReebok(old,'41',{sku:'04065419284966',title:'41'},false)).toBe(false);
 });
 const paths=['Reebok inmediato 29-09 (1).xlsb','Reebok Calzado 006 40%  22-09.xlsx','Reebok PROMO  001 30%  22-09.xlsx'];
 for(const name of paths) {
  const path=`C:/Users/maxim/Downloads/${name}`;
  it.skipIf(!existsSync(path))(`archivo real ${name}`,()=>{
   const w=XLSX.read(readFileSync(path));const rs=XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[w.SheetNames[0]],{header:1});
   const result=parseReebokCalzado(rs); const ps=Object.values(result.productos);
   const inmediato=name.endsWith('.xlsb');
   expect(ps.length).toBe(inmediato ? 382 : name.includes('40%') ? 211 : 45);
   expect(ps.reduce((n,p)=>n+Object.keys(p.sizes).length,0)).toBe(inmediato ? 1001 : name.includes('40%') ? 450 : 152);
   if(inmediato) {
    expect(result.avisos.filter(s=>s.includes('pack excluido'))).toHaveLength(41);
    expect(result.avisos.filter(s=>!s.includes('pack excluido')&&!s.includes('revisar colores'))).toHaveLength(1);
    expect(result.avisos.some(s=>s.includes('Fila 838'))).toBe(true);
    expect(ps.reduce((n,p)=>n+Object.values(p.skuPorTalle).filter(s=>/^\d+$/.test(s)).length,0)).toBe(992);
   }
  });
 }
});
