import { describe, expect, it, vi } from 'vitest';
import { parseCrocs } from '../crocsLogic';

const headers = ['Foto', 'SKU', 'Modelo', 'Categoría', 'Familia', 'Tipo de Producto', 'Modelo-Color', 'Descripción', 'UdM', 'Disponible', 'Disponible u', 'Módulo Mayorista', 'Individual Mayorista', 'COSTO DESCUENTO', 'PUBLICO DESCUENTO'];
const row = () => ['', 'C10001-C001-M8/W10', '', '', '', 'CALZADO', 'C10001-C001', 'CLASSIC BLACK 40', 'Pares', 5, 5, 100000, 80000, 60000, 150000];

describe('Crocs: columnas de costo y base de venta independientes', () => {
  it('usa N directo y entrega L a la regla de venta; ignora M y O', () => {
    // Regla ficticia para comprobar el cableado, no una política comercial.
    const calcularPrecio = vi.fn((base: number) => base + 123);
    const { productos } = parseCrocs([headers, row()], { calcularPrecio });
    expect(calcularPrecio).toHaveBeenCalledWith(100000);
    expect(productos['C10001-C001']).toMatchObject({ costo: 60000, precio: 100123, sizes: { '40': 5 } });
  });

  it('deja pendiente el modelo con N vacía sin inventar un descuento', () => {
    const r = row(); r[13] = '';
    const calcularPrecio = vi.fn((base: number) => base);
    const result = parseCrocs([headers, r], { calcularPrecio });
    expect(result.productos).toEqual({});
    expect(result.avisos[0]).toContain('COSTO DESCUENTO vacío');
    expect(calcularPrecio).not.toHaveBeenCalled();
  });

  it('rechaza L vacía aunque M y O tengan importes', () => {
    const r = row(); r[11] = '';
    expect(() => parseCrocs([headers, r], { calcularPrecio: n => n })).toThrow('Módulo Mayorista (L)');
  });

  it('excluye packs antes de interpretar talles y precios', () => {
    const r = row(); r[1] = 'C10001-C001-M6 W5/W9 (11121)'; r[8] = 'Pack de 6 Unidades'; r[11] = ''; r[13] = '';
    const result = parseCrocs([headers, r], { calcularPrecio: n => n });
    expect(result.productos).toEqual({});
    expect(result.avisos[0]).toContain('pack excluido');
  });
});
