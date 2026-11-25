// Carga de las entregas de iD en Shopify (12-nov-2026, pedido de gax). Shopify SIMULADO: ninguna escritura real.
import { describe, it, expect, vi } from 'vitest';
import { accionesElegidas, ejecutarCargaFamily, leerPrecio, llegaAl50, precioAEscribir, resumenCarga, type CargaFamily, type DepsCarga, type ItemCarga } from '../cargaFamily';
import {
  ajusteDe, costoPromedio, entregaArchivada, estadoCargaFactura, firmaCargaId, formasCodigo, leerEstadoCargaId, leerPendientesId, leerVentasId, noEntraronId, ordenesQueSalen, textoNoEntraron, packDeCarga, planCargaId, precioYCostoAntes, separarDe, talleEnShopify, tablaCargaId,
  type EstadoCargaId, type OrdenPendienteId, type ProductoId, type VarianteId,
} from '../cargaId';
import { diferenciasDeTalles, netosDeCarga, textoAvisoTalles } from '../avisoTalles';
import { PACKS_ID, packConocidoId, pareceCodigoPackId } from '../packsId';
import type { FilaChecklist, RenglonFactura, ResultadoFactura } from '../controlFacturas';

const LOC = 'gid://shopify/Location/9';
const sinPagina = { hasNextPage: false, endCursor: null };
function shopify(respuestas: Record<string, (v: Record<string, unknown>) => unknown>) {
  return vi.fn(async (q: string, v: Record<string, unknown> = {}) => {
    const k = Object.keys(respuestas).find((x) => q.includes(x));
    if (!k) throw new Error(`consulta inesperada: ${q.slice(0, 60)}`);
    return respuestas[k](v);
  });
}

const variante = (talle: string, disponible: number | null, extra: Partial<VarianteId> = {}): VarianteId => ({
  id: `gid://shopify/ProductVariant/${talle}`, talle, sku: `CTO0325003-${talle}`, inventoryItemId: `gid://shopify/InventoryItem/${talle}`,
  seguimiento: true, disponible, precio: 59900, costo: 20000, ...extra,
});
const remera = (variantes = [variante('S', 0), variante('M', 0), variante('L', 2), variante('XL', null)]): ProductoId => ({
  id: 'gid://shopify/Product/1', titulo: 'Remera Converse Star Chevron Negro', vendor: 'Converse', estado: 'ACTIVE', etiquetas: ['CTO0325003'], variantes,
});
const renglon = (precioUnitario = 25000, codigo = 'CTO0325003'): RenglonFactura => ({ codigo, descripcion: 'TEE STAR CHEVRON BLACK', precioUnitario, bonificacion: 10, cantidad: 4, total: 0 });
const fila = (talles: FilaChecklist['talles'], extra: Partial<FilaChecklist> = {}): FilaChecklist => ({
  codigo: 'CTO0325003', descripcion: 'TEE STAR CHEVRON BLACK', cantidad: 4, talles, nota: '', ...extra,
});
function resultado(filas: FilaChecklist[], renglones = [renglon()]): ResultadoFactura {
  return {
    factura: { id: 'F-0011-00139953', numero: '0011-00139953', fecha: '2026-11-10', remito: '0013-00125274', renglones },
    remito: { numero: '0013-00125274', renglones: filas.map((f) => ({ codigo: f.codigo, cantidad: f.cantidad })) },
    checklist: filas, difRemito: [],
  } as unknown as ResultadoFactura;
}
/** Solo talle y cantidades (sin el talle de Shopify, que se prueba aparte). */
const cantidades = (ts: { talle: string; cantidad: number; original: number }[] | undefined) => ts?.map(({ talle, cantidad, original }) => ({ talle, cantidad, original }));
const estado = (p: ProductoId = remera(), codigo = 'CTO0325003'): EstadoCargaId => ({ locationId: LOC, porCodigo: { [codigo]: [p.id] }, productos: { [p.id]: p } });

describe('iD: talle del proveedor → talle de Shopify (nunca adivina)', () => {
  it('Converse: la etiqueta TABLA DE TALLE manda; sin etiqueta, la tabla elegida (el maestro solo no alcanza)', () => {
    // A11716C: etiqueta TABLA 1 pero maestro tabla 2 (caso real de CLAUDE.md, sección 4).
    expect(talleEnShopify('converse', '085', 'A11716C', ['A11716C', 'TABLA DE TALLE CONVERSE 1'], '')).toEqual({ talle: '41' });
    // 17-nov-2026, gax: A10548C sin etiqueta, el maestro decía tabla 2 y era la 1. Sin etiqueta no se usa el maestro.
    expect(talleEnShopify('converse', '7', 'A10548C', ['a10548c'], '')).toMatchObject({ error: expect.stringMatching(/no tiene la etiqueta TABLA DE TALLE/) });
    expect(talleEnShopify('converse', '7', 'A10548C', ['a10548c'], '', 'TABLA DE TALLE CONVERSE 1')).toEqual({ talle: '39' });
    expect(talleEnShopify('converse', '7', 'A10548C', ['a10548c'], '', 'TABLA DE TALLE CONVERSE 2')).toEqual({ talle: '40' });
    // La etiqueta manda sobre lo elegido.
    expect(talleEnShopify('converse', '085', 'A11716C', ['TABLA DE TALLE CONVERSE 1'], '', 'TABLA DE TALLE CONVERSE 2')).toEqual({ talle: '41' });
    expect(talleEnShopify('converse', '8', 'ZZZ9999C', [], '')).toMatchObject({ error: expect.stringMatching(/TABLA DE TALLE/) });
    expect(talleEnShopify('converse', 'XL', 'CTO0325003', [], '')).toEqual({ talle: 'XL' });
  });
  it('Le Coq: el calzado va uno menos; la ropa con talle numérico, tal cual', () => {
    expect(talleEnShopify('lecoq', '040', 'LFO0125230', [], 'STRIDER')).toEqual({ talle: '39' });
    expect(talleEnShopify('lecoq', '44', 'LFO0125230', [], 'PANT TECH')).toEqual({ talle: '44' });
    expect(talleEnShopify('lecoq', 'm', 'LFO0125230', [], 'TEE')).toEqual({ talle: 'M' });
  });
  it('la O y el 0 se confunden en las facturas: se buscan las dos formas', () => {
    expect(formasCodigo('LFO0125084')).toEqual(['LFO0125084', 'LF00125084']);
    expect(formasCodigo('A10520C')).toEqual(['A10520C']);
  });
});

describe('iD: lectura de Shopify (solo lectura)', () => {
  it('busca en DEPOSITO MARTINEZ, por SKU delimitado o etiqueta exacta, y lee precio, costo y stock', async () => {
    const gql = shopify({
      locations: () => ({ locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'ID (Converse - Le Coq Sportif)' }, { id: LOC, name: 'DEPOSITO MARTINEZ' }] } }),
      productVariants: () => ({ productVariants: { pageInfo: sinPagina, nodes: [
        { sku: 'CTO0325003-S', product: { id: 'gid://shopify/Product/1', tags: [] } },
        // Mismo prefijo, otro modelo: no es este código.
        { sku: 'CTO03250031-S', product: { id: 'gid://shopify/Product/2', tags: [] } },
      ] } }),
      'product(id': (v) => ({ product: { id: v.id, title: 'Remera', vendor: 'Converse', status: 'ACTIVE', tags: [], variants: { nodes: [
        { id: 'v1', title: 'S', sku: 'CTO0325003-S', price: '59900.00', inventoryItem: { id: 'i1', tracked: true, unitCost: { amount: '20000.5' }, inventoryLevel: { quantities: [{ name: 'available', quantity: 3 }] } } },
        { id: 'v2', title: 'M', sku: 'CTO0325003-M', price: '59900.00', inventoryItem: { id: 'i2', tracked: true, unitCost: null, inventoryLevel: null } },
      ] } } }),
    });
    const e = await leerEstadoCargaId(['CTO0325003'], gql);
    expect(e.locationId).toBe(LOC);
    expect(e.porCodigo).toEqual({ CTO0325003: ['gid://shopify/Product/1'] });
    expect(e.productos['gid://shopify/Product/1'].variantes.map((v) => [v.talle, v.disponible, v.precio, v.costo])).toEqual([['S', 3, 59900, 20000.5], ['M', null, 59900, null]]);
    expect(gql.mock.calls.filter(([q]) => q.includes('product(id')).every(([, v]) => v?.loc === LOC)).toBe(true);
    expect(gql.mock.calls.every(([q]) => !/^\s*mutation/.test(q))).toBe(true);
  });
  it('sin la sucursal de Martínez no arma nada', async () => {
    const gql = shopify({ locations: () => ({ locations: { nodes: [{ id: 'x', name: 'NTF' }] } }) });
    await expect(leerEstadoCargaId(['CTO0325003'], gql)).rejects.toThrow(/DEPOSITO MARTINEZ/);
  });
});

describe('iD: margen y costo con la factura (gax, 12-nov-2026)', () => {
  it('50% o más con el precio actual = verde; el costo nuevo va a los talles que llegan y a los que están en 0 en Martínez', () => {
    // Lista 25.000 − 10% = 22.500. Con 59.900: 1 − 22.500 / (59.900 / 1,21) = 54,5%.
    const a = ajusteDe(remera(), renglon(), [{ talle: 'S', inventoryItemId: 'gid://shopify/InventoryItem/S', actual: 0, suma: 2 }])!;
    expect(a.costoNuevo).toBe(22500);
    expect(a.ok).toBe(true);
    expect(a.precioActual).toBe(59900);
    // S llega; M en 0; XL sin alta en Martínez (= sin stock propio). L tiene 2 y no llega: conserva su costo.
    expect(a.costos.map((c) => c.talle)).toEqual(['S', 'M', 'XL']);
    expect(a.conservan).toEqual([{ talle: 'L', stock: 2, costo: 20000 }]);
    expect(precioAEscribir(a)).toBeNull();
  });
  it('menos del 50% = hay que poner un precio que llegue al 50%, para toda la curva', () => {
    const a = ajusteDe(remera(), renglon(30000), [])!; // costo 27.000: margen 45,5%
    expect(a.ok).toBe(false);
    expect(Number.isNaN(precioAEscribir(a))).toBe(true);
    expect(Number.isNaN(precioAEscribir(a, 59900))).toBe(true);
    expect(Number.isNaN(precioAEscribir(a, 60000))).toBe(true); // 45,6%
    expect(llegaAl50(65340, 27000)).toBe(true); // exacto 50%
    expect(llegaAl50(65339, 27000)).toBe(false);
    expect(precioAEscribir(a, 69900)).toBe(69900);
    expect(Number.isNaN(precioAEscribir(a, 69900.5))).toBe(true);
    expect(a.variantes).toHaveLength(4);
  });
  it('básico: precio impuesto, avisa pero no obliga', () => {
    const a = ajusteDe(remera(), renglon(30000, '156991C'), [])!;
    expect(a.basico).toBe(true);
    expect(precioAEscribir(a)).toBeNull();
  });
  it('talles con precios distintos: hay que unificar el precio', () => {
    const p = remera([variante('S', 0), variante('M', 0, { precio: 64900 })]);
    const a = ajusteDe(p, renglon(), [])!;
    expect(a.precioActual).toBeNull();
    expect(Number.isNaN(precioAEscribir(a))).toBe(true);
    expect(precioAEscribir(a, 64900)).toBe(64900);
  });
  it('lee el precio escrito a mano', () => {
    expect(leerPrecio('84.900')).toBe(84900);
    expect(leerPrecio('$ 84900')).toBe(84900);
    expect(leerPrecio('')).toBeUndefined();
    expect(leerPrecio('abc')).toBeNaN();
  });
});

