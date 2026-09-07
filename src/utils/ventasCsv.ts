// ============================================================================
// PEDIDO A iD A PARTIR DEL EXPORT DE VENTAS DE SHOPIFY
// ----------------------------------------------------------------------------
// Wanda baja de Shopify el export de órdenes (orders_export.csv), lo sube acá,
// y la app le dice QUÉ TALLE PEDIRLE AL PROVEEDOR por cada cosa que se vendió.
//
// Reemplaza a la Reposición vieja, que calculaba todo leyendo Shopify en vivo.
// Decisión de Wanda (07-sep-2026): la lista muestra **todo lo vendido, tal
// cual**. NO se descuenta lo que hay en Martínez ni lo que viene en camino.
//
// ⚠ POR QUÉ HACE FALTA IGUAL LEER SHOPIFY:
//   El talle AR se convierte al del proveedor según la CURVA del modelo, y la
//   curva depende del CÓDIGO. El export de ventas casi nunca lo trae: medido
//   sobre el archivo real del 07-sep, de 143 líneas de calzado solo 70 (49%)
//   tenían el código en el SKU; las otras 73 traían el CÓDIGO DE BARRAS
//   (888754866635) o el SKU vacío.
//   Por eso se busca el producto en Shopify por su título y el código sale de
//   las ETIQUETAS, que es la fuente buena (ver `extraerCodigo`).
//
// ⚠ EL MISMO TALLE AR NO DA SIEMPRE EL MISMO US. Depende de la curva:
//   AR 38 de la A09429C = US 5.5, pero AR 38 de la A16122C = US 6.5.
//   Si no se sabe la curva NO se adivina: la fila va a "Revisar".
// ============================================================================

import Papa from 'papaparse';
import { shopifyGraphQL } from './shopify';
import { extraerCodigo } from './reposicionLogic';
import { convertirConverse, convertirLeCoq } from './conversorTalles';
import { escapeCSV, triggerDownload, todayStamp } from './csv';

export interface LineaVenta {
  orden: string;
  fecha: string;
  titulo: string;      // nombre del producto, ya sin el " - talle"
  talleAr: string;
  cantidad: number;
  sku: string;
  vendor: string;
}

export interface FilaPedido {
  codigo: string | null;
  titulo: string;
  marca: 'converse' | 'lecoq';
  talleAr: string;
  tallePedido: string | null;  // el que se carga en la web del proveedor
  escala: string | null;       // "U.S.A. MENS", "EU", etc.
  cantidad: number;
  motivo?: string;             // por qué no se pudo convertir
}

export interface ResultadoPedido {
  generadoEn: string;
  lineasLeidas: number;
  filas: FilaPedido[];       // listas para pedir
  revisar: FilaPedido[];     // no se pudo convertir: se muestran, no se tiran
  ignoradas: number;         // otras marcas (Vans, DC, etc.)
  productosShopify: number;
}

const PRODUCTOS_QUERY = `
  query($cursor: String, $q: String!) {
    products(first: 100, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges { node { handle title vendor tags } }
    }
  }
`;

