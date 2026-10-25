// ============================================================================
// REPOSICIÓN POR VENTAS — lo que cuida este archivo:
//   1) Solo cuenta la marca elegida; canceladas, de prueba y devueltas no suman.
//   2) Los 3 días son un subconjunto de los 15.
//   3) Nivel de inventario null = sin alta en la sucursal, NO cero.
//   4) Talle a pedir con la etiqueta TABLA DE TALLE; sin tabla no se adivina.
//   5) Órdenes con muchas líneas se leen completas; THROTTLED se reintenta.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acumularVentas, nuevaAcumulacion, armarModelo, esCalzado, filtrarModelos, consultarReposicion } from '../reposicionVentas';
import type { OrdenVenta, ProductoShopify, ModeloReposicion } from '../reposicionVentas';
import { shopifyGraphQL } from '../shopify';
vi.mock('../shopify', async importOriginal => ({ ...await importOriginal<typeof import('../shopify')>(), shopifyGraphQL: vi.fn() }));

const pag = <T,>(nodes: T[], endCursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: !!endCursor, endCursor } });
const linea = (variant: string, q = 1, vendor = 'Converse', product = 'P1') => ({ currentQuantity: q, vendor, variant: { id: variant }, product: { id: product } });
const orden = (createdAt: string, lineas: ReturnType<typeof linea>[], extra: Partial<OrdenVenta> = {}): OrdenVenta =>
  ({ id: 'o' + createdAt, createdAt, cancelledAt: null, test: false, lineItems: pag(lineas), ...extra });
const nivel = (quantity: number) => ({ quantities: [{ name: 'available', quantity }] });
const variante = (id: string, talle: string, mar: number | null, idl: number | null) => ({
  id, title: talle, selectedOptions: [{ name: 'Talle', value: talle }],
  inventoryItem: { mar: mar === null ? null : nivel(mar), idl: idl === null ? null : nivel(idl) },
});
const producto = (variants = [variante('v40', '40', 1, 10), variante('v39', '39', null, 3), variante('v41', '41', 0, 0)]): ProductoShopify => ({
  id: 'P1', title: 'Zapatillas Converse Sport Casual Ox Blanco', vendor: 'Converse', productType: 'Calzado', status: 'ACTIVE',
  tags: ['A11716C', 'TABLA DE TALLE CONVERSE 1'], variants: pag(variants),
});
const corte = new Date('2026-10-22T12:00:00Z');

describe('ventas por variante', () => {
  it('suma la marca elegida, separa los últimos 3 días y saltea canceladas, de prueba y devueltas', () => {
    const acc = acumularVentas(nuevaAcumulacion(), [
      orden('2026-10-12T10:00:00Z', [linea('v40', 2), linea('x', 5, 'Reebok', 'R1')]),
      orden('2026-10-24T10:00:00Z', [linea('v40', 1), linea('v41', 0)]),
      orden('2026-10-24T11:00:00Z', [linea('v40', 9)], { cancelledAt: '2026-10-24T12:00:00Z' }),
      orden('2026-10-24T13:00:00Z', [linea('v40', 9)], { test: true }),
      orden('2026-10-24T14:00:00Z', [linea('x', 1, 'Reebok', 'R1')]),
    ], 'converse', corte);
    expect(acc.porProducto.get('P1')!.get('v40')).toEqual({ v15: 3, v3: 1 });
    expect(acc.porProducto.has('R1')).toBe(false);
    expect(acc.porProducto.get('P1')!.has('v41')).toBe(false);
    expect(acc.ordenes).toBe(2);
  });

  it('Le Coq se reconoce por el vendor', () => {
    const acc = acumularVentas(nuevaAcumulacion(), [orden('2026-10-24T10:00:00Z', [linea('a', 1, 'Le Coq Sportif'), linea('b', 1)])], 'lecoq', corte);
    expect([...acc.porProducto.get('P1')!.keys()]).toEqual(['a']);
  });

  it('líneas sin variante (producto borrado) se cuentan aparte', () => {
    const acc = acumularVentas(nuevaAcumulacion(), [orden('2026-10-24T10:00:00Z', [{ currentQuantity: 2, vendor: 'Converse', variant: null, product: null }])], 'converse', corte);
    expect(acc.sinVariante).toBe(2);
    expect(acc.porProducto.size).toBe(0);
  });
});

describe('modelo con sus talles', () => {
  const ventas = new Map([['v40', { v15: 4, v3: 2 }], ['borrada', { v15: 1, v3: 0 }]]);
  const m = armarModelo('converse', producto(), ventas);

  it('todos los talles ordenados, con ventas, stock y talle de iD por la etiqueta', () => {
    expect(m.variantes.map(v => [v.talle, v.tallePedido, v.vendidos15, v.vendidos3, v.martinez, v.idStock])).toEqual([
      ['39', '7', 0, 0, null, 3],
      ['40', '8', 4, 2, 1, 10],
      ['41', '8.5', 0, 0, 0, 0],
    ]);
    expect(m).toMatchObject({ codigo: 'A11716C', calzado: true, vendidos15: 5, vendidos3: 2, martinez: 1, idStock: 13 });
    expect(m.aviso).toMatch(/1 vendidos de talles que ya no existen/);
  });

  it('sin alta en la sucursal NO es cero', () => {
    expect(m.variantes[0].martinez).toBeNull();
  });

  it('sin tabla ni código conocido: no adivina el talle de iD', () => {
    const p = producto(); p.tags = ['ZZZ999'];
    const v = armarModelo('converse', p, new Map()).variantes[0];
    expect(v.tallePedido).toBeNull();
    expect(v.motivo).toBeTruthy();
  });

  it('Le Coq calzado AR+1; ropa con letras tal cual', () => {
    const p = producto(); p.vendor = 'Le Coq Sportif'; p.title = 'Zapatillas Le Coq Sportif Strider'; p.tags = ['LFO0125017'];
    expect(armarModelo('lecoq', p, new Map()).variantes[1].tallePedido).toBe('41');
    const r = producto([variante('s', 'M', 1, 2)]); r.title = 'Remera Le Coq Sportif'; r.productType = 'Remera'; r.vendor = 'Le Coq Sportif';
    const mr = armarModelo('lecoq', r, new Map());
    expect(mr.variantes[0].tallePedido).toBe('M');
    expect(mr.calzado).toBe(false);
  });
});

