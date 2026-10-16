import { expect, it } from 'vitest';
import { etiquetaModelo, mismoTalleEtiqueta, validarTallesEtiqueta } from '../tallePorEtiqueta';
import { coincideVarianteReebok } from '../reebokMatching';
import { coincideVarianteKappa } from '../kappaLogic';
it('exige etiqueta de modelo exacta, no etiquetas de variante ni prefijos', () => {
  expect(etiquetaModelo(' RBK1100201119, RBK1100201119-9.5', 'rbk1100201119')).toBe(true);
  expect(etiquetaModelo('RBK1100201119-9.5', 'RBK1100201119')).toBe(false);
  expect(etiquetaModelo('RBK11002011190', 'RBK1100201119')).toBe(false);
});
it('normaliza decimales y letras sin inventar conversiones', () => {
  expect(mismoTalleEtiqueta('42.5', ' 42,50 ')).toBe(true);
  expect(mismoTalleEtiqueta('XL', ' xl ')).toBe(true);
  for (const title of ['9.5', '42 / Negro', '42 US', '', undefined]) expect(mismoTalleEtiqueta('42', title)).toBe(false);
});
it('etiqueta y talle prevalecen incluso con SKU cambiado, vacío o que indica otro talle', () => {
  const d = { matchPorEtiqueta: true, skuPorTalle: { '42': 'original' } };
  for (const sku of ['fisico', '', 'original']) {
    expect(coincideVarianteReebok(d, '42', { sku, title: '42' }, true)).toBe(true);
    expect(coincideVarianteKappa(d, '42', { sku, title: '42' })).toBe(true);
    expect(coincideVarianteReebok(d, '42', { sku, title: '43' }, true)).toBe(false);
  }
  expect(coincideVarianteReebok(d, 'XL', { sku: 'fisico', title: 'XL' }, false)).toBe(true);
  expect(coincideVarianteKappa({ ...d, matchPorEtiqueta: false }, '42', { sku: 'fisico', title: '42' })).toBe(false);
});
it('rechaza duplicados de ambos lados del cruce', () => {
  expect(() => validarTallesEtiqueta(['42'], [{ title: '42' }, { title: '42.0' }], 'MODELO')).toThrow('ambiguos');
  expect(() => validarTallesEtiqueta(['42', '42.0'], [{ title: '42' }], 'MODELO')).toThrow('ambiguos');
});
