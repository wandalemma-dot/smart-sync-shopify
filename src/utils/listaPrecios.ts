// ============================================================================
// SÁBANA DE PRECIOS (Le Coq Sportif y Converse)
// ----------------------------------------------------------------------------
// Archivo del proveedor con una hoja por marca y las columnas:
//   SKU | DESCRIPCION | WHSL PRICE | RETAIL PRICE
//
//   WHSL PRICE   = precio de LISTA por unidad (sobre este se calcula todo)
//   RETAIL PRICE = precio sugerido del proveedor (el que va en los básicos)
//
// El Excel de stock de Converse/Le Coq NO trae precios: por eso hace falta
// cruzar contra esta sábana para poder cargar precio y costo.
// ============================================================================

import * as XLSX from 'xlsx';

export interface PrecioItem {
  whsl: number;    // precio de lista
  retail: number;  // sugerido del proveedor
  desc: string;
}

export interface ListaPrecios {
  items: Record<string, PrecioItem>; // clave: SKU en mayúsculas
  cantidad: number;
  hojas: string[];
}

export async function leerListaPrecios(file: File): Promise<ListaPrecios> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const items: Record<string, PrecioItem> = {};
  const hojas: string[] = [];

  for (const nombreHoja of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1 }) as any[];
    // Encabezado: fila con "SKU" y algo con "PRICE"
    let h = -1;
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const linea = Array.from((rows[r] as any[]) || [], (x) => String(x || '').toUpperCase());
      if (linea.some((c) => c === 'SKU') && linea.some((c) => c.includes('PRICE'))) { h = r; break; }
    }
    if (h < 0) continue;

    const hdr = Array.from((rows[h] as any[]) || [], (x) => String(x || '').toUpperCase().trim());
    const iSku = hdr.findIndex((c) => c === 'SKU');
    const iDesc = hdr.findIndex((c) => c.includes('DESCRIP'));
    const iWhsl = hdr.findIndex((c) => c.includes('WHSL'));
    const iRetail = hdr.findIndex((c) => c.includes('RETAIL'));
    if (iSku < 0 || iWhsl < 0) continue;
    hojas.push(nombreHoja);

    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r] as any[];
      if (!row) continue;
      const sku = String(row[iSku] ?? '').trim().toUpperCase();
      if (!sku) continue;
      const whsl = parseFloat(row[iWhsl]) || 0;
      const retail = iRetail >= 0 ? (parseFloat(row[iRetail]) || 0) : 0;
      if (whsl <= 0 && retail <= 0) continue;
      items[sku] = { whsl, retail, desc: iDesc >= 0 ? String(row[iDesc] ?? '') : '' };
    }
  }

  return { items, cantidad: Object.keys(items).length, hojas };
}
