// ============================================================================
// ORNG — lista de precios (mochilas, gorras, bolsos)
// ----------------------------------------------------------------------------
// El proveedor manda UN archivo con las dos familias mezcladas, y cada una
// tiene su propio contrato. Por eso ORNG es UNA sola marca en la app y la regla
// se elige fila por fila, según la columna ARTICULO.
//
// CONTRATO (dicho por Wanda, 08-sep-2026):
//   • Mochilas                  -> bonificación 12,5% · markup 2,1
//   • Indumentaria y accesorios -> bonificación 15%   · markup 2,0
//   (el markup se aplica sobre el precio mayorista YA bonificado)
//
// FORMATO DEL EXCEL (hoja «Hoja1», encabezado en la fila 1):
//   A ARTICULO | B CODIGO | C COLOR | D DESCRIPCION | E NOMBRE | F COMPOSICION
//   G (cantidad por bulto) | H (unidad) | I COSTO
//
// ⚠ ESTE ARCHIVO NO TRAE STOCK. No hay ninguna columna de cantidad disponible:
//   la G es "1" (unidad de venta), no lo que tiene el proveedor. Así que de acá
//   salen precios y productos nuevos, nunca stock.
//
// ⚠ EL CÓDIGO SE REPITE POR COLOR. La HUDSON 22050019 viene en NE, AZ y VE.
//   Son productos distintos: la clave es CODIGO + COLOR.
// ============================================================================

export interface ReglaOrng { descuento: number; markup: number }

export const ORNG_REGLAS: Record<'mochilas' | 'accesorios', ReglaOrng> = {
  mochilas:   { descuento: 0.125, markup: 2.1 },
  accesorios: { descuento: 0.15,  markup: 2.0 },
};

// Qué valores de la columna ARTICULO caen en el contrato de MOCHILAS.
// 🟡 PENDIENTE DE CONFIRMAR: el Matero y las Luncheras están acá porque son
//    bolsos, pero Wanda todavía no lo confirmó. Si van con el contrato de
//    accesorios, se sacan de esta lista y listo: no hay que tocar nada más.
export const ORNG_ARTICULOS_MOCHILA = ['MOCHILA', 'MATERO', 'LUNCHERA', 'BOLSO', 'RIÑONERA', 'RINONERA'];

export function familiaOrng(articulo: string): 'mochilas' | 'accesorios' {
  const a = String(articulo || '').trim().toUpperCase();
  return ORNG_ARTICULOS_MOCHILA.some((x) => a.includes(x)) ? 'mochilas' : 'accesorios';
}

/**
 * Costo final: el de lista menos la bonificación comercial de esa familia.
 * CON DECIMALES (a los centavos), por pedido de Wanda: «todo suma».
 * Shopify guarda el costo con decimales, así que redondear al peso además
 * hacía que un costo correcto pareciera distinto en cada sincronización.
 */
export function costoOrng(costoLista: number, familia: 'mochilas' | 'accesorios'): number {
  return Math.round(costoLista * (1 - ORNG_REGLAS[familia].descuento) * 100) / 100;
}

/**
 * Precio de venta: el markup va sobre el precio de lista, SIN LA BONIFICACIÓN.
 *
 * 🔴 ESTO SE EQUIVOCÓ UNA VEZ Y NO SE VUELVE A CAMBIAR SIN PREGUNTAR.
 *    Al principio se aplicaba el markup sobre el costo ya bonificado y daba
 *    42,4% de margen. Wanda lo corrigió el 08-sep-2026: «tenés que multiplicar
 *    el precio final directamente con el costo sin descuento».
 *    Con el de lista da ~50%, que es el margen con el que trabaja, y coincide
 *    con cómo estaban armados los precios viejos de su tienda:
 *    Sunset lista 27999 × 2,1 = 58.798 y en Shopify estaba en 58.999.
 *
 *    La bonificación NO se pierde: es la ganancia. Baja el COSTO, no el precio.
 *
 * 🟡 SIN REDONDEO, igual que Bloque. Si quiere terminación …999, se cambia acá.
 */
export function precioOrng(costoLista: number, familia: 'mochilas' | 'accesorios'): number {
  return Math.round(costoLista * ORNG_REGLAS[familia].markup);
}

export interface ProductoOrng {
  clave: string;          // CODIGO-COLOR, la identidad del producto
  codigo: string;
  color: string;          // ⚠ viene como CÓDIGO de color (NE, AZ, GMM...)
  articulo: string;       // Mochila / Caps / Lunchera / Matero
  descripcion: string;    // "Mochila Urbana", "Trucker", "6 gajos"
  nombre: string;         // "HARLEM", "BAY"
  familia: 'mochilas' | 'accesorios';
  costoLista: number;     // el de la columna COSTO, sin bonificar
  costo: number;          // ya con la bonificación
  precio: number;         // el de venta
  titulo: string;         // como iría a Shopify
}

export interface ParseOrng {
  productos: ProductoOrng[];
  filasLeidas: number;
  duplicados: string[];   // mismo CODIGO+COLOR repetido en el archivo
}

/** Título para Shopify: "Mochila Urbana Harlem". El color se suma aparte. */
function titulo(descripcion: string, nombre: string): string {
  const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return [titleCase(descripcion), titleCase(nombre)].filter(Boolean).join(' ').trim();
}

/** Lee la hoja del Excel de ORNG (la matriz de XLSX con header:1). */
export function parseOrng(rows: any[][]): ParseOrng {
  // Encabezado: la fila que tiene ARTICULO y COSTO.
  let hRow = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const fila = (rows[r] || []).map((x) => String(x || '').trim().toUpperCase());
    if (fila.some((c) => c === 'ARTICULO') && fila.some((c) => c === 'COSTO')) { hRow = r; break; }
  }
  if (hRow < 0) throw new Error('No encontré el encabezado (ARTICULO / COSTO) en el Excel de ORNG.');

  const hdr = (rows[hRow] || []).map((x) => String(x || '').trim().toUpperCase());
  const col = (nombre: string, porDefecto: number) => {
    const i = hdr.findIndex((c) => c === nombre);
    return i >= 0 ? i : porDefecto;
  };
  const cArt = col('ARTICULO', 0), cCod = col('CODIGO', 1), cColor = col('COLOR', 2);
  const cDesc = col('DESCRIPCION', 3), cNom = col('NOMBRE', 4), cCosto = col('COSTO', 8);

  const vistos = new Set<string>();
  const duplicados: string[] = [];
  const productos: ProductoOrng[] = [];
  let filasLeidas = 0;

  for (let r = hRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const articulo = String(row[cArt] || '').trim();
    const codigo = String(row[cCod] || '').trim();
    if (!articulo || !codigo) continue;
    const costoLista = Number(row[cCosto]) || 0;
    if (costoLista <= 0) continue;
    filasLeidas++;

    // El color viene con espacios de más y a veces con barra: " AZ/GO" -> "AZ/GO".
    const color = String(row[cColor] || '').trim().replace(/\s*\/\s*/g, '/').toUpperCase();
    const clave = `${codigo}-${color}`;
    if (vistos.has(clave)) { duplicados.push(clave); continue; }
    vistos.add(clave);

    const familia = familiaOrng(articulo);
    const descripcion = String(row[cDesc] || '').trim();
    const nombre = String(row[cNom] || '').trim();

    productos.push({
      clave, codigo, color, articulo, descripcion, nombre, familia,
      costoLista,
      costo: costoOrng(costoLista, familia),
      precio: precioOrng(costoLista, familia),
      titulo: titulo(descripcion, nombre),
    });
  }

  return { productos, filasLeidas, duplicados };
}
