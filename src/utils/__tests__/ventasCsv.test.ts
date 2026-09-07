// ============================================================================
// PEDIDO DESDE EL EXPORT DE VENTAS — se corre contra el archivo REAL de Wanda
// ----------------------------------------------------------------------------
// ⚠ LA REGLA QUE CUIDA ESTE ARCHIVO:
//   el mismo talle AR NO da siempre el mismo talle US. Depende de la curva del
//   modelo. Si algún día alguien "simplifica" la conversión a una sola tabla,
//   estos tests fallan. Si fallan, el cambio está mal.
// ============================================================================
import { describe, it, expect, vi } from 'vitest';

const graphql = vi.fn();
vi.mock('../shopify', () => ({
  shopifyGraphQL: (...a: any[]) => graphql(...a),
  mismaSucursal: (a: string, b: string) => String(a).trim() === String(b).trim(),
}));

import { leerVentasCsv, partirNombre, normTitulo, armarPedidoDesdeVentas } from '../ventasCsv';

// Shopify devuelve estos productos, con su etiqueta de código.
function tienda(productos: { title: string; tags: string; vendor?: string }[]) {
  graphql.mockImplementation(() => Promise.resolve({
    products: {
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: productos.map((p) => ({ node: { handle: 'h', title: p.title, vendor: p.vendor || 'Converse', tags: p.tags } })),
    },
  }));
}

const csv = (filas: string[]) =>
  'Name,Created at,Lineitem quantity,Lineitem name,Lineitem sku,Vendor,Cancelled at\n' + filas.join('\n');

describe('lectura del export de ventas', () => {
  it('separa el talle del nombre del producto', () => {
    expect(partirNombre('Zapatillas Converse Ctas Logan Ox Negro - 41'))
      .toEqual({ titulo: 'Zapatillas Converse Ctas Logan Ox Negro', talle: '41' });
    // Los nombres con guiones adentro no se rompen: parte por el ÚLTIMO.
    expect(partirNombre('Zapatillas Puff Taylor Ox Negro/Classic - Gold - 43'))
      .toEqual({ titulo: 'Zapatillas Puff Taylor Ox Negro/Classic - Gold', talle: '43' });
  });

  it('ignora las órdenes canceladas', () => {
    const l = leerVentasCsv(csv([
      '#1,2026-09-07,1,Zapa - 41,,Converse,',
      '#2,2026-09-07,1,Zapa - 42,,Converse,2026-09-07 10:00',
    ]));
    expect(l).toHaveLength(1);
    expect(l[0].talleAr).toBe('41');
  });

  it('normaliza el título para poder cruzarlo con Shopify', () => {
    expect(normTitulo('  Zapatillas   Converse  Ctás  ')).toBe('ZAPATILLAS CONVERSE CTAS');
  });
});

describe('conversión del talle a pedir', () => {
  it('EL MISMO AR DA DISTINTO US SEGÚN LA CURVA', async () => {
    tienda([
      { title: 'Zapa A', tags: 'A09429C, TABLA DE TALLE CONVERSE 2' },
      { title: 'Zapa B', tags: 'A16122C, TABLA DE TALLE CONVERSE 1' },
    ]);
    const res = await armarPedidoDesdeVentas(leerVentasCsv(csv([
      '#1,2026-09-07,1,Zapa A - 38,,Converse,',
      '#2,2026-09-07,1,Zapa B - 38,,Converse,',
    ])));
    const a = res.filas.find((f) => f.codigo === 'A09429C');
    const b = res.filas.find((f) => f.codigo === 'A16122C');
    expect(a!.tallePedido).toBe('5.5');
    expect(b!.tallePedido).toBe('6.5');
  });

  it('suma las cantidades del mismo código y talle', async () => {
    tienda([{ title: 'Zapa A', tags: 'A16758C, TABLA DE TALLE CONVERSE 1' }]);
    const res = await armarPedidoDesdeVentas(leerVentasCsv(csv([
      '#1,2026-09-07,2,Zapa A - 41,,Converse,',
      '#2,2026-09-07,3,Zapa A - 41,,Converse,',
    ])));
    expect(res.filas).toHaveLength(1);
    expect(res.filas[0].cantidad).toBe(5);
    expect(res.filas[0].tallePedido).toBe('8.5');
  });

  it('Le Coq calzado: el talle a pedir es UNO MÁS', async () => {
    tienda([{ title: 'Zapa LC', tags: 'LFO0125230', vendor: 'Le Coq Sportif' }]);
    const res = await armarPedidoDesdeVentas(leerVentasCsv(csv([
      '#1,2026-09-07,1,Zapa LC - 40,,Le Coq Sportif,',
    ])));
    expect(res.filas[0].tallePedido).toBe('41');
  });

  it('la ropa va con el talle tal cual (no se convierte)', async () => {
    tienda([{ title: 'Remera X', tags: 'D1605901' }]);
    const res = await armarPedidoDesdeVentas(leerVentasCsv(csv([
      '#1,2026-09-07,1,Remera X - M,,Converse,',
    ])));
    expect(res.filas[0].tallePedido).toBe('M');
  });

  it('las otras marcas se ignoran (no son de iD)', async () => {
    tienda([]);
    const res = await armarPedidoDesdeVentas(leerVentasCsv(csv([
      '#1,2026-09-07,1,Zapatillas Vans - 43,,Vans,',
    ])));
    expect(res.filas).toHaveLength(0);
    expect(res.ignoradas).toBe(1);
  });

  it('SIN curva NO adivina: la fila va a Revisar', async () => {
    // El producto existe pero no tiene etiqueta de tabla ni está en el maestro.
    tienda([{ title: 'Zapa rara', tags: 'ZZ9999Z' }]);
    const res = await armarPedidoDesdeVentas(leerVentasCsv(csv([
      '#1,2026-09-07,1,Zapa rara - 41,,Converse,',
    ])));
    expect(res.filas).toHaveLength(0);
    expect(res.revisar).toHaveLength(1);
    expect(res.revisar[0].motivo).toBeTruthy();
  });

  it('si el producto no está en Shopify lo dice, no lo tira', async () => {
    tienda([]);
    const res = await armarPedidoDesdeVentas(leerVentasCsv(csv([
      '#1,2026-09-07,1,Zapa fantasma - 41,,Converse,',
    ])));
    expect(res.revisar).toHaveLength(1);
    expect(res.revisar[0].motivo).toMatch(/no encontré este producto/i);
  });
});
