// Carga de las entregas de Family en Shopify (11-nov-2026, pedido de gax). Shopify SIMULADO: ninguna escritura real.
import { describe, it, expect, vi } from 'vitest';
import {
  accionesElegidas, candidatosPorNombre, cargasDeEntrega, costoFamily, ejecutarCargaFamily, esBrandCo, estadoShopifyEntrega, firmaCarga, leerEstadoCarga,
  noSeEjecuto, planCargaFamily, resumenCarga, talleAlta, tituloFamily, type CargaFamily, type DepsCarga, type EstadoCarga, type PlanCarga, type ProductoCarga,
} from '../cargaFamily';
import { controlarEntregaFamily, leerEntregaFamily, type EntregaFamily } from '../controlFamily';
import type { Remito } from '../controlFacturas';

// La planilla real del 30-oct-2026 (la misma de controlFamily.test.ts).
const PLANILLA: unknown[][] = [
  ['ENTREGA MERCADERIA', null, null, 'FAMILYARG', '30-Oct-26'],
  ['CODIGO', 'ARTICULO', 'MODELO', 'CORTE', 'COLOR', 'PRECIOXMAYOR', 'PRECIO PUBLICO', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'TOTAL'],
  ['SHBSPEC', 'SHORT', 'SPECTRUM', 'BASKET', 'NEGRO/MULTI', 34500, 69000, 2, 4, 4, 6, 4, null, 20],
  ['GSKPT23', 'PANTALON', 'GARAGE SKT PANT', 'LOOSE FIT', 'GRIS', '$49,000.00', '$98,000.00', 1, 2, 2, 2, 2, 1, 10],
];
const REMITO: Remito = { numero: '0001-00002715', fecha: '2026-11-10', renglones: [{ codigo: 'SHBSPEC', cantidad: 20, talles: [] }, { codigo: 'GSKPT23', cantidad: 10, talles: [] }] };
const LOC = 'gid://shopify/Location/87136076019';
const POS = 'gid://shopify/Publication/1';

function entrega(id = 'E1', fecha = '2026-10-30'): EntregaFamily {
  const { entrega: e } = leerEntregaFamily(PLANILLA, 'Planilla', '2026-01-01');
  return { ...e, id, fecha, shopify: { fecha: 'x', codigos: { SHBSPEC: [], GSKPT23: [] } } };
}
const resultado = (e = entrega()) => controlarEntregaFamily(e, REMITO, [e]);
function producto(id: string, titulo: string, niveles: Record<string, number | null>, extra: Partial<ProductoCarga> = {}): ProductoCarga {
  return {
    id, titulo, estado: 'ACTIVE', etiquetas: [],
    variantes: Object.entries(niveles).map(([talle, disponible], i) => ({ id: `${id}/v${i}`, talle, sku: '', inventoryItemId: `${id}/inv/${talle}`, seguimiento: true, disponible })),
    ...extra,
  };
}
const estadoVacio = (extra: Partial<EstadoCarga> = {}): EstadoCarga => ({ locationId: LOC, posId: POS, porCodigo: { SHBSPEC: [], GSKPT23: [] }, familia: [], productos: {}, ...extra });

