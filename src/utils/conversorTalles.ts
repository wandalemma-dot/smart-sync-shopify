// ============================================================================
// CONVERSOR DE TALLES — Converse y Le Coq
// ----------------------------------------------------------------------------
// Wanda carga los productos en Shopify con talle ARGENTINO.
// La web de pedidos exige talle US (Converse) o EU (Le Coq calzado).
//
// ⚠ REGLA CRÍTICA (no simplificar):
//   Un mismo talle AR NO equivale siempre al mismo US. Depende de la CURVA del
//   modelo. AR 40 = US 8 en curva 2, US 7 en curva 8, US 9 en curva 8A.
//   Por eso es OBLIGATORIO conocer el código del producto para convertir.
//   Si alguien reemplaza esto por una tabla única, los pedidos salen mal en
//   silencio: no hay validación posterior que lo detecte.
//
// El módulo NUNCA adivina. Si el código no está en el maestro, o el talle cae
// fuera de la curva, devuelve { ok: false, motivo } para mostrar en la UI.
// ============================================================================

import tablas from './tallesConverseLecoq.json';

export type Marca = 'converse' | 'lecoq';

export interface ConversionOK {
  ok: true;
  talleAr: string;
  tallePedido: string;   // el talle que se carga en la web de pedidos
  escala: string;        // "U.S.A. MENS", "U.S.A. WOS", "U.S.A." o "EU"
  curva?: string;        // solo Converse
  curvaNombre?: string;  // solo Converse
}

export interface ConversionError {
  ok: false;
  talleAr: string;
  motivo: string;
}

export type Conversion = ConversionOK | ConversionError;

interface Curva {
  nombre: string;
  sap: string | null;
  escala_a_pedir: string;
  ar_a_us: Record<string, string>;
  us_a_ar: Record<string, string>;
}

const CURVAS = (tablas as any).curvas as Record<string, Curva>;
const SKU_A_CURVA = (tablas as any).sku_a_curva as Record<string, string>;

// Normaliza un talle: "40.0" -> "40", "40,5" -> "40.5", saca espacios.
function normTalle(talle: string | number): string {
  let s = String(talle ?? '').trim().replace(',', '.');
  if (s === '') return '';
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    s = Number.isInteger(n) ? String(n) : String(n);
  }
  return s;
}

// Normaliza un código de producto: mayúsculas, sin espacios.
export function normCodigo(sku: string): string {
  return String(sku ?? '').trim().toUpperCase();
}

// Devuelve la curva de un código, o null si no está en el maestro.
export function curvaDe(sku: string): string | null {
  return SKU_A_CURVA[normCodigo(sku)] ?? null;
}

// ============================================================================
// QUÉ CURVA USAR — la ETIQUETA del producto MANDA sobre el maestro.
// ----------------------------------------------------------------------------
// Misma regla que `converseTablaInfo()` en syncLogic.ts, y por el mismo motivo:
// medido contra la tienda real (28-ago-2026) hay 8 productos donde el maestro y
// la etiqueta no coinciden, y en los 8 gana la etiqueta.
//
// ⚠ ACÁ IMPORTA EL DOBLE. Esta conversión no escribe en Shopify: arma el PEDIDO
//   que Wanda le hace a iD. Equivocar la curva significa PEDIR EL TALLE
//   EQUIVOCADO y que llegue mercadería que no va.
//   Caso real (29-ago-2026): A11716C «Sport Casual Ox Blanco» tiene la etiqueta
//   TABLA 1 pero en el maestro figura como tabla 2. La reposición pedía US 7.5
//   para el AR 41, cuando corresponde US 8.5.
// ============================================================================
const CURVA_POR_TABLA: Record<string, string> = {
  '1': '2',      // TABLA DE TALLE CONVERSE 1
  '2': '8',      // TABLA DE TALLE CONVERSE 2
  MUJER: '8A',
  NINO: '4',
  BEBE: '5',
};

