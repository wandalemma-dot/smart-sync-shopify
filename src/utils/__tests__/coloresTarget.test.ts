// Target — separar por colores lo ya cargado (21-nov-2026, gax). Shopify simulado: sin escrituras reales.
import { describe, it, expect, vi } from 'vitest';
import { colorDelGrupo, ejecutarSepararColores, leerGrupoColores, nombreBase, planSepararColores, type GrupoColores, type MiembroColor } from '../coloresTarget';

const LOC = 'gid://shopify/Location/1';
const miembro = (x: Partial<MiembroColor>): MiembroColor => ({
  id: 'gid://shopify/Product/1', titulo: 'Gorra Reebok T3', vendor: 'Reebok', productType: 'Gorra', estado: 'ACTIVE', etiquetas: ['Target', '60028'],
  color: '', variantes: 1, varianteId: 'gid://shopify/ProductVariant/1', sku: '60028', inventoryItemId: 'gid://shopify/InventoryItem/1', seguimiento: true,
  precio: 30300, costo: 12510, disponible: 16, comprometido: 0, ...x,
});
const grupo = (miembros: MiembroColor[]): GrupoColores => ({ codigo: '60028', locationId: LOC, posId: 'gid://shopify/Publication/9', miembros, ajenos: [] });

describe('colorDelGrupo', () => {
  it('reconoce el original y los colores del código, y nada más', () => {
    expect(colorDelGrupo('60028', '60028')).toBe('');
    expect(colorDelGrupo('60028-NEGRO', '60028')).toBe('NEGRO');
    expect(colorDelGrupo('60028-AZUL-MARINO', '60028')).toBe('AZUL-MARINO');
    expect(colorDelGrupo('600281', '60028')).toBeNull();
    expect(colorDelGrupo('16043', '60028')).toBeNull();
  });
});

describe('leerGrupoColores', () => {
  it('lee solo los productos de Target del código, el original primero', async () => {
    const productos: Record<string, unknown> = {
      'gid://shopify/Product/2': { id: 'gid://shopify/Product/2', title: 'Gorra Reebok T3 Negro', vendor: 'Reebok', productType: 'Gorra', status: 'ACTIVE', tags: ['Target', '60028', 'Negro'],
        variants: { nodes: [{ id: 'v2', sku: '60028-NEGRO', price: '30300.00', inventoryItem: { id: 'i2', tracked: true, unitCost: { amount: '12510.0' }, inventoryLevel: { quantities: [{ name: 'available', quantity: 3 }, { name: 'committed', quantity: 0 }] } } }] } },
      'gid://shopify/Product/1': { id: 'gid://shopify/Product/1', title: 'Gorra Reebok T3', vendor: 'Reebok', productType: 'Gorra', status: 'ACTIVE', tags: ['Target', '60028'],
        variants: { nodes: [{ id: 'v1', sku: '60028', price: '30300.00', inventoryItem: { id: 'i1', tracked: true, unitCost: { amount: '12510.0' }, inventoryLevel: { quantities: [{ name: 'available', quantity: 13 }, { name: 'committed', quantity: 1 }] } } }] } },
      'gid://shopify/Product/3': { id: 'gid://shopify/Product/3', title: 'Remera de otra marca', vendor: 'X', productType: 'Remera', status: 'ACTIVE', tags: ['60028'],
        variants: { nodes: [{ id: 'v3', sku: '60028', price: '1', inventoryItem: { id: 'i3', tracked: true, unitCost: null, inventoryLevel: null } }] } },
    };
    const gql = vi.fn(async (q: string, v: Record<string, unknown>) => {
      if (q.includes('locations')) return { locations: { nodes: [{ id: 'x', name: 'ID (Converse - Le Coq Sportif)' }, { id: LOC, name: 'DEPOSITO MARTINEZ' }] } };
      if (q.includes('publications')) return { publications: { nodes: [{ id: 'pos', name: 'Point of Sale' }] } };
      if (q.includes('BuscarColores')) {
        expect(v.q).toBe('sku:60028* OR tag:60028');
        return { productVariants: { nodes: [
          { sku: '60028-NEGRO', product: { id: 'gid://shopify/Product/2', tags: ['Target'] } },
          { sku: '60028', product: { id: 'gid://shopify/Product/1', tags: ['Target'] } },
          { sku: '600281', product: { id: 'gid://shopify/Product/4', tags: ['Target'] } },
          { sku: '60028', product: { id: 'gid://shopify/Product/3', tags: [] } },
        ] } };
      }
      if (q.includes('ProductoColores')) return { product: productos[String(v.id)] ?? null };
      throw new Error(`consulta inesperada: ${q}`);
    });
    const g = await leerGrupoColores('60028', gql);
    expect(g.locationId).toBe(LOC);
    expect(g.posId).toBe('pos');
    expect(g.miembros.map((m) => [m.titulo, m.color, m.disponible, m.comprometido])).toEqual([['Gorra Reebok T3', '', 13, 1], ['Gorra Reebok T3 Negro', 'NEGRO', 3, 0]]);
    expect(g.ajenos).toEqual(['Remera de otra marca']);
    expect(nombreBase(g)).toBe('Gorra Reebok T3');
    // Solo lectura.
    expect(gql.mock.calls.every(([q]) => !String(q).trim().startsWith('mutation'))).toBe(true);
  });
  it('sin el original, el nombre base es el del color sin el color', () => {
    expect(nombreBase(grupo([miembro({ titulo: 'Gorra Reebok T3 Azul Marino', color: 'AZUL-MARINO', sku: '60028-AZUL-MARINO' })]))).toBe('Gorra Reebok T3');
  });
});

