import { expect, it } from 'vitest';
import { margenPct, precioExistente } from '../margen';
it.each(['converse', 'lecoq'])('umbral exacto con costo nuevo para %s', brand => {
  expect(precioExistente(brand, 121000, 50000, 119900)).toBe(121000);
  expect(precioExistente(brand, 121000, 50000.01, 119900)).toBe(119900);
  expect(precioExistente(brand, 121000, 49999.99, 119900)).toBe(121000);
  expect(precioExistente(brand, 99990, 43267.38, 99900)).toBe(99900);
  expect(margenPct(99990, 43267.38)).toBeCloseTo(47.64, 1);
  expect(precioExistente(brand, 0, 50000, 119900)).toBe(119900);
  expect(precioExistente(brand, 121000, NaN, 119900)).toBe(121000);
});
it('otras marcas mantienen propuestas', () => {
  for (const brand of ['orchard', 'kappa', 'reebok', 'crocs']) expect(precioExistente(brand, 121000, 10000, 119900)).toBe(119900);
});
