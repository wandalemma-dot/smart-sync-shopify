// ============================================================================
// iD — "PlantillaPedido.xlsx" (formato nuevo, agosto 2026)
// ----------------------------------------------------------------------------
// Desde ahora Wanda baja así los archivos de iD: UNO POR MARCA (uno de Converse
// y otro de Le Coq Sportif). Reemplaza al "Stock (N).xlsx".
//
// ESTRUCTURA (hoja «Plantilla»):
//   fila 0 -> IDs internos del proveedor (UUIDs). Se ignora.
//   fila 1 -> ENCABEZADO:
//        col 0 Foto | 1 Artículo | 2 Color | 3 Precio | 4 (etiqueta) |
//        col 5..N  talles: TU, XS, S, M, L, XL, XXL, 3XL y códigos numéricos
//                  (030, 035, ... 140) — ⚠ NO están en orden
//        después:  Unidades | Importe | IdCuenta | IdMarca | IdItem
//   fila 2 en adelante -> DE A PARES:
//        fila A: código | cód. color | PRECIO | "Disponible" | stock por talle
//        fila B: NOMBRE | COLOR      |         | "Cantidad"   | (vacío: es lo
//                que Wanda completa a mano cuando hace el pedido)
//
// ⚠ DOS COSAS QUE HAY QUE RESPETAR SÍ O SÍ:
//
//   1) Los talles se leen POR NOMBRE DE COLUMNA, nunca por posición. En este
//      archivo el encabezado va 030,035,...,130, y RECIÉN DESPUÉS 075,085,095.
//      Si se leyera por posición, se cargaría el stock en el talle equivocado.
//
//   2) La conversión numérica se aplica SOLO si el talle es todo dígitos.
//      "3XL" empieza con 3: si se hiciera parseInt("3XL")/10 daría 0.3.
//      Por eso el chequeo es /^\d+$/ y no parseInt a secas.
//
// PRECIO: la columna «Precio» es el precio de LISTA (WHSL). Verificado contra
// la sábana del 04-08-26: coincide exacto en 381 de 386 códigos en común.
// En los 5 que no, la sábana repite el mismo valor (53422,4599 / retail 99900)
// para 5 modelos distintos, así que la buena es la de este archivo.
// Lo que este archivo NO trae es el RETAIL (precio sugerido), que hace falta
// para los 45 básicos de Converse: eso sigue saliendo de la sábana.
// ============================================================================

export interface FilaPedido {
  codigo: string;                  // A10564C
  nombre: string;                  // CHUCK 70 HI
  color: string;                   // SANDY SHORE
  precioLista: number;             // columna Precio = WHSL
  sizes: Record<string, number>;   // talle YA normalizado -> cantidad
}

export interface ParsePedido {
  items: Record<string, FilaPedido>;
  productos: number;
  unidades: number;
  talleColumnas: string[];         // los talles que traía el encabezado
  conTope: number;                 // cuántas celdas venían como "+50"
}

// El proveedor no publica el stock exacto cuando tiene mucho: escribe "+50"
// ("más de cincuenta"). Regla de Wanda: en esos casos cargamos 50 y listo.
// El "+" se saca a propósito y NO se confía en que Number("+50") dé 50 solo.
const PREFIJO_TOPE = '+';

// Columnas que van DESPUÉS de los talles y no son talles.
const NO_SON_TALLES = ['unidades', 'importe', 'idcuenta', 'idmarca', 'iditem'];

/** ¿Este Excel es la PlantillaPedido nueva de iD? */
export function esPlantillaPedido(rows: any[][]): boolean {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const fila = (rows[r] || []).map((x) => String(x || '').trim().toLowerCase());
    const tieneArticulo = fila.some((c) => c === 'artículo' || c === 'articulo');
    const tienePrecio = fila.some((c) => c === 'precio');
    const tieneUnidades = fila.some((c) => c === 'unidades');
    if (tieneArticulo && tienePrecio && tieneUnidades) return true;
  }
  return false;
}

/**
 * Normaliza el talle del proveedor al que usamos internamente.
 *  - Converse: los códigos numéricos son US x10 -> 030 = US 3 ; 105 = US 10.5
 *  - Le Coq  : se le sacan los ceros de adelante -> 030 = 30
 *  - Letras (TU, S, M, L, XL, XXL, 3XL): quedan tal cual.
 */