describe('Family: título, talles y costo de los nuevos (como se cargan a mano)', () => {
  it('arma el título «Tipo Familyarg Modelo Color» con los tipos de la tienda', () => {
    expect(tituloFamily('SHORT SPECTRUM BASKET NEGRO/MULTI')).toBe('Bermuda Short Familyarg Spectrum Basket Negro Multi');
    expect(tituloFamily('PANTALON GARAGE SKT PANT LOOSE FIT GRIS')).toBe('Pantalon Familyarg Garage Skt Pant Loose Fit Gris');
    expect(tituloFamily('REMERA FAMILY LOGO 3D NEGRO')).toBe('Remera Familyarg Logo 3D Negro');
    expect(tituloFamily('CHALECO PUFFER NEGRO')).toBe('Chaleco Familyarg Puffer Negro');
  });
  it('Brand & Co (código BF…, como todos los de la tienda): «Remera Familyarg x Brand & Co Duncan Supersized Negro»', () => {
    // El título exacto que gax escribió a mano el 11-nov para BFRMCSD01.
    expect(tituloFamily('REMERA DUNCAN SUPERSIZED NEGRO', 'BFRMCSD01')).toBe('Remera Familyarg x Brand & Co Duncan Supersized Negro');
    expect(tituloFamily('REMERA PANCHART CRY REGULAR LADRILLO', 'BFRMCPC29')).toBe('Remera Familyarg x Brand & Co Panchart Cry Regular Ladrillo');
    expect(tituloFamily('BUZO DUNCAN NEGRO', 'bfhdu01')).toBe('Buzo Familyarg x Brand & Co Duncan Negro');
    // Si la planilla lo escribe, va una sola vez y en su lugar, con o sin código BF.
    expect(tituloFamily('REMERA X BRAND & CO DUNCAN NEGRO', 'BFRMCSD01')).toBe('Remera Familyarg x Brand & Co Duncan Negro');
    expect(tituloFamily('REMERA BRAND AND CO DUNCAN NEGRO', 'RMCX01')).toBe('Remera Familyarg x Brand & Co Duncan Negro');
    // Pegada a una barra (como «NEGRO/MULTI») también se saca: no se repite.
    expect(tituloFamily('REMERA DUNCAN NEGRO/BRAND & CO', 'BFRMCSD01')).toBe('Remera Familyarg x Brand & Co Duncan Negro');
    expect(tituloFamily('REMERA BRAND & CO/DUNCAN NEGRO', 'RMCX01')).toBe('Remera Familyarg x Brand & Co Duncan Negro');
    // Sin BF ni la frase, no es Brand & Co; «BRAND & COURT» tampoco.
    expect(tituloFamily('SHORT SPECTRUM BASKET NEGRO/MULTI', 'SHBSPEC')).toBe('Bermuda Short Familyarg Spectrum Basket Negro Multi');
    expect(esBrandCo('HPRST01', 'BUZO STICKERS NEGRO')).toBe(false);
    expect(esBrandCo('RMC01', 'REMERA BRAND & COURT NEGRO')).toBe(false);
    expect(esBrandCo('BF')).toBe(false);
    expect(esBrandCo('BFHDU01')).toBe(true);
  });
  it('talles como en Shopify y costo = por mayor − 15% con centavos (42,5% del público)', () => {
    expect(['S', '2XL', '3XL', 'xl', 'U'].map(talleAlta)).toEqual(['S', 'XXL', 'XXXL', 'XL', 'U']);
    expect(costoFamily(34500)).toBe(29325);
    expect(costoFamily(49000)).toBe(41650);
    expect(costoFamily(34500.5)).toBe(29325.43);
  });
});

