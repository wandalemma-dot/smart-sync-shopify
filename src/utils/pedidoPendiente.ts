// ============================================================================
// PEDIDO YA HECHO AL PROVEEDOR ("lo que viene en camino")
// ----------------------------------------------------------------------------
// Wanda descarga el pedido en Excel con formato de MATRIZ:
//   Imagen | Código | Descripción | Color | S | M | 030 | L | 035 | XL | TU |
//   040 | 045 | 055 | ... | Total | Precio unit. | Subtotal
// Los talles numéricos vienen como US x 10 con ceros adelante:
//   "030" = US 3      "055" = US 5.5      "130" = US 13
// Los de letra (S, M, L, XL, TU) van tal cual.
//
// Sirve para descontar del pedido nuevo lo que ya está por llegar.
// ============================================================================

import * as XLSX from 'xlsx';

// clave: "CODIGO|TALLE_US"  ->  cantidad pedida
export type EnCamino = Record<string, number>;

export interface PedidoPendiente {
  items: EnCamino;
  numero: string;      // "Pedido N° 00000125"
  fecha: string;       // como venga en el archivo
  lineas: number;      // cuántas líneas (código+talle) trae
  unidades: number;    // total de unidades
}

export function claveEnCamino(codigo: string, talle: string): string {
  return `${String(codigo || '').trim().toUpperCase()}|${String(talle || '').trim().toUpperCase()}`;
}

// "055" -> "5.5" | "030" -> "3" | "130" -> "13" | "S" -> "S"
function normalizarTalleColumna(h: string): string {
  const s = String(h || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10) / 10;
    return Number.isInteger(n) ? String(n) : String(n);
  }
  return s.toUpperCase();
}

export async function leerPedidoPendiente(file: File): Promise<PedidoPendiente> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(hoja, { header: 1 }) as any[];

  // Encabezado: la fila que tiene "Código" y "Descripción".
  let h = -1;
  for (let r = 0; r < rows.length; r++) {
    const línea = Array.from((rows[r] as any[]) || [], (x) => String(x || '').toLowerCase());
    if (línea.some((c) => c.includes('digo')) && línea.some((c) => c.includes('descrip'))) { h = r; break; }
  }
  if (h < 0) throw new Error('No encontré el encabezado (Código / Descripción) en el Excel del pedido.');

  const hdr = Array.from((rows[h] as any[]) || [], (x) => String(x || '').trim());
  const iCod = hdr.findIndex((c) => c.toLowerCase().includes('digo'));
  const iTotal = hdr.findIndex((c) => c.toLowerCase() === 'total');

  // Las columnas de talle son las que están entre "Color" y "Total".
  const iColor = hdr.findIndex((c) => c.toLowerCase().includes('color'));
  const desde = iColor >= 0 ? iColor + 1 : iCod + 3;
  const hasta = iTotal > 0 ? iTotal : hdr.length;

  const columnas: { idx: number; talle: string }[] = [];
  for (let c = desde; c < hasta; c++) {
    const t = normalizarTalleColumna(hdr[c]);
    if (t) columnas.push({ idx: c, talle: t });
  }

  // Datos del encabezado del archivo (número de pedido y fecha), si están.
  const cabecera = Array.from((rows[0] as any[]) || [], (x) => String(x || '').trim()).filter(Boolean);
  const numero = cabecera.find((x) => /pedido/i.test(x)) || '';
  const fecha = cabecera.find((x) => /^\d{2}\/\d{2}\/\d{4}$/.test(x)) || '';

  const items: EnCamino = {};
  let lineas = 0;
  let unidades = 0;

  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] as any[];
    if (!row) continue;
    const cod = String(row[iCod] || '').trim().toUpperCase();
    if (!cod) continue;
    for (const { idx, talle } of columnas) {
      const q = parseFloat(row[idx]);
      if (!q || isNaN(q) || q <= 0) continue;
      const k = claveEnCamino(cod, talle);
      items[k] = (items[k] || 0) + q;
      lineas++;
      unidades += q;
    }
  }

  return { items, numero, fecha, lineas, unidades };
}
