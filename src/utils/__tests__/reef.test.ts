import { describe, expect, it } from 'vitest';
import {
  altaReef, curvaReef, entregaDeRemitoReef, esTalleUs, leerListaReef, marketplaceReef, remitoReefDeExcel, skuEsDeReef, talleSkuReef, tituloReef, type ListaReef,
} from '../reef';
import { leerTextoEntregaFamily, talleFamily } from '../controlFamily';
import type { AltaFamily } from '../cargaFamily';

// Filas armadas con el formato de la lista Reef Summer 2027 (el archivo real no va al repositorio).
const ENC = ['Linea', 'Artículo', 'Descripción', 'Curva', 'PVM', 'PVP', 'Unid Cva', 'Pedido', 'Ttl Unid.', 'Total $', 'Obsev.'];
const HOJAS = [
  { nombre: 'Formulario Apertura de Cuenta', filas: [['INFORME PARA APERTURA DE CLIENTE'], ['E mail: alguien@ejemplo.com']] },
  {
    nombre: 'CALZADO', filas: [
      ['REEF CALZADO  -  SUMMER 2027  '], [], ['GUYS SHOES'], ENC,
      ['CALZADO WALL SHOES GUYS', 27112280, 'SHAKA BLACK/WHITE', '40 (1) / 41 (2) / 42 (3) / 43 (3) / 44 (2) 45 (1)= 12', 49995, 99990, 12, 0, 0, 0],
      ['CALZADO WALL SHOES GUYS', 27111933, 'MISSION TX', '8 (2) / 9 (3) / 10 (3) / 11 (2) / 12 (1) 13 (1)= 12', 59995, 119990, 12, 0, 0, 0],
      [], ['GIRLS SHOES'], ENC,
      ['CALZADO WALL SHOES GIRLS', 27112289, 'ROCKER ALL BLACK', '35 (1) / 36 (2) / 37 (3) / 38 (3) / 39 (2) 40 (1)= 12', 49995, 99990, 12, 0, 0, 0],
    ],
  },
  {
    nombre: 'INDUMENTARIA', filas: [
      ['Linea', 'Artículo', 'Descripcion', 'Curva', 'PMV', 'PVP', 'Unid Cva', 'Pedido', 'Ttl Unid.', 'Total $', 'Obsev.'],
      ['REMERAS MC LOGO GUYS', 272222167, 'CLASSIC BLOCK TEE BLANCO', 'S 1 / M 2 / L 2/ XL 1 / XXL1 = 7', 17495, 34990, 7, 0, 0, 0],
      ['RIÑONERAS', 272219086, 'RIÑONERA AUSTIN NEGRO', 'Talle único=3', 19995, 39990, 3, 0, 0, 0],
      ['REMERAS MC ARTISTICA JUNIOR', 272222250, 'SLOW WAVES OVZ TEE JR OFF WHITE', '10 (1) / 12 (1) / 14 (2) / 16 (2) = 6', 12995, 25990, 6, 0, 0, 0],
    ],
  },
  {
    nombre: 'OJOTAS', filas: [
      ENC,
      ['OJOTA GUYS ESSENTIALS', 27103265, 'TAILSLIDE GREY/TAN', '39-40 (2) / 41-42 (4) / 43-44 (4) / 45-46 (2)=12', 24995, 49990, 12, 0, 0, 0],
      ['OJOTA GUYS PERFORMANCE', 27103013, 'FANNING BLACK/SILVER', '7 (1) / 8 (2) / 9 (3) / 10 (3) / 11 (3) / 12 (2) 13 (1)= 15', 74995, 149990, 15, 0, 0, 0],
    ],
  },
  { nombre: 'RESUMEN', filas: [[null, 'Unidades', 'Importe Sin IVA'], ['Calzado', 0, 0]] },
];

