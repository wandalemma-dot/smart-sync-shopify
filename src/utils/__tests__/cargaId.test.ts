// Carga de las entregas de iD en Shopify (12-nov-2026, pedido de gax). Shopify SIMULADO: ninguna escritura real.
import { describe, it, expect, vi } from 'vitest';
import { accionesElegidas, ejecutarCargaFamily, leerPrecio, llegaAl50, precioAEscribir, resumenCarga, type CargaFamily, type DepsCarga } from '../cargaFamily';
import {
  ajusteDe, costoPromedio, estadoCargaFactura, firmaCargaId, formasCodigo, leerEstadoCargaId, leerPendientesId, planCargaId, precioYCostoAntes, separarDe, talleEnShopify,
  type EstadoCargaId, type OrdenPendienteId, type ProductoId, type VarianteId,
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
    // Precio en los 4 talles; costo (con centavos) solo en S, M y XL: L tiene stock en Martínez y no llega.
    expect(Object.values(porTalle).every((v) => v.price === '69900')).toBe(true);
    expect(porTalle.S.inventoryItem).toEqual({ cost: '27000.00' });
    expect(porTalle.L.inventoryItem).toBeUndefined();
    expect(res.mensaje).toMatch(/Cambiado precio de toda la curva/);
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
    expect(separarDe(ords, 2, 0)).toEqual({ cantidad: 2, ordenes: [{ nombre: '#1', cantidad: 1 }, { nombre: '#2', cantidad: 1 }] });
    expect(separarDe(ords, 5, 0)).toEqual({ cantidad: 3, ordenes: [{ nombre: '#1', cantidad: 1 }, { nombre: '#2', cantidad: 2 }] });
    // El depósito ya sacó 1 («-1») para la #1: de lo que queda se separan las 2 de la #2.
    expect(separarDe(ords, 2, 1)).toEqual({ cantidad: 2, ordenes: [{ nombre: '#2', cantidad: 2 }] });
    expect(separarDe(ords, 1, 2)).toEqual({ cantidad: 1, ordenes: [{ nombre: '#2', cantidad: 1 }] });
    expect(separarDe([orden('#1', 1, '2026-11-01')], 2, 1)).toEqual({ cantidad: 0, ordenes: [] });
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

    const igual = planCargaId(r, e, {}, new Set(['CTO0325003'])).items[0].opciones[0];
    if (igual.accion?.tipo !== 'reposicion') throw new Error('esperaba reposición');
    expect(igual.accion.lineas.map((l) => [l.talle, l.suma])).toEqual([['S', 2], ['XL', 2]]);
    expect(igual.separarAplicado).toBe(false);
  });

  it('si todo lo que llegó está vendido, no se suma nada pero se puede cargar igual', () => {
    const r = resultado([fila([{ talle: 'S', cantidad: 1 }])]);
    const e = conPendientes({ [VS]: [orden('#210776', 2, '2026-10-29')] });
    const it = planCargaId(r, e, {}).items[0];
    expect(it.estado).toBe('bloqueado');
    expect(it.motivo).toMatch(/ya está vendido en iD/);
    expect(it.opciones[0].separar).toEqual([{ talle: 'S', cantidad: 1, ordenes: [{ nombre: '#210776', cantidad: 1 }] }]);
    expect(accionesElegidas(planCargaId(r, e, {}), {})).toEqual([]);
    expect(planCargaId(r, e, {}, new Set(['CTO0325003'])).items[0].estado).toBe('listo');
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