describe('planSepararColores', () => {
  it('el original pasa a ser el primer color y los demás se crean con el mismo precio y costo', () => {
    const p = planSepararColores(grupo([miembro({})]), [{ color: 'negro', cantidad: 10 }, { color: 'azul marino', cantidad: 6 }], 'Gorra Reebok T3', 'CAP REEBOK T3');
    expect(p.error).toBeUndefined();
    expect(p.total).toBe(16);
    expect(p.pasos).toHaveLength(2);
    expect(p.pasos[0]).toMatchObject({ tipo: 'renombrar', titulo: 'Gorra Reebok T3 Negro', sku: '60028-NEGRO', desde: 16, hasta: 10 });
    expect(p.pasos[1]).toMatchObject({ tipo: 'crear', titulo: 'Gorra Reebok T3 Azul Marino', sku: '60028-AZUL-MARINO', cantidad: 6, precio: 30300, costo: 12510, vendor: 'Reebok', productType: 'Gorra', etiquetas: ['Target', '60028', 'Azul Marino'] });
  });
  it('los colores tienen que sumar lo que hay en Martínez', () => {
    expect(planSepararColores(grupo([miembro({})]), [{ color: 'Negro', cantidad: 8 }, { color: 'Azul', cantidad: 7 }], 'Gorra').error).toMatch(/suman 15 u\. .* hay 16 u\..*faltan 1/);
    expect(planSepararColores(grupo([miembro({})]), [{ color: 'Negro', cantidad: 8 }, { color: 'Azul', cantidad: 9 }], 'Gorra').error).toMatch(/sobran 1/);
  });
  it('bloquea colores vacíos, repetidos, cantidades inválidas y nombre vacío', () => {
    const g = grupo([miembro({})]);
    expect(planSepararColores(g, [{ color: '', cantidad: 16 }], 'Gorra').error).toMatch(/nombre de cada color/);
    expect(planSepararColores(g, [{ color: 'Negro', cantidad: 8 }, { color: 'NEGRO', cantidad: 8 }], 'Gorra').error).toMatch(/dos veces/);
    expect(planSepararColores(g, [{ color: 'Negro', cantidad: NaN }], 'Gorra').error).toMatch(/número entero/);
    expect(planSepararColores(g, [{ color: 'Negro', cantidad: 16 }], '  ').error).toMatch(/nombre del producto/);
  });
  it('no toca productos con varias variantes, sin alta o con stock negativo', () => {
    expect(planSepararColores(grupo([miembro({ variantes: 2 })]), [{ color: 'Negro', cantidad: 16 }], 'Gorra').error).toMatch(/variantes/);
    expect(planSepararColores(grupo([miembro({ disponible: null })]), [{ color: 'Negro', cantidad: 0 }], 'Gorra').error).toMatch(/dado de alta/);
    expect(planSepararColores(grupo([miembro({ disponible: -1 })]), [{ color: 'Negro', cantidad: 0 }], 'Gorra').error).toMatch(/corregí el stock/);
    expect(planSepararColores(grupo([]), [{ color: 'Negro', cantidad: 0 }], 'Gorra').error).toMatch(/No encontré/);
  });
  it('un color que ya existe solo cambia su stock; lo que no está en la lista queda en 0', () => {
    const g = grupo([miembro({ disponible: 4 }), miembro({ id: 'p2', titulo: 'Gorra Reebok T3 Negro', color: 'NEGRO', sku: '60028-NEGRO', inventoryItemId: 'i2', disponible: 8 }),
      miembro({ id: 'p3', titulo: 'Gorra Reebok T3 Rojo', color: 'ROJO', sku: '60028-ROJO', inventoryItemId: 'i3', disponible: 4 })]);
    const p = planSepararColores(g, [{ color: 'Negro', cantidad: 10 }, { color: 'Blanco', cantidad: 6 }], 'Gorra Reebok T3');
    expect(p.error).toBeUndefined();
    expect(p.pasos.map((x) => [x.tipo, x.tipo === 'crear' ? x.cantidad : x.tipo === 'cero' ? 0 : x.hasta])).toEqual([['ajustar', 10], ['renombrar', 6], ['cero', 0]]);
    expect(p.avisos.join(' ')).toMatch(/Rojo» no está en la lista: queda en 0/);
  });
  it('si ya está así, no hay nada para cambiar', () => {
    const g = grupo([miembro({ titulo: 'Gorra Reebok T3 Negro', color: 'NEGRO', sku: '60028-NEGRO', disponible: 16 })]);
    expect(planSepararColores(g, [{ color: 'Negro', cantidad: 16 }], 'Gorra Reebok T3').error).toMatch(/no hay nada para cambiar/);
  });
  it('avisa las ventas sin preparar: quedan en el producto original', () => {
    const p = planSepararColores(grupo([miembro({ comprometido: 2 })]), [{ color: 'Negro', cantidad: 8 }, { color: 'Azul', cantidad: 8 }], 'Gorra Reebok T3');
    expect(p.avisos.join(' ')).toMatch(/2 u\. vendida\(s\) sin preparar: siguen en este producto, que pasa a ser el Negro/);
  });
  it('no repite el color si el nombre ya lo tiene', () => {
    const p = planSepararColores(grupo([miembro({})]), [{ color: 'Negro', cantidad: 16 }], 'Gorra Reebok T3 Negro');
    expect(p.pasos[0]).toMatchObject({ tipo: 'renombrar', titulo: 'Gorra Reebok T3 Negro' });
  });
});

