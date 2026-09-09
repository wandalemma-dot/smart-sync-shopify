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
  talle: string;         // vacío = sin variante
  sku: string;
  sinTalle: boolean;
}

export interface ProductoRecrear {
  codigo: string;                               // el SKU de la primera variante (para mostrar)
  titulo: string;
  sinTalle: boolean;
  talles: { talle: string; sku: string }[];
}

export interface ParseRecrear {
  productos: ProductoRecrear[];
  lineas: LineaRecrear[];
  ignoradas: string[];
  skusRepetidos: string[];
  sinTalleCount: number;
}

// Talles que en realidad significan "no tiene talle".
const TALLES_UNICOS = ['', 'U', 'TU', 'UNICO', 'ÚNICO', 'UNIQUE', 'ONE SIZE'];

function esSinTalle(talle: string): boolean {
  return TALLES_UNICOS.includes(String(talle || '').trim().toUpperCase());
}

/**
 * ¿Esta línea es un SKU?
 *
 * ⚠ NO SE PUEDE IR POR POSICIÓN. Se intentó leer de a 3 líneas fijas y falló:
 *   la cantidad de líneas en blanco que copia Shopify es VARIABLE y el talle a
 *   veces no está. Hay que reconocer el SKU por cómo es.
 *
 * ⚠ Y NO SE PUEDE EXIGIR UN FORMATO FIJO. Se intentó pedir MAYÚSCULAS y volvió
 *   a fallar: los SKU de Wanda son un despelote. Todos estos son reales:
 *     2221110009!20!33   20BFLS1912$6   grid10E   UA220510A   7795456688744
 *     IFNX1J2CP4RR0IZ    13225058!U     016578Y   01360100110E
 *   Hay separadores "!" y "$", hay minúsculas, hay largos de 6 a 16.
 *   Cuando uno no se reconoce, el título se come el producto siguiente entero.
 *
 * Lo único que TODOS cumplen y que ninguna otra línea cumple:
 *   • no tiene espacios (los títulos sí: "Bolsa De Dormir Montagne")
 *   • tiene al menos un número ("Izquierdo", "Derecho", "M" no tienen)
 *   • es largo, o trae un separador ("33", "10", "16" son talles, no SKU)
 */
export function esSku(linea: string): boolean {
  const l = String(linea || '').trim();
  if (!l || /\s/.test(l)) return false;   // con espacios es un título
  if (!/\d/.test(l)) return false;        // sin números es un talle (Izquierdo)
  // Con separador vale aunque sea corto: "13225058!U", "20BFLS1912$6".
  if (l.includes('!') || l.includes('$')) return true;
  // Sin separador, tiene que ser largo: así "33", "10" o "16" siguen siendo talles.
  return l.length >= 5;
}

/**
 * Lee el texto que Wanda copia de la pantalla de la transferencia.
 *
 * Cada producto es: título → (talle, si tiene) → SKU, con cualquier cantidad de
 * líneas en blanco en el medio. Se avanza hasta encontrar un SKU y lo anterior
 * se reparte: si la última línea antes del SKU es UNA SOLA PALABRA, es el talle
 * ("Izquierdo", "33", "M"); si tiene espacios, es parte del título y el producto
 * va sin talle.
 */
export function parseRecrear(texto: string): ParseRecrear {
  const lineas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const out: LineaRecrear[] = [];
  const ignoradas: string[] = [];
  let buffer: string[] = [];

  for (const l of lineas) {
    if (!esSku(l)) { buffer.push(l); continue; }

    if (!buffer.length) { ignoradas.push(l); continue; }

    // ¿La última línea antes del SKU es un talle? Solo si es una sola palabra.
    // Los títulos siempre tienen espacios ("Bolsa De Dormir Montagne...").
    const ultima = buffer[buffer.length - 1];
    const hayTalle = buffer.length > 1 && !/\s/.test(ultima);
    const talle = hayTalle ? ultima : '';
    const titulo = (hayTalle ? buffer.slice(0, -1) : buffer).join(' ').trim();
    buffer = [];

    if (!titulo) { ignoradas.push(l); continue; }
    out.push({ titulo, talle, sku: l, sinTalle: esSinTalle(talle) });
  }
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

  // ---- AGRUPAR POR TÍTULO ----
  // En Shopify, la "Bolsa De Dormir Tenorio Pro Rojo" es UN producto con dos
  // variantes (Izquierdo y Derecho), y cada variante tiene su propio SKU
  // (IFNX1J2CP4RR0IZ / IFNX1J2CP4RR0DE). Por eso se agrupa por TÍTULO.
  //
  // ⚠ PERO SI UN TALLE SE REPITE dentro del mismo título, son DOS productos
  //   distintos: Shopify no acepta dos variantes con el mismo valor de opción.
  //   Ahí se abre un producto nuevo. Los SKU siempre se conservan, que es lo
  //   único que hace que la transferencia se reenganche.
  const productos: ProductoRecrear[] = [];
  const abiertos = new Map<string, ProductoRecrear[]>();

  for (const l of limpias) {
    const clave = l.titulo.toUpperCase();
    if (!abiertos.has(clave)) abiertos.set(clave, []);
    const grupo = abiertos.get(clave)!;
    const valor = l.sinTalle ? '' : l.talle.toUpperCase();
    // Buscamos un producto de ese título donde ese talle todavía no esté.
    let destino = grupo.find((p) => !p.talles.some((t) => (p.sinTalle ? '' : t.talle.toUpperCase()) === valor));
    if (!destino) {
      destino = { codigo: l.sku, titulo: l.titulo, sinTalle: l.sinTalle, talles: [] };
      grupo.push(destino);
      productos.push(destino);
    }
    if (!l.sinTalle) destino.sinTalle = false;
    destino.talles.push({ talle: l.talle, sku: l.sku });
  }

  return {
    productos,
    lineas: limpias,
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
