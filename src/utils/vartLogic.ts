// ============================================================================
// VART — lectura de la "Plantilla de Carga de Productos - Marketplace INDY"
// ----------------------------------------------------------------------------
// Es la MISMA plantilla que usa Luxo. Hoja "Carga Productos", encabezado en la
// fila 4 (índice 3):
//   A=Código SKU | B=Nombre del Producto | C=Descripción | D=Costo |
//   E=Precio / Markup | F=Talle | G=Cantidad | H=Link Foto | I=Descuento (%) |
//   J=Observaciones
//
// REGLAS CONFIRMADAS CON WANDA (19-ago-2026):
//   • COSTO  = columna D menos el descuento comercial (columna I; si viene
//     vacía se usa VART_DESCUENTO, que HOY ES 0 porque todavía lo está
//     negociando con el proveedor).
//   • PRECIO = columna E tal cual. La app NO calcula el precio de Vart.
//   • TALLES = tal cual vienen. NO hay conversión (es marca argentina):
//     ropa S…XXL, pantalón 28…40 de cintura, calzado 35…46.
//   • Los productos sin precio NO son un problema: se listan y se cargan
//     igual, los precios llegan después.
//
// ⚠ POR QUÉ ESTE ARCHIVO EXISTE Y NO REUSAMOS EL LECTOR DE LUXO:
//   La plantilla de Vart vino con errores de tipeo que, si los cargábamos
//   derecho, metían stock en el talle equivocado (el mismo tipo de error que
//   ya nos costó caro con Converse 157197C). Acá se detectan y se FRENAN.
// ============================================================================

// Descuento comercial de Vart. PENDIENTE de confirmar con el proveedor.
// Mientras esté en 0, el costo que va a Shopify es el de la columna D tal cual.
export const VART_DESCUENTO = 0;

// Sucursal de Shopify donde se escribe el stock de Vart.
// ⚠ PENDIENTE: Wanda tiene que crear/confirmar el nombre EXACTO (con emoji si
// lo lleva). Hasta entonces la escritura de stock va a avisar que no la ubica.
export const VART_LOCATION = 'VART';

export interface VartProblema {
  tipo: 'talle_corrido' | 'sku_duplicado' | 'nombre_en_conflicto';
  fila: number;      // fila del Excel tal cual la ve la usuaria (base 1)
  sku: string;
  detalle: string;
}

export interface VartProducto {
  skuBase: string;                    // VA0082-524 (sin el sufijo de talle)
  nombre: string;
  descripcion: string;
  costo: number;                      // columna D, sin descuento
  costoFinal: number;                 // columna D menos el descuento comercial
  precio: number;                     // columna E tal cual (0 si no vino)
  foto: string;
  sizes: Record<string, number>;      // talle -> cantidad
  // talle -> SKU REAL del proveedor. Importantísimo: en la ropa el sufijo del
  // SKU es un código (63=S, 64=M, 65=L, 66=XL, 67=XXL), NO el talle. Si al crear
  // los productos la app se inventara el SKU (VA0082-524-S), no coincidiría
  // nunca más con el archivo de Vart. Por eso guardamos el que mandó el
  // proveedor y lo usamos tal cual.
  skuPorTalle: Record<string, string>;
}

export interface VartParse {
  productos: Record<string, VartProducto>;
  filasLeidas: number;
  filasIgnoradas: number;             // ejemplo de la plantilla y filas vacías
  problemas: VartProblema[];
  sinPrecio: string[];                // skuBase de los que vinieron sin precio
}

// Talles de calzado. En el calzado (y SOLO en el calzado) el SKU termina en el
// talle: VA0005-28-39 = modelo VA0005, color 28, talle 39. Eso nos deja
// verificar la fila contra sí misma.
const CALZADO_MIN = 34;
const CALZADO_MAX = 47;

function esTalleCalzado(x: string): boolean {
  const n = Number(x);
  return Number.isInteger(n) && n >= CALZADO_MIN && n <= CALZADO_MAX;
}

// VA0082-524-63 -> VA0082-524 ; VA0005-28-39 -> VA0005-28
export function skuBaseDe(sku: string): string {
  const p = String(sku || '').trim().split('-');
  return p.length > 1 ? p.slice(0, -1).join('-') : String(sku || '').trim();
}

export function sufijoDe(sku: string): string {
  const p = String(sku || '').trim().split('-');
  return p.length > 1 ? p[p.length - 1] : '';
}

/**
 * Lee las filas ya crudas de la hoja "Carga Productos".
 * `rows` es la matriz que devuelve XLSX.utils.sheet_to_json(..., {header:1}).
 */