describe('qué es zapatilla', () => {
  const base = { vendor: 'Converse', productType: '', tags: [] as string[] };
  it.each([
    [{ ...base, title: 'Zapatillas Converse X' }, true],
    [{ ...base, title: 'Converse Run Star', tags: ['TABLA DE TALLE CONVERSE 2'] }, true],
    [{ ...base, title: 'Converse Algo', productType: 'Calzado' }, true],
    [{ ...base, title: 'Remera Converse Logo', productType: 'Calzado' }, false],
    [{ ...base, title: 'Medias Converse X3' }, false],
    [{ ...base, title: 'Converse Algo' }, false],
  ])('%o → %s', (p, esperado) => expect(esCalzado(p, ['40'])).toBe(esperado));
});

describe('filtros', () => {
  const mod = (titulo: string, v15: number, v3: number, calzado = true) => ({ productId: titulo, titulo, codigo: null, estado: 'ACTIVE', calzado, vendidos15: v15, vendidos3: v3, martinez: 0, idStock: 1, variantes: [] }) as ModeloReposicion;
  const modelos = [mod('A', 6, 0), mod('B', 10, 1), mod('C', 7, 5), mod('D', 5, 5), mod('Remera', 20, 9, false)];
  it('mínimo de ventas en 15 días, solo zapatillas, orden por 15 o 3 días', () => {
    expect(filtrarModelos(modelos, { minimo: 6, soloCalzado: true, orden: 'v15' }).map(m => m.titulo)).toEqual(['B', 'C', 'A']);
    expect(filtrarModelos(modelos, { minimo: 6, soloCalzado: true, orden: 'v3' }).map(m => m.titulo)).toEqual(['C', 'B', 'A']);
    expect(filtrarModelos(modelos, { minimo: 6, soloCalzado: false, orden: 'v15' })[0].titulo).toBe('Remera');
  });
});

describe('lectura de Shopify', () => {
  beforeEach(() => vi.clearAllMocks());
  const mock = vi.mocked(shopifyGraphQL);

  it('lee órdenes completas, reintenta THROTTLED y arma los modelos', async () => {
    const larga = orden('2026-10-24T10:00:00Z', [linea('v40', 1)]);
    larga.lineItems = pag([linea('v40', 1)], 'c1');
    let throttled = false;
    mock.mockImplementation(async (q: string, vars: any) => {
      if (q.includes('RepoSucursales')) return { locations: pag([{ id: 'L1', name: '🟢 DEPOSITO MARTINEZ' }, { id: 'L2', name: 'ID (Converse - Le Coq Sportif)' }]) };
      if (q.includes('RepoVentas')) {
        expect(vars.q).toMatch(/^created_at:>='2026-10-10T12:00:00.000Z'$/);
        if (!throttled) { throttled = true; throw new Error('Shopify error: [{"extensions":{"code":"THROTTLED"}}]'); }
        return { orders: pag([larga]) };
      }
      if (q.includes('RepoLineas')) return { order: { lineItems: pag([linea('v39', 2)]) } };
      if (q.includes('RepoVariantes')) {
        expect(vars).toMatchObject({ q: 'product_id:P1', mar: 'L1', idl: 'L2' });
        const p = producto();
        return { productVariants: pag(p.variants.nodes.map(v => ({ ...v, product: { ...p, variants: undefined } }))) };
      }
      throw new Error('consulta inesperada');
    });
    const r = await consultarReposicion('converse', undefined, new Date('2026-10-25T12:00:00Z'), 1);
    expect(r.ordenes).toBe(1);
    expect(r.modelos).toHaveLength(1);
    expect(r.modelos[0]).toMatchObject({ vendidos15: 3, vendidos3: 3 });
    expect(r.modelos[0].variantes.find(v => v.talle === '39')!.vendidos15).toBe(2);
  });

  it('otro error de Shopify corta la consulta, sin resultados a medias', async () => {
    mock.mockImplementation(async (q: string) => {
      if (q.includes('RepoSucursales')) return { locations: pag([{ id: 'L1', name: 'DEPOSITO MARTINEZ' }, { id: 'L2', name: 'ID (Converse - Le Coq Sportif)' }]) };
      throw new Error('Shopify error: ACCESS_DENIED');
    });
    await expect(consultarReposicion('converse', undefined, new Date(), 1)).rejects.toThrow(/ACCESS_DENIED/);
  });

  it('sin la sucursal de iD no inventa stock', async () => {
    mock.mockResolvedValue({ locations: pag([{ id: 'L1', name: 'DEPOSITO MARTINEZ' }]) });
    await expect(consultarReposicion('converse', undefined, new Date(), 1)).rejects.toThrow(/ID \(Converse/);
  });
});