// Lee ÚNICAMENTE la etiqueta "TABLA DE TALLE ...". Devuelve null si no está.
export function curvaDesdeEtiqueta(tags: string | string[] | null | undefined): string | null {
  const lista = (Array.isArray(tags) ? tags : String(tags || '').split(','))
    .map((s) => String(s).trim().toUpperCase());
  const etq = lista.find((e) => e.startsWith('TABLA DE TALLE'));
  if (!etq) return null;
  if (etq.includes('NIÑO') || etq.includes('NINO')) return CURVA_POR_TABLA.NINO;
  if (etq.includes('BEBE') || etq.includes('BEBÉ')) return CURVA_POR_TABLA.BEBE;
  if (etq.includes('MUJER')) return CURVA_POR_TABLA.MUJER;
  if (/\b2\b/.test(etq)) return CURVA_POR_TABLA['2'];
  if (/\b1\b/.test(etq)) return CURVA_POR_TABLA['1'];
  return null; // etiqueta rara: mejor no adivinar
}

// ---- CONVERSE: AR -> US, según la curva del modelo ----
export function convertirConverse(
  sku: string,
  talleAr: string | number,
  tags?: string | string[] | null,
): Conversion {
  const codigo = normCodigo(sku);
  const talle = normTalle(talleAr);

  if (!codigo) return { ok: false, talleAr: talle, motivo: 'Falta el código del producto' };
  if (!talle) return { ok: false, talleAr: talle, motivo: 'Falta el talle' };

  // La etiqueta del producto manda; el maestro es el respaldo (ver arriba).
  const curva = curvaDesdeEtiqueta(tags) ?? SKU_A_CURVA[codigo];
  if (!curva) {
    return { ok: false, talleAr: talle, motivo: `${codigo}: no tiene etiqueta "TABLA DE TALLE" y no está en el maestro de curvas` };
  }

  const tabla = CURVAS[curva];
  if (!tabla) {
    return { ok: false, talleAr: talle, motivo: `La curva ${curva} no existe en las tablas` };
  }

  const us = tabla.ar_a_us[talle];
  if (us === undefined) {
    return { ok: false, talleAr: talle, motivo: `Talle AR ${talle} fuera de la curva ${curva} (${tabla.nombre})` };
  }

  return {
    ok: true,
    talleAr: talle,
    tallePedido: us,
    escala: tabla.escala_a_pedir,
    curva,
    curvaNombre: tabla.nombre,
  };
}

// ---- LE COQ: EU = AR + 1. Solo aplica a CALZADO. ----
export function convertirLeCoq(talleAr: string | number): Conversion {
  const talle = normTalle(talleAr);
  if (!talle) return { ok: false, talleAr: talle, motivo: 'Falta el talle' };

  const n = parseFloat(talle);
  if (isNaN(n)) {
    // Talles en letras (S, M, L) => es indumentaria, no calzado: no se convierte.
    return { ok: false, talleAr: talle, motivo: `Talle "${talle}" no es numérico (la regla AR+1 es solo para calzado)` };
  }

  const eu = n + 1;
  return {
    ok: true,
    talleAr: talle,
    tallePedido: Number.isInteger(eu) ? String(eu) : String(eu),
    escala: 'EU',
  };
}

// ---- Router por marca ----
export function convertir(
  marca: Marca | string,
  sku: string,
  talleAr: string | number,
  tags?: string | string[] | null,
): Conversion {
  const m = String(marca || '').toLowerCase();
  if (m.includes('coq')) return convertirLeCoq(talleAr);
  if (m.includes('converse')) return convertirConverse(sku, talleAr, tags);
  return { ok: false, talleAr: normTalle(talleAr), motivo: `Marca "${marca}" no se convierte (solo Converse y Le Coq)` };
}

// ---- Conversión en lote ----
export interface LineaPedido {
  marca: Marca | string;
  sku: string;
  talleAr: string | number;
  [k: string]: unknown; // datos extra que la UI quiera arrastrar (título, cantidad, etc.)
}

export interface LineaConvertida extends LineaPedido { conversion: ConversionOK }
export interface LineaRevisar extends LineaPedido { conversion: ConversionError }

export function convertirLote(lineas: LineaPedido[]): { listas: LineaConvertida[]; revisar: LineaRevisar[] } {
  const listas: LineaConvertida[] = [];
  const revisar: LineaRevisar[] = [];
  for (const linea of lineas) {
    const conversion = convertir(linea.marca, linea.sku, linea.talleAr);
    if (conversion.ok) listas.push({ ...linea, conversion });
    else revisar.push({ ...linea, conversion });
  }
  return { listas, revisar };
}