describe('Reef: curvas de la lista (26-nov-2026)', () => {
  it.each([
    ['40 (1) / 41 (2) / 42 (3) / 43 (3) / 44 (2) 45 (1)= 12', '40:1 41:2 42:3 43:3 44:2 45:1', 12],
    ['S 1 / M 2 / L 2/ XL 1 / XXL1 = 7', 'S:1 M:2 L:2 XL:1 XXL:1', 7],
    ['S (1) M (2) L (2) XL (2) 2XL (1) = 8', 'S:1 M:2 L:2 XL:2 XXL:1', 8],
    ['28(1) - 30(2) - 32(2) - 34(3) - 36(3) - 38(2) - 40(1) =  14', '28:1 30:2 32:2 34:3 36:3 38:2 40:1', 14],
    ['39-40 (2) / 41-42 (4) / 43-44 (4) / 45-46 (2)=12', '39-40:2 41-42:4 43-44:4 45-46:2', 12],
    ['36/37 (3)  -  38/39(3) = 6', '36-37:3 38-39:3', 6],
    ['08 (2) / 10 (2) / 12 (1) = 5', '8:2 10:2 12:1', 5],
    ['1(3) - 2(3)=6', '1:3 2:3', 6],
    [' 42(2) - 44(2) - 46(1) - 48(1)  =  6', '42:2 44:2 46:1 48:1', 6],
    ['90 (1) / 95 (2) / 100 (2) / 105 (1) = 6', '90:1 95:2 100:2 105:1', 6],
    ['XXS 1 / XS 1 / S 2 / M 2 / L 2 / XL 1  = 9', 'XXS:1 XS:1 S:2 M:2 L:2 XL:1', 9],
    ['6 (2) /7 (4) / 8 (4) / 9 (2)=12', '6:2 7:4 8:4 9:2', 12],
    ['Talle único=3', 'TU:3', 3],
  ])('«%s»', (texto, esperado, total) => {
    const c = curvaReef(texto)!;
    expect(c.talles.map((t) => `${t.talle}:${t.cantidad}`).join(' ')).toBe(esperado);
    expect(c.total).toBe(total);
  });

  it('no adivina lo que no entiende', () => {
    expect(curvaReef('')).toBeNull();
    expect(curvaReef('S, M y L surtidos')).toBeNull();
    expect(curvaReef('40 (1) / 40 (2)')).toBeNull();
  });

  it('talles de EE.UU. solo en calzado y ojotas, numéricos de hasta 15', () => {
    expect(esTalleUs('CALZADO', curvaReef('8 (2) / 9 (3) = 5')!.talles)).toBe(true);
    expect(esTalleUs('OJOTAS', curvaReef('6 (2) /7 (4) = 6')!.talles)).toBe(true);
    expect(esTalleUs('CALZADO', curvaReef('40 (1) / 41 (2) = 3')!.talles)).toBe(false);
    expect(esTalleUs('OJOTAS', curvaReef('39-40 (2) / 41-42 (4) = 6')!.talles)).toBe(false);
    expect(esTalleUs('INDUMENTARIA', curvaReef('10 (1) / 12 (1) = 2')!.talles)).toBe(false);
  });
});

describe('Reef: lista de precios', () => {
  const { lista, avisos } = leerListaReef(HOJAS, 'Lista Summer 2027');

  it('lee solo los artículos (ni la hoja de apertura de cuenta ni el resumen), con PVM o PMV', () => {
    expect(lista.articulos.map((a) => a.codigo)).toEqual(['27112280', '27111933', '27112289', '272222167', '272219086', '272222250', '27103265', '27103013']);
    expect(JSON.stringify(lista)).not.toContain('ejemplo.com');
    const tee = lista.articulos.find((a) => a.codigo === '272222167')!;
    expect(tee).toMatchObject({ hoja: 'INDUMENTARIA', linea: 'REMERAS MC LOGO GUYS', pvm: 17495, pvp: 34990, unidades: 7 });
    expect(lista.articulos.find((a) => a.codigo === '27103013')!.us).toBe(true);
    expect(lista.articulos.find((a) => a.codigo === '27112280')!.us).toBeUndefined();
    expect(avisos).toEqual([]);
  });

  it('sin artículos, error claro', () => {
    expect(() => leerListaReef([HOJAS[0]])).toThrow(/No encontré artículos/);
  });

  it('avisa la curva que no entiende y el artículo sin PVM', () => {
    const r = leerListaReef([{ nombre: 'INDUMENTARIA', filas: [ENC, ['X', 272200001, 'RARO', 'surtido', 0, 1000, 3]] }]);
    expect(r.avisos.join(' ')).toMatch(/no entiendo la curva/);
    expect(r.avisos.join(' ')).toMatch(/sin PVM/);
  });
});

