// Primera etapa: indumentaria. No deducir tablas de calzado del sufijo del SKU.
export const REEBOK_LOCATION = 'DISTRINANDO SA (Reebok - Kappa)';
const tipos: Record<string, string> = {
  PANT: 'Pantalón', JACKET: 'Campera', SET: 'Conjunto', HOODIE: 'Buzo',
  HOODY: 'Buzo', 'ZIP HOODIE': 'Campera', 'T-SHIRT': 'Remera',
  LEGGING: 'Calza', CALZA: 'Calza', TOP: 'Top deportivo', 'TRACK TOP': 'Top deportivo',
  SHORT: 'Short', SWEATSHIRT: 'Buzo',
};
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
export function precioReebok(costo: number): number {
  // Margen de la planilla: (venta - costo*1.21) / venta. Objetivo 50%.
  const objetivo = costo * 2.42;
  const abajo = Math.floor((objetivo - 900) / 1000) * 1000 + 900;
  const candidatos = [abajo, abajo + 1000].filter(p => p > 0);
  return candidatos.sort((a, b) => Math.abs(1 - costo * 1.21 / a - 0.5) - Math.abs(1 - costo * 1.21 / b - 0.5))[0];
}
export interface ReebokProducto {
  codigo: string; nombre: string; artType: string; costo: number; precio: number;
  sizes: Record<string, number>; skuPorTalle: Record<string, string>;
}
export function parseReebok(rows: unknown[][]): { productos: Record<string, ReebokProducto>; avisos: string[] } {
  const h = rows.findIndex(r => r.some(v => norm(v) === 'MODELO COLOR') && r.some(v => norm(v) === 'MAYORISTA CON DESCUENTO'));
  if (h < 0) throw new Error('Reebok: falta el encabezado Modelo color / Mayorista con descuento.');
  const headers = rows[h].map(norm);
  const col = (n: string) => { const i = headers.indexOf(n); if (i < 0) throw new Error(`Reebok: falta la columna ${n}. Usá el Excel de indumentaria.`); return i; };
  const skuCol = col('SKU'), modeloCol = col('MODELO COLOR'), descCol = col('DESCRIPCION DEL ARTICULO');
  const grupoCol = col('GRUPO'), stockCol = col('STOCK X SKU'), costoCol = col('MAYORISTA CON DESCUENTO');
  const productos: Record<string, ReebokProducto> = {}, avisos: string[] = [];
  const vistos = new Set<string>();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i], sku = String(r[skuCol] ?? '').trim();
    if (!sku) continue;
    const tipo = tipos[norm(r[grupoCol])];
    if (!tipo) { avisos.push(`Fila ${i + 1}: ${sku}, grupo ${r[grupoCol] || 'sin identificar'}, excluido porque la categoría aún no está reconocida como indumentaria. Revisar categoría; el calzado sigue pendiente.`); continue; }
    const codigo = String(r[modeloCol] ?? '').trim().replace(/-+$/, '');
    const descripcion = String(r[descCol] ?? '').trim();
    const sizeMatch = descripcion.match(/\s-\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|TU|UNICO|ÚNICO)\s*$/i);
    const talle = sizeMatch?.[1].toUpperCase();
    const qty = Number(r[stockCol]), rawCost = Number(r[costoCol]);
    if (!codigo || !sku.startsWith(`${codigo}-`) || !talle || !Number.isInteger(qty) || qty < 0 || r[stockCol] == null || r[stockCol] === '' || !Number.isFinite(rawCost) || rawCost <= 0) {
      throw new Error(`Reebok: revisá fila ${i + 1} (${sku}): modelo, SKU, talle de indumentaria, stock y costo con descuento deben ser válidos.`);
    }
    if (vistos.has(sku)) throw new Error(`Reebok: SKU repetido ${sku} (fila ${i + 1}). No se suma el stock duplicado.`);
    vistos.add(sku);
    const costo = Math.round(rawCost * 100) / 100;
    const nombre = `${tipo} Reebok ${descripcion.slice(0, sizeMatch!.index).replace(/\bREEBOK\b/gi, '').trim()}`;
    const anterior = productos[codigo];
    if (anterior && (anterior.nombre !== nombre || anterior.costo !== costo)) throw new Error(`Reebok: ${codigo} tiene nombres o costos diferentes entre talles. Revisá el archivo.`);
    const p = productos[codigo] ??= { codigo, nombre, artType: tipo.toLowerCase(), costo, precio: precioReebok(costo), sizes: {}, skuPorTalle: {} };
    if (talle in p.sizes) throw new Error(`Reebok: ${codigo}, talle ${talle} repetido. Revisá los SKU.`);
    p.sizes[talle] = qty; p.skuPorTalle[talle] = sku;
  }
  if (!Object.keys(productos).length) throw new Error('Reebok: no hay indumentaria compatible en este archivo. El calzado está pendiente.');
  return { productos, avisos };
}