/** Shopify simulado que responde bien a todo y anota las llamadas. */
function shopifyOk(opts: { stale?: boolean; crearFalla?: boolean } = {}) {
  const llamadas: { q: string; v: Record<string, unknown> }[] = [];
  const gql = vi.fn(async (q: string, v: Record<string, unknown>) => {
    llamadas.push({ q, v });
    if (q.includes('StockColores')) {
      if (opts.stale) return { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ code: 'CHANGE_FROM_QUANTITY_STALE', message: 'stale' }] } };
      return { inventorySetQuantities: { inventoryAdjustmentGroup: { createdAt: 'x' }, userErrors: [] } };
    }
    if (q.includes('TituloColor')) return { productUpdate: { product: { id: 'p1', title: 'x' }, userErrors: [] } };
    if (q.includes('SkuColor')) return { productVariantsBulkUpdate: { productVariants: [{ id: 'v1' }], userErrors: [] } };
    if (q.includes('EtiquetaColor')) return { tagsAdd: { node: { id: 'p1' }, userErrors: [] } };
    if (q.includes('SkuLibreColor')) return { productVariants: { nodes: [] } };
    if (q.includes('CrearColor')) return opts.crearFalla ? { productSet: { product: null, userErrors: [{ message: 'Title is too long' }] } } : { productSet: { product: { id: 'p9', title: 'x' }, userErrors: [] } };
    if (q.includes('PublicarColor')) return { publishablePublish: { userErrors: [] } };
    throw new Error(`llamada inesperada: ${q}`);
  });
  return { gql, llamadas };
}
const nombre = (q: string) => /(?:mutation|query)\s+(\w+)/.exec(q)?.[1];