describe('Reef: remito + lista → entrega', () => {
  const { lista } = leerListaReef(HOJAS, 'Lista');
  const remito = {
    numero: '0067-00003073', fecha: '2026-11-25', dudas: [],
    renglones: [
      { codigo: '27112280', descripcion: 'SHAKA BLACK/WHITE - 045', cantidad: 12, talles: '040 041 042 043 044 045' },
      { codigo: '27112289', descripcion: 'ROCKER ALL BLACK', cantidad: 24, talles: '035 036 037 038 039 040' },
      { codigo: '27103013', descripcion: 'FANNING', cantidad: 15, talles: '' },
      { codigo: '272219086', descripcion: 'RIÑONERA AUSTIN', cantidad: 3, talles: '' },
      { codigo: '272222167', descripcion: 'CLASSIC BLOCK TEE', cantidad: 5, talles: '' },
      { codigo: '99999999', descripcion: 'OTRO', cantidad: 2, talles: '' },
    ],
  };
  const { entrega, avisos } = entregaDeRemitoReef(remito, lista, '2026-11-26');
  const ren = (c: string) => entrega.renglones.find((r) => r.codigo === c)!;

  it('precios y descripción de la lista; talles = curva × cantidad de curvas', () => {
    expect(ren('27112280')).toMatchObject({ descripcion: 'SHAKA BLACK/WHITE', precioMayor: 49995, precioPublico: 99990, cantidad: 12 });
    expect(ren('27112280').talles.map((t) => `${t.talle}:${t.cantidad}`).join(' ')).toBe('40:1 41:2 42:3 43:3 44:2 45:1');
    expect(ren('27112289').talles.map((t) => `${t.talle}:${t.cantidad}`).join(' ')).toBe('35:2 36:4 37:6 38:6 39:4 40:2');
    expect(entrega.documento).toEqual({ tipo: 'remito', numero: '0067-00003073', remito: '0067-00003073', total: 0 });
    expect(entrega).toMatchObject({ nombre: 'Remito 0067-00003073', fecha: '2026-11-25', origen: 'foto' });
    expect(avisos).toEqual([]);
  });

  it('lo que no se puede saber queda sin talles y con una duda (nunca se adivina)', () => {
    expect(ren('27103013').talles).toEqual([]);
    expect(entrega.dudas!.join(' ')).toMatch(/27103013.*talle de EE\.UU\./);
    expect(ren('272222167').talles).toEqual([]);
    expect(entrega.dudas!.join(' ')).toMatch(/272222167.*no es una cantidad justa de curvas/);
    expect(ren('99999999')).toMatchObject({ precioMayor: 0, precioPublico: 0, talles: [] });
    expect(entrega.dudas!.join(' ')).toMatch(/99999999: no está en la lista/);
    expect(ren('272219086')).toMatchObject({ talles: [], cantidad: 3 });
    expect(entrega.dudas!.join(' ')).not.toMatch(/272219086/);
    expect(entrega.dudas!.join(' ')).not.toMatch(/27112280|27112289/);
  });

  it('avisa si los talles impresos no son los de la curva', () => {
    const r = entregaDeRemitoReef({ ...remito, renglones: [{ ...remito.renglones[0], talles: '040 041 046' }] }, lista, '2026-11-26');
    expect(r.entrega.dudas!.join(' ')).toMatch(/27112280: el remito dice talles/);
  });

  it('sin lista: avisa que hay que subirla', () => {
    const r = entregaDeRemitoReef(remito, null, '2026-11-26');
    expect(r.avisos[0]).toMatch(/lista de precios/);
    expect(r.entrega.renglones[0]).toMatchObject({ precioMayor: 0, talles: [] });
  });
});

