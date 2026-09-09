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
  talle: string;         // vacío = accesorio, va SIN variante de talle
  sku: string;
  codigo: string;        // lo que va antes del primer "!" (o el SKU entero)
  talleDelSku: string;   // lo que va después del último "!"
  sinTalle: boolean;     // true = producto sin variante
  coincide: boolean;     // ¿el talle de la línea es el mismo que el del SKU?
}

export interface ProductoRecrear {
  codigo: string;
  titulo: string;
  sinTalle: boolean;                            // sin variante de talle
  talles: { talle: string; sku: string }[];     // si sinTalle, es una sola con talle ''
}

export interface ParseRecrear {
  productos: ProductoRecrear[];
  lineas: LineaRecrear[];
  sospechosas: LineaRecrear[];   // el talle no coincide con el del SKU
  ignoradas: string[];           // grupos que no se pudieron interpretar
  skusRepetidos: string[];
  sinTalleCount: number;
}

// Talles que en realidad significan "no tiene talle".
const TALLES_UNICOS = ['', 'U', 'TU', 'UNICO', 'ÚNICO', 'UNIQUE', 'ONE SIZE'];

function esSinTalle(talle: string): boolean {
  return TALLES_UNICOS.includes(String(talle || '').trim().toUpperCase());
}

/**
 * Lee el texto pegado. Viene SIEMPRE de a TRES líneas:
 *
 *     Bermuda Quiksilver Slim Basic Blue Azul Claro   <- título
 *     33                                              <- talle (VACÍO si es accesorio)
 *     2221110009!20!33                                <- SKU
 *
 * ⚠ LAS LÍNEAS VACÍAS NO SE PUEDEN BORRAR.
 *   Se intentó y salió mal: en los accesorios el talle viene vacío, así que al
 *   sacar esa línea se corría TODO un renglón y cada producto se quedaba con el
 *   título del siguiente como talle. Se recorre de a 3 y punto.
 */
export function parseRecrear(texto: string): ParseRecrear {
  // OJO: solo se saca el \r y los espacios de los costados. Las vacías QUEDAN.
  const todas = String(texto || '').split(/\r?\n/).map((l) => l.trim());
  // Sí se recortan las vacías del principio y del final (al copiar suelen sobrar).
  while (todas.length && !todas[0]) todas.shift();
  while (todas.length && !todas[todas.length - 1]) todas.pop();

  const out: LineaRecrear[] = [];
  const ignoradas: string[] = [];

  for (let i = 0; i < todas.length; i += 3) {
    const titulo = (todas[i] || '').trim();
    const talle = (todas[i + 1] ?? '').trim();
    const sku = (todas[i + 2] || '').trim();

    if (!titulo || !sku) {
      const resto = todas.slice(i, i + 3).filter(Boolean);
      if (resto.length) ignoradas.push(resto.join(' ⏎ '));
      continue;
    }

    const partes = sku.split('!');
    const codigo = partes[0].trim();
    // El talle es el ÚLTIMO segmento del SKU. En "2232127002!79!U" el 79 es el
    // color y la U el talle; en "13225058!U" no hay color.
    const talleDelSku = partes.length > 1 ? partes[partes.length - 1].trim() : '';
    const sinTalle = esSinTalle(talle);

    out.push({
      titulo, talle, sku, codigo, talleDelSku, sinTalle,
      // Si no tiene talle no hay nada que comparar: no es sospechosa.
      coincide: sinTalle || !talleDelSku || talleDelSku.toUpperCase() === talle.toUpperCase(),
    });
  }

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
      porCodigo.set(l.codigo, { codigo: l.codigo, titulo: l.titulo, sinTalle: l.sinTalle, talles: [] });
    }
    const p = porCodigo.get(l.codigo)!;
    // Si alguna de sus líneas trae talle, el producto SÍ lleva variantes.
    if (!l.sinTalle) p.sinTalle = false;
    p.talles.push({ talle: l.talle, sku: l.sku });
  }

  return {
    productos: [...porCodigo.values()],
    lineas: limpias,
    sospechosas: limpias.filter((l) => !l.coincide),
    ignoradas,
    skusRepetidos,
    sinTalleCount: limpias.filter((l) => l.sinTalle).length,
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
    // ⚠ ACCESORIOS: SIN VARIANTE DE TALLE (pedido de Wanda, 09-sep-2026).
    // Un gorro o una cartuchera no tienen talle. Se crean con la opción por
    // defecto de Shopify (Title / Default Title), como cualquier producto único.
    const variants = p.talles.map((t) => {
      const v: any = {
        // ⚠ EL SKU VA TAL CUAL. Es lo único que reengancha la transferencia.
        inventoryItem: { sku: t.sku, tracked: true },
        optionValues: p.sinTalle
          ? [{ optionName: 'Title', name: 'Default Title' }]
          : [{ optionName: 'Talle', name: t.talle }],
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
      productOptions: p.sinTalle
        ? [{ name: 'Title', values: [{ name: 'Default Title' }] }]
        : [{ name: 'Talle', values: [...new Set(p.talles.map((t) => t.talle))].map((name) => ({ name })) }],
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
