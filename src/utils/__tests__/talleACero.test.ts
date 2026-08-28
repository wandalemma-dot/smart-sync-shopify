// ============================================================================
// RED DE SEGURIDAD — TALLES QUE EL PROVEEDOR YA NO TIENE VAN A CERO
// ----------------------------------------------------------------------------
// Regla de Wanda (28-ago-2026), dicha así:
//   "Si yo en mi tienda tengo un talle 42 y vos en esta tabla lo ves con un
//    guión, o en gris, o en blanco, lo que sea, lo tenés que poner en cero."
//
// El Excel de iD trae por producto SOLO los talles con stock; el resto viene
// con guión en celda gris. Antes esos talles se salteaban y se quedaban en
// Shopify con el stock viejo, disponibles para la venta, para siempre.
//
// ⚠ DOS COSAS QUE ESTE ARCHIVO CUIDA Y NO SE TOCAN:
//   1) El barrido corre SOLO en Converse y Le Coq, donde el Excel es el
//      catálogo completo del proveedor. Las otras marcas mandan listas
//      parciales: poner en 0 lo que no aparece les borraría stock real.
//   2) Si de un producto hubo UN talle que no se supo convertir, ese producto
//      NO se barre. Si no, un error de conversión pondría en 0 un talle que el
//      proveedor sí tiene.
//
// ⚠ SI UN CAMBIO HACE FALLAR ESTE ARCHIVO, EL CAMBIO ESTÁ MAL.
//   Correr con: npm test
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const graphql = vi.fn();
vi.mock('../shopify', () => ({
  shopifyGraphQL: (...a: any[]) => graphql(...a),
  mismaSucursal: (a: string, b: string) => String(a).trim() === String(b).trim(),
}));

import { planStockWrite } from '../writeStock';

const LOC = 'gid://shopify/Location/1';

// Arma una variante de Shopify con su stock en la sucursal.
function variante(talle: string, cantidad: number | null, id = 'inv-' + talle) {
  return {
    title: talle,
    sku: 'SKU-' + talle,
    inventoryItem: {
      id,
      // inventoryLevel null = la variante NO está dada de alta en la sucursal.
      inventoryLevel: cantidad === null ? null : { quantities: [{ name: 'available', quantity: cantidad }] },
    },
  };
}

function responder(variantes: any[], tags = 'TABLA DE TALLE CONVERSE 1') {
  graphql.mockImplementation((query: string) => {
    if (String(query).includes('locations')) {
      return Promise.resolve({ locations: { edges: [{ node: { id: LOC, name: 'ID (Converse - Le Coq Sportif)' } }] } });
    }
    return Promise.resolve({
      products: { edges: [{ node: { handle: 'zapa', title: 'Zapatillas Converse Chuck Taylor', tags, variants: { edges: variantes.map((n) => ({ node: n })) } } }] },
    });
  });
}

// El Excel solo trae los talles CON stock: acá US 8 (=AR 40 en la tabla 1).
function resultado(sizes: Record<string, number>) {
  return {
    excelMap: { zz9999z: { foundInShopify: true, shopifyHandle: 'zapa', title: 'Chuck Taylor', sizes } },
    enPeligro: [],
  } as any;
}

const cfg = (brand: string) => ({ brand } as any);

beforeEach(() => graphql.mockReset());