describe('Reef: remito digital (Excel, 26-nov-2026)', () => {
  // Mismo formato que «Detalle Remit …xlsx» de New Arrecife, con datos armados (el archivo real no va al repositorio).
  const FILAS: unknown[][] = [
    ['Estadísticas de Ventas', '', '', '', '', '', ''],
    ['desde el 01/10/2026 hasta el 26/11/2026 (Clientes parcial)'],
    ['Artículo: ', 'Comprobante', 'Fecha', 'Clnte', 'Razón Social', 'Cant.Mov.', 'Importe'],
    ['27112280     - SHAKA BLACK/WHITE                  ', 'RTTO-R 0067-00003073', '25/11/2026', '00001', 'CLIENTE DE PRUEBA SA', 12, 509949],
    ['27112289     - ROCKER ALL BLACK                   ', 'RTTO-R 0067-00003073', '25/11/2026', '00001', 'CLIENTE DE PRUEBA SA', 24, 1100000],
    ['', '', '', '', '', 36, 1609949],
  ];
  const { lista } = leerListaReef(HOJAS, 'Lista');

  it('lee número, fecha, cantidades e importes; la fila de totales no es un artículo', () => {
    const doc = remitoReefDeExcel(FILAS);
    expect(doc).toMatchObject({ numero: '0067-00003073', fecha: '2026-11-25', total: 1609949 });
    expect(doc.renglones).toEqual([
      { codigo: '27112280', descripcion: 'SHAKA BLACK/WHITE', cantidad: 12, talles: '', importe: 509949 },
      { codigo: '27112289', descripcion: 'ROCKER ALL BLACK', cantidad: 24, talles: '', importe: 1100000 },
    ]);
  });

  it('con la lista: talles por la curva, origen Excel, total del remito; avisa si el importe no es PMV − 15%', () => {
    const { entrega } = entregaDeRemitoReef(remitoReefDeExcel(FILAS), lista, '2026-11-26', 'excel');
    expect(entrega).toMatchObject({ origen: 'excel', nombre: 'Remito 0067-00003073', documento: { tipo: 'remito', numero: '0067-00003073', total: 1609949 } });
    expect(entrega.renglones[0].talles.map((t) => `${t.talle}:${t.cantidad}`).join(' ')).toBe('40:1 41:2 42:3 43:3 44:2 45:1');
    // 509.949 / 12 = 42.495,75 = 49.995 − 15%: sin duda. 1.100.000 / 24 = 45.833,33: duda.
    expect(entrega.dudas!.join(' ')).not.toMatch(/27112280/);
    expect(entrega.dudas!.join(' ')).toMatch(/27112289: el remito dice \$1\.100\.000 por 24 u\..*PMV − 15% da \$42\.495,75/);
  });

  it('no es el remito digital, o trae varios remitos: no adivina', () => {
    expect(() => remitoReefDeExcel([['Linea', 'Artículo', 'Curva']])).toThrow(/no encontré las columnas/);
    const dos = [...FILAS.slice(0, 4), ['27112289 - ROCKER ALL BLACK', 'RTTO-R 0067-00003074', '26/11/2026', '', '', 12, 509949]];
    expect(() => remitoReefDeExcel(dos)).toThrow(/2 remitos distintos.*uno por remito/);
  });
});

