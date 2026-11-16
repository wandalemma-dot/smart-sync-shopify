import { describe, it, expect } from 'vitest';
import { descripcionTarjetaFamily, nombreTarjetaFamily } from '../trelloFamily';
import type { ResultadoFamily } from '../controlFamily';

const r = {
  entrega: { id: 'E1', nombre: 'Planilla', fecha: '2026-11-11', renglones: [
    { codigo: 'BFRMCSPE16', descripcion: 'Remera', precioMayor: 1, precioPublico: 2, cantidad: 3, talles: [{ talle: 'M', cantidad: 2 }, { talle: 'L', cantidad: 1 }] },
    { codigo: 'BFRMCSPE09', descripcion: 'Gorra', precioMayor: 1, precioPublico: 2, cantidad: 1, talles: [] },
  ] },
  remito: { numero: '0001-00002716', fecha: '2026-11-11', renglones: [] },
} as unknown as ResultadoFamily;

describe('Tarjeta de Trello de Family (16-nov-2026)', () => {
  it('nombre con el remito y la fecha de la entrega', () => {
    expect(nombreTarjetaFamily(r)).toBe('Family - Remito 0001-00002716 - 11/11/26');
    expect(nombreTarjetaFamily({ ...r, remito: null })).toBe('Family - Entrega - 11/11/26');
  });
  it('descripción con lo que llegó y la fecha de carga', () => {
    expect(descripcionTarjetaFamily(r, 'FAMILYARG', '2026-11-16')).toBe([
      'Entrega de Family del 11/11/26, remito 0001-00002716: 2 artículos, 4 u.',
      'Cargada en Shopify (FAMILYARG) el 16/11/26. Tarjeta creada por la app.',
      '',
      '- BFRMCSPE16 Remera: 3 u. (M ×2, L ×1)',
      '- BFRMCSPE09 Gorra: 1 u.',
    ].join('\n'));
  });
  it('muy larga: se corta con aviso', () => {
    const muchos = { ...r, entrega: { ...r.entrega, renglones: Array.from({ length: 200 }, (_, i) => ({ ...r.entrega.renglones[1], codigo: `COD${i}`, descripcion: 'Artículo con un nombre bastante largo' })) } };
    const d = descripcionTarjetaFamily(muchos, 'FAMILYARG', '2026-11-16');
    expect(d.length).toBeLessThanOrEqual(4000);
    expect(d).toMatch(/… y \d+ artículo\(s\) más\.$/);
  });
});
