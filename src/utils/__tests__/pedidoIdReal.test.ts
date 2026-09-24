import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import { leerPlantillaId, cruzarPedido, generarExcelPedido } from '../pedidoId';

// Verificación opcional con la plantilla local del proveedor; nunca subirla al repo.
it.skipIf(!process.env.PEDIDO_ID_TEMPLATE)('conserva imágenes y estructura de una plantilla real', () => {
  const p = leerPlantillaId(new Uint8Array(readFileSync(process.env.PEDIDO_ID_TEMPLATE!)));
  const a = p.articulos.find(a => a.celdas.some(c => c.disponible > 0 && c.raw === 'TU'))!;
  expect(a).toBeDefined();
  const r = cruzarPedido([{ orden: 'PRUEBA', id: 'test', titulo: a.nombre, sku: a.codigo, talle: 'TU', cantidad: 1, tags: [a.codigo], vendor: 'Converse' }], p);
  expect(r.filas[0].pedir).toBe(1);
  const out = generarExcelPedido(p, r);
  const before = unzipSync(p.original), after = unzipSync(out);
  expect(Object.keys(after)).toEqual(Object.keys(before));
  for (const path of Object.keys(before)) if (![p.sheetPath, 'xl/workbook.xml'].includes(path)) expect(after[path]).toEqual(before[path]);
  const wb = XLSX.read(out, { type: 'array' });
  expect(wb.Sheets.Plantilla[r.filas[0].celda!].v).toBe(1);
  for (const ref of p.limpiar) if (ref !== r.filas[0].celda) expect(Number(wb.Sheets.Plantilla[ref]?.v) || 0).toBe(0);
});
