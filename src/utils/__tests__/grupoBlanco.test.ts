// ============================================================================
// GRUPO BLANCO (Timberland) — factura PDF y nota de pedido Excel
// ----------------------------------------------------------------------------
// ⚠ LO QUE CUIDA ESTE ARCHIVO:
//   1) Unidades de la factura = curvas × unidades por curva (1 cv × 6 = 6).
//   2) Unidades de la nota = PEDIDO (módulos) × PARES X MOD / UNID X CURVA, y
//      la segunda fila de cada par de calzado (sin pedido) NO cuenta.
//   3) Del PDF se lee solo la primera copia (Original), no el Duplicado.
//   4) El costo comparado es el precio de lista contra $MAYORISTA.
// Prueba REAL optativa: GRUPO_BLANCO_FACTURA=<pdf> GRUPO_BLANCO_NOTA=<xlsx>.
// ============================================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { facturaGrupoBlanco, notaGrupoBlanco, lineasDePagina } from '../grupoBlanco';
import { compararConPedido } from '../controlPedido';

const cabecera = (copia: string, hoja: string) => [
  'A Factura 0099-00000001', hoja, copia, 'Código Nro. 1', '30/09/2026', 'Remito: 0099-00000002',
  'Producto Descripción Cant. Un.x Cv. Precio Bonif. Importe',
];
const pagina1 = (copia: string) => [
  ...cabecera(copia, 'Hoja 1 de 2'),
  '161101500010 TB0A2QKNEAC-GREYFIELD SANDAL 1 cv 6 88.947,3684 20% 426.947,37',
  'Timberland / CUERO / WHITE KNIT / 35/40-1 2 3',
  '161101500020 TB0A2QKNEAC-GREYFIELD SANDAL 1 cv 6 88.947,3684 20% 426.947,37',
  'Timberland / CUERO / WHITE KNIT / 35/40-3 2 1',
  '161102190010 TB0A4187EM6-CLASSIC BOAT 5 cv 6 157.368,4211 20% 3.776.842,10',
  'Timberland / CUERO / RUST FULL GRAIN / 39/45-1 2 2 1',
  '*****TRANSPORTE',
];
const pagina2 = (copia: string) => [
  ...cabecera(copia, 'Hoja 2 de 2'),
  '161102190020 TB0A4187EM6-CLASSIC BOAT 5 cv 6 157.368,4211 20% 3.776.842,10',
  'Timberland / CUERO / RUST FULL GRAIN / 39/45-3 2 1',
  '161103730010 TB0A5W2F001-THAYER WOMEN CROSSBODY BAG 1 cv 4 34.500,0000 20% 110.400,00',
  'Timberland / TEXTIL / BLACK / PACK x4',
  'Total: 13 cv 76 un',
];

const ENC = ['IMAGEN', 'PÁG.', 'PRODUCTO', 'GENERO', 'CATEGORÍA', 'CODIGO ART', 'DESCRIPCION', 'COLOR', 'P/SISTEMA', 'PEDIDO', 'PARES X MOD', 'TOTAL PARES', '$MAYORISTA', '$SUGERIDO', 'VALORIZADO'];
const hojaCalzado = {
  nombre: 'Calzados VLP',
  filas: [
    ['', '', '', '', '', '', 'CUIT:'], [], ENC,
    ['', 84, 161101500010, 'WOMEN', 'SANDALIAS', 'TB0A2QKNEAC', 'GREYFIELD SANDAL', 'WHITE KNIT', 1, 1, 12, 12, 88947.36842105264, 169000, 1067368.42],
    // segunda curva del par: sin pedido y con datos de otro modelo (así viene el archivo)
    ['', '', 161101500020, 'MENS', '', 'TB0A41Q8ER3', 'MT. MADDSEN PEAK', 'LIGHT BEIGE SUEDE', 1, '', '', '', '', '', ''],
    ['', 17, 161102190010, 'MENS', 'CASUAL', 'TB0A4187EM6', 'CLASSIC BOAT', 'RUST FULL GRAIN', 0, 6, 12, 72, 157368.42105263157, 299000, 11330526.3],
    ['', 23, 161104430010, 'MEN', 'BOTAS', 'TB112122001', 'WHITE LEDGE', 'BLACK', 0, '', 12, 0, 146842.1, 279000, 0],
    ['', '', '', '', '', '', '', '', 0, 7, '', 84, '', '', 0],
  ],
};
const hojaAcc = {
  nombre: 'Accesorios VLP',
  filas: [
    ['IMAGEN', 'PÁG.', 'PRODUCTO', 'GENERO', 'CATEGORIA', 'CODIGO ART', 'DESCRIPCION', 'COLOR', 'P/SISTEMA', 'PEDIDO', 'PACK X', 'TOTAL UNIDADES', '$MAYORISTA', '$SUGERIDO', 'VALORIZADO'],
    ['', 157, '161103730010', 'Women', 'MOCHILAS Y BOLSOS', 'TB0A5W2F001', 'THAYER WOMEN CROSSBODY BAG', 'Black', 12, 12, 4, 48, 34500, 69000, 1656000],
  ],
};