export function normalizarTalle(raw: string, brand: 'converse' | 'lecoq'): string {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return s;
  // ⚠ Solo si es TODO dígitos. "3XL" NO entra acá (ver comentario de arriba).
  if (!/^\d+$/.test(s)) return s;
  if (brand === 'converse') return (parseInt(s, 10) / 10).toString();
  return s.replace(/^0+/, '') || s;
}

export function parsePlantillaPedido(rows: any[][], brand: 'converse' | 'lecoq'): ParsePedido {
  // 1) Encontrar el encabezado (el que tiene "Artículo" y "Precio").
  let hRow = -1;
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const fila = (rows[r] || []).map((x) => String(x || '').trim().toLowerCase());
    if ((fila.some((c) => c === 'artículo' || c === 'articulo')) && fila.some((c) => c === 'precio')) {
      hRow = r; break;
    }
  }
  if (hRow < 0) throw new Error('No encontré el encabezado (Artículo / Precio) en la PlantillaPedido.');

  const hdr = (rows[hRow] || []).map((x) => String(x || '').trim());
  const iCod = hdr.findIndex((c) => /^art[ií]culo$/i.test(c));
  const iColor = hdr.findIndex((c) => /^color$/i.test(c));
  const iPrecio = hdr.findIndex((c) => /^precio$/i.test(c));

  // 2) Mapa columna -> talle, LEYENDO EL NOMBRE. Arranca después de "Precio"
  //    y corta en "Unidades" (o en la primera columna que no sea talle).
  const colTalle: { col: number; talle: string }[] = [];
  for (let c = iPrecio + 1; c < hdr.length; c++) {
    const nombre = hdr[c];
    if (!nombre) continue;                                   // la columna de la etiqueta
    if (NO_SON_TALLES.includes(nombre.toLowerCase())) break;  // desde acá ya no hay talles
    colTalle.push({ col: c, talle: nombre });
  }

  // 3) Recorrer de a pares: fila "Disponible" + fila "Cantidad".
  const items: Record<string, FilaPedido> = {};
  let unidades = 0;
  let conTope = 0;
  for (let r = hRow + 1; r < rows.length; r++) {
    const a = rows[r] || [];
    const codigo = String(a[iCod] || '').trim();
    if (!codigo) continue;
    // La fila del stock es la que dice "Disponible" en la columna de etiqueta.
    const etiqueta = String(a[iPrecio + 1] || '').trim().toLowerCase();
    if (etiqueta !== 'disponible') continue;

    const b = rows[r + 1] || [];                              // fila "Cantidad"
    const nombre = String(b[iCod] || '').trim();
    const color = iColor >= 0 ? String(b[iColor] || '').trim() : '';
    const precioLista = Number(a[iPrecio]) || 0;

    const key = codigo.toUpperCase();
    if (!items[key]) {
      items[key] = { codigo: key, nombre, color, precioLista, sizes: {} };
    }
    for (const { col, talle } of colTalle) {
      let celda = String(a[col] ?? '').trim();
      if (!celda || celda === '-') continue;                  // "-" = no lo maneja
      // "+50" = "más de 50". Regla de Wanda: cargamos 50.
      if (celda.startsWith(PREFIJO_TOPE)) {
        celda = celda.slice(1).trim();
        conTope++;
      }
      const qty = Number(celda);
      if (!isFinite(qty)) continue;
      const norm = normalizarTalle(talle, brand);
      items[key].sizes[norm] = (items[key].sizes[norm] || 0) + qty;
      unidades += qty;
    }
    r++; // saltamos la fila "Cantidad": ya la usamos para el nombre
  }

  return {
    items,
    productos: Object.keys(items).length,
    unidades,
    talleColumnas: colTalle.map((x) => x.talle),
    conTope,
  };
}

/** Título para Shopify: nombre + color, sin repetir el color si ya está. */
export function tituloPedido(f: FilaPedido): string {
  const n = f.nombre.trim();
  const c = f.color.trim();
  if (!c || n.toUpperCase().includes(c.toUpperCase())) return n;
  return `${n} ${c}`;
}
