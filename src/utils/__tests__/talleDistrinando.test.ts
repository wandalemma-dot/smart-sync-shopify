// Ubicar en Shopify el talle US de un remito de Distrinando (13-nov-2026, gax). Casos tomados del
// remito 0085-00206200 y la nota 1001408 contra lo que hay hoy en Shopify. Sin escrituras.
import { describe, it, expect } from 'vitest';
import type { Pedido } from '../controlFacturas';
import { arDeNotas, curvaPack, paresConocidos, skuProveedor, tablaDeEtiquetas, tablaReebok, tablasDelModelo, talleUS, ubicarTalleDistrinando, type VarianteTalle } from '../talleDistrinando';

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
const ubicar = (codigo: string, talle: string, variantes: VarianteTalle[], tabla: string | null, pedidos = [NOTA]) =>
  ubicarTalleDistrinando({ codigo, talle, variantes, pedidos, tabla: tabla ? tablaReebok(tabla) : null });

describe('talle de Distrinando en Shopify', () => {
  it('normaliza el talle US y arma el SKU del proveedor', () => {
    expect(talleUS('8,5')).toBe('8.5');
    expect(talleUS('10.0')).toBe('10');
    expect(skuProveedor('rbklip15-rbkgy2120', '9,5')).toBe('RBKLIP15-RBKGY2120-9.5');
  });

  it('1) manda el SKU del proveedor', () => {
    const r = ubicar('RBK110S236074', '13', [v('42', 'RBK110S236074-10.5'), v('45.5', 'RBK110S236074-13')], null);
    expect(r).toMatchObject({ talle: '45.5', fuente: 'sku' });
  });

  it('2) sin SKU, el AR que el proveedor informa en la nota (la variante tiene el EAN)', () => {
    const r = ubicar('RBK110S236074', '11', [v('43', '4066749645052'), v('44', '4066749645083'), v('45.5', 'RBK110S236074-13')], null);
    expect(r).toMatchObject({ talle: '43', fuente: 'nota', skuProveedor: 'RBK110S236074-11' });
  });

  it('el AR del proveedor gana a la tabla (Club C Cardi: MUJER diría 34.5), y esa tabla no se puede elegir', () => {
    const r = ubicar('RBKLIX71-RBKGX9659', '5', [v('36.5', '4065426564000'), v('34.5', 'X')], 'MUJER');
    expect(r).toMatchObject({ talle: '36.5', fuente: 'nota' });
    const pares = paresConocidos('RBKLIX71-RBKGX9659', [NOTA], []);
    const mujer = tablasDelModelo(pares, []).find((t) => t.nombre === 'MUJER');
    expect(mujer?.bloqueo).toMatch(/US 5 = 36.5, la tabla dice 34.5/);
  });

  it('UK de la nota solo con respaldo de las tablas (UK 10 + US 11 = AR 44)', () => {
    expect(arDeNotas([NOTA], 'RBK1100033511-11', '11')).toEqual({ ar: '44' });
    const r = ubicar('RBK1100033511', '11', [v('44', '4066756365851'), v('46', 'RBK1100033511-12')], null);
    expect(r).toMatchObject({ talle: '44', fuente: 'nota' });
  });

  it('3) sin SKU ni nota, la tabla elegida; sin tabla no adivina', () => {
    const vs = [v('44', '4066749953270'), v('46', 'RBK110S239239-12')];
    expect(ubicar('RBK110S239239', '11', vs, '1', [])).toMatchObject({ talle: '44', fuente: 'tabla' });
    expect(ubicar('RBK110S239239', '11', vs, null, [])).toMatchObject({ error: expect.stringMatching(/Elegí la tabla/) });
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK NINO'])).toBe('NIÑO');
    // Hojas del local (13-nov-2026): REEBOK 1, REEBOK 2 y MUJER; la vieja «HOMBRE» es la 1.
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK 2'])).toBe('2');
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK 1'])).toBe('1');
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK HOMBRE'])).toBe('1');
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK 1', 'TABLA DE TALLE REEBOK HOMBRE'])).toBe('1');
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK SIN IDENTIFICAR'])).toBeNull();
    expect(tablaDeEtiquetas(['TABLA DE TALLE REEBOK HOMBRE', 'TABLA DE TALLE REEBOK MUJER'])).toBeNull();
  });

  it('TABLA DE TALLE REEBOK 2 (hoja del local): la Nano X3 Blanca, US 11 = 43, 12 = 44, 13 = 45.5', () => {
    const t = tablaReebok('2')!;
    expect(['7', '10.5', '11', '12', '13', '15.5'].map((us) => t.ar(us))).toEqual(['38', '42', '43', '44', '45.5', '48.5']);
    const pares = paresConocidos('RBK110S236074', [NOTA], [v('42', 'RBK110S236074-10.5'), v('45.5', 'RBK110S236074-13')]);
    const ok = tablasDelModelo(pares, []).filter((x) => !x.bloqueo).map((x) => x.nombre);
    expect(ok).toEqual(['2']);
  });

  it('la curva del pack: «M12 4/7.5 (23322)» y «M12U 5/7,5 (3441)»', () => {
    expect(curvaPack('Pack x12 (M12 4/7.5 (23322))')).toEqual([
      { us: '4', porCaja: 2 }, { us: '5', porCaja: 3 }, { us: '6', porCaja: 3 }, { us: '7', porCaja: 2 }, { us: '7.5', porCaja: 2 }]);
    expect(curvaPack('NANO COURT - BLACK/GREY 5 - M12U 5/7,5 (3441)')).toEqual([
      { us: '5', porCaja: 3 }, { us: '6', porCaja: 4 }, { us: '7', porCaja: 4 }, { us: '7.5', porCaja: 1 }]);
    // De medio en medio cuando los números alcanzan para eso; si no cierra, no adivina.
    expect(curvaPack('M12 7/8.5 (3333)')?.map((x) => x.us)).toEqual(['7', '7.5', '8', '8.5']);
    expect(curvaPack('M12 4/7.5 (12)')).toBeNull();
  });

  it('el talle no existe: lo dice y deja los datos para crearlo (Nano X3 Energy: solo está el 43)', () => {
    const r = ubicar('RBK110S236046', '11', [v('43', '4066749652807')], null);
    expect(r).toMatchObject({ error: expect.stringMatching(/no existe el talle 44/), falta: { talle: '44', skuProveedor: 'RBK110S236046-11' } });
  });

  it('no carga en un talle cuyo SKU es de otro US', () => {
    const r = ubicar('RBK110S236074', '12', [v('44', 'RBK110S236074-11.5')], null);
    expect(r).toMatchObject({ error: expect.stringMatching(/US 11.5/) });
  });

  it('dos AR distintos para el mismo SKU en las notas: no adivina', () => {
    const otra = nota(linea('RBK110S236074-11', 'HP6074 - NANO X3 - FTWR WHITE / CORE BLACK 43.5'));
    expect(ubicar('RBK110S236074', '11', [v('43', 'E')], null, [NOTA, otra])).toMatchObject({ error: expect.stringMatching(/dos AR distintos/) });
  });

  it('dos variantes con el mismo talle o el mismo SKU: no elige', () => {
    expect(ubicar('RBK110S236074', '11', [v('43', 'A'), v('43', 'B')], null)).toMatchObject({ error: expect.stringMatching(/dos variantes/) });
    expect(ubicar('RBK110S236074', '13', [v('45.5', 'RBK110S236074-13'), v('45', 'rbk110s236074-13')], null)).toMatchObject({ error: expect.stringMatching(/dos variantes/) });
  });
});
