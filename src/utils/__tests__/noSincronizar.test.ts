// ============================================================================
// ETIQUETA «NO SINCRONIZAR» (30-oct-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Un producto con esa etiqueta en Shopify queda FUERA de la actualización de
// stock: no se le escribe el número del proveedor, no se le barren talles a
// cero y, si el proveedor ya no lo lista, tampoco se lo apaga entero.
// Caso real: un modelo pedido completo a iD que se tiene que seguir vendiendo.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const graphql = vi.fn();
vi.mock('../shopify', () => ({
  shopifyGraphQL: (...a: any[]) => graphql(...a),
  mismaSucursal: (a: string, b: string) => String(a).trim() === String(b).trim(),
}));

import { planStockWrite, tieneEtiquetaNoSincronizar } from '../writeStock';

const LOC = 'gid://shopify/Location/1';

function variante(handle: string, talle: string, cantidad: number) {
  return {
    id: `gid://shopify/ProductVariant/${handle}-${talle}`, title: talle, sku: `${handle}-${talle}`,
    inventoryItem: { id: `inv-${handle}-${talle}`, inventoryLevel: { quantities: [{ name: 'available', quantity: cantidad }] } },
  };
}

function responder(productos: { handle: string; tags: string; variantes: any[] }[]) {
  graphql.mockImplementation((query: string) => {
    if (String(query).includes('locations')) {
      return Promise.resolve({ locations: { edges: [{ node: { id: LOC, name: 'ID (Converse - Le Coq Sportif)' } }] } });
    }
    return Promise.resolve({ products: { edges: productos.map(p => ({ node: {
      handle: p.handle, title: 'Zapatillas ' + p.handle, tags: p.tags, variants: { edges: p.variantes.map(n => ({ node: n })) },
    } })) } });
  });
}

beforeEach(() => graphql.mockReset());

describe('etiqueta NO SINCRONIZAR', () => {
  it('reconoce la etiqueta sin importar mayúsculas ni espacios', () => {
    expect(tieneEtiquetaNoSincronizar('A10564C, no sincronizar, TABLA DE TALLE CONVERSE 1')).toBe(true);
    expect(tieneEtiquetaNoSincronizar(['NO  SINCRONIZAR '])).toBe(true);
    expect(tieneEtiquetaNoSincronizar('A10564C, sincronizar')).toBe(false);
    expect(tieneEtiquetaNoSincronizar('')).toBe(false);
  });

  it.each(['converse', 'lecoq'])('%s: no escribe stock, no barre talles ni apaga el producto etiquetado', async brand => {
    responder([
      { handle: 'pedida', tags: 'NO SINCRONIZAR', variantes: [variante('pedida', 'M', 5), variante('pedida', 'L', 3)] },
      { handle: 'normal', tags: '', variantes: [variante('normal', 'M', 5), variante('normal', 'L', 3)] },
      { handle: 'ausente', tags: 'AUS1234C, No Sincronizar', variantes: [variante('ausente', 'M', 7)] },
    ]);
    const result = {
      excelMap: {
        ped1234c: { foundInShopify: true, shopifyHandle: 'pedida', title: 'Pedida', sizes: { M: 1 } },
        nor1234c: { foundInShopify: true, shopifyHandle: 'normal', title: 'Normal', sizes: { M: 1 } },
      },
      enPeligro: [{ handle: 'ausente', titulo: 'Zapatillas ausente', codigo: 'AUS1234C', stockProveedor: 7, talles: ['M'] }],
    } as any;
    const plan = await planStockWrite(result, { brand } as any);
    // Solo el producto sin etiqueta recibe cambios: M al número del archivo, L barrido a 0.
    expect(plan.changes.map(c => [c.handle, c.talle, c.desired])).toEqual([['normal', 'M', 1], ['normal', 'L', 0]]);
    expect(plan.excluidos.map(e => [e.handle, e.code])).toEqual([['pedida', 'PED1234C'], ['ausente', 'AUS1234C']]);
    expect(plan.unchangedRows).toEqual([]);
    expect(plan.notFound).toEqual([]);
  });
});
