// ============================================================================
// RECREAR PRODUCTOS BORRADOS (para las transferencias viejas de Shopify)
// ----------------------------------------------------------------------------
// Wanda tiene transferencias viejas que apuntan a productos que ya borró. Para
// poder recibirlas, el producto tiene que existir otra vez CON EL MISMO SKU.
// Shopify no le deja exportar eso: lo único que puede hacer es copiar el texto
// de la pantalla de la transferencia, que viene de a tres líneas:
//
//     Bermuda Quiksilver Slim Basic Blue Azul Claro   <- título
//     33                                              <- talle
//     2221110009!20!33                                <- SKU
//
// ⚠ EL SKU MANDA. Es lo único que hace que la transferencia vuelva a
//   engancharse con el producto. Si el SKU no queda idéntico, no sirve de nada.
//
// ⚠ EL MISMO TÍTULO PUEDE SER DE DOS PRODUCTOS DISTINTOS.
//   En el ejemplo real de Wanda, "Bermuda Quiksilver Slim Basic Blue Azul
//   Claro" aparece con el código 2221110009 (talle 33) y con el 2231110023
//   (talle 28): son dos temporadas distintas. Por eso los productos se agrupan
//   por el CÓDIGO (lo que va antes del primer "!"), NUNCA por el título.
// ============================================================================

export interface LineaRecrear {
  titulo: string;
  talle: string;
  sku: string;
  codigo: string;        // lo que va antes del primer "!"
  talleDelSku: string;   // lo que va después del último "!"
  coincide: boolean;     // ¿el talle de la línea es el mismo que el del SKU?
}

export interface ProductoRecrear {
  codigo: string;
  titulo: string;
  talles: { talle: string; sku: string }[];
}

export interface ParseRecrear {
  productos: ProductoRecrear[];
  lineas: LineaRecrear[];
  sospechosas: LineaRecrear[];   // el talle no coincide con el del SKU
  ignoradas: string[];           // texto que no se pudo interpretar
  skusRepetidos: string[];
}

// Un SKU de estos tiene al menos dos "!" y algo a cada lado: 2221110009!20!33
const RE_SKU = /^[^!\s]+![^!\s]*![^!\s]+$/;

/**
 * Lee el texto pegado. Es tolerante: busca las líneas que tienen pinta de SKU y,
 * para cada una, toma la línea de arriba como talle y todo lo anterior (desde el
 * SKU previo) como título. Así no se rompe si un título viene cortado en dos.
 */