describe('ejecutarSepararColores', () => {
  it('baja el stock primero, renombra el original y crea el color nuevo con su stock', async () => {
    const g = grupo([miembro({})]);
    const plan = planSepararColores(g, [{ color: 'Negro', cantidad: 10 }, { color: 'Azul', cantidad: 6 }], 'Gorra Reebok T3', 'CAP REEBOK T3');
    const { gql, llamadas } = shopifyOk();
    const r = await ejecutarSepararColores(plan, g, { gql, clave: () => 'k' });
    expect(r.ok).toBe(true);
    expect(r.faltan).toEqual([]);
    expect(llamadas.map((l) => nombre(l.q))).toEqual(['StockColores', 'TituloColor', 'SkuColor', 'EtiquetaColor', 'SkuLibreColor', 'CrearColor', 'PublicarColor']);
    const stock = llamadas[0].v.input as { quantities: { quantity: number; changeFromQuantity: number; locationId: string }[] };
    expect(stock.quantities).toEqual([{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOC, quantity: 10, changeFromQuantity: 16 }]);
    expect(llamadas[1].v).toEqual({ product: { id: 'gid://shopify/Product/1', title: 'Gorra Reebok T3 Negro' } });
    expect(llamadas[2].v).toEqual({ productId: 'gid://shopify/Product/1', variants: [{ id: 'gid://shopify/ProductVariant/1', inventoryItem: { sku: '60028-NEGRO' } }] });
    const alta = llamadas[5].v.input as { title: string; variants: { price: string; inventoryItem: { sku: string; cost: string }; inventoryQuantities: { quantity: number; locationId: string }[] }[] };
    expect(alta.title).toBe('Gorra Reebok T3 Azul');
    expect(alta.variants[0]).toMatchObject({ price: '30300', inventoryItem: { sku: '60028-AZUL', cost: '12510' }, inventoryQuantities: [{ locationId: LOC, name: 'available', quantity: 6 }] });
  });
  it('si el stock cambió desde que se leyó, no hace nada más', async () => {
    const g = grupo([miembro({})]);
    const plan = planSepararColores(g, [{ color: 'Negro', cantidad: 10 }, { color: 'Azul', cantidad: 6 }], 'Gorra Reebok T3');
    const { gql, llamadas } = shopifyOk({ stale: true });
    const r = await ejecutarSepararColores(plan, g, { gql, clave: () => 'k' });
    expect(r.ok).toBe(false);
    expect(r.hecho).toEqual([]);
    expect(r.faltan[0]).toMatch(/cambió desde que lo leí.*No se cambió nada/);
    expect(llamadas).toHaveLength(1);
  });
  it('si no se puede crear un color, dice qué falta hacer a mano', async () => {
    const g = grupo([miembro({})]);
    const plan = planSepararColores(g, [{ color: 'Negro', cantidad: 10 }, { color: 'Azul', cantidad: 6 }], 'Gorra Reebok T3');
    const { gql } = shopifyOk({ crearFalla: true });
    const r = await ejecutarSepararColores(plan, g, { gql, clave: () => 'k' });
    expect(r.ok).toBe(false);
    expect(r.faltan.join(' ')).toMatch(/Creá a mano «Gorra Reebok T3 Azul» \(SKU 60028-AZUL\) con 6 u\./);
  });
  it('sube el stock de los colores que ya estaban al final, después de bajar los demás', async () => {
    const g = grupo([miembro({ disponible: 4 }), miembro({ id: 'p2', titulo: 'Gorra Reebok T3 Negro', color: 'NEGRO', sku: '60028-NEGRO', inventoryItemId: 'i2', disponible: 8 })]);
    const plan = planSepararColores(g, [{ color: 'Negro', cantidad: 12 }], 'Gorra Reebok T3');
    const { gql, llamadas } = shopifyOk();
    const r = await ejecutarSepararColores(plan, g, { gql, clave: () => 'k' });
    expect(r.ok).toBe(true);
    const stocks = llamadas.filter((l) => nombre(l.q) === 'StockColores').map((l) => (l.v.input as { quantities: { inventoryItemId: string; quantity: number }[] }).quantities);
    expect(stocks).toEqual([
      [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOC, quantity: 0, changeFromQuantity: 4 }],
      [{ inventoryItemId: 'i2', locationId: LOC, quantity: 12, changeFromQuantity: 8 }],
    ]);
  });
});

describe('botón en la entrega', () => {
  it('aparece solo si hay artículos ya cargados', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { SepararColores } = await import('../../SepararColores');
    expect(renderToStaticMarkup(createElement(SepararColores, { articulos: [] }))).toBe('');
    expect(renderToStaticMarkup(createElement(SepararColores, { articulos: [{ codigo: '60028', descripcion: 'CAP REEBOK T3' }] }))).toMatch(/Algo vino en varios colores\? Separarlo \(ya cargado\)/);
  });
});