describe('Family: vista previa de la carga', () => {
  it('la entrega real: dos productos nuevos listos para crear, con precio público, costo, SKU y stock por talle', () => {
    const plan = planCargaFamily(resultado(), estadoVacio(), {});
    expect(plan.items.map((i) => [i.codigo, i.estado])).toEqual([['SHBSPEC', 'listo'], ['GSKPT23', 'listo']]);
    const short = plan.items[0].opciones[0].accion!;
    expect(short).toEqual({
      tipo: 'alta', titulo: 'Bermuda Short Familyarg Spectrum Basket Negro Multi', productType: 'Bermudas',
      etiquetas: ['SHBSPEC', 'Indumentaria', 'Pantalones', 'Ropa'], gramos: 750, precio: 69000, costo: 29325,
      variantes: [
        { talle: 'S', sku: 'SHBSPEC.S', cantidad: 2 }, { talle: 'M', sku: 'SHBSPEC.M', cantidad: 4 }, { talle: 'L', sku: 'SHBSPEC.L', cantidad: 4 },
        { talle: 'XL', sku: 'SHBSPEC.XL', cantidad: 6 }, { talle: 'XXL', sku: 'SHBSPEC.XXL', cantidad: 4 },
      ],
    });
    const pant = plan.items[1].opciones[0].accion!;
    expect(pant.tipo === 'alta' && pant.variantes.map((v) => v.talle)).toEqual(['S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
    expect(resumenCarga(plan, {})).toMatchObject({ altas: 2, reposiciones: 0, unidades: 30 });
  });

  it('reposición: SUMA a lo que hay en FAMILYARG; talle sin alta en la sucursal se da de alta; avisa precio cambiado sin tocarlo', () => {
    const e = entrega();
    const r = resultado(e);
    r.filas[0].cambiosPrecio = ['Precio público: Family dice $ 69.000 y en Shopify está a $ 65.000.'];
    const p = producto('gid://shopify/Product/1', 'Bermuda Short Familyarg Spectrum Negro', { S: 1, M: 0, L: 3, XL: null, XXL: 2 });
    const plan = planCargaFamily(r, estadoVacio({ porCodigo: { SHBSPEC: [p.id], GSKPT23: [] }, productos: { [p.id]: p } }), {});
    const it = plan.items[0];
    expect(it.estado).toBe('listo');
    const a = it.opciones[0].accion!;
    expect(a.tipo).toBe('reposicion');
    expect(a.tipo === 'reposicion' && a.lineas.map((l) => [l.talle, l.actual, l.suma])).toEqual([['S', 1, 2], ['M', 0, 4], ['L', 3, 4], ['XL', null, 6], ['XXL', 2, 4]]);
    expect(it.opciones[0].avisos.join(' ')).toMatch(/Talle XL: no está dado de alta en FAMILYARG; se da de alta con 6/);
    expect(it.opciones[0].avisos.join(' ')).toMatch(/precio de Shopify NO se cambia/);
  });

  it('bloquea si en Shopify falta un talle, si los talles no suman el TOTAL o si ya se cargó (en esta o en otra entrega)', () => {
    const p = producto('gid://shopify/Product/1', 'Bermuda Short Familyarg Spectrum Negro', { S: 1, M: 0, L: 3, XL: 0 });
    let plan = planCargaFamily(resultado(), estadoVacio({ porCodigo: { SHBSPEC: [p.id], GSKPT23: [] }, productos: { [p.id]: p } }), {});
    expect(plan.items[0]).toMatchObject({ estado: 'bloqueado' });
    expect(plan.items[0].motivo).toMatch(/no existe el talle 2XL/);

    const e = entrega();
    e.renglones[1].totalImpreso = 11;
    plan = planCargaFamily(controlarEntregaFamily(e, REMITO, [e]), estadoVacio(), {});
    expect(plan.items[1].motivo).toMatch(/no suman el TOTAL/);

    const marca: CargaFamily = { estado: 'cargada', fecha: '2026-11-11T19:00:00Z', firma: firmaCarga('2026-10-30', entrega().renglones[0]), detalle: { titulo: 'X', unidades: 20 } };
    plan = planCargaFamily(resultado(), estadoVacio(), { 'E1|SHBSPEC': marca });
    expect(plan.items[0]).toMatchObject({ estado: 'cargado', opciones: [] });
    expect(plan.items[0].motivo).toMatch(/Cargado en Shopify el 11\/11\/2026/);
    // La misma planilla subida de nuevo (otra entrega): no se carga dos veces.
    plan = planCargaFamily(resultado(entrega('E2')), estadoVacio(), { 'E1|SHBSPEC': marca });
    expect(plan.items[0]).toMatchObject({ estado: 'bloqueado' });
    expect(plan.items[0].motivo).toMatch(/ya se cargó desde otra entrega/);
    expect(accionesElegidas(plan, {}).map((x) => x.codigo)).toEqual(['GSKPT23']);
  });

  it('Family sin SKU: si hay uno parecido por nombre, la usuaria elige (por defecto no se carga); al vincularlo se le pone la etiqueta', () => {
    const familia = [
      { id: 'gid://shopify/Product/9', titulo: 'Bermuda Short Familyarg Spectrum Basket Negro Multi', estado: 'ACTIVE', etiquetas: ['Ropa'] },
      { id: 'gid://shopify/Product/8', titulo: 'Remera Familyarg Spectrum Negro', estado: 'ACTIVE', etiquetas: [] },
      { id: 'gid://shopify/Product/7', titulo: 'Bermuda Short Familyarg Duncan Negro', estado: 'ACTIVE', etiquetas: [] },
    ];
    expect(candidatosPorNombre('SHORT SPECTRUM BASKET NEGRO/MULTI', familia).map((c) => c.id)).toEqual(['gid://shopify/Product/9']);
    expect(candidatosPorNombre('SHORT DUNCAN RELAXED NEGRO', familia).map((c) => c.id)).toEqual(['gid://shopify/Product/7']);
    // Otro color del mismo modelo NO es parecido (es otro producto).
    const remeras = [{ id: 'r1', titulo: 'Remera Familyarg Tired Supersized Habano', estado: 'ACTIVE', etiquetas: [] }];
    expect(candidatosPorNombre('REMERA TIRED SUPERSIZED NEGRO', remeras)).toEqual([]);
    const p = producto('gid://shopify/Product/9', familia[0].titulo, { S: 0, M: 0, L: 0, XL: 0, XXL: 0 });
    const plan = planCargaFamily(resultado(), estadoVacio({ familia, productos: { [p.id]: p } }), {});
    const it = plan.items[0];
    expect(it.estado).toBe('elegir');
    expect(it.opciones.map((o) => o.clave)).toEqual(['no', `repo:${p.id}`, 'alta']);
    expect(accionesElegidas(plan, {}).map((x) => x.codigo)).toEqual(['GSKPT23']);
    const vincular = accionesElegidas(plan, { SHBSPEC: { clave: `repo:${p.id}` } })[0].accion;
    expect(vincular).toMatchObject({ tipo: 'reposicion', productoId: p.id, etiquetar: true });
    const crear = accionesElegidas(plan, { SHBSPEC: { clave: 'alta', titulo: '  Bermuda Short Familyarg Spectrum  Negro ' } })[0].accion;
    expect(crear).toMatchObject({ tipo: 'alta', titulo: 'Bermuda Short Familyarg Spectrum Negro' });
  });

  it('Brand & Co: el producto nuevo se crea con «x Brand & Co» en el título', () => {
    const planilla = [PLANILLA[0], PLANILLA[1], ['BFRMCSD01', 'REMERA', 'DUNCAN', 'SUPERSIZED', 'NEGRO', 19500, 39000, 1, 2, 2, 2, 1, null, 8]];
    const { entrega: e0 } = leerEntregaFamily(planilla, 'Planilla', '2026-01-01');
    const e = { ...e0, id: 'E3', fecha: '2026-11-10', shopify: { fecha: 'x', codigos: { BFRMCSD01: [] } } };
    const r = controlarEntregaFamily(e, { numero: '0001-00002716', fecha: '2026-11-10', renglones: [{ codigo: 'BFRMCSD01', cantidad: 8, talles: [] }] }, [e]);
    const plan = planCargaFamily(r, estadoVacio({ porCodigo: { BFRMCSD01: [] } }), {});
    const op = plan.items[0].opciones[0];
    expect(op.etiqueta).toBe('Crear producto nuevo «Remera Familyarg x Brand & Co Duncan Supersized Negro»');
    expect(op.accion).toMatchObject({ tipo: 'alta', titulo: 'Remera Familyarg x Brand & Co Duncan Supersized Negro', productType: 'Remera', precio: 39000, costo: 16575 });
  });
  it('el código en dos productos: elegir en cuál sumar', () => {
    const a = producto('gid://shopify/Product/1', 'Uno', { S: 0, M: 0, L: 0, XL: 0, XXL: 0 });
    const b = producto('gid://shopify/Product/2', 'Dos', { S: 0, M: 0, L: 0, XL: 0, XXL: 0 });
    const plan = planCargaFamily(resultado(), estadoVacio({ porCodigo: { SHBSPEC: [a.id, b.id], GSKPT23: [] }, productos: { [a.id]: a, [b.id]: b } }), {});
    expect(plan.items[0].estado).toBe('elegir');
    expect(plan.items[0].opciones.map((o) => o.clave)).toEqual(['no', `repo:${a.id}`, `repo:${b.id}`]);
  });
});

/** Shopify simulado: responde según la operación. */
function shopify(respuestas: Record<string, (v: Record<string, unknown>) => unknown>) {
  return vi.fn(async (q: string, v: Record<string, unknown> = {}) => {
    const k = Object.keys(respuestas).find((x) => q.includes(x));
    if (!k) throw new Error(`consulta inesperada: ${q.slice(0, 60)}`);
    return respuestas[k](v);
  });
}
const sinPagina = { hasNextPage: false, endCursor: null };

describe('Family: entregas cargadas y pendientes en Shopify (pantalla)', () => {
  const marca = (estado: CargaFamily['estado']): CargaFamily => ({ estado, fecha: '2026-11-11T19:20:55.000Z', firma: 'x' });
  it('separa las marcas por entrega y cuenta cuánto está cargado', () => {
    const cargas = { 'E1|SHBSPEC': marca('cargada'), 'E1|GSKPT23': marca('dudosa'), 'E10|SHBSPEC': marca('cargada'), 'E2|HPRST01': marca('cargada') };
    expect(Object.keys(cargasDeEntrega(cargas, 'E1'))).toEqual(['SHBSPEC', 'GSKPT23']);
    const e1 = cargasDeEntrega(cargas, 'E1');
    // Dudosa no cuenta como cargada: la entrega sigue pendiente (amarilla, arriba).
    expect(estadoShopifyEntrega(['SHBSPEC', 'GSKPT23'], e1)).toEqual({ cargados: 1, total: 2, completa: false });
    expect(estadoShopifyEntrega(['SHBSPEC'], e1)).toEqual({ cargados: 1, total: 1, completa: true });
    expect(estadoShopifyEntrega(['SHBSPEC', 'SHBSPEC'], e1)).toEqual({ cargados: 1, total: 1, completa: true });
    expect(estadoShopifyEntrega(['SHBSPEC'], {})).toEqual({ cargados: 0, total: 1, completa: false });
    // Una entrega sin artículos no es «cargada».
    expect(estadoShopifyEntrega([], e1).completa).toBe(false);
  });
});

describe('Family: lectura de Shopify para armar la carga (solo lectura)', () => {
  it('encuentra FAMILYARG y Point of Sale, busca por SKU/etiqueta y por nombre, y lee el stock en FAMILYARG', async () => {
    const gql = shopify({
      locations: () => ({ locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'DEPOSITO MARTINEZ' }, { id: LOC, name: '🟢FAMILYARG' }] } }),
      publications: () => ({ publications: { nodes: [{ id: 'x', name: 'Online Store' }, { id: POS, name: 'Point of Sale' }] } }),
      productVariants: (v) => ({ productVariants: { pageInfo: sinPagina, nodes: String(v.q).includes('GSKPT23')
        ? [{ sku: null, product: { id: 'gid://shopify/Product/5', tags: ['GSKPT23', 'Ropa'] } }, { sku: 'GSKPT230.S', product: { id: 'gid://shopify/Product/6', tags: [] } }]
        : [] } }),
      'vendor:Familyarg': () => ({ products: { pageInfo: sinPagina, nodes: [{ id: 'gid://shopify/Product/9', title: 'Bermuda Short Familyarg Spectrum Basket Negro', status: 'ACTIVE', tags: [] }] } }),
      'product(id': (v) => ({ product: { id: v.id, title: `P ${v.id}`, status: 'ACTIVE', tags: [], variants: { nodes: [
        { id: 'v1', title: 'S', sku: null, inventoryItem: { id: 'i1', tracked: true, inventoryLevel: { quantities: [{ name: 'available', quantity: 3 }] } } },
        { id: 'v2', title: 'M', sku: null, inventoryItem: { id: 'i2', tracked: true, inventoryLevel: null } },
      ] } } }),
    });
    const estado = await leerEstadoCarga(entrega().renglones, gql);
    expect(estado.locationId).toBe(LOC);
    expect(estado.posId).toBe(POS);
    expect(estado.porCodigo).toEqual({ SHBSPEC: [], GSKPT23: ['gid://shopify/Product/5'] });
    expect(Object.keys(estado.productos).sort()).toEqual(['gid://shopify/Product/5', 'gid://shopify/Product/9']);
    expect(estado.productos['gid://shopify/Product/5'].variantes.map((v) => [v.talle, v.disponible])).toEqual([['S', 3], ['M', null]]);
    expect(gql.mock.calls.filter(([q]) => q.includes('product(id')).every(([, v]) => v?.loc === LOC)).toBe(true);
    expect(gql.mock.calls.every(([q]) => !/^\s*mutation/.test(q))).toBe(true);
  });

  it('sin la sucursal FAMILYARG no arma nada', async () => {
    const gql = shopify({ locations: () => ({ locations: { nodes: [{ id: 'x', name: 'LUXO' }] } }) });
    await expect(leerEstadoCarga(entrega().renglones, gql)).rejects.toThrow(/No encontré la sucursal FAMILYARG/);
  });
});