describe('factura de Grupo Blanco', () => {
  const f = facturaGrupoBlanco([pagina1('Original'), pagina2('Original'), pagina1('Duplicado'), pagina2('Duplicado')]);

  it('lee la primera copia: curvas × unidades por curva, precio de lista', () => {
    expect(f.numero).toBe('0099-00000001');
    expect(f.fecha).toBe('2026-09-30');
    expect(f.renglones).toHaveLength(5);
    expect(f.renglones[0]).toMatchObject({ codigo: 'TB0A2QKNEAC', descripcion: 'GREYFIELD SANDAL', color: 'WHITE KNIT', talle: '', cantidad: 6 });
    expect(f.renglones[0].precio_unitario).toBeCloseTo(88947.3684, 4);
    expect(f.renglones.reduce((s, r) => s + r.cantidad, 0)).toBe(76);
    expect(f.cantidad_total_impresa).toBe(76);
    expect(f.observaciones).toMatch(/13 curvas/);
    expect(f.observaciones).toMatch(/20%/);
  });

  it('avisa si el importe no cuadra con curvas × unidades × precio − bonificación', () => {
    const p = pagina1('Original');
    p[7] = p[7].replace('426.947,37', '426.000,00');
    expect(facturaGrupoBlanco([p]).observaciones).toMatch(/no da el importe/);
  });

  it('un PDF que no es de Grupo Blanco da error claro', () => {
    expect(() => facturaGrupoBlanco([['Hola', 'Total 3']])).toThrow(/Grupo Blanco/);
  });

  it('arma renglones con la altura del texto del PDF', () => {
    const it = (str: string, y: number) => ({ str, transform: [1, 0, 0, 1, 0, y] });
    expect(lineasDePagina([it('161101500010', 500), it(' ', 500), it('TB0A2QKNEAC-X', 500), it('Timberland /', 480), it('CUERO', 480.5)]))
      .toEqual(['161101500010 TB0A2QKNEAC-X', 'Timberland / CUERO']);
  });
});

describe('nota de pedido de Grupo Blanco', () => {
  const { nota, avisos } = notaGrupoBlanco([hojaCalzado, hojaAcc], 'TIMB.xlsx', 1);

  it('módulos × unidades por módulo; ignora filas sin pedido y la fila de totales', () => {
    expect(nota.renglones.map((r) => [r.codigo, r.cantidad, r.costo])).toEqual([
      ['TB0A2QKNEAC', 12, 88947.36842105264],
      ['TB0A4187EM6', 72, 157368.42105263157],
      ['TB0A5W2F001', 48, 34500],
    ]);
    expect(avisos).toEqual([]);
  });

  it('factura contra nota: modelo completo, pendientes y no pedidos', () => {
    const f = facturaGrupoBlanco([pagina1('Original'), pagina2('Original')]);
    const r = compararConPedido(f, [nota]);
    const por = (c: string) => r.filas.find((x) => x.codigo === c)!;
    expect(por('TB0A2QKNEAC')).toMatchObject({ tipo: 'ok', porModelo: true, cantFacturada: 12, cantPedida: 12 });
    expect(por('TB0A4187EM6')).toMatchObject({ tipo: 'ok', cantFacturada: 60, cantPedida: 72 });
    expect(por('TB0A5W2F001')).toMatchObject({ tipo: 'ok', cantFacturada: 4, cantPedida: 48 });
    expect(r.pendientes.map((p) => [p.codigo, p.falta])).toEqual([['TB0A4187EM6', 12], ['TB0A5W2F001', 44]]);
  });

  it('archivo que no es de Grupo Blanco da error claro', () => {
    expect(() => notaGrupoBlanco([{ nombre: 'H', filas: [['Código', 'Cantidad']] }], 'x.xlsx')).toThrow(/Grupo Blanco/);
  });
});

// ---------- Archivos reales (optativo, no se suben al repositorio) ----------
const FACT = process.env.GRUPO_BLANCO_FACTURA;
const NOTA = process.env.GRUPO_BLANCO_NOTA;
describe.skipIf(!FACT || !NOTA)('Grupo Blanco con los archivos reales', () => {
  it('factura 0023-00066655 contra TIMB.xlsx', async () => {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(FACT!)), verbosity: 0 }).promise;
    const paginas: string[][] = [];
    for (let i = 1; i <= doc.numPages; i++) paginas.push(lineasDePagina((await (await doc.getPage(i)).getTextContent()).items));
    const f = facturaGrupoBlanco(paginas);
    expect(f.numero).toBe('0023-00066655');
    expect(f.renglones).toHaveLength(16);
    expect(f.renglones.reduce((s, r) => s + r.cantidad, 0)).toBe(176);
    expect(f.observaciones).not.toMatch(/no da el importe|puede faltar/);

    const wb = XLSX.read(fs.readFileSync(NOTA!));
    const { nota } = notaGrupoBlanco(wb.SheetNames.map((n) => ({ nombre: n, filas: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: '' }) })), 'TIMB.xlsx');
    const r = compararConPedido(f, [nota]);
    const res = Object.fromEntries(r.filas.map((x) => [x.codigo, [x.tipo, x.cantFacturada, x.cantPedida]]));
    expect(res).toEqual({
      TB0A2QKNEAC: ['ok', 12, 12], TB0A2QKNEK8: ['ok', 36, 36], TB0A61N4EK4: ['ok', 24, 36], TB0A2QJAAJG: ['ok', 12, 12],
      TB0A6DPPEVH: ['ok', 12, 12], TB0A4187EM6: ['ok', 60, 72], TB0A5W2F001: ['ok', 4, 48], TB0A43PB001: ['ok', 4, 12],
      TB0A2PDQAMX: ['noPedido', 12, 0],
    });
  });
});
