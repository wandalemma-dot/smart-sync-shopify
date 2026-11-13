// Ubicar en Shopify el talle US de un remito de Distrinando (13-nov-2026, gax). Casos tomados del
// remito 0085-00206200 y la nota 1001408 contra lo que hay hoy en Shopify. Sin escrituras.
import { describe, it, expect } from 'vitest';
import type { Pedido } from '../controlFacturas';
import { arDeNotas, skuProveedor, tablaDeEtiquetas, talleUS, ubicarTalleDistrinando, type VarianteTalle } from '../talleDistrinando';

const v = (talle: string, sku: string): VarianteTalle => ({ id: `gid://shopify/ProductVariant/${sku}`, talle, sku });
const linea = (sku: string, descripcion: string) => ({
  sku, codigo: sku.replace(/-[^-]+$/, ''), descripcion, talle: '', unidadesPorUdm: 1, precioLista: 63982.4, descuento: 40, cantidad: 1,
});
const nota = (...lineas: ReturnType<typeof linea>[]): Pedido => ({ id: 'T-1', nombre: 'DISTRINANDO', fecha: '2026-11-10', lineas });

const NOTA = nota(
  linea('RBK110S236074-11', 'HP6074 - NANO X3 - FTWR WHITE / CORE BLACK 43'),
  linea('RBK110S236074-12', 'HP6074 - NANO X3 - FTWR WHITE / CORE BLACK 44'),
  linea('RBK110S236046-11', 'NANO X3 - CORE BLACK / ENERGY GLO 44'),
  linea('RBK1100033511-11', 'IE6693 - NANO X3 - COLD GREY 2/COLD GREY 2/FTWR WHITE UK 10'),
  linea('RBKLIX71-RBKGX9659-5', 'CLUB C CARDI V2 ULTPUR AR 36.5'),
  linea('RBKLRL40-RBKHQ6266-5', 'BEATNIK BOUGRY 36.5'),
);
const ubicar = (codigo: string, talle: string, variantes: VarianteTalle[], etiquetas: string[], pedidos = [NOTA]) =>
  ubicarTalleDistrinando({ codigo, talle, variantes, etiquetas, pedidos, reebok: true });

describe('talle de Distrinando en Shopify', () => {
  it('normaliza el talle US y arma el SKU del proveedor', () => {
    expect(talleUS('8,5')).toBe('8.5');
    expect(talleUS('10.0')).toBe('10');
    expect(skuProveedor('rbklip15-rbkgy2120', '9,5')).toBe('RBKLIP15-RBKGY2120-9.5');
  });

  it('1) manda el SKU del proveedor', () => {
    const r = ubicar('RBK110S236074', '13', [v('42', 'RBK110S236074-10.5'), v('45.5', 'RBK110S236074-13')], ['RBK110S236074', 'TABLA DE TALLE REEBOK SIN IDENTIFICAR']);
    expect(r).toMatchObject({ talle: '45.5', fuente: 'sku', skuDistinto: false });
  });

  it('2) sin SKU, el AR que el proveedor informa en la nota (la variante tiene el EAN)', () => {
    const r = ubicar('RBK110S236074', '11', [v('43', '4066749645052'), v('44', '4066749645083'), v('45.5', 'RBK110S236074-13')], ['TABLA DE TALLE REEBOK SIN IDENTIFICAR']);
    expect(r).toMatchObject({ talle: '43', fuente: 'nota', skuProveedor: 'RBK110S236074-11', skuDistinto: true });
  });

  it('el AR del proveedor gana a una etiqueta de tabla que no coincide (Club C Cardi: MUJER diría 34.5)', () => {
    const r = ubicar('RBKLIX71-RBKGX9659', '5', [v('36.5', '4065426564000'), v('34.5', 'X')], ['TABLA DE TALLE REEBOK MUJER']);
    expect(r).toMatchObject({ talle: '36.5', fuente: 'nota' });
    expect((r as { avisos: string[] }).avisos.join(' ')).toMatch(/tabla MUJER/);
  });

  it('UK de la nota solo con respaldo de las tablas (UK 10 + US 11 = AR 44)', () => {
    expect(arDeNotas([NOTA], 'RBK1100033511-11', '11')).toEqual({ ar: '44' });
    const r = ubicar('RBK1100033511', '11', [v('44', '4066756365851'), v('46', 'RBK1100033511-12')], ['TABLA DE TALLE REEBOK 2']);
    expect(r).toMatchObject({ talle: '44', fuente: 'nota' });
  });

  it('3) sin SKU ni nota, la tabla de la etiqueta con nombre; «REEBOK 2» o «SIN IDENTIFICAR» no sirven', () => {
    const vs = [v('44', '4066749953270'), v('46', 'RBK110S239239-12')];
    expect(ubicar('RBK110S239239', '11', vs, ['TABLA DE TALLE REEBOK HOMBRE'], [])).toMatchObject({ talle: '44', fuente: 'tabla' });
    expect(ubicar('RBK110S239239', '11', vs, ['TABLA DE TALLE REEBOK 2'], [])).toHaveProperty('error');
    expect(ubicar('RBK110S239239', '11', vs, ['TABLA DE TALLE REEBOK SIN IDENTIFICAR'], [])).toHaveProperty('error');
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK NINO'])?.nombre).toBe('NIÑO');
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK HOMBRE', 'TABLA DE TALLE REEBOK MUJER'])).toBeNull();
  });

  it('Kappa y Crocs no usan tablas de Reebok', () => {
    const r = ubicarTalleDistrinando({ codigo: 'K1', talle: '11', variantes: [v('44', 'E')], etiquetas: ['TABLA DE TALLE REEBOK HOMBRE'], pedidos: [], reebok: false });
    expect(r).toHaveProperty('error');
  });

  it('el talle no existe: lo dice y deja los datos para crearlo (Nano X3 Energy: solo está el 43)', () => {
    const r = ubicar('RBK110S236046', '11', [v('43', '4066749652807')], ['TABLA DE TALLE REEBOK 2']);
    expect(r).toMatchObject({ error: expect.stringMatching(/no existe el talle 44/), falta: { talle: '44', skuProveedor: 'RBK110S236046-11' } });
  });

  it('no carga en un talle cuyo SKU es de otro US', () => {
    const r = ubicar('RBK110S236074', '12', [v('44', 'RBK110S236074-11.5')], []);
    expect(r).toMatchObject({ error: expect.stringMatching(/US 11.5/) });
  });

  it('dos AR distintos para el mismo SKU en las notas: no adivina', () => {
    const otra = nota(linea('RBK110S236074-11', 'HP6074 - NANO X3 - FTWR WHITE / CORE BLACK 43.5'));
    expect(ubicar('RBK110S236074', '11', [v('43', 'E')], [], [NOTA, otra])).toMatchObject({ error: expect.stringMatching(/dos AR distintos/) });
  });

  it('dos variantes con el mismo talle o el mismo SKU: no elige', () => {
    expect(ubicar('RBK110S236074', '11', [v('43', 'A'), v('43', 'B')], [])).toMatchObject({ error: expect.stringMatching(/dos variantes/) });
    expect(ubicar('RBK110S236074', '13', [v('45.5', 'RBK110S236074-13'), v('45', 'rbk110s236074-13')], [])).toMatchObject({ error: expect.stringMatching(/dos variantes/) });
  });
});