describe('iD: vista previa de la carga', () => {
  it('suma lo del remito menos lo que salió para órdenes, en Martínez, con margen y costo', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 2 }, { talle: 'XL', cantidad: 2, retirado: 1 }], { retirado: 1 })]);
    const plan = planCargaId(r, estado(), {});
    expect(plan.sucursal).toBe('DEPOSITO MARTINEZ');
    const [it] = plan.items;
    expect(it.estado).toBe('listo');
    const a = it.opciones[0].accion!;
    expect(a.tipo).toBe('reposicion');
    if (a.tipo !== 'reposicion') return;
    expect(a.lineas).toEqual([
      { talle: 'S', inventoryItemId: 'gid://shopify/InventoryItem/S', actual: 0, suma: 2 },
      { talle: 'XL', inventoryItemId: 'gid://shopify/InventoryItem/XL', actual: null, suma: 2 },
    ]);
    expect(it.opciones[0].avisos.join(' ')).toMatch(/XL: no está dado de alta/);
    expect(it.opciones[0].avisos.join(' ')).toMatch(/Salieron 1 para órdenes/);
    expect(a.ajuste?.ok).toBe(true);
  });
  it('un talle que llega y ya tenía stock en Martínez lleva el promedio ponderado (gax, 12-nov-2026)', () => {
    // L: 2 en Martínez a $20.000 + llegan 2 a $22.500 → $21.250.
    const plan = planCargaId(resultado([fila([{ talle: 'L', cantidad: 2 }])]), estado(), {});
    const op = plan.items[0].opciones[0];
    if (op.accion?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    const a = op.accion.ajuste!;
    expect(a.costos.map((c) => c.talle)).toEqual(['S', 'M', 'XL']);
    expect(a.ponderados).toEqual([{ id: 'gid://shopify/ProductVariant/L', talle: 'L', stock: 2, suma: 2, actual: 20000, costo: 21250 }]);
    expect(a.conservan).toEqual([]);
    expect(resumenCarga(plan, {}).lineas[0]).toMatch(/costo promedio en L \$ 21\.250,00/);
  });
  it('promedio con centavos; sin costo actual no se inventa: conserva el suyo y se avisa', () => {
    expect(costoPromedio(3, 27561.63, 1, 22500)).toBe(26296.22);
    const p = remera([variante('S', 0), variante('L', 2, { costo: null })]);
    const op = planCargaId(resultado([fila([{ talle: 'L', cantidad: 2 }])]), estado(p), {}).items[0].opciones[0];
    if (op.accion?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(op.accion.ajuste!.ponderados).toEqual([]);
    expect(op.avisos.join(' ')).toMatch(/Talle L: ya tenía 2 en Martínez y su costo actual es cero o desconocido/);
  });
  it('bloquea lo que no se puede cargar sin adivinar', () => {
    const casos: [FilaChecklist, EstadoCargaId, RegExp][] = [
      [fila(null), { locationId: LOC, porCodigo: { CTO0325003: [] }, productos: {} }, /escribí el remito con los talles/],
      // 21-nov-2026: con el producto en Shopify, se escriben los talles en la vista previa.
      [fila(null), estado(), /escribí arriba cuántas unidades llegaron de cada talle/],
      [fila([{ talle: 'S', cantidad: 0, retirado: 2 }], { retirado: 2 }), estado(), /salió para órdenes/],
      [fila([{ talle: 'S', cantidad: 2 }]), { locationId: LOC, porCodigo: { CTO0325003: [] }, productos: {} }, /crealo desde Sincronización/],
      [fila([{ talle: 'XXL', cantidad: 2 }]), estado(), /no existe el talle XXL/],
      [fila([{ talle: 'S', cantidad: 2 }]), estado({ ...remera(), vendor: 'Vans' }), /no de Converse ni Le Coq/],
    ];
    for (const [f, e, motivo] of casos) {
      const [it] = planCargaId(resultado([f]), e, {}).items;
      expect(it.estado).toBe('bloqueado');
      expect(it.motivo).toMatch(motivo);
    }
  });
  it('talle único (16-nov-2026, gax: MA5672FF7): «TU» del remito va a la variante única de un producto sin talles', () => {
    const mochila = remera([variante('Default Title', 4)]);
    const [it] = planCargaId(resultado([fila([{ talle: 'TU', cantidad: 2 }])]), estado(mochila), {}).items;
    expect(it.estado).toBe('listo');
    const a = it.opciones[0].accion!;
    if (a.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(a.lineas).toEqual([{ talle: 'Default Title', inventoryItemId: 'gid://shopify/InventoryItem/Default Title', actual: 4, suma: 2 }]);
    // Un producto con talles de verdad sigue sin aceptar TU.
    expect(planCargaId(resultado([fila([{ talle: 'TU', cantidad: 2 }])]), estado(), {}).items[0].motivo).toMatch(/no existe el talle TU/);
  });
  it('talle que no existe (19-nov-2026, gax: medias LAN0122018P, la foto leyó «12» y en Shopify son 1 y 2): se elige en qué talle entra', () => {
    const medias: ProductoId = {
      id: 'gid://shopify/Product/7', titulo: 'Medias Le Coq Sportif Tripack Poliester X6', vendor: 'Le Coq Sportif', estado: 'ACTIVE', etiquetas: ['LAN0122018P'],
      variantes: [variante('1', 0), variante('2', 3)],
    };
    const r = resultado([fila([{ talle: '12', cantidad: 1 }], { codigo: 'LAN0122018P', descripcion: 'TRIPACK POLIESTER' })], [{ ...renglon(28877, 'LAN0122018P'), descripcion: 'TRIPACK POLIESTER' }]);
    const e = estado(medias, 'LAN0122018P');
    const [it] = planCargaId(r, e, {}).items;
    expect(it.estado).toBe('bloqueado');
    expect(it.motivo).toMatch(/no existe el talle 12.*en Shopify tiene 1, 2.*Elegí arriba/);
    expect(it.talles?.[0]).toMatchObject({ talle: '12', destino: '', enShopify: ['1', '2'], problema: 'no existe el talle 12 en Shopify' });
    // Elegido el 1: se carga ahí (pack de 6 = 6 unidades), con aviso.
    const [ok] = planCargaId(r, e, {}, new Map(), new Map(), new Map(), new Map(), new Map([['LAN0122018P', { '12': '1' }]])).items;
    expect(ok.estado).toBe('listo');
    expect(ok.talles?.[0]).toMatchObject({ destino: '1', destinoManual: true });
    const a = ok.opciones[0].accion!;
    if (a.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(a.lineas).toEqual([{ talle: '1', inventoryItemId: 'gid://shopify/InventoryItem/1', actual: 0, suma: 6 }]);
    expect(ok.opciones[0].avisos.join(' ')).toMatch(/Talle elegido a mano: 12 → 1/);
    // Un talle que existe muestra igual los talles de Shopify, con el automático elegido.
    const [s] = planCargaId(resultado([fila([{ talle: 'L', cantidad: 1 }])]), estado(), {}).items;
    expect(s.talles?.[0]).toMatchObject({ destino: 'L', destinoManual: false, enShopify: ['S', 'M', 'L', 'XL'] });
  });
  it('una sola vez: lo ya cargado no se vuelve a cargar, ni desde otra entrega con la misma mercadería', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 2 }])]);
    const marca: CargaFamily = { estado: 'cargada', fecha: '2026-11-12T15:00:00Z', firma: firmaCargaId('2026-11-10', '0013-00125274', r.checklist[0]) };
    expect(planCargaId(r, estado(), { 'F-0011-00139953|CTO0325003': marca }).items[0].estado).toBe('cargado');
    expect(planCargaId(r, estado(), { 'F-otra|CTO0325003': marca }).items[0]).toMatchObject({ estado: 'bloqueado', motivo: expect.stringMatching(/otra entrega/) });
    expect(estadoCargaFactura(r, { 'F-0011-00139953|CTO0325003': marca })).toEqual({ cargados: 1, noLlego: [], pendientes: [], total: 1, completa: true });
  });
  it('lo que no llegó cuenta como terminado y la entrega cargada pasa a las cerradas (gax, 14-nov-2026)', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 2 }]), { ...fila([{ talle: '9', cantidad: 1 }]), codigo: 'RBK1100033527' }]);
    const marca: CargaFamily = { estado: 'cargada', fecha: '2026-11-12T15:00:00Z', firma: 'x' };
    const cargas = { 'F-0011-00139953|CTO0325003': marca };
    expect(estadoCargaFactura(r, cargas)).toEqual({ cargados: 1, noLlego: [], pendientes: ['RBK1100033527'], total: 2, completa: false });
    const e = estadoCargaFactura(r, cargas, { 'F-0011-00139953|RBK1100033527': { fecha: 'x' }, 'F-otra|CTO0325003': { fecha: 'x' } });
    expect(e).toEqual({ cargados: 1, noLlego: ['RBK1100033527'], pendientes: [], total: 2, completa: true });
    // Lo cargado manda sobre «no llegó».
    expect(estadoCargaFactura(r, cargas, { 'F-0011-00139953|CTO0325003': {} }).noLlego).toEqual([]);
    const con = (semaforo: string) => ({ ...r, semaforo }) as ResultadoFactura;
    expect(entregaArchivada(con('observaciones'), e)).toBe(true);
    expect(entregaArchivada(con('ok'), e)).toBe(true);
    expect(entregaArchivada(con('reclamar'), e)).toBe(false);
    expect(entregaArchivada(con('incompleta'), e)).toBe(false);
    expect(entregaArchivada(con('ok'), { completa: false })).toBe(false);
    // A mano: cerrada aunque falte cargar (Kappa a mano) o con reclamo; abierta aunque esté toda cargada.
    expect(entregaArchivada(con('reclamar'), { completa: false }, 'cerrada')).toBe(true);
    expect(entregaArchivada(con('ok'), e, 'abierta')).toBe(false);
    expect(entregaArchivada(con('ok'), null)).toBe(false);
    // iD y Target (21-nov-2026, gax): con algo sin cargar, cerrarla a mano no vale.
    expect(entregaArchivada(con('ok'), { completa: false }, 'cerrada', true)).toBe(false);
    expect(entregaArchivada(con('reclamar'), e, 'cerrada', true)).toBe(true);
  });
  it('la cantidad de cada talle viene del remito y se puede escribir a mano (gax, 12-nov-2026)', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 2 }, { talle: 'XL', cantidad: 2, retirado: 1 }], { retirado: 1 })]);
    expect(cantidades(planCargaId(r, estado(), {}).items[0].talles)).toEqual([{ talle: 'S', cantidad: 2, original: 2 }, { talle: 'XL', cantidad: 2, original: 2 }]);
    const plan = planCargaId(r, estado(), {}, new Map(), new Map([['CTO0325003', { XL: 3 }]]));
    const [it] = plan.items;
    expect(cantidades(it.talles)).toEqual([{ talle: 'S', cantidad: 2, original: 2 }, { talle: 'XL', cantidad: 3, original: 2 }]);
    expect(it.unidades).toBe(5);
    const a = it.opciones[0].accion!;
    if (a.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(a.lineas.map((l) => [l.talle, l.suma])).toEqual([['S', 2], ['XL', 3]]);
    const avisos = it.opciones[0].avisos.join(' ');
    expect(avisos).toMatch(/Cantidad escrita a mano: XL 2→3/);
    expect(avisos).not.toMatch(/Salieron 1 para órdenes/);
    // La firma sigue siendo la del remito: la misma mercadería no se carga dos veces aunque se cambie la cantidad.
    expect(it.firma).toBe(firmaCargaId('2026-11-10', '0013-00125274', r.checklist[0]));
    const cero = planCargaId(r, estado(), {}, new Map(), new Map([['CTO0325003', { S: 0, XL: 0 }]])).items[0];
    expect(cero).toMatchObject({ estado: 'bloqueado', motivo: expect.stringMatching(/Pusiste 0/) });
    expect(cero.talles).toHaveLength(2);
  });
  it('sin precio que llegue al 50% el artículo no entra en la carga; con el precio, sí', () => {
    const plan = planCargaId(resultado([fila([{ talle: 'S', cantidad: 2 }])], [renglon(30000)]), estado(), {});
    expect(accionesElegidas(plan, {})).toEqual([]);
    expect(resumenCarga(plan, {}).reposiciones).toBe(0);
    const el = { CTO0325003: { clave: plan.items[0].opciones[0].clave, precio: 69900 } };
    const [x] = accionesElegidas(plan, el);
    expect(x.accion.tipo === 'reposicion' && x.accion.ajuste?.precio).toBe(69900);
    expect(resumenCarga(plan, el).lineas[0]).toMatch(/precio de toda la curva \$ 59\.900,00 → \$ 69\.900,00/);
  });
});

