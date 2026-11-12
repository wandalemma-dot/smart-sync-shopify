// Carga de las entregas de iD en Shopify (12-nov-2026, pedido de gax). Shopify SIMULADO: ninguna escritura real.
import { describe, it, expect, vi } from 'vitest';
import { accionesElegidas, ejecutarCargaFamily, leerPrecio, llegaAl50, precioAEscribir, resumenCarga, type CargaFamily, type DepsCarga } from '../cargaFamily';
import {
  ajusteDe, estadoCargaFactura, firmaCargaId, formasCodigo, leerEstadoCargaId, planCargaId, precioYCostoAntes, talleEnShopify,
  type EstadoCargaId, type ProductoId, type VarianteId,
} from '../cargaId';
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
const estado = (p: ProductoId = remera(), codigo = 'CTO0325003'): EstadoCargaId => ({ locationId: LOC, porCodigo: { [codigo]: [p.id] }, productos: { [p.id]: p } });

describe('iD: talle del proveedor → talle de Shopify (nunca adivina)', () => {
  it('Converse: la etiqueta TABLA DE TALLE manda; sin etiqueta, el maestro; sin ninguno, no se carga', () => {
    // A11716C: etiqueta TABLA 1 pero maestro tabla 2 (caso real de CLAUDE.md, sección 4).
    expect(talleEnShopify('converse', '085', 'A11716C', ['A11716C', 'TABLA DE TALLE CONVERSE 1'], '')).toEqual({ talle: '41' });
    expect(talleEnShopify('converse', '7.5', 'A11716C', ['A11716C'], '')).toEqual({ talle: '41' });
    expect(talleEnShopify('converse', '8', 'ZZZ9999C', [], '')).toMatchObject({ error: expect.stringMatching(/tabla de talle/) });
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
  it('un talle que llega y ya tenía stock en Martínez conserva su costo (y se avisa)', () => {
    const plan = planCargaId(resultado([fila([{ talle: 'L', cantidad: 2 }])]), estado(), {});
    const op = plan.items[0].opciones[0];
    if (op.accion?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(op.accion.ajuste!.costos.map((c) => c.talle)).toEqual(['S', 'M', 'XL']);
    expect(op.avisos.join(' ')).toMatch(/Talle L: ya tenía stock en Martínez, conserva su costo/);
  });
  it('bloquea lo que no se puede cargar sin adivinar', () => {
    const casos: [FilaChecklist, EstadoCargaId, RegExp][] = [
      [fila(null), estado(), /escribí el remito con los talles/],
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
  it('una sola vez: lo ya cargado no se vuelve a cargar, ni desde otra entrega con la misma mercadería', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 2 }])]);
    const marca: CargaFamily = { estado: 'cargada', fecha: '2026-11-12T15:00:00Z', firma: firmaCargaId('2026-11-10', '0013-00125274', r.checklist[0]) };
    expect(planCargaId(r, estado(), { 'F-0011-00139953|CTO0325003': marca }).items[0].estado).toBe('cargado');
    expect(planCargaId(r, estado(), { 'F-otra|CTO0325003': marca }).items[0]).toMatchObject({ estado: 'bloqueado', motivo: expect.stringMatching(/otra entrega/) });
    expect(estadoCargaFactura(r, { 'F-0011-00139953|CTO0325003': marca })).toEqual({ cargados: 1, total: 1, completa: true });
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
    // Precio en los 4 talles; costo (con centavos) solo en S, M y XL: L tiene stock en Martínez.
    expect(Object.values(porTalle).every((v) => v.price === '69900')).toBe(true);
    expect(porTalle.S.inventoryItem).toEqual({ cost: '27000.00' });
    expect(porTalle.L.inventoryItem).toBeUndefined();
    expect(res.mensaje).toMatch(/Cambiado precio de toda la curva/);
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
