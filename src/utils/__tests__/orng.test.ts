// ============================================================================
// ORNG — DOS CONTRATOS EN EL MISMO ARCHIVO
// ----------------------------------------------------------------------------
// Contrato (Wanda, 08-sep-2026):
//   Mochilas y bolsos          -> 12,5% de bonificación · markup 2,1
//   Indumentaria y accesorios  -> 15%   de bonificación · markup 2,0
//
// ⚠ SI ALGUIEN UNIFICA LAS DOS REGLAS EN UNA, ESTE ARCHIVO FALLA. Está bien
//   que falle: son contratos distintos y confundirlos cambia lo que se cobra.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { parseOrng, familiaOrng, costoOrng, precioOrng, ORNG_REGLAS } from '../orngLogic';

const hoja = (filas: any[][]) => [
  ['ARTICULO', 'CODIGO ', 'COLOR ', 'DESCRIPCION ', 'NOMBRE ', 'COMPOSICION', '', '', 'COSTO'],
  ...filas,
];

describe('a qué contrato va cada artículo', () => {
  it('las mochilas y los bolsos van al 12,5%', () => {
    expect(familiaOrng('Mochila')).toBe('mochilas');
    // El Matero: en la web de ORNG está dentro de MOCHILAS (lo confirmó Wanda).
    expect(familiaOrng('Matero')).toBe('mochilas');
    expect(familiaOrng('Lunchera')).toBe('mochilas');
  });

  it('las gorras van al 15%', () => {
    expect(familiaOrng('Caps')).toBe('accesorios');
    expect(familiaOrng('caps')).toBe('accesorios');   // el archivo lo trae en minúscula
    expect(familiaOrng('Remera')).toBe('accesorios');
  });

  it('los porcentajes son los del contrato', () => {
    expect(ORNG_REGLAS.mochilas).toEqual({ descuento: 0.125, markup: 2.1 });
    expect(ORNG_REGLAS.accesorios).toEqual({ descuento: 0.15, markup: 2.0 });
  });
});

describe('las cuentas', () => {
  it('mochila HARLEM: 43999 -> costo 38499 -> precio 80848', () => {
    expect(costoOrng(43999, 'mochilas')).toBe(38499);
    expect(precioOrng(43999, 'mochilas')).toBe(80848);
  });

  it('gorra BAY: 12999 -> costo 11049 -> precio 22098', () => {
    expect(costoOrng(12999, 'accesorios')).toBe(11049);
    expect(precioOrng(12999, 'accesorios')).toBe(22098);
  });

  it('el markup se aplica sobre el costo YA bonificado, no sobre el de lista', () => {
    // Si se aplicara sobre el de lista daría 43999*2,1 = 92398. No es eso.
    expect(precioOrng(43999, 'mochilas')).not.toBe(Math.round(43999 * 2.1));
  });
});

describe('lectura del Excel', () => {
  it('cada COLOR es un producto distinto (el código se repite)', () => {
    const r = parseOrng(hoja([
      ['Mochila', 22050019, 'NE', 'Mochila Urbana', 'HUDSON', 'Poly', 1, 'Unidad', 34999],
      ['Mochila', 22050019, 'AZ', 'Mochila Urbana', 'HUDSON', 'Poly', 1, 'Unidad', 34999],
      ['Mochila', 22050019, 'VE', 'Mochila Urbana', 'HUDSON', 'Poly', 1, 'Unidad', 34999],
    ]));
    expect(r.productos).toHaveLength(3);
    expect(r.productos.map((p) => p.clave)).toEqual(['22050019-NE', '22050019-AZ', '22050019-VE']);
  });

  it('mezcla las dos familias y le da a cada una su regla', () => {
    const r = parseOrng(hoja([
      ['Mochila', 22050018, 'AR', 'Mochila Urbana', 'HARLEM', 'Cordura', 1, 'Unidad', 43999],
      ['Caps', 21316014, 'NE', 'Trucker', 'BAY', 'Gabard', 1, 'Unidad', 12999],
    ]));
    const mochila = r.productos.find((p) => p.articulo === 'Mochila')!;
    const gorra = r.productos.find((p) => p.articulo === 'Caps')!;
    expect(mochila.familia).toBe('mochilas');
    expect(mochila.precio).toBe(80848);
    expect(gorra.familia).toBe('accesorios');
    expect(gorra.precio).toBe(22098);
  });

  it('arma el título con descripción y nombre', () => {
    const r = parseOrng(hoja([
      ['Matero', 21024009, 'VE', 'Bolso Matero', 'TRIBECA', 'Cordura', 1, 'Unidad', 24499],
    ]));
    expect(r.productos[0].titulo).toBe('Bolso Matero Tribeca');
  });

  it('limpia los espacios del color (" AZ/GO " -> "AZ/GO")', () => {
    const r = parseOrng(hoja([
      ['Caps', 21316018, ' AZ/ GO ', '6 gajos', 'GOOD GIRL', 'Gabardina', 1, 'Unidad', 12999],
    ]));
    expect(r.productos[0].color).toBe('AZ/GO');
  });

  it('avisa si el mismo CÓDIGO+COLOR viene repetido', () => {
    const r = parseOrng(hoja([
      ['Caps', 21316014, 'NE', 'Trucker', 'BAY', 'Gabard', 1, 'Unidad', 12999],
      ['Caps', 21316014, 'NE', 'Trucker', 'BAY', 'Gabard', 1, 'Unidad', 12999],
    ]));
    expect(r.productos).toHaveLength(1);
    expect(r.duplicados).toEqual(['21316014-NE']);
  });

  it('saltea las filas sin costo', () => {
    const r = parseOrng(hoja([
      ['Mochila', 22050018, 'AR', 'Mochila Urbana', 'HARLEM', 'Cordura', 1, 'Unidad', ''],
    ]));
    expect(r.productos).toHaveLength(0);
  });
});