describe('iD: la foto del remito no trae un artículo de la factura (25-nov-2026, factura 0011-00140160)', () => {
  it('avisa que se arma con lo facturado y cómo corregirlo', () => {
    const r = { ...resultado([fila([{ talle: 'L', cantidad: 2 }])]), difRemito: [{ codigo: 'CTO0325003', factura: 4, remito: 0 }] } as ResultadoFactura;
    const plan = planCargaId(r, estado(), {});
    const av = plan.avisos.join(' ');
    expect(av).toMatch(/El remito leído no trae CTO0325003 \(factura 4\): se arma con lo facturado\..*Ver o corregir.*no llegó/);
    expect(av).not.toMatch(/se carga lo del remito/);
    const otro = planCargaId({ ...r, difRemito: [{ codigo: 'CTO0325003', factura: 4, remito: 3 }] } as ResultadoFactura, estado(), {});
    expect(otro.avisos.join(' ')).toMatch(/se carga lo del remito/);
  });
});

describe('iD: carga después de confirmar (precio y costo ANTES del stock)', () => {
  const setOk = () => ({ inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: 'x' }, userErrors: [] } });
  function deps(gql: DepsCarga['gql'], precios: (v: unknown) => Promise<unknown>) {
    return {
      gql,
      reservar: vi.fn(async () => ({ ok: true })),
      terminar: vi.fn(async () => undefined),
      liberar: vi.fn(async () => undefined),
      clave: vi.fn(() => 'clave-1'),
      antes: precioYCostoAntes(precios as never),
    };
  }
  const plan = () => planCargaId(resultado([fila([{ talle: 'S', cantidad: 2 }])], [renglon(30000)]), estado(), {});
  const elecciones = (p = plan()) => ({ CTO0325003: { clave: p.items[0].opciones[0].clave, precio: 69900 } });

  it('cambia el precio de toda la curva y el costo de los talles sin stock propio, y después suma el stock', async () => {
    const orden: string[] = [];
    const gql = shopify({ inventorySetQuantities: () => { orden.push('stock'); return setOk(); } });
    const precios = vi.fn(async (v: unknown) => { orden.push('precios'); return { productVariantsBulkUpdate: { userErrors: [], productVariants: [], v } }; });
    const p = plan();
    const [res] = await ejecutarCargaFamily(p, elecciones(p), deps(gql, precios));
    expect(res.estado).toBe('cargada');
    expect(orden).toEqual(['precios', 'stock']);
    type Variante = { id: string; price?: string; inventoryItem?: { cost: string } };
    const enviado = precios.mock.calls[0][0] as { productId: string; variants: Variante[] };
    expect(enviado.productId).toBe('gid://shopify/Product/1');
    const porTalle: Record<string, Variante> = Object.fromEntries(enviado.variants.map((v) => [v.id.split('/').pop(), v]));
    // Precio en los 4 talles; costo (con centavos) solo en S, M y XL: L tiene stock en Martínez y no llega.
    expect(Object.values(porTalle).every((v) => v.price === '69900')).toBe(true);
    expect(porTalle.S.inventoryItem).toEqual({ cost: '27000.00' });
    expect(porTalle.L.inventoryItem).toBeUndefined();
    expect(res.mensaje).toMatch(/Cambiado precio de toda la curva/);
    expect(res.detalle?.precio?.nuevo).toBe(69900);
    expect(res.detalle?.costos.join(' ')).toMatch(/27\.000,00 en S, M, XL/);
  });
  it('el promedio viaja con el stock y el costo que se leyeron, para que el servidor los vuelva a comprobar', async () => {
    const gql = shopify({ inventorySetQuantities: setOk });
    const precios = vi.fn(async () => ({ productVariantsBulkUpdate: { userErrors: [], productVariants: [] } }));
    const p = planCargaId(resultado([fila([{ talle: 'L', cantidad: 2 }])]), estado(), {});
    const [res] = await ejecutarCargaFamily(p, {}, deps(gql, precios));
    expect(res.estado).toBe('cargada');
    const enviado = (precios.mock.calls[0] as unknown[])[0] as { variants: { id: string; inventoryItem?: { cost: string }; ponderado?: unknown }[] };
    expect(enviado.variants.find((v) => v.id.endsWith('/L'))).toEqual({
      id: 'gid://shopify/ProductVariant/L', inventoryItem: { cost: '21250.00' },
      ponderado: { stock: 2, costoAnterior: '20000', unidades: 2, costoNuevo: '22500' },
    });
    expect(res.mensaje).toMatch(/costo promedio en L/);
    expect(res.detalle?.costos).toContain('L $ 21.250,00 (promedio)');
    expect(res.detalle?.precio).toBeUndefined();
  });
  it('si Shopify rechaza el precio o el costo, no se suma el stock y la marca se libera', async () => {
    const gql = shopify({ inventorySetQuantities: setOk });
    const precios = vi.fn(async () => { throw new Error('Hay stock en Martínez y su costo está protegido. Volvé a analizar para conservarlo.'); });
    const p = plan();
    const d = deps(gql, precios);
    const [res] = await ejecutarCargaFamily(p, elecciones(p), d);
    expect(res.estado).toBe('error');
    expect(res.mensaje).toMatch(/No se sumó el stock/);
    expect(gql).not.toHaveBeenCalled();
    expect(d.liberar).toHaveBeenCalledWith('CTO0325003');
  });
  it('si no se sabe si se cambió el precio, queda dudosa y no suma el stock', async () => {
    const gql = shopify({ inventorySetQuantities: setOk });
    const precios = vi.fn(async () => { throw new Error('Shopify no confirmó la actualización. Volvé a analizar.'); });
    const p = plan();
    const d = deps(gql, precios);
    const [res] = await ejecutarCargaFamily(p, elecciones(p), d);
    expect(res.estado).toBe('dudosa');
    expect(gql).not.toHaveBeenCalled();
    expect(d.liberar).not.toHaveBeenCalled();
  });
  it('sin nada para cambiar (margen verde y costos iguales) no llama a precios', async () => {
    const igual = remera([variante('S', 0, { costo: 22500 })]);
    const p = planCargaId(resultado([fila([{ talle: 'S', cantidad: 2 }])]), estado(igual), {});
    const gql = shopify({ inventorySetQuantities: setOk });
    const precios = vi.fn();
    const [res] = await ejecutarCargaFamily(p, {}, deps(gql, precios));
    expect(res.estado).toBe('cargada');
    expect(precios).not.toHaveBeenCalled();
  });
});

describe('iD: el ajuste se arma solo con precio de lista', () => {
  it('sin precio de lista en la factura no revisa margen ni costo (y lo avisa)', () => {
    const plan = planCargaId(resultado([fila([{ talle: 'S', cantidad: 2 }])], [renglon(0)]), estado(), {});
    const op = plan.items[0].opciones[0];
    expect(op.accion?.tipo === 'reposicion' && op.accion.ajuste).toBeFalsy();
    expect(op.avisos.join(' ')).toMatch(/no trae el precio de lista/);
  });
});

