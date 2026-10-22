import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { existsSync, readFileSync } from 'fs';
import { leerExcelDistrinando, cruzarDistrinando } from '../pedidoDistrinando';
import { generarExcelDistrinando } from '../excelPedidoDistrinando';
import type { PendienteId } from '../pedidoId';

// Misma forma que STOCKPROMOCROCS.xlsx: «Modelo-Color», «Descripción», «UdM», «Disponible», «PEDIDO».
const headers = ['Foto', 'SKU', 'Modelo', 'Categoría', 'Familia', 'Tipo de Producto', 'Modelo-Color', 'Descripción', 'UdM', 'Disponible', 'Disponible u', 'Módulo Mayorista', 'Individual Mayorista', 'COSTO DESCUENTO', 'PUBLICO DESCUENTO', 'SALE', 'PEDIDO'];
const fila = (sku: string, modelo: string, desc: string, udm = 'Pares', tipo = 'CALZADO', stock = 10) =>
  ['', sku, modelo.split('-')[0], 'Everyday', 'CLASSIC', tipo, modelo, desc, udm, stock, stock, 31990.93, 31990.93, '', 59999, '', ''];
function libro(rows: unknown[][]) {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Sheet1');
  return new Uint8Array(XLSX.write(w, { type: 'array', bookType: 'xlsx' }));
}
const linea = (p: Partial<PendienteId>): PendienteId => ({ id: 'l1', orden: '#1', titulo: 'Crocs Classic Negro', sku: '', talle: '37', cantidad: 2, tags: [], vendor: 'Crocs', ...p } as PendienteId);

describe('pedido DISTRINANDO con la lista de Crocs', () => {
  const rows = [
    fila('C10001-C001-M5/W7', 'C10001-C001', 'CLASSIC BLACK 37'),
    fila('C10001-C001-M5/W7-P6', 'C10001-C001', 'CLASSIC BLACK 37', 'Pack de 6 Unidades'),
    fila('C10006828-C99', 'C10006828-C99', 'JIBBITZ CORAZON', 'Unidades', 'ACCESORIOS'),
    fila('C20000-C001-C6/7', 'C20000-C001', 'CLASSIC KIDS BLACK 23'),
  ];
  const p = leerExcelDistrinando(libro(rows), 'STOCKPROMOCROCS.xlsx', '0');

  it('acepta Modelo-Color, excluye packs y valida el talle con la tabla de sincronización', () => {
    expect(p.articulos.map(a => [a.sku, a.talle, a.marca])).toEqual([
      ['C10001-C001-M5/W7', '37', 'Crocs'], ['C10006828-C99', '', 'Crocs'], ['C20000-C001-C6/7', '', 'Crocs']]);
    expect(p.avisos.join('\n')).toContain('pack excluido');
    expect(p.avisos.join('\n')).toContain('C20000-C001-C6/7');
  });

  it('asocia por SKU exacto o etiqueta + talle, y completa PEDIDO', () => {
    const filas = cruzarDistrinando([
      linea({ sku: 'C10001-C001-M5/W7' }),
      linea({ id: 'l2', orden: '#2', sku: 'otro', tags: ['C10001-C001'], talle: '37', cantidad: 1, variantId: 'v2' }),
      linea({ id: 'l3', orden: '#3', sku: 'C10006828-C99', talle: 'Default Title', cantidad: 1, variantId: 'v3' }),
    ], [p]);
    expect(filas.map(f => [f.elegido?.celda, f.pedir])).toEqual([['Q2', 2], ['Q2', 1], ['Q4', 1]]);
    const out = XLSX.read(generarExcelDistrinando(p, filas), { type: 'array' }).Sheets.Sheet1;
    expect([out.Q2?.v, out.Q4?.v]).toEqual([3, 1]);
  });

  it('un doble infantil sin tabla confirmada no se asocia solo por talle', () => {
    const [f] = cruzarDistrinando([linea({ sku: 'x', tags: ['C20000-C001'], talle: '23' })], [p]);
    expect(f.elegido).toBeUndefined();
  });

  const real = process.env.CROCS_PEDIDO_TEMPLATE;
  it.skipIf(!real || !existsSync(real))('lista real STOCKPROMOCROCS.xlsx', () => {
    const r = leerExcelDistrinando(new Uint8Array(readFileSync(real!)), 'STOCKPROMOCROCS.xlsx', '0');
    expect(r.articulos.length).toBe(722);
    expect(r.articulos.filter(a => a.talle).length).toBe(393);
  });
});