function deps(gql: DepsCarga['gql'], reservar = true) {
  const d = {
    gql,
    reservar: vi.fn(async () => (reservar ? { ok: true } : { ok: false, existente: { estado: 'cargada', fecha: '2026-11-11', firma: 'x' } as CargaFamily })),
    terminar: vi.fn(async () => undefined),
    liberar: vi.fn(async () => undefined),
    clave: vi.fn(() => 'clave-1'),
  };
  return d;
}
const planSolo = (codigo: 'SHBSPEC' | 'GSKPT23', estado: EstadoCarga = estadoVacio()): PlanCarga => {
  const plan = planCargaFamily(resultado(), estado, {});
  return { ...plan, items: plan.items.filter((i) => i.codigo === codigo) };
};

describe('Family: carga en Shopify (después de confirmar)', () => {
  it('crea el nuevo activo, vendor Familyarg, precio público, costo con centavos, stock en FAMILYARG, y lo publica solo en Point of Sale', async () => {
    const gql = shopify({
      productVariants: () => ({ productVariants: { pageInfo: sinPagina, nodes: [] } }),
      productSet: () => ({ productSet: { product: { id: 'gid://shopify/Product/77', title: 't' }, userErrors: [] } }),
      publishablePublish: () => ({ publishablePublish: { userErrors: [] } }),
    });
    const d = deps(gql);
    const [res] = await ejecutarCargaFamily(planSolo('SHBSPEC'), {}, d);
    expect(res).toMatchObject({ codigo: 'SHBSPEC', estado: 'cargada', productoId: 'gid://shopify/Product/77' });
    const set = gql.mock.calls.find(([q]) => q.includes('productSet'))![1]!;
    const input = set.input as Record<string, unknown> & { variants: Record<string, unknown>[] };
    expect(input).toMatchObject({ title: 'Bermuda Short Familyarg Spectrum Basket Negro Multi', vendor: 'Familyarg', status: 'ACTIVE', productType: 'Bermudas' });
    expect(input.variants[0]).toEqual({
      optionValues: [{ optionName: 'Talle', name: 'S' }], price: '69000',
      inventoryItem: { sku: 'SHBSPEC.S', cost: '29325', tracked: true, measurement: { weight: { value: 750, unit: 'GRAMS' } } },
      inventoryQuantities: [{ locationId: LOC, name: 'available', quantity: 2 }],
    });
    expect(gql.mock.calls.find(([q]) => q.includes('publishablePublish'))![1]).toEqual({ id: 'gid://shopify/Product/77', input: [{ publicationId: POS }] });
    expect(d.reservar).toHaveBeenCalledWith('SHBSPEC', expect.stringContaining('2026-10-30|SHBSPEC|20|'), expect.objectContaining({ accion: 'alta' }));
    expect(d.terminar).toHaveBeenCalledWith('SHBSPEC', 'cargada', expect.objectContaining({
      productoId: 'gid://shopify/Product/77', unidades: 20,
      // Para el registro de cargas: qué talles se cargaron.
      talles: [{ talle: 'S', cantidad: 2 }, { talle: 'M', cantidad: 4 }, { talle: 'L', cantidad: 4 }, { talle: 'XL', cantidad: 6 }, { talle: 'XXL', cantidad: 4 }],
    }));
    expect(d.liberar).not.toHaveBeenCalled();
  });

  it('si Shopify lo rechaza se libera la marca; si la respuesta no llega queda «dudosa» y no se reintenta', async () => {
    const vacio = () => ({ productVariants: { pageInfo: sinPagina, nodes: [] } });
    let d = deps(shopify({ productVariants: vacio, productSet: () => ({ productSet: { product: null, userErrors: [{ message: 'Title is too long' }] } }) }));
    let [res] = await ejecutarCargaFamily(planSolo('SHBSPEC'), {}, d);
    expect(res).toMatchObject({ estado: 'error' });
    expect(res.mensaje).toMatch(/Title is too long/);
    expect(d.liberar).toHaveBeenCalledWith('SHBSPEC');
    expect(d.terminar).not.toHaveBeenCalled();

    const gql = shopify({ productVariants: vacio, productSet: () => { throw new Error('timeout'); } });
    d = deps(gql);
    [res] = await ejecutarCargaFamily(planSolo('SHBSPEC'), {}, d);
    expect(res.estado).toBe('dudosa');
    expect(gql.mock.calls.filter(([q]) => q.includes('productSet'))).toHaveLength(1);
    expect(d.liberar).not.toHaveBeenCalled();
    expect(d.terminar).toHaveBeenCalledWith('SHBSPEC', 'dudosa', expect.anything());
  });

  it('si la app o Shopify rechazan la escritura sin ejecutarla (sesión, límite), no queda dudosa: se libera', async () => {
    expect(noSeEjecuto(new Error('Error de conexión con Shopify (401): {"error":"Autenticación requerida."}'))).toBe(true);
    expect(noSeEjecuto(new Error('Shopify error: [{"message":"Throttled","extensions":{"code":"THROTTLED"}}]'))).toBe(true);
    expect(noSeEjecuto(new Error('Error de conexión con Shopify (502): {"error":"No se pudo consultar Shopify."}'))).toBe(false);
    expect(noSeEjecuto(new Error('Failed to fetch'))).toBe(false);
    const d = deps(shopify({ productVariants: () => ({ productVariants: { pageInfo: sinPagina, nodes: [] } }), productSet: () => { throw new Error('Error de conexión con Shopify (403): {"error":"Origen no permitido."}'); } }));
    const [res] = await ejecutarCargaFamily(planSolo('SHBSPEC'), {}, d);
    expect(res.estado).toBe('error');
    expect(d.liberar).toHaveBeenCalledWith('SHBSPEC');
  });

  it('no crea si mientras tanto apareció el código en Shopify, ni si ya estaba marcado como cargado', async () => {
    let gql = shopify({ productVariants: () => ({ productVariants: { pageInfo: sinPagina, nodes: [{ sku: 'SHBSPEC.S', product: { id: 'p', tags: [] } }] } }) });
    let d = deps(gql);
    let [res] = await ejecutarCargaFamily(planSolo('SHBSPEC'), {}, d);
    expect(res.estado).toBe('error');
    expect(res.mensaje).toMatch(/apareció en Shopify/);
    expect(gql.mock.calls.some(([q]) => q.includes('productSet'))).toBe(false);
    expect(d.liberar).toHaveBeenCalled();

    gql = shopify({});
    d = deps(gql, false);
    [res] = await ejecutarCargaFamily(planSolo('SHBSPEC'), {}, d);
    expect(res.estado).toBe('saltado');
    expect(gql).not.toHaveBeenCalled();
  });

  it('reposición: lo que había + lo entregado, con changeFromQuantity; el talle sin alta se activa con lo entregado', async () => {
    const p = producto('gid://shopify/Product/1', 'Bermuda Short Familyarg Spectrum Negro', { S: 1, M: 0, L: 3, XL: null, XXL: 2 });
    const gql = shopify({
      inventorySetQuantities: () => ({ inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: 'x' }, userErrors: [] } }),
      inventoryActivate: () => ({ inventoryActivate: { inventoryLevel: { id: 'lvl' }, userErrors: [] } }),
    });
    const d = deps(gql);
    const [res] = await ejecutarCargaFamily(planSolo('SHBSPEC', estadoVacio({ porCodigo: { SHBSPEC: [p.id], GSKPT23: [] }, productos: { [p.id]: p } })), {}, d);
    expect(res).toMatchObject({ estado: 'cargada' });
    const set = gql.mock.calls.find(([q]) => q.includes('inventorySetQuantities'))![1]!;
    expect(set.key).toBe('clave-1');
    expect(set.input).toEqual({
      name: 'available', reason: 'received',
      quantities: [
        { inventoryItemId: `${p.id}/inv/S`, locationId: LOC, quantity: 3, changeFromQuantity: 1 },
        { inventoryItemId: `${p.id}/inv/M`, locationId: LOC, quantity: 4, changeFromQuantity: 0 },
        { inventoryItemId: `${p.id}/inv/L`, locationId: LOC, quantity: 7, changeFromQuantity: 3 },
        { inventoryItemId: `${p.id}/inv/XXL`, locationId: LOC, quantity: 6, changeFromQuantity: 2 },
      ],
    });
    expect(gql.mock.calls.find(([q]) => q.includes('inventoryActivate'))![1]).toEqual({ inventoryItemId: `${p.id}/inv/XL`, locationId: LOC, available: 6, key: 'clave-1' });
    expect(gql.mock.calls.some(([q]) => /productSet|productVariantsBulkUpdate|price/.test(q))).toBe(false);
    expect(d.terminar).toHaveBeenCalledWith('SHBSPEC', 'cargada', expect.objectContaining({
      unidades: 20, productoId: p.id,
      talles: [{ talle: 'S', cantidad: 2 }, { talle: 'M', cantidad: 4 }, { talle: 'L', cantidad: 4 }, { talle: 'XXL', cantidad: 4 }, { talle: 'XL', cantidad: 6 }],
    }));
  });

  it('reposición en parte: al registro van solo los talles que Shopify no rechazó', async () => {
    const p = producto('gid://shopify/Product/1', 'Bermuda', { S: 1, M: 0, L: 3, XL: null, XXL: 2 });
    const gql = shopify({
      inventorySetQuantities: () => ({ inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: 'x' }, userErrors: [] } }),
      inventoryActivate: () => ({ inventoryActivate: { inventoryLevel: null, userErrors: [{ message: 'no se puede' }] } }),
    });
    const d = deps(gql);
    const [res] = await ejecutarCargaFamily(planSolo('SHBSPEC', estadoVacio({ porCodigo: { SHBSPEC: [p.id], GSKPT23: [] }, productos: { [p.id]: p } })), {}, d);
    expect(res.estado).toBe('parcial');
    expect(d.terminar).toHaveBeenCalledWith('SHBSPEC', 'parcial', expect.objectContaining({
      unidades: 14, talles: [{ talle: 'S', cantidad: 2 }, { talle: 'M', cantidad: 4 }, { talle: 'L', cantidad: 4 }, { talle: 'XXL', cantidad: 4 }],
    }));
  });

  it('cargar solo una parte de la entrega: lo destildado no se carga y queda para otro día', async () => {
    const gql = shopify({
      productVariants: () => ({ productVariants: { pageInfo: sinPagina, nodes: [] } }),
      productSet: () => ({ productSet: { product: { id: 'gid://shopify/Product/78' }, userErrors: [] } }),
      publishablePublish: () => ({ publishablePublish: { userErrors: [] } }),
    });
    const plan = planCargaFamily(resultado(), estadoVacio(), {});
    const elecciones = { GSKPT23: { clave: 'no' } };
    expect(accionesElegidas(plan, elecciones).map((a) => a.codigo)).toEqual(['SHBSPEC']);
    expect(resumenCarga(plan, elecciones)).toMatchObject({ altas: 1, unidades: 20 });
    const d = deps(gql);
    const res = await ejecutarCargaFamily(plan, elecciones, d);
    expect(res.map((r) => r.codigo)).toEqual(['SHBSPEC']);
    expect(d.reservar).toHaveBeenCalledTimes(1);
    // Al otro día, con la marca del primero, el plan deja cargar solo lo que falta.
    const otroDia = planCargaFamily(resultado(), estadoVacio(), { 'E1|SHBSPEC': { estado: 'cargada', fecha: '2026-11-11T19:00:00Z', firma: 'x' } });
    expect(otroDia.items.map((i) => [i.codigo, i.estado])).toEqual([['SHBSPEC', 'cargado'], ['GSKPT23', 'listo']]);
  });

  it('si el stock cambió desde la vista previa, Shopify rechaza todo y no se suma nada', async () => {
    const p = producto('gid://shopify/Product/1', 'Bermuda', { S: 1, M: 0, L: 3, XL: null, XXL: 2 });
    const gql = shopify({ inventorySetQuantities: () => ({ inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ code: 'CHANGE_FROM_QUANTITY_STALE', message: 'stale' }] } }) });
    const d = deps(gql);
    const [res] = await ejecutarCargaFamily(planSolo('SHBSPEC', estadoVacio({ porCodigo: { SHBSPEC: [p.id], GSKPT23: [] }, productos: { [p.id]: p } })), {}, d);
    expect(res.estado).toBe('error');
    expect(res.mensaje).toMatch(/cambió desde que armaste la carga/);
    expect(gql.mock.calls.some(([q]) => q.includes('inventoryActivate'))).toBe(false);
    expect(d.liberar).toHaveBeenCalledWith('SHBSPEC');
  });

  it('al vincular un Family sin SKU por nombre, suma el stock y le agrega la etiqueta del código', async () => {
    const familia = [{ id: 'gid://shopify/Product/9', titulo: 'Bermuda Short Familyarg Spectrum Basket Negro Multi', estado: 'ACTIVE', etiquetas: [] }];
    const p = producto('gid://shopify/Product/9', familia[0].titulo, { S: 0, M: 0, L: 0, XL: 0, XXL: 0 });
    const gql = shopify({
      inventorySetQuantities: () => ({ inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: 'x' }, userErrors: [] } }),
      tagsAdd: () => ({ tagsAdd: { node: { id: p.id }, userErrors: [] } }),
    });
    const [res] = await ejecutarCargaFamily(planSolo('SHBSPEC', estadoVacio({ familia, productos: { [p.id]: p } })), { SHBSPEC: { clave: `repo:${p.id}` } }, deps(gql));
    expect(res.estado).toBe('cargada');
    expect(gql.mock.calls.find(([q]) => q.includes('tagsAdd'))![1]).toEqual({ id: p.id, tags: ['SHBSPEC'] });
  });
});