describe('talles que el proveedor ya no tiene', () => {
  it('pone en 0 el talle que tiene stock en Shopify y no viene en el Excel', async () => {
    responder([variante('40', 5), variante('42', 7)]);
    const plan = await planStockWrite(resultado({ '8': 5 }), cfg('converse'));

    const aCero = plan.changes.filter((c) => c.desired === 0);
    expect(aCero).toHaveLength(1);
    expect(aCero[0].talle).toBe('42');
    expect(aCero[0].current).toBe(7);
    expect(aCero[0].motivo).toBe('El proveedor ya no tiene este talle');
  });

  it('no toca el talle que ya está en 0 (no ensucia la lista)', async () => {
    responder([variante('40', 5), variante('42', 0)]);
    const plan = await planStockWrite(resultado({ '8': 5 }), cfg('converse'));
    expect(plan.changes.filter((c) => c.desired === 0)).toHaveLength(0);
  });

  it('no toca el talle que ni siquiera está dado de alta en la sucursal', async () => {
    responder([variante('40', 5), variante('42', null)]);
    const plan = await planStockWrite(resultado({ '8': 5 }), cfg('converse'));
    expect(plan.changes.filter((c) => c.desired === 0)).toHaveLength(0);
  });

  it('NO barre las marcas que mandan listas parciales (Orchard)', async () => {
    responder([variante('40', 5), variante('42', 7)]);
    const plan = await planStockWrite(resultado({ '40': 5 }), cfg('orchard'));
    expect(plan.changes.filter((c) => c.desired === 0)).toHaveLength(0);
  });

  it('NO barre un producto si hubo un talle que no se supo convertir', async () => {
    // US 99 no existe en ninguna tabla: la conversión falla. Ese producto queda
    // afuera del barrido aunque el 42 tenga stock y no venga en el Excel.
    responder([variante('40', 5), variante('42', 7)]);
    const plan = await planStockWrite(resultado({ '8': 5, '99': 3 }), cfg('converse'));
    expect(plan.changes.filter((c) => c.desired === 0)).toHaveLength(0);
    expect(plan.notFound.some((r) => r.talleProveedor === '99')).toBe(true);
  });

  it('sigue escribiendo normalmente los talles que sí vienen en el Excel', async () => {
    responder([variante('40', 5)]);
    const plan = await planStockWrite(resultado({ '8': 12 }), cfg('converse'));
    const cambio = plan.changes.find((c) => c.talle === '40');
    expect(cambio?.current).toBe(5);
    expect(cambio?.desired).toBe(12);
    expect(cambio?.motivo).toBeUndefined();
  });
});

// ============================================================================
// La etiqueta del producto MANDA sobre el maestro de curvas (28-ago-2026).
// Medido contra la tienda real: en los 8 productos donde no coincidían, la
// etiqueta acertó 64 talles y el maestro 43, y el maestro perdía 512 unidades
// en variantes que no existen en Shopify.
// ============================================================================
describe('qué tabla de talle se usa', () => {
  it('la etiqueta de Shopify le gana al maestro de curvas', async () => {
    // A10547C está en el maestro como tabla 2 (US 8.5 -> AR 41.5), pero su
    // etiqueta dice TABLA 1 (US 8.5 -> AR 41) y en la tienda solo existe el 41.
    responder([variante('41', 4)], 'TABLA DE TALLE CONVERSE 1, A10547C');
    const plan = await planStockWrite(
      { excelMap: { a10547c: { foundInShopify: true, shopifyHandle: 'zapa', title: 'Sport Casual', sizes: { '8.5': 50 } } }, enPeligro: [] } as any,
      cfg('converse'),
    );
    expect(plan.notFound).toHaveLength(0);
    expect(plan.changes.find((c) => c.talle === '41')?.desired).toBe(50);
  });

  it('no barre a cero un producto si quedó stock del proveedor sin ubicar', async () => {
    // El proveedor manda un talle que no se pudo ubicar -> el 42, que tiene
    // stock y no viene en el archivo, NO se toca.
    responder([variante('41', 4), variante('42', 116)], 'TABLA DE TALLE CONVERSE 1, A10547C');
    const plan = await planStockWrite(
      { excelMap: { a10547c: { foundInShopify: true, shopifyHandle: 'zapa', title: 'Sport Casual', sizes: { '8.5': 50, '13': 7 } } }, enPeligro: [] } as any,
      cfg('converse'),
    );
    expect(plan.notFound.length).toBeGreaterThan(0);
    expect(plan.changes.filter((c) => c.desired === 0)).toHaveLength(0);
  });
});
