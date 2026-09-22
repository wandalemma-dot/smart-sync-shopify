import { describe, expect, it, vi } from 'vitest';
import { buildMatrixProducts, downloadMatrixCSV, tituloNuevoConverse } from '../syncLogic';
import type { SyncResult } from '../syncLogic';
import { createProducts } from '../createProducts';
const { graphql, download } = vi.hoisted(() => ({ graphql: vi.fn(), download: vi.fn() }));
vi.mock('../shopify', () => ({ shopifyGraphQL: graphql, mismaSucursal: (a: string, b: string) => a === b }));
vi.mock('../csv', async original => ({ ...await original<typeof import('../csv')>(), triggerDownload: download }));
const config = { brand: 'converse' as const, sheetName: '' };
const resultado: SyncResult = {
  missingProducts: [{ coditm: 'CTN0325031', title: 'CONS ZIP JACKET GREEN', sizes: { M: 2, L: 3 }, wholesale: 100, publicPrice: 227, costFinal: 93 }],
  excelMap: {}, enPeligro: [], alerts: [], updatesToApply: [],
};
describe('nombres de indumentaria Converse', () => {
  it.each([
    ['STAR CHEVRON TEE BLUE', 'Remera Converse Star Chevron Azul'],
    ['CONS ZIP JACKET GREEN', 'Campera Converse Cons Zip Verde'],
    ['CONS ZIP JACKET BLACK', 'Campera Converse Cons Zip Negro'],
    ['PATCH MEN JOGGER CELESTE', 'Pantalón Converse Patch Men Celeste'],
    ['STAR CHEVRON CONVERSE TEE GREEN', 'Remera Converse Star Chevron Verde'],
    ['NOVA TEE GENDER FREE BLACK', 'Remera Converse Nova Gender Free Negro'],
    ['cons zip jacket green', 'Campera Converse Cons Zip Verde'],
  ])('%s → %s', (original, esperado) => expect(tituloNuevoConverse(original, -1)).toBe(esperado));
  it('conserva calzado y nombres sin palabras reconocidas', () => {
    expect(tituloNuevoConverse('CHUCK 70 HI BLACK', 1)).toBe('Zapatillas Converse Chuck 70 Hi Negro');
    expect(tituloNuevoConverse('STEEL CAP BLACK', 0)).toBe('Converse Steel Cap Negro');
  });
  it('usa el mismo nombre en vista previa, matriz, CSV y alta, conservando variantes', async () => {
    const titulo = tituloNuevoConverse(resultado.missingProducts[0].title, -1);
    const [p] = buildMatrixProducts(resultado, config);
    expect(p.title).toBe(titulo);
    expect(p.variants.map(v => [v.optionValue, v.qty])).toEqual([['M', 2], ['L', 3]]);
    downloadMatrixCSV(resultado, config);
    expect(download.mock.calls[0][0]).toContain(titulo);
    graphql.mockResolvedValueOnce({ locations: { edges: [{ node: { id: 'loc', name: 'ID (Converse - Le Coq Sportif)' } }] } })
      .mockResolvedValueOnce({ publications: { edges: [] } })
      .mockResolvedValueOnce({ productSet: { product: { id: 'p' }, userErrors: [] } });
    expect((await createProducts(resultado, config)).created).toBe(1);
    expect(graphql.mock.calls[2][1].input.title).toBe(titulo);
  });
});