describe('iD: lo que llegó y ya está vendido en iD se separa (gax, 12-nov-2026)', () => {
  const orden = (nombre: string, cantidad: number, fecha: string, extra: Partial<OrdenPendienteId> = {}): OrdenPendienteId => ({ nombre, fecha, cantidad, cuenta: true, ...extra });
  const conPendientes = (pend: Record<string, OrdenPendienteId[]>): EstadoCargaId => ({ ...estado(), pendientesId: pend });
  const VS = 'gid://shopify/ProductVariant/S', VXL = 'gid://shopify/ProductVariant/XL';

  it('separa de la venta más vieja a la más nueva, sin pasar lo que llegó; lo marcado «-1» ya cuenta como separado', () => {
    const ords = [orden('#2', 2, '2026-11-02'), orden('#1', 1, '2026-11-01')].sort((a, b) => a.fecha.localeCompare(b.fecha));
    expect(separarDe(ords, 2, 0)).toEqual({ cantidad: 2, ordenes: [{ nombre: '#1', cantidad: 1 }, { nombre: '#2', cantidad: 1 }], retirados: [] });
    expect(separarDe(ords, 5, 0)).toEqual({ cantidad: 3, ordenes: [{ nombre: '#1', cantidad: 1 }, { nombre: '#2', cantidad: 2 }], retirados: [] });
    // El depósito ya sacó 1 («-1») para la #1: de lo que queda se separan las 2 de la #2.
    expect(separarDe(ords, 2, 1)).toEqual({ cantidad: 2, ordenes: [{ nombre: '#2', cantidad: 2 }], retirados: [{ nombre: '#1', cantidad: 1 }] });
    expect(separarDe(ords, 1, 2)).toEqual({ cantidad: 1, ordenes: [{ nombre: '#2', cantidad: 1 }], retirados: [{ nombre: '#1', cantidad: 1 }, { nombre: '#2', cantidad: 1 }] });
    expect(separarDe([orden('#1', 1, '2026-11-01')], 2, 1)).toEqual({ cantidad: 0, ordenes: [], retirados: [{ nombre: '#1', cantidad: 1 }] });
    // «solucionar» o sin pagar: no se descuentan.
    expect(separarDe([orden('#9', 1, '2026-11-01', { cuenta: false, motivo: 'etiqueta solucionar' })], 2, 0).cantidad).toBe(0);
  });

  it('descuenta de la carga lo vendido y lo muestra; «cargarlo igual» suma todo', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 2 }, { talle: 'XL', cantidad: 2 }])]);
    const e = conPendientes({ [VS]: [orden('#210776', 1, '2026-10-29')], [VXL]: [orden('#205595', 1, '2026-07-16', { cuenta: false, motivo: 'etiqueta solucionar' })] });
    const op = planCargaId(r, e, {}).items[0].opciones[0];
    if (op.accion?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(op.accion.lineas.map((l) => [l.talle, l.suma])).toEqual([['S', 1], ['XL', 2]]);
    expect(op.separar).toEqual([{ talle: 'S', cantidad: 1, ordenes: [{ nombre: '#210776', cantidad: 1 }] }]);
    expect(op.separarAplicado).toBe(true);
    expect(op.avisos.join(' ')).toMatch(/no descuento: XL #205595 \(etiqueta solucionar\)/);
    const plan = planCargaId(r, e, {});
    expect(resumenCarga(plan, {}).lineas[0]).toMatch(/sumar 3 u\..*separar para órdenes de iD S ×1 \(#210776\)/);

    const igual = planCargaId(r, e, {}, new Map([['CTO0325003', 'igual' as const]])).items[0].opciones[0];
    if (igual.accion?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(igual.accion.lineas.map((l) => [l.talle, l.suma])).toEqual([['S', 2], ['XL', 2]]);
    expect(igual.separarAplicado).toBe(false);
  });

  it('si todo lo que llegó está vendido, no se suma stock pero el precio y el costo se actualizan igual', async () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 1 }])], [renglon(30000)]);
    const e = conPendientes({ [VS]: [orden('#210776', 2, '2026-10-29')] });
    const plan = planCargaId(r, e, {});
    const it = plan.items[0];
    expect(it.estado).toBe('listo');
    const op = it.opciones[0];
    if (op.accion?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(op.accion.lineas).toEqual([]);
    expect(op.separar).toEqual([{ talle: 'S', cantidad: 1, ordenes: [{ nombre: '#210776', cantidad: 1 }] }]);
    expect(op.avisos.join(' ')).toMatch(/no se suma stock en Martínez, pero se actualizan el precio y el costo/);
    // Margen bajo el 50%: sin precio nuevo no se carga; con precio, se cambia precio y costo y no se toca el stock.
    expect(accionesElegidas(plan, {})).toEqual([]);
    const el = { CTO0325003: { clave: op.clave, precio: 69900 } };
    expect(resumenCarga(plan, el).lineas[0]).toMatch(/no se suma stock \(vendido en iD\), solo precio y costo de .*→ \$ 69\.900,00/);
    const gql = shopify({});
    const precios = vi.fn(async () => ({ productVariantsBulkUpdate: { userErrors: [], productVariants: [] } }));
    const [res] = await ejecutarCargaFamily(plan, el, {
      gql, reservar: vi.fn(async () => ({ ok: true })), terminar: vi.fn(async () => undefined), liberar: vi.fn(async () => undefined),
      clave: () => 'k', antes: precioYCostoAntes(precios as never),
    });
    expect(res.estado).toBe('cargada');
    expect(res.mensaje).toMatch(/Cambiado precio de toda la curva.*No se sumó stock: todo lo que llegó está vendido en iD/);
    expect(precios).toHaveBeenCalledOnce();
    expect(gql).not.toHaveBeenCalled();
    expect(planCargaId(r, e, {}, new Map([['CTO0325003', 'igual' as const]])).items[0].opciones[0].accion).toMatchObject({ lineas: [{ talle: 'S', suma: 1 }] });
  });

  it('si todo está vendido y no hay precio ni costo para cambiar, queda bloqueado con la opción de cargarlo igual', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 1 }])], []);
    const e = conPendientes({ [VS]: [orden('#210776', 2, '2026-10-29')] });
    const it = planCargaId(r, e, {}).items[0];
    expect(it.estado).toBe('bloqueado');
    expect(it.motivo).toMatch(/ya está vendido en iD/);
    expect(it.opciones[0].separar).toHaveLength(1);
    expect(accionesElegidas(planCargaId(r, e, {}), {})).toEqual([]);
    expect(planCargaId(r, e, {}, new Map([['CTO0325003', 'igual' as const]])).items[0].estado).toBe('listo');
  });

  it('si no se pudieron leer las ventas de iD, se avisa y no se separa nada', () => {
    const plan = planCargaId(resultado([fila([{ talle: 'S', cantidad: 2 }])]), { ...estado(), errorPendientes: 'sin permiso' }, {});
    expect(plan.avisos.join(' ')).toMatch(/No pude leer las ventas pendientes de iD \(sin permiso\)/);
    const a = plan.items[0].opciones[0].accion;
    expect(a?.tipo === 'reposicion' && a.lineas[0].suma).toBe(2);
  });

  it('lee solo las preparaciones abiertas de iD, de órdenes no canceladas, con todas las páginas (solo lectura)', async () => {
    const fo = (id: string, status: string, order: object, lineas: object[], mas = false) => ({
      id, status, order, lineItems: { pageInfo: { hasNextPage: mas, endCursor: mas ? 'L1' : null }, nodes: lineas },
    });
    const pagada = (name: string, extra: object = {}) => ({ name, createdAt: `2026-11-0${name.length}T00:00:00Z`, cancelledAt: null, displayFinancialStatus: 'PAID', tags: ['pedido id'], ...extra });
    const linea = (id: string, q: number) => ({ remainingQuantity: q, variant: { id } });
    const gql = shopify({
      'fulfillmentOrders(': (v) => v.cursor
        ? { fulfillmentOrders: { pageInfo: sinPagina, nodes: [fo('F3', 'IN_PROGRESS', pagada('#3', { displayFinancialStatus: 'PENDING' }), [linea(VS, 1)])] } }
        : { fulfillmentOrders: { pageInfo: { hasNextPage: true, endCursor: 'C1' }, nodes: [
          fo('F1', 'OPEN', pagada('#1'), [linea(VS, 1), linea('gid://otra', 5)], true),
          fo('F2', 'OPEN', pagada('#22', { cancelledAt: '2026-11-02' }), [linea(VS, 1)]),
          fo('F4', 'ON_HOLD', pagada('#4'), [linea(VS, 1)]),
        ] } },
      'fulfillmentOrder(id': () => ({ fulfillmentOrder: { lineItems: { pageInfo: sinPagina, nodes: [linea(VXL, 2), linea(VS, 0)] } } }),
    });
    const out = await leerPendientesId('gid://shopify/Location/92732457203', new Set([VS, VXL]), gql);
    expect(out[VS]).toEqual([
      { nombre: '#1', fecha: '2026-11-02T00:00:00Z', cantidad: 1, cuenta: true },
      { nombre: '#3', fecha: '2026-11-02T00:00:00Z', cantidad: 1, cuenta: false, motivo: 'sin pagar' },
    ]);
    expect(out[VXL]).toEqual([{ nombre: '#1', fecha: '2026-11-02T00:00:00Z', cantidad: 2, cuenta: true }]);
    expect(gql.mock.calls[0][1]).toMatchObject({ q: 'assigned_location_id:92732457203' });
    expect(gql.mock.calls.every(([q]) => !/^\s*mutation/.test(q))).toBe(true);
  });
});

