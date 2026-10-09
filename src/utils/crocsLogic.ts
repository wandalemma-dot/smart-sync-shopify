import { talleCrocs } from './crocsTalles';
import type { ReebokCalzadoProducto } from './reebokCalzado';
import { simplificarColores } from './coloresComerciales';
import { precioReebokCalzado } from './reebokCalzado';

export interface CrocsOpciones {
  /** Regla de venta explícita: recibe Módulo Mayorista (L), nunca el costo N. */
  calcularPrecio?: (mayorista: number) => number;
  permitirDoblesNino?: boolean;
}
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();

/** Solo calzado individual. Columnas por nombre; UDM se evalúa antes del sufijo M/C. */
export function parseCrocs(rows: unknown[][], opciones: CrocsOpciones = {}) {
  const h = rows.findIndex(r => r.some(v=>norm(v)==='MODELO-COLOR') && r.some(v=>norm(v)==='SKU'));
  if(h<0) throw new Error('Crocs: faltan los encabezados SKU y Modelo-Color.');
  const headers=rows[h].map(norm);
  const col=(name:string)=>{const c=headers.indexOf(name);if(c<0)throw new Error(`Crocs: falta la columna ${name}.`);return c;};
  const c={sku:col('SKU'),modelo:col('MODELO-COLOR'),tipo:col('TIPO DE PRODUCTO'),desc:col('DESCRIPCION'),udm:col('UDM'),stock:col('DISPONIBLE'),costo:col('COSTO DESCUENTO'),mayorista:col('MODULO MAYORISTA')};
  const productos:Record<string,ReebokCalzadoProducto>={},avisos:string[]=[];
  const vistos=new Set<string>(), pendientes=new Set<string>();
  for(let i=h+1;i<rows.length;i++) {
    const r=rows[i],sku=String(r[c.sku]??'').trim(); if(!sku)continue;
    if(/PACK|CURVA|MODULO/.test(norm(r[c.udm]))) {avisos.push(`Fila ${i+1}: ${sku}; pack excluido.`);continue;}
    if(norm(r[c.tipo])!=='CALZADO') {avisos.push(`Fila ${i+1}: ${sku}; accesorio excluido, esta carga es de calzado.`);continue;}
    const codigo=String(r[c.modelo]??'').trim();
    if(!codigo || !sku.startsWith(codigo+'-'))throw new Error(`Crocs fila ${i+1}: SKU y Modelo-Color incompatibles (${sku}).`);
    const us=sku.slice(codigo.length+1),desc=String(r[c.desc]??'').trim();
    const mapped=talleCrocs(us,opciones.permitirDoblesNino);
    const descSize=desc.match(/\s(\d+)$/);
    if(!mapped || mapped.talleWeb!==descSize?.[1]) {
      pendientes.add(codigo);avisos.push(`Fila ${i+1}: ${sku}; talle ${us} sin equivalencia confirmada con la descripción (${desc}). Modelo pendiente, no se carga.`);continue;
    }
    const hasCost=r[c.costo]!==null && r[c.costo]!==undefined && r[c.costo]!=='';
    if(!hasCost) {
      pendientes.add(codigo);avisos.push(`Fila ${i+1}: ${sku}; COSTO DESCUENTO vacío. Modelo pendiente, no se carga.`);continue;
    }
    // N ya contiene el costo: no descontar otra vez ni completar desde M.
    const rawCost=Number(r[c.costo]),baseVenta=Number(r[c.mayorista]);
    if(!Number.isFinite(baseVenta)||baseVenta<=0)throw new Error(`Crocs fila ${i+1}: revisar Módulo Mayorista (L) de ${sku}.`);
    const rawPrice=(opciones.calcularPrecio ?? precioReebokCalzado)(baseVenta),qty=Number(r[c.stock]);
    if(!Number.isFinite(rawCost)||rawCost<=0||!Number.isFinite(rawPrice)||rawPrice<=0||!Number.isInteger(qty)||qty<0||r[c.stock]==null||r[c.stock]==='')throw new Error(`Crocs fila ${i+1}: revisar stock, costo y precio de ${sku}.`);
    if(vistos.has(sku))throw new Error(`Crocs: SKU repetido ${sku}; no se suma stock.`);
    vistos.add(sku);
    const costo=Math.round(rawCost*100)/100,precio=Math.round(rawPrice*100)/100;
    const nombre=simplificarColores(`Crocs ${desc.slice(0,descSize!.index).replace(/\bCROCS\b/gi,'').trim()}`).titulo;
    const old=productos[codigo];
    if(old&&(old.nombre!==nombre||old.costo!==costo||old.precio!==precio||old.tablaTalle!==mapped.tablaTalle))throw new Error(`Crocs ${codigo}: nombres, precios o tablas distintos entre talles. Revisar el modelo.`);
    const p=productos[codigo]??={codigo,nombre,artType:'calzado',costo,precio,sizes:{},skuPorTalle:{},skuProveedorPorTalle:{},tablaTalle:mapped.tablaTalle,sizeConversion:mapped.sizeConversion};
    if(mapped.talleWeb in p.sizes)throw new Error(`Crocs ${codigo}: más de un SKU para talle web ${mapped.talleWeb}.`);
    p.sizes[mapped.talleWeb]=qty;p.skuPorTalle[mapped.talleWeb]=sku;p.skuProveedorPorTalle![mapped.talleWeb]=sku;
  }
  // No crear un modelo incompleto si otro talle todavía necesita una decisión.
  for(const code of pendientes)delete productos[code];
  return {productos,avisos};
}

export function coincideVarianteCrocs(d:{skuPorTalle?:Record<string,string>},size:string,v:{sku?:string}) {
  return !!v.sku && v.sku===d.skuPorTalle?.[size];
}
