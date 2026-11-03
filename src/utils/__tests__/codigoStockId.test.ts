import { expect, it } from 'vitest';
import { codigoStockId } from '../codigoStockId';

it('distingue un código de otro con sufijo aunque ambos coincidan por prefijo', () => {
  const codigos = ['abc123', 'abc123p'];
  expect(codigoStockId('medias', 'ABC123P', ['abc123p-2'], codigos)).toBe('abc123p');
  expect(codigoStockId('medias', 'ABC123P', ['7790000000001'], codigos)).toBe('abc123p');
  expect(codigoStockId('medias', '', ['abc123 2'], codigos)).toBe('abc123');
  expect(codigoStockId('medias', '', ['abc123p2'], ['abc123p'])).toBe('abc123p');
  expect(() => codigoStockId('medias', '', ['abc123p2'], codigos)).toThrow('varios códigos');
});