describe('iD: cargar y pasar la venta de iD a Martínez (gax, 12-nov-2026)', () => {
  const VS = 'gid://shopify/ProductVariant/S', VM = 'gid://shopify/ProductVariant/M';
  const fo = (id: string, abierta = true) => ({ id, lineaId: `${id}-linea`, abierta });
  const orden = (nombre: string, cantidad: number, extra: Partial<OrdenPendienteId> = {}): OrdenPendienteId => ({ nombre, fecha: '2026-11-01', cantidad, cuenta: true, ...extra });
  const pasar = new Map([['CTO0325003', 'pasar' as const]]);
  const deps = (gql: DepsCarga['gql']): DepsCarga => ({
    gql, reservar: vi.fn(async () => ({ ok: true })), terminar: vi.fn(async () => undefined), liberar: vi.fn(async () => undefined), clave: () => 'k',
  });
  const SUMA_OK = () => ({ inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: 'x' }, userErrors: [] } });

  it('lee la preparación de cada venta: abierta se puede mover; en preparación, no', async () => {
    const gql = shopify({
      'fulfillmentOrders(': () => ({ fulfillmentOrders: { pageInfo: sinPagina, nodes: [
        { id: 'F1', status: 'OPEN', order: { name: '#210855', createdAt: '2026-11-10', cancelledAt: null, displayFinancialStatus: 'PAID', tags: [] }, lineItems: { pageInfo: sinPagina, nodes: [{ id: 'L1', remainingQuantity: 1, variant: { id: VS } }] } },
        { id: 'F2', status: 'IN_PROGRESS', order: { name: '#210900', createdAt: '2026-11-11', cancelledAt: null, displayFinancialStatus: 'PAID', tags: [] }, lineItems: { pageInfo: sinPagina, nodes: [{ id: 'L2', remainingQuantity: 1, variant: { id: VS } }] } },
      ] } }),
    });
    const out = await leerPendientesId('gid://shopify/Location/1', new Set([VS]), gql);
    expect(out[VS].map((o) => o.fo)).toEqual([{ id: 'F1', lineaId: 'L1', abierta: true }, { id: 'F2', lineaId: 'L2', abierta: false }]);
  });

  it('suma todo a Martínez y anota qué venta pasa; la que está en preparación en iD se separa igual', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 2 }, { talle: 'M', cantidad: 1 }])]);
    const e: EstadoCargaId = { ...estado(), pendientesId: { [VS]: [orden('#210855', 1, { fo: fo('F1') })], [VM]: [orden('#210900', 1, { fo: fo('F2', false) })] } };
    const separado = planCargaId(r, e, {}).items[0].opciones[0];
    expect(separado.movibles).toBe(1);
    expect(separado.modoVenta).toBe('separar');
    const op = planCargaId(r, e, {}, pasar).items[0].opciones[0];
    if (op.accion?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(op.accion.lineas.map((l) => [l.talle, l.suma])).toEqual([['S', 2]]);
    expect(op.accion.mover).toEqual([{ talle: 'S', orden: '#210855', cantidad: 1, foId: 'F1', lineaId: 'F1-linea', inventoryItemId: 'gid://shopify/InventoryItem/S' }]);
    expect(op.accion.separar).toEqual([{ talle: 'M', cantidad: 1, ordenes: [{ nombre: '#210900', cantidad: 1, fo: fo('F2', false) }] }]);
    expect(op.modoVenta).toBe('pasar');
    expect(op.avisos.join(' ')).toMatch(/No puedo pasar a Martínez la venta de M #210900/);
    expect(op.avisos.join(' ')).toMatch(/la venta de S #210855 pasa de iD a Martínez/);
    const linea = resumenCarga(planCargaId(r, e, {}, pasar), { CTO0325003: { clave: op.clave, precio: 59900 } }).lineas[0];
    expect(linea).toMatch(/sumar 2 u\..*separar para órdenes de iD M ×1 \(#210900\).*después pasar la venta de iD a .*S ×1 \(#210855\)/);
  });

  it('después de sumar el stock mueve la venta (una llamada por preparación, con todos sus artículos)', async () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 1 }, { talle: 'M', cantidad: 1 }])], [renglon(20000)]);
    const e: EstadoCargaId = { ...estado(), pendientesId: { [VS]: [orden('#210855', 1, { fo: fo('F1') })], [VM]: [{ ...orden('#210855', 1), fo: { id: 'F1', lineaId: 'L-M', abierta: true } }] } };
    const plan = planCargaId(r, e, {}, pasar);
    const orden_: string[] = [];
    const gql = shopify({
      'inventorySetQuantities(': () => { orden_.push('stock'); return SUMA_OK(); },
      'fulfillmentOrderMove(': () => { orden_.push('mover'); return { fulfillmentOrderMove: { movedFulfillmentOrder: { id: 'F9', status: 'OPEN' }, userErrors: [] } }; },
    });
    const [res] = await ejecutarCargaFamily(plan, {}, deps(gql));
    expect(res.estado).toBe('cargada');
    expect(orden_).toEqual(['stock', 'mover']);
    const llamada = gql.mock.calls.find(([q]) => q.includes('fulfillmentOrderMove('))!;
    expect(llamada[1]).toEqual({ id: 'F1', loc: LOC, items: [{ id: 'F1-linea', quantity: 1 }, { id: 'L-M', quantity: 1 }] });
    expect(res.mensaje).toMatch(/Venta pasada de iD a .*S #210855, M #210855/);
    // Resultado ordenado (gax, 16-nov-2026): unidades sumadas por talle y ventas que quedaron en Martínez.
    expect(res.detalle?.sumados.map((t) => [t.talle, t.suma])).toEqual([['S', 1], ['M', 1]]);
    expect(res.detalle?.pasadas).toEqual([{ talle: 'S', cantidad: 1, orden: '#210855' }, { talle: 'M', cantidad: 1, orden: '#210855' }]);
  });

  it('el disponible de iD queda como estaba: la unidad que Shopify libera al mover no se suma (gax, 12-nov-2026)', async () => {
    const ID = 'gid://shopify/Location/ID', IS = 'gid://shopify/InventoryItem/S';
    const r = resultado([fila([{ talle: 'S', cantidad: 1 }])], [renglon(20000)]);
    const e: EstadoCargaId = { ...estado(), idLocationId: ID, pendientesId: { [VS]: [orden('#210837', 1, { fo: fo('F1') })] } };
    const plan = planCargaId(r, e, {}, pasar);
    expect(plan.idLocationId).toBe(ID);
    expect(plan.items[0].opciones[0].avisos.join(' ')).toMatch(/El stock de iD queda como estaba/);
    const correr = async (antes: number, despues: number) => {
      let lecturas = 0;
      const gql = shopify({
        'nodes(ids:': () => ({ nodes: [{ id: IS, inventoryLevel: { quantities: [{ name: 'available', quantity: lecturas++ === 0 ? antes : despues }] } }] }),
        'inventorySetQuantities(': SUMA_OK,
        'fulfillmentOrderMove(': () => ({ fulfillmentOrderMove: { movedFulfillmentOrder: { id: 'F9', status: 'OPEN' }, userErrors: [] } }),
      });
      const [res] = await ejecutarCargaFamily(plan, {}, deps(gql));
      return { res, sets: gql.mock.calls.filter(([q]) => q.includes('inventorySetQuantities(')).map(([, v]) => v as { input: { reason: string; quantities: unknown[] } }) };
    };
    // Estaba en 0 y Shopify la dejó en 1: vuelve a 0, con control de cambio.
    const a = await correr(0, 1);
    expect(a.sets).toHaveLength(2);
    expect(a.sets[1].input).toEqual({ name: 'available', reason: 'correction', quantities: [{ inventoryItemId: IS, locationId: ID, quantity: 0, changeFromQuantity: 1 }] });
    expect(a.res.mensaje).not.toMatch(/Revisá el stock de iD/);
    // Shopify no la liberó: no se toca nada.
    const b = await correr(0, 0);
    expect(b.sets).toHaveLength(1);
    // No se pudo leer: se avisa para revisarlo a mano.
    const sinLeer = shopify({
      'nodes(ids:': () => { throw new Error('caído'); },
      'inventorySetQuantities(': SUMA_OK,
      'fulfillmentOrderMove(': () => ({ fulfillmentOrderMove: { movedFulfillmentOrder: { id: 'F9', status: 'OPEN' }, userErrors: [] } }),
    });
    const [c] = await ejecutarCargaFamily(plan, {}, deps(sinLeer));
    expect(c.mensaje).toMatch(/Venta pasada.*Revisá el stock de iD de S/);
    expect(c.detalle?.pasadas).toHaveLength(1);
    expect(c.detalle?.notas.join(' ')).toMatch(/Revisá el stock de iD de S/);
  });

  it('sin el permiso de Shopify avisa qué falta; si el stock no se sumó, no mueve nada', async () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 1 }])], [renglon(20000)]);
    const e: EstadoCargaId = { ...estado(), pendientesId: { [VS]: [orden('#210855', 1, { fo: fo('F1') })] } };
    const plan = planCargaId(r, e, {}, pasar);
    const sinPermiso = shopify({
      'inventorySetQuantities(': SUMA_OK,
      'fulfillmentOrderMove(': () => { throw new Error('Shopify error: Access denied for fulfillmentOrderMove field. Required access: `write_merchant_managed_fulfillment_orders` (ACCESS_DENIED)'); },
    });
    const [a] = await ejecutarCargaFamily(plan, {}, deps(sinPermiso));
    expect(a.estado).toBe('cargada');
    expect(a.mensaje).toMatch(/le falta el permiso write_merchant_managed_fulfillment_orders.*El stock ya quedó sumado: pasala a mano/);

    const falla = shopify({ 'inventorySetQuantities(': () => ({ inventorySetQuantities: { userErrors: [{ code: 'X', message: 'no' }] } }) });
    const [b] = await ejecutarCargaFamily(plan, {}, deps(falla));
    expect(b.estado).toBe('error');
    expect(falla.mock.calls.some(([q]) => q.includes('fulfillmentOrderMove('))).toBe(false);
  });
});

describe('iD: qué órdenes ya pueden salir con lo que llegó (gax, 12-nov-2026)', () => {
  const VS = 'gid://shopify/ProductVariant/S', VM = 'gid://shopify/ProductVariant/M';
  const ord = (nombre: string, lineaId: string, extra: Partial<OrdenPendienteId> = {}): OrdenPendienteId =>
    ({ nombre, fecha: '2026-11-01', cantidad: 1, cuenta: true, fo: { id: `F-${nombre}`, lineaId, abierta: true }, ...extra });

  it('una orden que solo esperaba esto puede salir; otra que espera más artículos de iD, todavía no', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 1 }, { talle: 'M', cantidad: 1 }])]);
    const e: EstadoCargaId = {
      ...estado(),
      pendientesId: { [VS]: [ord('#210952', 'L1')], [VM]: [ord('#210837', 'L2')] },
      ordenesId: {
        '#210952': [{ lineaId: 'L1', titulo: 'Remera Mujer Converse Retro', talle: 'S', cantidad: 1 }],
        '#210837': [
          { lineaId: 'L2', titulo: 'Remera Converse Patch', talle: 'M', cantidad: 1 },
          { lineaId: 'L3', titulo: 'Remera Le Coq Monochrome Negro', talle: 'S', cantidad: 1 },
          { lineaId: 'L4', titulo: 'Remera Converse Nova', talle: 'S', cantidad: 2 },
        ],
      },
    };
    const separado = planCargaId(r, e, {});
    expect(ordenesQueSalen(separado, {})).toEqual([
      { orden: '#210952', puede: true, pasa: false, llega: ['Remera Mujer Converse Retro S'], faltan: [] },
      { orden: '#210837', puede: false, pasa: false, llega: ['Remera Converse Patch M'], faltan: ['Remera Le Coq Monochrome Negro S', 'Remera Converse Nova S ×2'] },
    ]);
    // Pasando la venta a Martínez se avisa; destildado no cuenta (queda para otro día).
    const pasa = planCargaId(r, e, {}, new Map([['CTO0325003', 'pasar' as const]]));
    expect(ordenesQueSalen(pasa, {})[0]).toMatchObject({ orden: '#210952', puede: true, pasa: true, llega: ['Remera Mujer Converse Retro S (pasa a Martínez)'] });
    expect(ordenesQueSalen(pasa, { CTO0325003: { clave: 'no' } })).toEqual([]);
    // «Cargarlo igual»: ya se separó antes, no se dice nada de esas órdenes.
    expect(ordenesQueSalen(planCargaId(r, e, {}, new Map([['CTO0325003', 'igual' as const]])), {})).toEqual([]);
  });

  it('lo marcado «-1» en el remito también cuenta para la orden', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 1, retirado: 1 }])]);
    const e: EstadoCargaId = { ...estado(), pendientesId: { [VS]: [ord('#1', 'L1')] }, ordenesId: { '#1': [{ lineaId: 'L1', titulo: 'Remera', talle: 'S', cantidad: 1 }] } };
    expect(ordenesQueSalen(planCargaId(r, e, {}), {})).toEqual([{ orden: '#1', puede: true, pasa: false, llega: ['Remera S (ya salió con la marca «-1»)'], faltan: [] }]);
  });

  it('lee todo lo que esas órdenes esperan de iD, no solo lo que llega', async () => {
    const gql = shopify({
      'fulfillmentOrders(': () => ({ fulfillmentOrders: { pageInfo: sinPagina, nodes: [
        { id: 'F1', status: 'OPEN', order: { name: '#210837', createdAt: '2026-10-30', cancelledAt: null, displayFinancialStatus: 'PAID', tags: [] }, lineItems: { pageInfo: sinPagina, nodes: [
          { id: 'L1', remainingQuantity: 1, productTitle: 'Remera Converse Patch', variantTitle: 'S', variant: { id: VS } },
          { id: 'L2', remainingQuantity: 1, productTitle: 'Remera Le Coq Monochrome', variantTitle: 'S', variant: { id: 'gid://otra' } },
        ] } },
        { id: 'F2', status: 'OPEN', order: { name: '#999', createdAt: '2026-10-30', cancelledAt: null, displayFinancialStatus: 'PAID', tags: [] }, lineItems: { pageInfo: sinPagina, nodes: [
          { id: 'L9', remainingQuantity: 1, productTitle: 'Otra', variantTitle: 'M', variant: { id: 'gid://otra' } },
        ] } },
      ] } }),
    });
    const { porOrden } = await leerVentasId('gid://shopify/Location/1', new Set([VS]), gql);
    expect(porOrden).toEqual({ '#210837': [
      { lineaId: 'L1', titulo: 'Remera Converse Patch', talle: 'S', cantidad: 1 },
      { lineaId: 'L2', titulo: 'Remera Le Coq Monochrome', talle: 'S', cantidad: 1 },
    ] });
  });
});

