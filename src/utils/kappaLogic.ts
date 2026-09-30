import * as XLSX from 'xlsx';
import { KAPPA_TABLAS, convertirTalleKappa, type TablaKappa } from './kappaTalles';
import type { SizeConversion } from './reebokCalzado';
import type { ReebokProducto } from './reebokLogic';
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
export interface KappaProducto extends ReebokProducto { tablaTalle?: string; sizeConversion?: SizeConversion; costoMargen: number; }
export async function leerKappa(file: File, calzado: boolean) {
 const w=XLSX.read(await file.arrayBuffer());
 const nombre=calzado ? 'CALZADO' : 'INDUMENTARIA 30%';
 const info=w.Workbook?.Sheets?.find(s=>s.name===nombre);
 if(!w.Sheets[nombre] || info?.Hidden) throw new Error(`Kappa: falta la hoja visible ${nombre}. Elegí el archivo de ${calzado?'calzado':'indumentaria'}.`);
 return XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[nombre],{header:1});
}
export function parseKappa(rows: unknown[][], calzado: boolean, sistema: 'EU'|'AR') {
 const h=rows.findIndex(r=>r.some(v=>norm(v)==='MODELO COLOR') && r.some(v=>norm(v)==='EAN'));
 if(h<0) throw new Error('Kappa: faltan encabezados Modelo Color y EAN.');
 const hs=rows[h].map(norm);
 const c=(name:string)=>{const i=hs.indexOf(name);if(i<0)throw new Error(`Kappa: falta ${name}.`);return i;};
 const skuC=c('SKU'),modeloC=c('MODELO COLOR'),descC=c('DESCRIPCION DEL ARTICULO'),eanC=c('EAN'),udmC=c('UDM');
 const stockC=c(calzado?'DISPONIBLE (INMEDIATO)':'DISPONIBLE'),costC=c('MAYORISTA CON DESCUENTO'),priceC=c('PUBLICO'),listaC=c('MAYORISTA UNITARIO'),dtoC=c('DESCUENTO'),generoC=c('GENERO');
 const productos:Record<string,KappaProducto>={},avisos:string[]=[];
 const vistos=new Map<string,string>(),eans=new Map<string,string>();
 for(let i=h+1;i<rows.length;i++) {
  const r=rows[i],sku=String(r[skuC]??'').trim();if(!sku)continue;
  if(/PACK|CURVA/.test(norm(r[udmC]))) {avisos.push(`Fila ${i+1}: ${sku}; pack excluido (${r[udmC]}).`);continue;}
  const codigo=String(r[modeloC]??'').trim(),desc=String(r[descC]??'').trim();
  if(!codigo || !sku.startsWith(codigo+'-')) {avisos.push(`Fila ${i+1}: ${sku}; SKU y Modelo Color ${codigo} incompatibles, fila excluida.`);continue;}
  const original=sku.slice(codigo.length+1).replace(',','.').toUpperCase();
  if(!desc.toUpperCase().endsWith(' '+original))throw new Error(`Kappa ${sku}: talle del SKU y descripción no coinciden.`);
  let talle=original,tabla:TablaKappa|undefined;
  if(calzado) {
   if(!/^\d+(\.\d+)?$/.test(original)) {avisos.push(`${sku}: no es talle individual de calzado.`);continue;}
   tabla=/KIDS|CHILD|NINO|JUNIOR/.test(norm(r[generoC]))?'NINO':'UNISEX';
   const equivalencia=sistema==='EU'?convertirTalleKappa(original,tabla):Object.values(KAPPA_TABLAS[tabla]).find(t=>t.arg===original);
   if(!equivalencia){avisos.push(`${sku}: talle ${original} ${sistema} fuera de tabla ${tabla}; revisar.`);continue;}
   talle=equivalencia.arg;
  } else if(!/^(X{0,4}[SML]|[2-6]XL|TU|UNICO)$/.test(original)) {avisos.push(`${sku}: talle de indumentaria sin identificar.`);continue;}
  const qty=Number(String(r[stockC]??'').replace(/^\+\s*/,'')),costo=Math.round(Number(r[costC])*100)/100,precio=Number(r[priceC]),lista=Number(r[listaC]),dto=Number(r[dtoC]);
  if(r[stockC]==null || r[stockC]==='' || !Number.isInteger(qty)||qty<0||!Number.isFinite(costo)||costo<=0||!Number.isFinite(precio)||precio<=0||!Number.isFinite(lista)||lista<=0||r[dtoC]==null||r[dtoC]===''||!Number.isFinite(dto)||dto<0||dto>=100) throw new Error(`Kappa ${sku}: stock o precios inválidos.`);
  const costoMargen=lista*(1-dto/100);
  const raw=r[eanC],ean=/^0+$/.test(String(raw??'').trim())?'':String(raw??'').trim();
  if(ean && (!/^\d{8,14}$/.test(ean)||(typeof raw==='number'&&!Number.isSafeInteger(raw))))throw new Error(`Kappa ${sku}: EAN inválido, no se redondea.`);
  const base=desc.slice(0,-original.length).replace(/\bKAPPA\b/gi,'').trim();
  const nombre=`${calzado?'Zapatillas':'Indumentaria'} Kappa ${base}`;
  const signature=JSON.stringify([codigo,nombre,talle,qty,costo,precio,costoMargen,ean,tabla]);
  if(vistos.has(sku)) {if(vistos.get(sku)!==signature)throw new Error(`Kappa ${sku}: filas repetidas con datos diferentes.`);avisos.push(`${sku}: fila duplicada idéntica omitida; no se suma stock.`);continue;}
  vistos.set(sku,signature);
  if(ean && eans.has(ean))throw new Error(`Kappa: EAN ${ean} compartido por ${eans.get(ean)} y ${sku}. Revisar.`);
  if(ean)eans.set(ean,sku);else avisos.push(`${sku}: sin EAN; se conserva SKU del proveedor y código de barras vacío.`);
  const old=productos[codigo];
  if(old&&(old.nombre!==nombre||old.costo!==costo||old.precio!==precio||Math.abs(old.costoMargen-costoMargen)>.005))throw new Error(`Kappa ${codigo}: nombres o precios diferentes entre talles.`);
  const p=productos[codigo]??={codigo,nombre,artType:calzado?'zapatillas':'indumentaria',costo,precio,costoMargen,sizes:{},skuPorTalle:{},skuProveedorPorTalle:{},...(tabla?{tablaTalle:`TABLA DE TALLE KAPPA ${tabla==='NINO'?'NIÑO':tabla}`,sizeConversion:KAPPA_TABLAS[tabla]}:{})};
  if(talle in p.sizes)throw new Error(`Kappa ${codigo}: dos SKU para talle ${talle}.`);
  if(tabla&&p.tablaTalle!==`TABLA DE TALLE KAPPA ${tabla==='NINO'?'NIÑO':tabla}`)throw new Error(`Kappa ${codigo}: géneros/tablas incompatibles.`);
  p.sizes[talle]=qty;p.skuPorTalle[talle]=ean||sku;p.skuProveedorPorTalle![talle]=sku;
 }
 if(!Object.keys(productos).length)throw new Error('Kappa: no hay filas compatibles. '+avisos.join(' '));
 return {productos,avisos};
}
export function coincideVarianteKappa(data: {skuPorTalle?:Record<string,string>;skuProveedorPorTalle?:Record<string,string>},size:string,v:{sku?:string}) {
 const sku=String(v.sku||'').trim();return !!sku&&(sku===data.skuPorTalle?.[size]||sku===data.skuProveedorPorTalle?.[size]);
}
