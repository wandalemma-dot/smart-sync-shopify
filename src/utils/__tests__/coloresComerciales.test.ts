import { describe,it,expect } from 'vitest';
import { simplificarColores } from '../coloresComerciales';
import { tituloReebokCalzado } from '../reebokCalzado';
import { parseKappa } from '../kappaLogic';
describe('colores comerciales',()=>{
 it('simplifica el ejemplo confirmado sin perder modelo ni colores',()=>{
  expect(tituloReebokCalzado('Zapatillas Reebok CLASSIC LEATHER LILGLW/PROPNK/CBLACK')).toBe('Zapatillas Reebok Classic Leather Lila Rosa Negro');
 });
 it('traduce combinaciones Kappa y elimina colores repetidos',()=>{
  expect(simplificarColores('Zapatillas Kappa CLASSIC BLACK-WHITE-BLACK').titulo).toBe('Zapatillas Kappa CLASSIC Negro Blanco');
  expect(simplificarColores('Indumentaria Kappa LOGO GREEN OPALE').titulo).toBe('Indumentaria Kappa LOGO Verde');
 });
 it('no modifica modelos sin color ni adivina códigos desconocidos',()=>{
  expect(simplificarColores('Zapatillas Kappa KOMBAT 3')).toEqual({titulo:'Zapatillas Kappa KOMBAT 3',pendientes:[]});
  expect(simplificarColores('Zapatillas Reebok CLUB - ZZZ/WHITE')).toEqual({titulo:'Zapatillas Reebok CLUB ZZZ Blanco',pendientes:['ZZZ']});
 });
 it('Kappa valida filas antes de simplificar y conserva SKU, costo y talles',()=>{
  const h=['SKU','Modelo Color','Descripción del artículo','EAN','UDM','DISPONIBLE (inmediato)','Mayorista con descuento','Público','Mayorista Unitario','Descuento','GÉNERO'];
  const r=['K-B-40','K-B','CLASSIC BLACK-WHITE 40','07799087201358','Pares',2,600,1875.5,1000,40,'MEN'];
  const p=parseKappa([h,r],true,'AR').productos['K-B'];
  expect(p.nombre).toBe('Zapatillas Kappa CLASSIC Negro Blanco');
  expect(p).toMatchObject({costo:600,precio:1875.5,sizes:{'40':2},skuPorTalle:{'40':'07799087201358'}});
 });
});