describe('iD: packs (13-nov-2026, gax: «la factura dice por 6, es porque son 6 bandas»)', () => {
  // Caso real: LAN0122026P. La factura dice «LCS SHORT SPORTY WRISTBAND BLA» (sin X6) a $28.877 el pack (−10% = $25.989,30);
  // en Shopify «Muñequeras Le Coq Sportif Lcs Short Sp Wristband X6 Blanco» a $11.900, con costo $4.331,55 (= 25.989,30 ÷ 6).
  const COD = 'LAN0122026P';
  const VTU = 'gid://shopify/ProductVariant/TU';
  const munequera = (titulo = 'Muñequeras Le Coq Sportif Lcs Short Sp Wristband X6 Blanco', disponible: number | null = 0, extra: Partial<VarianteId> = {}): ProductoId => ({
    id: 'gid://shopify/Product/77', titulo, vendor: 'Le Coq Sportif', estado: 'ACTIVE', etiquetas: [COD],
    variantes: [variante('TU', disponible, { sku: `${COD}-TU`, precio: 11900, costo: 4331.55, ...extra })],
  });
  const renPack = (descripcion = 'LCS SHORT SPORTY WRISTBAND BLA'): RenglonFactura => ({ codigo: COD, descripcion, precioUnitario: 28877, bonificacion: 10, cantidad: 1, total: 25989.3 });
  const filaPack = (talles: FilaChecklist['talles'] = [{ talle: 'TU', cantidad: 1 }], descripcion = 'LCS SHORT SPORTY WRISTBAND BLA', extra: Partial<FilaChecklist> = {}) =>
    fila(talles, { codigo: COD, descripcion, cantidad: 1, ...extra });
  const pack = (descripcion?: string) => resultado([filaPack(undefined, descripcion)], [renPack(descripcion)]);
  const repo = (it: ItemCarga) => {
    const a = it.opciones[0].accion;
    if (a?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    return a;
  };

  it('cuántas unidades trae: el «X6» de la factura o del nombre en Shopify (la regla de Sincronización); el «X6» nunca se lee del código', () => {
    expect(packDeCarga('LCS SHORT SPORTY WRISTBAND X 6 BLUE', ['Muñequeras Le Coq Sportif Wristband Azul'])).toEqual({ unidades: 6, fuente: 'lo dice la factura' });
    expect(packDeCarga('LCS SHORT SPORTY WRISTBAND BLA', ['Muñequeras Le Coq Sportif Lcs Short Sp Wristband X6 Blanco'])).toEqual({ unidades: 6, fuente: 'lo dice el nombre en Shopify' });
    expect(packDeCarga('PUMAS SOCKS X 6 CON ANTIDES', ['Medias Le Coq Sportif Pumas Socks X6 Negro'])).toEqual({ unidades: 6, fuente: 'lo dice la factura y el nombre en Shopify' });
    expect(packDeCarga('LCS SOCKS X 6', ['Medias Le Coq Sportif Socks X3'])).toEqual({ unidades: 1, fuente: '', error: 'No sé cuántas unidades trae cada pack: la factura dice packs de 6 y el nombre en Shopify dice 3.' });
    expect(packDeCarga('LCS SOCKS', ['Medias X3', 'Medias X6']).error).toMatch(/el nombre en Shopify dice 3 y 6/);
    expect(packDeCarga('REMERA 3XL', ['Remera A123X6 Negro'])).toEqual({ unidades: 1, fuente: '' });
    // Lo escrito a mano manda, también para decir que no viene en pack.
    expect(packDeCarga('LCS SOCKS X 6', [], 12)).toEqual({ unidades: 12, fuente: 'lo escribiste a mano', manual: true });
    expect(packDeCarga('LCS SOCKS X 6', [], 1)).toEqual({ unidades: 1, fuente: 'lo escribiste a mano', manual: true });
  });

  it('caso real: 1 pack del remito se carga como 6 unidades, a $4.331,55 cada una; el margen por unidad da verde', () => {
    const r = pack();
    const plan = planCargaId(r, estado(munequera(), COD), {});
    const [it] = plan.items;
    expect(it.estado).toBe('listo');
    expect(it.unidades).toBe(6);
    expect(cantidades(it.talles)).toEqual([{ talle: 'TU', cantidad: 6, original: 6 }]);
    expect(it.pack).toEqual({ unidades: 6, fuente: 'lo dice el nombre en Shopify y la plantilla de iD', lista: 28877, bonificacion: 10, costo: 4331.55 });
    const a = repo(it);
    expect(a.lineas).toEqual([{ talle: 'TU', inventoryItemId: 'gid://shopify/InventoryItem/TU', actual: 0, suma: 6 }]);
    expect(a.pack).toBe(6);
    // Antes: costo $25.989,30 contra $11.900 = margen −164% y obligaba a un precio de $65.900.
    // Ahora: 1 − 4.331,55 / (11.900 / 1,21) = 56%. El sugerido por unidad (28.877 ÷ 6 × 2,27, al 900) es su precio de hoy.
    expect(a.ajuste).toMatchObject({ costoNuevo: 4331.55, precioActual: 11900, ok: true, sugerido: 11900, costos: [], ponderados: [] });
    expect(a.ajuste!.margen).toBeCloseTo(55.96, 1);
    expect(precioAEscribir(a.ajuste!)).toBeNull();
    expect(resumenCarga(plan, {}).lineas[0]).toMatch(/sumar 6 u\. \(vienen en packs de 6\) en «Muñequeras/);
    // La marca «una sola vez» sigue siendo la del remito (1 pack).
    expect(it.firma).toBe(firmaCargaId('2026-11-10', '0013-00125274', r.checklist[0]));
  });

  it('LAN0125034P: si lo dice la factura («X 6») alcanza; el costo nuevo por unidad va a los talles sin stock', () => {
    const it = planCargaId(pack('LCS SHORT SPORTY WRISTBAND X 6 BLUE'), estado(munequera('Muñequeras Le Coq Sportif Wristband Azul', 0, { costo: 4000 }), COD), {}).items[0];
    expect(it.pack).toMatchObject({ unidades: 6, fuente: 'lo dice la factura y la plantilla de iD' });
    const a = repo(it);
    expect(a.ajuste!.costoNuevo).toBe(4331.55);
    expect(a.ajuste!.costos).toEqual([{ id: VTU, talle: 'TU', actual: 4000 }]);
  });

  it('con stock en Martínez el costo promedio se hace por unidad', () => {
    // 2 a $4.000 + 6 a $4.331,55 = $4.248,66.
    const a = repo(planCargaId(pack(), estado(munequera(undefined, 2, { costo: 4000 }), COD), {}).items[0]);
    expect(a.ajuste!.ponderados).toEqual([{ id: VTU, talle: 'TU', stock: 2, suma: 6, actual: 4000, costo: 4248.66 }]);
  });

  it('lo marcado «-1» son unidades que salieron para órdenes (de un pack de 6 se cargan 5); lo escrito a mano va en unidades', () => {
    const r = resultado([filaPack([{ talle: 'TU', cantidad: 0, retirado: 1 }], undefined, { retirado: 1 })], [renPack()]);
    const it = planCargaId(r, estado(munequera(), COD), {}).items[0];
    expect(it.estado).toBe('listo');
    expect(cantidades(it.talles)).toEqual([{ talle: 'TU', cantidad: 5, original: 5 }]);
    expect(it.opciones[0].avisos.join(' ')).toMatch(/Salieron 1 para órdenes .*unidades sueltas del pack.*Si salió el pack entero, corregí la cantidad/);
    const escrito = planCargaId(pack(), estado(munequera(), COD), {}, new Map(), new Map([[COD, { TU: 5 }]])).items[0];
    expect(cantidades(escrito.talles)).toEqual([{ talle: 'TU', cantidad: 5, original: 6 }]);
    expect(escrito.opciones[0].avisos.join(' ')).toMatch(/Cantidad escrita a mano: TU 6→5/);
  });

  it('lo vendido en iD se separa en unidades: llega 1 pack (6) y hay 1 vendida → se suman 5', () => {
    const e = { ...estado(munequera(), COD), pendientesId: { [VTU]: [{ nombre: '#210900', fecha: '2026-11-11', cantidad: 1, cuenta: true }] } };
    const it = planCargaId(pack(), e, {}).items[0];
    expect(repo(it).lineas.map((l) => [l.talle, l.suma])).toEqual([['TU', 5]]);
    expect(it.opciones[0].separar).toEqual([{ talle: 'TU', cantidad: 1, ordenes: [{ nombre: '#210900', cantidad: 1 }] }]);
  });

  it('si la factura y Shopify dicen packs distintos no se adivina; escrito a mano, se carga', () => {
    const r = pack('LCS SOCKS X 6 BLA');
    const e = estado(munequera('Medias Le Coq Sportif Socks X3 Blanco'), COD);
    const it = planCargaId(r, e, {}).items[0];
    expect(it).toMatchObject({ estado: 'bloqueado', motivo: expect.stringMatching(/la factura dice packs de 6, el nombre en Shopify dice 3 y la plantilla de iD dice 6\. Escribí cuántas unidades/) });
    expect(it.pack).toMatchObject({ unidades: 1, error: expect.any(String) });
    expect(cantidades(it.talles)).toEqual([{ talle: 'TU', cantidad: 1, original: 1 }]);
    const manual = planCargaId(r, e, {}, new Map(), new Map(), new Map([[COD, 6]])).items[0];
    expect(manual).toMatchObject({ estado: 'listo', unidades: 6, pack: { unidades: 6, fuente: 'lo escribiste a mano', manual: true, costo: 4331.55 } });
  });

  it('«no viene en pack» (1 a mano) carga lo del remito con el costo entero; si el margen da negativo, pregunta si viene en pack', () => {
    const it = planCargaId(pack(), estado(munequera(), COD), {}, new Map(), new Map(), new Map([[COD, 1]])).items[0];
    expect(it.pack).toEqual({ unidades: 1, fuente: 'lo escribiste a mano', manual: true });
    expect(it.unidades).toBe(1);
    const a = repo(it);
    expect(a.ajuste!.costoNuevo).toBe(25989.3);
    expect(a.pack).toBeUndefined();
    expect(it.opciones[0].avisos.join(' ')).toMatch(/deja el margen en negativo\. ¿Viene en pack\?/);
    // Sin «X6» en ningún lado y con un código que no es de pack (no está en la plantilla ni termina en P): no se inventa
    // el pack, pero se pregunta.
    const SUELTO = 'LAN0122026';
    const sinX = planCargaId(
      resultado([fila([{ talle: 'TU', cantidad: 1 }], { codigo: SUELTO, descripcion: 'LCS SHORT SPORTY WRISTBAND BLA', cantidad: 1 })], [{ ...renPack(), codigo: SUELTO }]),
      estado({ ...munequera('Muñequeras Le Coq Sportif Wristband Blanco'), etiquetas: [SUELTO] }, SUELTO), {}).items[0];
    expect(sinX.pack).toBeUndefined();
    expect(sinX.unidades).toBe(1);
    expect(sinX.opciones[0].avisos.join(' ')).toMatch(/¿Viene en pack\?/);
    // Con un margen sano no se pregunta nada.
    expect(planCargaId(resultado([fila([{ talle: 'S', cantidad: 2 }])]), estado(), {}).items[0].opciones[0].avisos.join(' ')).not.toMatch(/pack/);
  });

  it('el mail de diferencias con el remito cuenta unidades, con el neto por unidad', () => {
    const plan = planCargaId(pack(), estado(munequera(), COD), {}, new Map(), new Map([[COD, { TU: 5 }]]));
    const netos = netosDeCarga(plan.items, [renPack()]);
    expect(netos).toEqual({ [COD]: 4331.55 });
    const difs = diferenciasDeTalles(plan.items, [{ codigo: COD, estado: 'cargada', mensaje: '' }], netos);
    expect(difs).toEqual([{ codigo: COD, descripcion: 'LCS SHORT SPORTY WRISTBAND BLA', talles: [{ talle: 'TU', remito: 6, llego: 5 }], neto: 4331.55, pack: 6 }]);
    const { cuerpo } = textoAvisoTalles(difs, { proveedor: 'iD', factura: '0011-00140008', remito: '0013-00125300' });
    expect(cuerpo).toMatch(/Según el remito: TU ×6 \(en unidades: viene en packs de 6\)\. Llegó: TU ×5\./);
    expect(cuerpo).toMatch(/Falta 1 unidad \(\$ 4\.331,55 neto a precio de factura\)\./);
  });

  // PlantillaPedido 12 de Le Coq (gax, 13-nov-2026): 39 artículos con «X6» / «X 6», todos con el código terminado en P.
  it('la plantilla de iD: 39 códigos de Le Coq vienen de a 6 (el mismo código sin la P es la unidad suelta)', () => {
    expect(PACKS_ID.size).toBe(39);
    for (const [codigo, n] of PACKS_ID) {
      expect(n).toBe(6);
      expect(pareceCodigoPackId(codigo)).toBe(true);
    }
    expect(packConocidoId(' lan0122012p ')).toBe(6);
    expect(packConocidoId('LAN0122018')).toBeUndefined();
    expect(packConocidoId('')).toBeUndefined();
    // Ni la factura (cortada) ni Shopify dicen «X6»: alcanza con la plantilla.
    expect(packDeCarga('TRIPACK ALGODON MEL', ['Medias Le Coq Sportif Tripack Algodon'], undefined, 'LAN0122012P')).toEqual({ unidades: 6, fuente: 'lo dice la plantilla de iD' });
    expect(packDeCarga('PUMAS HOME SOCKS X 6 CON ANTIDES', ['Medias Le Coq Sportif Pumas Home Socks X 6 Con Antides Blanco'], undefined, 'LAN0226035P'))
      .toEqual({ unidades: 6, fuente: 'lo dice la factura, el nombre en Shopify y la plantilla de iD' });
    // Si otra fuente dice otra cantidad no se adivina, y lo escrito a mano sigue mandando.
    expect(packDeCarga('TRIPACK ALGODON MEL', ['Medias Tripack Algodon X12'], undefined, 'LAN0122012P').error)
      .toBe('No sé cuántas unidades trae cada pack: el nombre en Shopify dice 12 y la plantilla de iD dice 6.');
    expect(packDeCarga('TRIPACK ALGODON MEL', [], 1, 'LAN0122012P')).toEqual({ unidades: 1, fuente: 'lo escribiste a mano', manual: true });
  });

  it('caso real sin «X6» en ningún lado: Tripack Algodón LAN0122012P, 2 packs (talles 1 y 2) = 12 unidades a $6.208,56', () => {
    const T = 'LAN0122012P';
    const v = (talle: string) => variante(talle, 0, { id: `gid://shopify/ProductVariant/T${talle}`, inventoryItemId: `gid://shopify/InventoryItem/T${talle}`, sku: `77904465645${talle}`, precio: 15999, costo: 6209 });
    const tripack: ProductoId = { id: 'gid://shopify/Product/88', titulo: 'Medias Le Coq Sportif Tripack Algodon', vendor: 'Le Coq Sportif', estado: 'ACTIVE', etiquetas: ['lan0122012p'], variantes: [v('1'), v('2')] };
    const ren: RenglonFactura = { codigo: T, descripcion: 'TRIPACK ALGODON MEL', precioUnitario: 41390.3743, bonificacion: 10, cantidad: 2, total: 74502.67 };
    const r = resultado([fila([{ talle: '1', cantidad: 1 }, { talle: '2', cantidad: 1 }], { codigo: T, descripcion: 'TRIPACK ALGODON MEL', cantidad: 2 })], [ren]);
    const it = planCargaId(r, estado(tripack, T), {}).items[0];
    expect(it.estado).toBe('listo');
    expect(it.unidades).toBe(12);
    expect(cantidades(it.talles)).toEqual([{ talle: '1', cantidad: 6, original: 6 }, { talle: '2', cantidad: 6, original: 6 }]);
    // 41.390,3743 ÷ 6 − 10% = 6.208,56 (en Shopify ya está a $6.209 por unidad); sin la lista daba $37.251,34 por par.
    expect(it.pack).toEqual({ unidades: 6, fuente: 'lo dice la plantilla de iD', lista: 41390.3743, bonificacion: 10, costo: 6208.56 });
    const a = repo(it);
    expect(a.lineas.map((l) => [l.talle, l.suma])).toEqual([['1', 6], ['2', 6]]);
    expect(a.ajuste).toMatchObject({ costoNuevo: 6208.56, precioActual: 15999, ok: true });
    expect(a.ajuste!.margen).toBeCloseTo(53.04, 1);
    expect(it.opciones[0].avisos.join(' ')).not.toMatch(/¿Viene en pack\?/);
  });

  it('un código de Le Coq terminado en P que no está en la plantilla: si nadie dice cuántas trae, se pide escribirlo', () => {
    expect(pareceCodigoPackId('LAN0127001P')).toBe(true);
    expect(pareceCodigoPackId('lan0127001p')).toBe(true);
    expect(pareceCodigoPackId('LAN0122018')).toBe(false);
    expect(pareceCodigoPackId('A10520C')).toBe(false);
    expect(pareceCodigoPackId('CTO0325003')).toBe(false);
    expect(pareceCodigoPackId('2020713')).toBe(false);
    expect(packDeCarga('CARC MEDIAS NUEVAS', ['Medias Le Coq Sportif Carc Nuevas Azul'], undefined, 'LAN0127001P'))
      .toEqual({ unidades: 1, fuente: '', error: 'El código termina en P (en iD es un pack), pero ni la factura ni el nombre en Shopify dicen cuántas unidades trae.' });
    expect(packDeCarga('CARC MEDIAS NUEVAS X 6', [], undefined, 'LAN0127001P')).toEqual({ unidades: 6, fuente: 'lo dice la factura' });
    expect(packDeCarga('TEE STAR CHEVRON BLACK', ['Remera Converse Star Chevron Negro'], undefined, 'CTO0325003')).toEqual({ unidades: 1, fuente: '' });
    // En la carga: bloqueado, con el casillero para escribir cuántas trae; escrito, se carga.
    const N = 'LAN0127001P';
    const r = resultado([fila([{ talle: 'TU', cantidad: 1 }], { codigo: N, descripcion: 'CARC MEDIAS NUEVAS', cantidad: 1 })], [{ ...renPack('CARC MEDIAS NUEVAS'), codigo: N }]);
    const e = estado({ ...munequera('Medias Le Coq Sportif Carc Nuevas Azul'), etiquetas: [N] }, N);
    const it = planCargaId(r, e, {}).items[0];
    expect(it).toMatchObject({ estado: 'bloqueado', motivo: expect.stringMatching(/termina en P .*Escribí cuántas unidades trae cada pack\./), pack: { unidades: 1, error: expect.any(String) } });
    expect(planCargaId(r, e, {}, new Map(), new Map(), new Map([[N, 6]])).items[0]).toMatchObject({ estado: 'listo', unidades: 6, pack: { unidades: 6, manual: true, costo: 4331.55 } });
  });
});

describe('iD: zapatilla Converse sin etiqueta TABLA DE TALLE (17-nov-2026, gax)', () => {
  // Caso real: Zapatillas Converse Sport Casual Gris (A10548C), sin etiqueta de tabla; el maestro dice tabla 2.
  const zapa = (etiquetas = ['a10548c']): ProductoId => ({
    id: 'gid://shopify/Product/7', titulo: 'Zapatillas Converse Sport Casual Gris', vendor: 'Converse', estado: 'ACTIVE', etiquetas,
    variantes: ['37', '38', '39', '39.5', '40', '41', '41.5', '42', '43', '44'].map((t) => variante(t, 0)),
  });
  const llega = (talles: FilaChecklist['talles']) => resultado([fila(talles, { codigo: 'A10548C' })], [renglon(50000, 'A10548C')]);
  const est = (p = zapa()) => estado(p, 'A10548C');

  it('queda bloqueada hasta elegir la tabla; ninguna viene elegida y la del maestro es solo sugerencia', () => {
    const [it] = planCargaId(llega([{ talle: '070', cantidad: 1 }]), est(), {}).items;
    expect(it.estado).toBe('bloqueado');
    expect(it.motivo).toMatch(/no tiene la etiqueta TABLA DE TALLE/);
    expect(it.tabla?.elegida).toBe('');
    expect(it.tabla?.opciones.find((o) => o.clave === 'TABLA DE TALLE CONVERSE 2')?.etiqueta).toMatch(/sugerida por el maestro/);
    expect(it.tabla?.opciones.find((o) => o.clave === 'TABLA DE TALLE CONVERSE 1')?.etiqueta).toMatch(/US 7 → 39/);
    expect(it.tabla?.avisos[0]).toMatch(/Mirá la caja/);
  });

  it('con la tabla elegida carga en el talle de esa tabla y le agrega la etiqueta', () => {
    const [it] = planCargaId(llega([{ talle: '070', cantidad: 1 }]), est(), {}, new Map(), new Map(), new Map(), new Map([['A10548C', 'TABLA DE TALLE CONVERSE 1']])).items;
    expect(it.estado).toBe('listo');
    expect(it.tabla?.elegida).toBe('TABLA DE TALLE CONVERSE 1');
    const a = it.opciones[0].accion;
    expect(a?.tipo).toBe('reposicion');
    if (a?.tipo !== 'reposicion') return;
    expect(a.lineas.map((l) => [l.talle, l.suma])).toEqual([['39', 1]]);
    expect(a.etiquetas).toEqual(['TABLA DE TALLE CONVERSE 1']);
  });

  it('una tabla que manda un US a un talle que el producto no tiene, o que no tiene ese US, no se puede elegir', () => {
    const t = tablaCargaId(fila([{ talle: '095', cantidad: 1 }], { codigo: 'A10548C' }), [zapa()], 'TABLA DE TALLE CONVERSE 2');
    // Tabla 2: US 9.5 = 43 (existe). Tabla 1: US 9.5 = 42 (existe). Mujer: US 9.5 = 41 (existe). Niño: no tiene US 9.5.
    expect(t?.opciones.find((o) => o.clave === 'TABLA DE TALLE CONVERSE NIÑO')?.bloqueo).toMatch(/no tiene el US 9.5/);
    const t2 = tablaCargaId(fila([{ talle: '090', cantidad: 1 }], { codigo: 'A10548C' }), [zapa()], 'TABLA DE TALLE CONVERSE 2');
    // Tabla 2: US 9 = 42.5, que el producto no tiene: no se puede elegir y no queda elegida.
    expect(t2?.opciones.find((o) => o.clave === 'TABLA DE TALLE CONVERSE 2')?.bloqueo).toMatch(/42.5/);
    expect(t2?.elegida).toBe('');
  });

  it('con etiqueta, ropa o Le Coq no aparece el selector', () => {
    const [con] = planCargaId(llega([{ talle: '070', cantidad: 1 }]), est(zapa(['a10548c', 'TABLA DE TALLE CONVERSE 1'])), {}).items;
    expect(con.tabla).toBeUndefined();
    expect(con.estado).toBe('listo');
    expect(con.opciones[0].accion?.tipo === 'reposicion' && con.opciones[0].accion.etiquetas).toBeFalsy();
    expect(planCargaId(resultado([fila([{ talle: 'L', cantidad: 2 }])]), estado(), {}).items[0].tabla).toBeUndefined();
  });
});

describe('iD: productos pedidos que no entraron (17-nov-2026, gax, caso A10516C)', () => {
  const chuck = (etiquetas: string[]): ProductoId => ({
    id: 'gid://shopify/Product/16', titulo: 'Zapatillas Converse Chuck Taylor Negro', vendor: 'Converse', estado: 'ACTIVE', etiquetas,
    variantes: ['39', '40', '43'].map((t) => ({ ...variante(t, 0), id: `gid://shopify/ProductVariant/A${t}`, sku: `A10516C-${t}` })),
  });
  const orden = (nombre: string, cantidad: number, extra: Partial<OrdenPendienteId> = {}): OrdenPendienteId => ({ nombre, fecha: '2026-11-01', cantidad, cuenta: true, ...extra });
  const e = (p: ProductoId): EstadoCargaId => ({
    locationId: LOC, porCodigo: { A10516C: [p.id] }, productos: { [p.id]: p },
    pendientesId: { 'gid://shopify/ProductVariant/A39': [orden('#210900', 1), orden('#210950', 1, { cuenta: false, motivo: 'sin pagar' })], 'gid://shopify/ProductVariant/A43': [orden('#210960', 2)] },
  });
  const falta = { codigo: 'A10516C', descripcion: 'CHUCK TAYLOR ALL STAR', nota: 'N° 2595' };

  it('pasa el talle de iD al de Shopify y lista las ventas de iD que lo esperan', () => {
    // TABLA DE TALLE CONVERSE 1: US 7 = 39.
    const r = noEntraronId([{ ...falta, talle: '070', unidades: 2 }], e(chuck(['A10516C', 'TABLA DE TALLE CONVERSE 1'])));
    expect(r[0]).toMatchObject({ talleShopify: '39', producto: 'Zapatillas Converse Chuck Taylor Negro', unidades: 2 });
    expect(r[0].ordenes).toEqual([{ nombre: '#210900', cantidad: 1 }, { nombre: '#210950', cantidad: 1, motivo: 'sin pagar' }]);
    expect(r[0].aviso).toBeUndefined();
    const t = textoNoEntraron(r, '0011-00139953');
    expect(t).toMatch(/factura 0011-00139953/);
    expect(t).toMatch(/A10516C Zapatillas Converse Chuck Taylor Negro talle 39 \(2 u\. pedidas, nota N° 2595\): #210900, #210950 \[sin pagar\]/);
  });

  it('sin etiqueta de tabla o sin talle no adivina: muestra las ventas de todos los talles, avisando', () => {
    const r = noEntraronId([{ ...falta, talle: '060', unidades: 2 }, { ...falta, talle: '', unidades: 7 }], e(chuck(['A10516C'])));
    for (const x of r) {
      expect(x.talleShopify).toBeUndefined();
      expect(x.ordenes.map((o) => [o.nombre, o.talle])).toEqual([['#210900', '39'], ['#210950', '39'], ['#210960', '43']]);
    }
    expect(r[0].aviso).toMatch(/no tiene la etiqueta TABLA DE TALLE/);
    expect(r[1].aviso).toMatch(/no sé de qué talle/);
  });

  it('no está en Shopify o no se pudieron leer las ventas: avisa', () => {
    expect(noEntraronId([{ ...falta, codigo: 'A99999C', talle: '060', unidades: 1 }], e(chuck([])))[0].aviso).toMatch(/no lo encontré en Shopify/);
    const sin = { ...e(chuck(['TABLA DE TALLE CONVERSE 1'])), pendientesId: undefined, errorPendientes: 'sin permiso' };
    const r = noEntraronId([{ ...falta, talle: '060', unidades: 1 }], sin);
    expect(r[0].ordenes).toEqual([]);
    expect(r[0].aviso).toMatch(/no pude leer las ventas de iD \(sin permiso\)/);
  });
});

describe('iD: remito sin talles (21-nov-2026, gax: «que nos dé alguna opción de avanzar, de corregir la falla nosotros manualmente»)', () => {
  // Caso real: LAN0122012P «Medias Le Coq Sportif Tripack Algodon», talles 1 y 2 en Shopify, sin alta en Martínez.
  // Llegaron 2 packs de 6 y el remito no dice de qué talle: antes quedaba bloqueado con «No sé qué talles llegaron».
  const COD = 'LAN0122012P';
  const tripack = (variantes = [variante('1', null, { sku: '7790446564503' }), variante('2', null, { sku: '7790446564510' })]): ProductoId => ({
    id: 'gid://shopify/Product/12', titulo: 'Medias Le Coq Sportif Tripack Algodon', vendor: 'Le Coq Sportif', estado: 'ACTIVE', etiquetas: [COD.toLowerCase()], variantes,
  });
  const ren: RenglonFactura = { codigo: COD, descripcion: 'LCS LOGO TRIPACK', precioUnitario: 30000, bonificacion: 10, cantidad: 2, total: 54000 };
  const r = (extra: Partial<FilaChecklist> = {}) => resultado([fila(null, { codigo: COD, descripcion: 'LCS LOGO TRIPACK', cantidad: 2, nota: 'Talle a confirmar por depósito', ...extra })], [ren]);

  it('muestra los talles de Shopify para escribir y explica cuánto dice el remito', () => {
    const [it] = planCargaId(r(), estado(tripack(), COD), {}).items;
    expect(it.estado).toBe('bloqueado');
    expect(cantidades(it.talles)).toEqual([{ talle: '1', cantidad: 0, original: 0 }, { talle: '2', cantidad: 0, original: 0 }]);
    expect(it.motivo).toBe('El remito no dice los talles: escribí arriba cuántas unidades llegaron de cada talle (el remito dice 12 u. (2 packs de 6)). Si no llegó, «Sacar de la carga (no llegó)».');
    expect(it.tabla).toBeUndefined();
  });

  it('lo escrito va a esos talles de Shopify, en unidades (sin volver a multiplicar por el pack)', () => {
    const [it] = planCargaId(r(), estado(tripack(), COD), {}, new Map(), new Map([[COD, { 1: 6, 2: 6 }]])).items;
    expect(it.estado).toBe('listo');
    expect(it.unidades).toBe(12);
    const a = it.opciones[0].accion;
    if (a?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(a.lineas.map((l) => [l.talle, l.suma])).toEqual([['1', 6], ['2', 6]]);
    expect(it.opciones[0].avisos).toContain('El remito no dice los talles: lo escribiste a mano (1: 6 · 2: 6).');
    expect(it.opciones[0].avisos.join(' ')).not.toMatch(/el remito dice otra cosa|elegido a mano/);
    // La firma «una sola vez» es la del remito, no la de lo escrito.
    expect(it.firma).toBe(planCargaId(r(), estado(tripack(), COD), {}).items[0].firma);
  });

  it('si lo escrito no suma lo del remito, avisa pero deja cargar', () => {
    const [it] = planCargaId(r(), estado(tripack(), COD), {}, new Map(), new Map([[COD, { 1: 6 }]])).items;
    expect(it.estado).toBe('listo');
    expect(it.opciones[0].avisos).toContain('El remito no dice los talles y lo escrito (1: 6) suma 6 u., pero el remito dice 12 u. (2 packs de 6). Revisá antes de cargar.');
  });

  it('con un solo talle (o sin talles) en Shopify va todo ahí, sin escribir nada', () => {
    const [it] = planCargaId(r(), estado(tripack([variante('Default Title', 0, { sku: COD })]), COD), {}).items;
    expect(it.estado).toBe('listo');
    expect(cantidades(it.talles)).toEqual([{ talle: 'TU', cantidad: 12, original: 12 }]);
    expect(it.opciones[0].avisos).toContain('El remito no dice los talles: va todo al único talle (TU: 12).');
  });

  it('descuenta lo que salió para órdenes (marca «-1» sin talle)', () => {
    const [it] = planCargaId(r({ retirado: 1 }), estado(tripack(), COD), {}).items;
    expect(it.motivo).toMatch(/el remito dice 11 u\. \(2 packs de 6\), menos 1 que salieron para órdenes/);
  });

  it('con el código en dos productos de Shopify sigue pidiendo el remito con talles', () => {
    const otro = { ...tripack(), id: 'gid://shopify/Product/13' };
    const e: EstadoCargaId = { locationId: LOC, porCodigo: { [COD]: [tripack().id, otro.id] }, productos: { [tripack().id]: tripack(), [otro.id]: otro } };
    const [it] = planCargaId(r(), e, {}).items;
    expect(it.estado).toBe('bloqueado');
    expect(it.motivo).toMatch(/varios productos de Shopify: escribí el remito con los talles/);
  });
});