// Para comparar títulos sin que molesten mayúsculas, tildes ni dobles espacios.
export function normTitulo(s: string): string {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// El talle viene pegado al final del nombre: "... Negro - 41" -> "41".
export function partirNombre(nombre: string): { titulo: string; talle: string } {
  const partes = String(nombre || '').split(' - ');
  if (partes.length < 2) return { titulo: String(nombre || '').trim(), talle: '' };
  return {
    titulo: partes.slice(0, -1).join(' - ').trim(),
    talle: partes[partes.length - 1].trim(),
  };
}

export function esTalleCalzado(t: string): boolean {
  return /^\d+(\.\d+)?$/.test(String(t || '').trim());
}

/** Lee el orders_export.csv de Shopify: una línea por producto vendido. */
export function leerVentasCsv(texto: string): LineaVenta[] {
  const parsed = Papa.parse<Record<string, string>>(texto, { header: true, skipEmptyLines: true });
  const out: LineaVenta[] = [];
  for (const r of parsed.data || []) {
    const nombre = String(r['Lineitem name'] || '').trim();
    if (!nombre) continue;
    if (String(r['Cancelled at'] || '').trim()) continue;  // orden cancelada: no se repone
    const { titulo, talle } = partirNombre(nombre);
    const cantidad = Number(r['Lineitem quantity']) || 0;
    if (cantidad <= 0) continue;
    out.push({
      orden: String(r['Name'] || '').trim(),
      fecha: String(r['Created at'] || '').slice(0, 10),
      titulo,
      talleAr: talle,
      cantidad,
      sku: String(r['Lineitem sku'] || '').trim().toUpperCase(),
      vendor: String(r['Vendor'] || '').trim(),
    });
  }
  return out;
}

function marcaDe(vendor: string): 'converse' | 'lecoq' | null {
  const v = vendor.toLowerCase();
  if (v.includes('coq')) return 'lecoq';
  if (v.includes('converse')) return 'converse';
  return null;
}

/**
 * Cruza las ventas contra Shopify para sacar el código y la curva de cada
 * producto, y devuelve el pedido con los talles ya convertidos.
 */
export async function armarPedidoDesdeVentas(
  lineas: LineaVenta[],
  onProgress?: (leidos: number) => void,
): Promise<ResultadoPedido> {
  // 1) Traer los productos de Converse y Le Coq (título + etiquetas).
  //    Consulta barata: campos sueltos, sin variantes.
  const porTitulo = new Map<string, { tags: string; vendor: string; handle: string }>();
  let cursor: string | null = null;
  let hayMas = true;
  let leidos = 0;
  let guarda = 0;
  while (hayMas && guarda < 100) {
    guarda++;
    const data: any = await shopifyGraphQL<any>(PRODUCTOS_QUERY, {
      cursor,
      q: 'vendor:Converse OR vendor:"Le Coq Sportif"',
    });
    const conn = data?.products;
    for (const e of (conn?.edges || [])) {
      const n = e.node;
      const tags = Array.isArray(n.tags) ? n.tags.join(', ') : String(n.tags || '');
      porTitulo.set(normTitulo(n.title), { tags, vendor: String(n.vendor || ''), handle: String(n.handle || '') });
      leidos++;
    }
    hayMas = !!conn?.pageInfo?.hasNextPage;
    cursor = conn?.pageInfo?.endCursor || null;
    onProgress?.(leidos);
  }

  // 2) Convertir cada línea vendida y acumular por código + talle.
  const acc = new Map<string, FilaPedido>();
  const accRevisar = new Map<string, FilaPedido>();
  let ignoradas = 0;

  const sumar = (mapa: Map<string, FilaPedido>, clave: string, fila: FilaPedido) => {
    const previa = mapa.get(clave);
    if (previa) previa.cantidad += fila.cantidad;
    else mapa.set(clave, fila);
  };

  for (const l of lineas) {
    const marca = marcaDe(l.vendor);
    if (!marca) { ignoradas++; continue; }   // Vans, DC, gotcha... no son de iD

    const prod = porTitulo.get(normTitulo(l.titulo));
    const tags = prod?.tags || '';
    // El código sale de las ETIQUETAS de Shopify. Si el producto no se
    // encontró, probamos con el SKU de la venta (a veces sí lo trae).
    const mSku = l.sku.match(/^([0-9A-Z]{6,8}C)/);
    const codigo = extraerCodigo(tags) || (mSku ? mSku[1] : null);

    const base: FilaPedido = {
      codigo, titulo: l.titulo, marca, talleAr: l.talleAr,
      tallePedido: null, escala: null, cantidad: l.cantidad,
    };
    const clave = `${codigo || l.titulo}|${l.talleAr}`;

    // Indumentaria y accesorios: el talle va tal cual, no se convierte.
    if (!esTalleCalzado(l.talleAr)) {
      sumar(acc, clave, { ...base, tallePedido: l.talleAr, escala: '—' });
      continue;
    }

    const conv = marca === 'lecoq'
      ? convertirLeCoq(l.talleAr)
      : convertirConverse(codigo || '', l.talleAr, tags);

    if (conv.ok) {
      sumar(acc, clave, { ...base, tallePedido: conv.tallePedido, escala: conv.escala });
    } else {
      const motivo = !prod
        ? `No encontré este producto en Shopify (¿le cambiaste el nombre?). ${conv.motivo}`
        : conv.motivo;
      sumar(accRevisar, clave, { ...base, motivo });
    }
  }

  const orden = (a: FilaPedido, b: FilaPedido) =>
    b.cantidad - a.cantidad || a.titulo.localeCompare(b.titulo) || a.talleAr.localeCompare(b.talleAr);

  return {
    generadoEn: new Date().toISOString(),
    lineasLeidas: lineas.length,
    filas: [...acc.values()].sort(orden),
    revisar: [...accRevisar.values()].sort(orden),
    ignoradas,
    productosShopify: porTitulo.size,
  };
}

export function descargarPedidoCSV(res: ResultadoPedido) {
  if (!res.filas.length) { alert('No hay nada para descargar.'); return; }
  const headers = ['Marca', 'Codigo', 'Producto', 'Talle tu tienda (AR)', 'Talle a pedir', 'Escala', 'Cantidad'];
  let csv = headers.join(',') + '\n';
  for (const f of res.filas) {
    csv += [
      f.marca === 'lecoq' ? 'Le Coq Sportif' : 'Converse',
      f.codigo || '', f.titulo, f.talleAr, f.tallePedido || '', f.escala || '', f.cantidad,
    ].map(escapeCSV).join(',') + '\n';
  }
  triggerDownload(csv, `Pedido_iD_${todayStamp()}.csv`);
}