describe('Reef: Shopify y altas', () => {
  const { lista } = leerListaReef(HOJAS, 'Lista');
  const l: ListaReef = lista;

  it('reconoce el SKU del código, con separador (como los Reef de la tienda)', () => {
    expect(skuEsDeReef('27111871.005', '27111871')).toBe(true);
    expect(skuEsDeReef('27111871', '27111871')).toBe(true);
    expect(skuEsDeReef('271118710', '27111871')).toBe(false);
    expect(skuEsDeReef('2711187.005', '27111871')).toBe(false);
    expect(marketplaceReef(l).esDelCodigo('', ['Calzado', '27112280'], '27112280')).toBe(true);
  });

  it('títulos como en la tienda: Tipo Reef Modelo [Mujer|Niño] Color', () => {
    expect(tituloReef('SHAKA BLACK/WHITE', 'CALZADO WALL SHOES GUYS')).toBe('Zapatillas Reef Shaka Negro Blanco');
    expect(tituloReef('ROCKER ALL BLACK', 'CALZADO WALL SHOES GIRLS')).toBe('Zapatillas Reef Rocker Mujer Negro Total');
    expect(tituloReef('AGGY BLACK', 'CALZADO WALL SHOES GUYS')).toBe('Zapatillas Reef Aggy Negro');
    expect(tituloReef('JACINTA BIKINI CHOCOLATE', 'BIKINIS')).toBe('Bikini Reef Jacinta Chocolate');
    expect(tituloReef('PRIMO II BLACK GUM', 'CALZADO WALL SHOES GUYS')).toBe('Zapatillas Reef Primo II Negro Gum');
    expect(tituloReef('CLASSIC BLOCK TEE BLANCO', 'REMERAS MC LOGO GUYS')).toBe('Remera Reef Classic Block Blanco');
    expect(tituloReef('SLOW WAVES OVZ TEE JR OFF WHITE', 'REMERAS MC ARTISTICA JUNIOR')).toBe('Remera Reef Slow Waves Ovz Niño Blanco Hueso');
    expect(tituloReef('TAILSLIDE GREY/TAN', 'OJOTA GUYS ESSENTIALS')).toBe('Ojota Reef Tailslide Gris Habano');
    expect(tituloReef('RIÑONERA AUSTIN NEGRO', 'RIÑONERAS')).toBe('Riñonera Reef Austin Negro');
  });

  it('SKU de los nuevos: código.talle (040, 3940, S)', () => {
    expect(talleSkuReef('40')).toBe('040');
    expect(talleSkuReef('39-40')).toBe('3940');
    expect(talleSkuReef('xl')).toBe('XL');
  });

  it('alta: PVP de la lista (editable), costo PMV − 15%, vendor Reef', () => {
    const { entrega } = entregaDeRemitoReef({ numero: '1', fecha: '2026-11-25', dudas: [], renglones: [
      { codigo: '27112280', descripcion: '', cantidad: 12, talles: '' },
      { codigo: '27103265', descripcion: '', cantidad: 12, talles: '' },
      { codigo: '272219086', descripcion: '', cantidad: 3, talles: '' },
      { codigo: '27103013', descripcion: '', cantidad: 15, talles: '' },
    ] }, l, '2026-11-26');
    const a = altaReef(entrega.renglones[0], l).accion as AltaFamily;
    expect(a).toMatchObject({ titulo: 'Zapatillas Reef Shaka Negro Blanco', vendor: 'Reef', productType: 'Zapatillas', precio: 99990, costo: 42495.75, precioEditable: true });
    expect(a.etiquetas).toEqual(['27112280', 'Calzado', 'Zapatillas', 'reef']);
    expect(a.variantes[0]).toEqual({ talle: '40', sku: '27112280.040', cantidad: 1 });
    const ojota = altaReef(entrega.renglones[1], l).accion as AltaFamily;
    expect(ojota.variantes.map((v) => `${v.talle}=${v.sku}`)).toEqual(['39 / 40=27103265.3940', '41 / 42=27103265.4142', '43 / 44=27103265.4344', '45 / 46=27103265.4546']);
    const rin = altaReef(entrega.renglones[2], l).accion as AltaFamily;
    expect(rin).toMatchObject({ opcion: 'Title', variantes: [{ talle: 'Default Title', sku: '272219086', cantidad: 3 }] });
    const us = altaReef(entrega.renglones[3], l);
    expect(us.accion).toBeNull();
    expect(us.bloqueo).toMatch(/EE\.UU\./);
  });

  it('talle doble: «39 / 40» de Shopify = «39-40» de la lista; se escribe a mano con guion', () => {
    expect(talleFamily('39 / 40')).toBe(talleFamily('39-40'));
    expect(talleFamily('19/20')).toBe('19/20');
    const t = leerTextoEntregaFamily('27103265 39-40/2 41-42/4 $24995 $49990 TAILSLIDE');
    expect(t.errores).toEqual([]);
    expect(t.renglones[0].talles).toEqual([{ talle: '39-40', cantidad: 2 }, { talle: '41-42', cantidad: 4 }]);
  });
});
