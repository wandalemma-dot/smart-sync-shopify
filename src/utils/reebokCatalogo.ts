import { parseReebokCalzado, tablaReebok, REEBOK_SIN_TABLA } from './reebokCalzado';
import type { ReebokCalzadoProducto } from './reebokCalzado';

export interface ReebokArchivo { file: File; sheetName: string }
export interface ReebokCobertura {
  categoria: 'calzado' | 'indumentaria';
  archivos: string[];
  modelosPresentes: string[];
  modelosProtegidos: string[];
  identificadoresPresentes: string[];
}
export interface ReebokLista { nombre: string; datos: ReturnType<typeof parseReebokCalzado> }

/** Unión de listas; nunca sumar dos veces una disponibilidad compartida. */
export function combinarReebok(listas: ReebokLista[], prioridad = '') {
  if (!listas.length || new Set(listas.map(l => l.nombre)).size !== listas.length) throw new Error('Elegí planillas Reebok distintas.');
  const contenidos = listas.map(l => JSON.stringify(l.datos));
  if (new Set(contenidos).size !== contenidos.length) throw new Error('Hay dos planillas con el mismo contenido. Cargá las listas distintas de calzado, no dos copias de la misma.');
  const productos: Record<string, ReebokCalzadoProducto> = {};
  const origen: Record<string, string> = {}, avisos: string[] = [];
  const sinTabla = new Set<string>();
  const cobertura: ReebokCobertura = {
    categoria: 'calzado',
    archivos: listas.map(l => l.nombre),
    modelosPresentes: [...new Set(listas.flatMap(l => l.datos.modelosPresentes))],
    modelosProtegidos: [...new Set(listas.flatMap(l => l.datos.modelosProtegidos))],
    identificadoresPresentes: [...new Set(listas.flatMap(l => l.datos.identificadoresPresentes))],
  };
  // La prioridad solo resuelve diferencias de cantidades/precios, nunca de identidad.
  const ordenadas = [...listas].sort((a,b) => Number(b.nombre === prioridad) - Number(a.nombre === prioridad));
  const eans = new Map<string,string>();
  const tallesPorSku = new Map<string,string>();
  for (const { nombre, datos } of ordenadas) {
    if (!Object.keys(datos.productos).length) throw new Error(`${nombre}: no hay calzado individual válido. Revisá la pestaña seleccionada.`);
    avisos.push(...datos.avisos.map(a => `${nombre}: ${a}`));
    for (const [code, p] of Object.entries(datos.productos)) {
      if (!p.sizeConversion) sinTabla.add(code);
      const anterior = productos[code];
      if (anterior && (anterior.costo !== p.costo || anterior.precio !== p.precio)) {
        if (origen[code] !== prioridad) throw new Error(`${code}: precios diferentes en ${origen[code]} y ${nombre}. Elegí qué planilla tiene prioridad.`);
        avisos.push(`${code}: precios tomados de ${prioridad}.`);
      }
      const destino = productos[code] ??= { ...p, sizes: {}, skuPorTalle: {}, skuProveedorPorTalle: {} };
      origen[code] ??= nombre;
      for (const [ar, qty] of Object.entries(p.sizes)) {
        const sku = p.skuProveedorPorTalle![ar], ean = p.skuPorTalle[ar];
        if (tallesPorSku.has(sku) && tallesPorSku.get(sku) !== ar) throw new Error(`${sku}: distintos talles AR entre planillas. Revisá la equivalencia.`);
        tallesPorSku.set(sku, ar);
        if (ean !== sku) {
          if (eans.has(ean) && eans.get(ean) !== sku) throw new Error(`EAN ${ean} corresponde a distintos SKU entre las planillas.`);
          eans.set(ean, sku);
        }
        const clave = `${code}|${ar}`;
        if (ar in destino.sizes) {
          if (destino.skuProveedorPorTalle![ar] !== sku ||
              (destino.skuPorTalle[ar] !== sku && ean !== sku && destino.skuPorTalle[ar] !== ean)) {
            throw new Error(`${code}, AR ${ar}: identificadores distintos entre planillas. Revisá el SKU/EAN.`);
          }
          if (destino.sizes[ar] !== qty) {
            if (origen[clave] !== prioridad) throw new Error(`${sku}: stock ${destino.sizes[ar]} en ${origen[clave]} y ${qty} en ${nombre}. Elegí qué planilla tiene prioridad.`);
            avisos.push(`${sku}: stock ${destino.sizes[ar]} de ${prioridad}; no se suma ${qty} de ${nombre}.`);
          }
          // La lista sin EAN puede complementarse con la que sí lo informa.
          if (ean !== sku) destino.skuPorTalle[ar] = ean;
        } else {
          destino.sizes[ar] = qty;
          destino.skuPorTalle[ar] = ean;
          destino.skuProveedorPorTalle![ar] = sku;
          origen[clave] = nombre;
        }
      }
    }
  }
  for (const [code, p] of Object.entries(productos)) {
    Object.assign(p, sinTabla.has(code) ? { tablaTalle: REEBOK_SIN_TABLA, sizeConversion: undefined } :
      tablaReebok(Object.keys(p.sizes).map(ar => ({ ar, us: p.skuProveedorPorTalle![ar].slice(code.length + 1).replace(',', '.').toUpperCase() }))));
  }
  return { productos, avisos, cobertura };
}

/** Solo productos identificados como calzado Reebok; jamás inferirlo por talle numérico. */
export function esCalzadoReebok(title: string, tags: string) {
  return /^Zapatillas\s+Reebok\b/i.test(title) || /(?:^|,\s*)TABLA DE TALLE REEBOK /i.test(tags);
}
export function coincideCategoriaReebok(title: string, tags: string, categoria: ReebokCobertura['categoria']) {
  if (categoria === 'calzado') return esCalzadoReebok(title, tags);
  // La ausencia de una etiqueta de calzado NO demuestra que sea ropa.
  const titulo = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return !esCalzadoReebok(title, tags) && /^(?:Pantalon|Campera|Conjunto|Buzo|Remera|Calza|Top(?: deportivo)?|Short|Indumentaria)\s+Reebok\b/i.test(titulo);
}
export function codigosReebok(tags: string, skus: string[]) {
  return [...new Set([...tags.split(',').map(t => t.trim()), ...skus]
    .map(t => t.toUpperCase().match(/^(RBK[A-Z0-9]+)(?:-|$)/)?.[1]).filter((c): c is string => !!c))];
}
export function ausenteReebok(prod: { title: string; tags: string; vendor?: string; variants: {edges: {node: {sku: string}}[]} }, c: ReebokCobertura) {
  if (prod.vendor?.trim().toLowerCase() !== 'reebok' || !coincideCategoriaReebok(prod.title, prod.tags, c.categoria)) return false;
  const skus = prod.variants.edges.map(e => e.node.sku);
  const codes = codigosReebok(prod.tags, skus);
  return codes.length > 0 && codes.every(code => !c.modelosPresentes.includes(code)) &&
    !skus.some(s => c.identificadoresPresentes.includes(s));
}
