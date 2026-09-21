export const NTF_LOCATION = 'NTF';
export const NTF_DESCUENTO = 0.15;

export function costoNtf(precio: number): number {
  return Math.round((precio / 2) * (1 - NTF_DESCUENTO) * 100) / 100;
}

export function tituloNtf(nombre: string): string {
  const limpio = nombre.replace(/\bNTF\b/gi, '').trim()
    .replace(/^bemurda\b/i, 'Bermuda').replace(/^ean\b/i, 'Jean')
    .replace(/\s+/g, ' ');
  const palabras = limpio.split(' ').map(p => p.length <= 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1).toLowerCase());
  return [palabras[0], 'NTF', ...palabras.slice(1)].join(' ').trim();
}

export interface NtfProducto {
  codigo: string;
  nombre: string;
  precio: number;
  costoLista: number;
  costoFinal: number;
  sizes: Record<string, number>;
}

/** Plantilla INDY: E es precio FINAL. D e I no cambian el contrato fijo de NTF. */
export function parseNtf(rows: unknown[][]): { productos: Record<string, NtfProducto>; avisos: string[] } {
  const header = rows.findIndex(r => String(r[0] ?? '').trim().toLowerCase().includes('digo sku'));
  if (header < 0) throw new Error('NTF: no encontré el encabezado Código SKU.');
  const productos: Record<string, NtfProducto> = {};
  const avisos: string[] = [];
  for (let i = header + 1; i < rows.length; i++) {
    const row = rows[i];
    const codigo = String(row[0] ?? '').trim();
    if (!codigo || /^SINDY|EJEMPLO/i.test(codigo)) continue;
    if ([row[4], row[5], row[6]].every(v => v === null || v === undefined || v === '')) {
      avisos.push(`Fila ${i + 1}: ${codigo} sin precio, talle ni cantidad; no se carga.`);
      continue;
    }
    const nombreOriginal = String(row[1] ?? '').trim();
    const precio = Number(row[4]);
    const talle = String(row[5] ?? '').trim().toUpperCase();
    const cantidad = Number(row[6]);
    if (!nombreOriginal || !Number.isFinite(precio) || precio <= 0 || !talle || row[6] === '' || row[6] == null || !Number.isInteger(cantidad) || cantidad < 0) {
      throw new Error(`NTF: revisá la fila ${i + 1} (${codigo}): nombre, precio final positivo, talle y cantidad entera son obligatorios.`);
    }
    const nombre = tituloNtf(nombreOriginal);
    const anterior = productos[codigo];
    if (anterior && (anterior.nombre !== nombre || anterior.precio !== precio)) {
      throw new Error(`NTF: ${codigo} tiene nombres o precios distintos entre sus talles (fila ${i + 1}).`);
    }
    const p = productos[codigo] ??= { codigo, nombre, precio, costoLista: precio / 2, costoFinal: costoNtf(precio), sizes: {} };
    if (talle in p.sizes) throw new Error(`NTF: ${codigo}, talle ${talle}, está repetido (fila ${i + 1}).`);
    p.sizes[talle] = cantidad;
  }
  const porNombre = new Map<string, string[]>();
  for (const p of Object.values(productos)) porNombre.set(p.nombre, [...(porNombre.get(p.nombre) || []), p.codigo]);
  for (const [nombre, codigos] of porNombre) if (codigos.length > 1) {
    avisos.push(`${nombre}: aparece con códigos distintos (${codigos.join(', ')}). Se mantienen separados; revisá si corresponden al mismo modelo.`);
  }
  return { productos, avisos };
}
