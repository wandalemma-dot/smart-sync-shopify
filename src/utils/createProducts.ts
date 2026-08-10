// ============================================================================
// CREAR PRODUCTOS NUEVOS EN SHOPIFY (directo por API, como BORRADOR)
// ----------------------------------------------------------------------------
// Usa la misma matriz que ya arma el CSV, pero en vez de descargar, crea los
// productos con productSet. Se crean como DRAFT (borrador) para que no se
// publiquen solos: vos los revisás y publicás en Shopify.
// ============================================================================

import { shopifyGraphQL } from './shopify';
import { STOCK_LOCATION, buildMatrixProducts } from './syncLogic';
import type { SyncResult, SyncConfig, MatrixProduct } from './syncLogic';

const LOCATIONS_QUERY = `query { locations(first: 50) { edges { node { id name } } } }`;

const PUBLICATIONS_QUERY = `query { publications(first: 30) { edges { node { id name } } } }`;

const PRODUCT_SET = `
  mutation CrearProducto($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id title }
      userErrors { field message }
    }
  }
`;

const PUBLISH = `
  mutation Publicar($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

// Busca la publicación (canal de venta) "Point of Sale".
async function getPosPublicationId(): Promise<string | null> {
  const data = await shopifyGraphQL<any>(PUBLICATIONS_QUERY);
  const edges: any[] = data?.publications?.edges || [];
  const pos = edges.find((e) => {
    const n = String(e.node.name || '').toLowerCase();
    return n.includes('point of sale') || n.includes('punto de venta') || n === 'pos';
  });
  return pos ? pos.node.id : null;
}

export interface CreateResult {
  created: number;
  failed: number;
  errors: string[];
}

async function getLocationId(name: string): Promise<string | null> {
  const data = await shopifyGraphQL<any>(LOCATIONS_QUERY);
  const edges: any[] = data?.locations?.edges || [];
  const loc = edges.find((e) => String(e.node.name).trim() === name);
  return loc ? loc.node.id : null;
}

function buildProductSetInput(p: MatrixProduct, locationId: string | null): any {
  const variants = p.variants.map((v) => {
    const variant: any = {
      price: String(v.price),
      inventoryItem: {
        sku: v.sku,
        cost: String(v.cost),
        tracked: true,
        measurement: { weight: { value: p.weightGrams, unit: 'GRAMS' } },
      },
    };
    // La variante SIEMPRE necesita optionValues (aunque sea producto sin talle:
    // ahí usamos la opción por defecto "Title / Default Title").
    variant.optionValues = p.hasSizes
      ? [{ optionName: 'Talle', name: v.optionValue }]
      : [{ optionName: 'Title', name: 'Default Title' }];
    // Cargamos el stock (de la columna CANTIDAD del archivo) en la sucursal de la
    // marca. Lo hacemos siempre, aunque sea 0, para activar el inventario ahí.
    if (locationId) {
      variant.inventoryQuantities = [{ locationId, name: 'available', quantity: v.qty }];
    }
    return variant;
  });

  const input: any = {
    title: p.title,
    vendor: p.vendor,
    status: 'ACTIVE', // se crean activos
    variants,
    productOptions: p.hasSizes
      ? [{ name: 'Talle', values: [...new Set(p.variants.map((v) => v.optionValue))].map((name) => ({ name })) }]
      : [{ name: 'Title', values: [{ name: 'Default Title' }] }],
  };
  if (p.productType) input.productType = p.productType;
  if (p.tags && p.tags.length) input.tags = p.tags;
  if (p.handle) input.handle = p.handle;

  return input;
}

// Crea los productos. Si `limit` se pasa, crea solo los primeros N (para probar).
export async function createProducts(
  result: SyncResult,
  config: SyncConfig,
  tableSelections: Record<string, number> = {},
  limit?: number,
  onProgress?: (done: number, total: number) => void,
): Promise<CreateResult> {
  let products = buildMatrixProducts(result, config, tableSelections);
  if (limit && limit > 0) products = products.slice(0, limit);

  const locId = await getLocationId(STOCK_LOCATION[config.brand]);
  const posId = await getPosPublicationId();

  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    try {
      const data = await shopifyGraphQL<any>(PRODUCT_SET, { input: buildProductSetInput(p, locId) });
      const ue = data?.productSet?.userErrors || [];
      if (ue.length) { failed++; errors.push(`${p.title}: ${ue.map((e: any) => e.message).join('; ')}`); }
      else {
        created++;
        // Publicar SOLO en Point of Sale (no en la tienda online).
        const productId = data?.productSet?.product?.id;
        if (productId && posId) {
          try {
            await shopifyGraphQL<any>(PUBLISH, { id: productId, input: [{ publicationId: posId }] });
          } catch { /* si falla la publicación, el producto igual quedó creado */ }
        }
      }
    } catch (e: any) {
      failed++;
      errors.push(`${p.title}: ${e?.message || 'error'}`);
    }
    onProgress?.(i + 1, products.length);
  }

  return { created, failed, errors };
}
