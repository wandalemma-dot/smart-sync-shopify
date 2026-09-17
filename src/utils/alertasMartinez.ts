import { shopifyGraphQL, mismaSucursal } from './shopify';
import { extraerCodigo, LOC_ID, LOC_MARTINEZ } from './reposicionLogic';
import { convertirConverse, convertirLeCoq } from './conversorTalles';
import { escapeCSV, triggerDownload, todayStamp } from './csv';
import { esCalzadoLeCoq } from './syncLogic';

export const LOCATIONS_QUERY = `query AlertasSucursales($cursor: String) {
  locations(first: 50, after: $cursor) {
    nodes { id name }
    pageInfo { hasNextPage endCursor }
  }
}`;

// Paginamos variantes directamente: ningún producto pierde talles por un límite anidado.
export const VARIANTS_QUERY = `query AlertasMartinez($cursor: String, $mar: ID!, $idl: ID!) {
  productVariants(first: 50, after: $cursor, query: "vendor:Converse OR vendor:'Le Coq Sportif'") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title selectedOptions { name value }
      product { title vendor tags status }
      inventoryItem {
        mar: inventoryLevel(locationId: $mar) { quantities(names: ["available"]) { name quantity } }
        idl: inventoryLevel(locationId: $idl) { quantities(names: ["available"]) { name quantity } }
      }
    }
  }
}`;

type Level = { quantities: { name: string; quantity: number }[] } | null;
export interface VarianteAlerta {
  id: string;
  title: string;
  selectedOptions: { name: string; value: string }[];
  product: { title: string; vendor: string; tags: string[]; status: string };
  inventoryItem: { mar: Level; idl: Level };
}
export interface AlertaMartinez {
  id: string;
  codigo: string | null;
  titulo: string;
  marca: string;
  variante: string;
  talleAr: string;
  tallePedido: string | null;
  escala: string | null;
  stockMartinez: number;
  stockId: number;
  estado: string;
  motivo?: string;
}
interface Connection<T> { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
export interface ResultadoAlertas { filas: AlertaMartinez[]; generadoEn: string; escaneadas: number }

function cantidad(level: Level): number | null {
  const value = level?.quantities.find(q => q.name === 'available')?.quantity;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function alertaDeVariante(v: VarianteAlerta): AlertaMartinez | null {
  const vendor = v.product.vendor.toLowerCase();
  const marca = vendor.includes('converse') ? 'Converse' : vendor.includes('coq') ? 'Le Coq Sportif' : null;
  const stockMartinez = cantidad(v.inventoryItem?.mar);
  const stockId = cantidad(v.inventoryItem?.idl);
  // null significa que no está dada de alta ahí, no que tiene cero unidades.
  if (!marca || stockMartinez === null || stockId === null || stockMartinez > 3 || stockId <= 0) return null;
  const codigo = extraerCodigo(v.product.tags.join(', '));
  const opcion = v.selectedOptions.find(o => /^(talle|talla|size)$/i.test(o.name.trim()));
  const talleAr = opcion?.value || (v.selectedOptions.length <= 1 ? v.title : '');
  const nombreNormalizado = v.product.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const numerico = /^\d+([.,]\d+)?$/.test(talleAr) && (marca !== 'Le Coq Sportif' || esCalzadoLeCoq(nombreNormalizado, talleAr));
  const conv = !talleAr || talleAr === 'Default Title'
    ? { ok: false as const, motivo: 'No se pudo identificar el talle de esta variante.' }
    : !numerico ? { ok: true as const, tallePedido: talleAr, escala: '—' }
    : marca === 'Converse' ? convertirConverse(codigo || '', talleAr, v.product.tags)
    : convertirLeCoq(talleAr);
  return {
    id: v.id, codigo, titulo: v.product.title, marca, variante: v.title,
    talleAr, tallePedido: conv.ok ? conv.tallePedido : null,
    escala: conv.ok ? conv.escala : null, stockMartinez, stockId,
    estado: v.product.status,
    motivo: !conv.ok ? conv.motivo : !codigo ? 'Falta el código del proveedor en las etiquetas.' : undefined,
  };
}

function siguiente<T>(conn: Connection<T>, anterior: string | null): string | null {
  if (!conn?.nodes || !conn.pageInfo) throw new Error('Shopify devolvió una respuesta incompleta. Volvé a consultar.');
  if (!conn.pageInfo.hasNextPage) return null;
  const cursor = conn.pageInfo.endCursor;
  if (!cursor || cursor === anterior) throw new Error('No se pudo completar la lectura de Shopify. Volvé a consultar.');
  return cursor;
}

export async function consultarAlertasMartinez(onProgress?: (n: number) => void): Promise<ResultadoAlertas> {
  const locations: { id: string; name: string }[] = [];
  let cursor: string | null = null;
  do {
    const data: { locations: Connection<{ id: string; name: string }> } = await shopifyGraphQL(LOCATIONS_QUERY, { cursor });
    cursor = siguiente(data.locations, cursor);
    locations.push(...data.locations.nodes);
  } while (cursor);
  const localizar = (nombre: string) => {
    const matches = locations.filter(l => mismaSucursal(l.name, nombre));
    if (matches.length !== 1) throw new Error(`No pude identificar una única sucursal «${nombre}» en Shopify.`);
    return matches[0].id;
  };
  const mar = localizar(LOC_MARTINEZ), idl = localizar(LOC_ID);
  const filas: AlertaMartinez[] = [];
  let escaneadas = 0;
  do {
    const data: { productVariants: Connection<VarianteAlerta> } = await shopifyGraphQL(VARIANTS_QUERY, { cursor, mar, idl });
    cursor = siguiente(data.productVariants, cursor);
    for (const v of data.productVariants.nodes) {
      const fila = alertaDeVariante(v);
      if (fila) filas.push(fila);
      escaneadas++;
    }
    onProgress?.(escaneadas);
  } while (cursor);
  filas.sort((a, b) => a.stockMartinez - b.stockMartinez || a.titulo.localeCompare(b.titulo) || a.variante.localeCompare(b.variante, 'es', { numeric: true }));
  return { filas, escaneadas, generadoEn: new Date().toISOString() };
}

export function descargarAlertasMartinez(filas: AlertaMartinez[]) {
  const rows = filas.map(f => [f.marca, f.codigo, f.titulo, f.variante, f.talleAr, f.tallePedido, f.escala, f.stockMartinez, f.stockId, f.estado, f.motivo]);
  const header = ['Marca', 'Código', 'Producto', 'Variante', 'Talle tienda', 'Talle iD', 'Escala', 'Stock Martínez', 'Disponible iD', 'Estado Shopify', 'Revisar'];
  triggerDownload([header, ...rows].map(r => r.map(escapeCSV).join(',')).join('\n'), `alertas-martinez-${todayStamp()}.csv`);
}
