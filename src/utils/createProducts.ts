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

const PRODUCT_SET = `
  mutation CrearProducto($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id title }
      userErrors { field message }
    }
  }
`;

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
    if (p.hasSizes) variant.optionValues = [{ optionName: 'Talle', name: v.optionValue }];
    if (v.qty > 0 && locationId) {
      variant.inventoryQuantities = [{ locationId, name: 'available', quantity: v.qty }];
    }
    return variant;
  });

  const input: any = {
    title: p.title,
    vendor: p.vendor,
    status: 'DRAFT', // borrador: no se publica solo
    variants,
  };
  if (p.productType) input.productType = p.productType;
  if (p.tags) input.tags = [p.tags];
  if (p.handle) input.handle = p.handle;
  if (p.hasSizes) input.productOptions = [{ name: 'Talle', values: p.variants.map((v) => ({ name: v.optionValue })) }];

  return input;
}

// Crea los productos. Si `limit` se pasa, crea solo los primeros N (para probar).
export async function createProducts(
  result: SyncResult,
  config: SyncConfig,
  limit?: number,
  onProgress?: (done: number, total: number) => void,
): Promise<CreateResult> {
  let products = buildMatrixProducts(result, config);
  if (limit && limit > 0) products = products.slice(0, limit);

  const locId = await getLocationId(STOCK_LOCATION[config.brand]);

  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    try {
      const data = await shopifyGraphQL<any>(PRODUCT_SET, { input: buildProductSetInput(p, locId) });
      const ue = data?.productSet?.userErrors || [];
      if (ue.length) { failed++; errors.push(`${p.title}: ${ue.map((e: any) => e.message).join('; ')}`); }
      else created++;
    } catch (e: any) {
      failed++;
      errors.push(`${p.title}: ${e?.message || 'error'}`);
    }
    onProgress?.(i + 1, products.length);
  }

  return { created, failed, errors };
}