export function parseRecrear(texto: string): ParseRecrear {
  const lineas = String(texto || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: LineaRecrear[] = [];
  const ignoradas: string[] = [];
  let buffer: string[] = [];   // lo que todavía no se asignó a ningún producto

  for (const l of lineas) {
    if (!RE_SKU.test(l)) { buffer.push(l); continue; }

    // Encontramos un SKU: la línea de arriba es el talle y el resto, el título.
    const talle = buffer.length ? buffer[buffer.length - 1] : '';
    const titulo = buffer.slice(0, -1).join(' ').trim();
    buffer = [];

    if (!titulo || !talle) { ignoradas.push(l); continue; }

    const partes = l.split('!');
    const codigo = partes[0].trim();
    const talleDelSku = partes[partes.length - 1].trim();

    out.push({
      titulo, talle, sku: l, codigo, talleDelSku,
      coincide: talleDelSku.toUpperCase() === talle.toUpperCase(),
    });
  }
  // Lo que quedó suelto al final no era un producto completo.
  if (buffer.length) ignoradas.push(...buffer);

  // SKU repetido: se carga una sola vez.
  const vistos = new Set<string>();
  const skusRepetidos: string[] = [];
  const limpias: LineaRecrear[] = [];
  for (const l of out) {
    if (vistos.has(l.sku)) { skusRepetidos.push(l.sku); continue; }
    vistos.add(l.sku);
    limpias.push(l);
  }

  // Agrupar por CÓDIGO (no por título: el mismo título puede ser otro producto).
  const porCodigo = new Map<string, ProductoRecrear>();
  for (const l of limpias) {
    if (!porCodigo.has(l.codigo)) {
      porCodigo.set(l.codigo, { codigo: l.codigo, titulo: l.titulo, talles: [] });
    }
    porCodigo.get(l.codigo)!.talles.push({ talle: l.talle, sku: l.sku });
  }

  return {
    productos: [...porCodigo.values()],
    lineas: limpias,
    sospechosas: limpias.filter((l) => !l.coincide),
    ignoradas,
    skusRepetidos,
  };
}

// ============================================================================
// CREACIÓN EN SHOPIFY
// ----------------------------------------------------------------------------
// Se crean como BORRADOR y en $0 a propósito: son productos de recuperación,
// para que la transferencia vieja vuelva a engancharse. Un producto en $0
// publicado se podría vender a $0; en borrador, no. Wanda le pone precio y lo
// publica cuando quiera.
// ============================================================================

import { shopifyGraphQL } from './shopify';

const LOCATIONS_QUERY = `query { locations(first: 50) { edges { node { id name } } } }`;

const PRODUCT_SET = `
  mutation Recrear($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id title }
      userErrors { field message }
    }
  }
`;

export interface Sucursal { id: string; nombre: string }

export async function listarSucursales(): Promise<Sucursal[]> {
  const data = await shopifyGraphQL<any>(LOCATIONS_QUERY);
  return (data?.locations?.edges || []).map((e: any) => ({
    id: String(e.node.id), nombre: String(e.node.name || ''),
  }));
}

export interface ResultadoRecrear {
  creados: number;
  fallidos: number;
  errores: string[];
}

/**
 * Crea los productos. `cantidades` es un mapa SKU -> unidades (las que Wanda
 * escribe a mano). Lo que no esté en el mapa va en 0.
 */
export async function crearProductosRecuperados(
  productos: ProductoRecrear[],
  opciones: { vendor: string; locationId: string | null; cantidades: Record<string, number> },
  onProgress?: (hechos: number, total: number) => void,
): Promise<ResultadoRecrear> {
  let creados = 0;
  let fallidos = 0;
  const errores: string[] = [];

  for (let i = 0; i < productos.length; i++) {
    const p = productos[i];
    const variants = p.talles.map((t) => {
      const v: any = {
        // ⚠ EL SKU VA TAL CUAL. Es lo único que reengancha la transferencia.
        inventoryItem: { sku: t.sku, tracked: true },
        optionValues: [{ optionName: 'Talle', name: t.talle }],
        price: '0',
      };
      if (opciones.locationId) {
        v.inventoryQuantities = [{
          locationId: opciones.locationId,
          name: 'available',
          quantity: Number(opciones.cantidades[t.sku]) || 0,
        }];
      }
      return v;
    });

    const input: any = {
      title: p.titulo,
      status: 'DRAFT',            // borrador: no se puede vender en $0 por error
      variants,
      productOptions: [{
        name: 'Talle',
        values: [...new Set(p.talles.map((t) => t.talle))].map((name) => ({ name })),
      }],
      tags: [p.codigo],           // el código, para poder encontrarlo después
    };
    if (opciones.vendor) input.vendor = opciones.vendor;

    try {
      const data = await shopifyGraphQL<any>(PRODUCT_SET, { input });
      const ue = data?.productSet?.userErrors || [];
      if (ue.length) {
        fallidos++;
        if (errores.length < 5) errores.push(`${p.titulo}: ${ue[0].message}`);
      } else creados++;
    } catch (err: any) {
      fallidos++;
      if (errores.length < 5) errores.push(`${p.titulo}: ${err?.message || 'Error desconocido'}`);
    }
    onProgress?.(i + 1, productos.length);
  }

  return { creados, fallidos, errores };
}