export function parseVart(rows: any[][], descuento = VART_DESCUENTO): VartParse {
  // Buscamos el encabezado por su primera celda ("Código SKU").
  let hRow = -1;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const fila = (rows[r] || []).map((x) => String(x || '').toLowerCase());
    if (fila.some((c) => c.includes('digo sku'))) { hRow = r; break; }
  }
  if (hRow < 0) {
    throw new Error('No encontré el encabezado "Código SKU" en la plantilla de Vart.');
  }

  const productos: Record<string, VartProducto> = {};
  const problemas: VartProblema[] = [];
  const vistos = new Map<string, number>();   // sku completo -> fila donde apareció
  const nombreDeBase = new Map<string, string>();
  let filasLeidas = 0;
  let filasIgnoradas = 0;

  for (let r = hRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const fila = r + 1; // como la numera Excel
    const sku = String(row[0] || '').trim();
    if (!sku) { filasIgnoradas++; continue; }

    // La plantilla trae 5 filas de ejemplo (SKU que empieza con SINDY) y una
    // fila con el cartel "EJEMPLO - SELECCIONAR Y ELIMINAR FILAS".
    if (/^SINDY/i.test(sku) || /EJEMPLO/i.test(sku)) { filasIgnoradas++; continue; }

    const nombre = String(row[1] || '').trim();
    const descripcion = String(row[2] || '').trim();
    const costo = Number(row[3]) || 0;
    const precio = Number(row[4]) || 0;
    const talle = String(row[5] ?? '').trim().toUpperCase() || 'UNICO';
    const cantidad = Number(row[6]) || 0;
    const foto = String(row[7] || '').trim();
    // El descuento por fila pisa al general, si viene cargado.
    const dtoFila = row[8] === '' || row[8] === null || row[8] === undefined ? null : Number(row[8]);
    const dto = dtoFila === null || isNaN(dtoFila) ? descuento : dtoFila;

    if (!nombre) { filasIgnoradas++; continue; }
    filasLeidas++;

    // ---- VALIDACIÓN 1: SKU repetido ----
    const previa = vistos.get(sku.toUpperCase());
    if (previa !== undefined) {
      problemas.push({
        tipo: 'sku_duplicado', fila, sku,
        detalle: `El mismo SKU ya está en la fila ${previa} ("${nombreDeBase.get(sku.toUpperCase()) || ''}"). Un SKU no puede estar en dos productos.`,
      });
      continue; // no lo cargamos: no sabemos a cuál de los dos pertenece
    }
    vistos.set(sku.toUpperCase(), fila);
    nombreDeBase.set(sku.toUpperCase(), nombre);

    // ---- VALIDACIÓN 2: talle corrido (solo calzado) ----
    // En calzado el sufijo del SKU ES el talle. Si no coinciden, la fila está
    // desalineada y cargarla significaría meter el stock en el talle que no es.
    const suf = sufijoDe(sku);
    if (esTalleCalzado(suf) && esTalleCalzado(talle) && Number(suf) !== Number(talle)) {
      problemas.push({
        tipo: 'talle_corrido', fila, sku,
        detalle: `El SKU termina en ${suf} pero la columna Talle dice ${talle}. En el resto del archivo el SKU siempre termina en el talle, así que esta fila está corrida.`,
      });
      continue; // NO se carga
    }

    // ---- VALIDACIÓN 3: dos nombres distintos para el mismo modelo+color ----
    const base = skuBaseDe(sku);
    const nombrePrevio = nombreDeBase.get(base);
    if (nombrePrevio && nombrePrevio !== nombre) {
      problemas.push({
        tipo: 'nombre_en_conflicto', fila, sku,
        detalle: `El código ${base} figura como "${nombrePrevio}" y también como "${nombre}". Son dos productos distintos con el mismo código.`,
      });
      continue;
    }
    nombreDeBase.set(base, nombre);

    if (!productos[base]) {
      productos[base] = {
        skuBase: base, nombre, descripcion, costo,
        costoFinal: Math.round(costo * (1 - dto)),
        precio, foto, sizes: {}, skuPorTalle: {},
      };
    }
    // Si en la primera fila del producto no vino el precio pero sí en otra, lo tomamos.
    const p = productos[base];
    if (!p.precio && precio) p.precio = precio;
    if (!p.costo && costo) { p.costo = costo; p.costoFinal = Math.round(costo * (1 - dto)); }
    p.sizes[talle] = (p.sizes[talle] || 0) + cantidad;
    p.skuPorTalle[talle] = sku;
  }

  const sinPrecio = Object.values(productos).filter((p) => !p.precio).map((p) => p.skuBase);
  return { productos, filasLeidas, filasIgnoradas, problemas, sinPrecio };
}
