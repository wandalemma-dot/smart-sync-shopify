import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import { cruzarPedido, generarExcelPedido, leerPlantillaId } from '../pedidoId';
import type { PendienteId } from '../pedidoId';

function plantilla(headers: string[], stock: (number | string)[], nombre = 'VELOCE ACTION') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['UUID'], ['Foto', 'Artículo', 'Color', 'Precio', '', ...headers, 'Unidades', 'Importe'],
    ['', 'LFN9924029', '', 100, 'Disponible', ...stock],
    ['', nombre, '', '', 'Cantidad', ...headers.map(() => 0)],
  ]), 'Plantilla');
  return leerPlantillaId(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
}

function linea(talle: string, codigo = 'LFN9924029'): PendienteId {
  return { orden: '#PRUEBA', id: `${codigo}-${talle}`, titulo: 'Nombre comercial diferente',
    sku: '7790000000000', talle, cantidad: 1, tags: [codigo], vendor: 'Le Coq Sportif' };
}

describe('pedido iD Le Coq: columnas de calzado y ropa con el mismo número', () => {
  it.each([['43', '044'], ['45', '046'], ['47', '048'], ['49', '050']])(
    'Shopify %s pide %s sin confundir la columna de ropa', (ar, proveedor) => {
      const p = plantilla([proveedor, String(Number(proveedor))], [3, '-']);
      const r = cruzarPedido([linea(ar)], p);
      expect(r.filas[0]).toMatchObject({ codigo: 'LFN9924029', talleProveedor: proveedor,
        disponible: 3, pedir: 1, faltante: 0, motivo: '', celda: 'F4' });
      const out = XLSX.read(generarExcelPedido(p, r), { type: 'array' }).Sheets.Plantilla;
      expect(out.F4.v).toBe(1);
      expect(out.G4.v).toBe(0);
    },
  );

  it('elige por categoría y encabezado aunque cambie el orden o ambas columnas tengan stock', () => {
    const p = plantilla(['48', 'XL', '048'], [20, 10, 3]);
    expect(cruzarPedido([linea('47')], p).filas[0]).toMatchObject({ talleProveedor: '048', disponible: 3, pedir: 1, celda: 'H4' });
  });

  it('un calzado agotado no toma el stock de la columna de ropa', () => {
    const p = plantilla(['048', '48'], ['-', 20]);
    expect(cruzarPedido([linea('47')], p).filas[0]).toMatchObject({ talleProveedor: '048', disponible: 0, pedir: 0, faltante: 1, motivo: 'Sin stock en la plantilla.' });
  });

  it.each(['PANT', 'DRESS'])('ropa numérica %s conserva el talle y usa su propia columna', nombre => {
    const p = plantilla(['038', '38'], [30, 4], nombre);
    expect(cruzarPedido([linea('38')], p).filas[0]).toMatchObject({ talleProveedor: '38', disponible: 4, pedir: 1, celda: 'G4' });
  });

  it('ropa agotada no toma el stock de la columna de calzado', () => {
    const p = plantilla(['038', '38'], [30, '-'], 'PANT');
    expect(cruzarPedido([linea('38')], p).filas[0]).toMatchObject({ talleProveedor: '38', pedir: 0, motivo: 'Sin stock en la plantilla.' });
  });

  it.each(['048', '48'])('mantiene plantillas con una única columna %s', raw => {
    expect(cruzarPedido([linea('47')], plantilla([raw], [3])).filas[0]).toMatchObject({ talleProveedor: raw, pedir: 1 });
  });

  it('un duplicado real queda para revisión, no se elige por stock', () => {
    const p = plantilla(['048', '048', '48'], [3, '-', '-']);
    expect(cruzarPedido([linea('47')], p).filas[0]).toMatchObject({ pedir: 0, motivo: 'Talle sin equivalencia única en la plantilla.' });
  });

  it('conserva talles de letras y medias numéricas', () => {
    expect(cruzarPedido([linea('XL')], plantilla(['XL', '3XL'], [4, 9], 'TEE')).filas[0]).toMatchObject({ talleProveedor: 'XL', pedir: 1 });
    expect(cruzarPedido([linea('2')], plantilla(['1', '2'], [4, 9], 'SOCKS')).filas[0]).toMatchObject({ talleProveedor: '2', pedir: 1 });
  });
});

it.skipIf(!process.env.PEDIDO_ID_LECOQ_TEMPLATE)('cruza los casos reportados y exporta en las columnas originales del Excel real', () => {
  const p = leerPlantillaId(new Uint8Array(readFileSync(process.env.PEDIDO_ID_LECOQ_TEMPLATE!)));
  const casos = [
    ['LFO0125241', '45', '046'], ['LFN9924029', '47', '048'], ['LFN9924029', '43', '044'],
    ['LFO0125230', '41', '042'], ['LFO0125222', '49', '050'],
  ];
  const r = cruzarPedido(casos.map(([codigo, ar]) => linea(ar, codigo)), p);
  for (const [i, [codigo, , raw]] of casos.entries()) {
    const a = p.articulos.find(a => a.codigo === codigo)!;
    const c = a.celdas.find(c => c.raw === raw)!;
    expect(r.filas[i]).toMatchObject({ talleProveedor: raw, disponible: c.disponible,
      pedir: Math.min(1, c.disponible), celda: XLSX.utils.encode_cell({ r: a.row, c: c.col }) });
  }
  const out = generarExcelPedido(p, r);
  const ws = XLSX.read(out, { type: 'array' }).Sheets.Plantilla;
  for (const ref of p.limpiar) expect(Number(ws[ref]?.v) || 0).toBe(r.filas.find(f => f.celda === ref)?.pedir || 0);
  const before = unzipSync(p.original), after = unzipSync(out);
  for (const path of Object.keys(before)) if (![p.sheetPath, 'xl/workbook.xml'].includes(path)) expect(after[path]).toEqual(before[path]);
}, 30000);
