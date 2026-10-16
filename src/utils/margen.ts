// El precio incluye IVA; el costo es neto.
export const IVA = 1.21;
export function margenPct(precio: number, costo: number): number | null {
  if (!Number.isFinite(precio) || precio <= 0 || !Number.isFinite(costo) || costo <= 0) return null;
  return (1 - costo / (precio / IVA)) * 100;
}
export function precioExistente(brand: string, actual: number, costoNuevo: number, calculado: number): number {
  if (brand !== 'converse' && brand !== 'lecoq') return calculado;
  // Un precio cero requiere inicialización. Sin costo válido no decidir margen.
  if (actual === 0 && costoNuevo > 0) return calculado;
  if (margenPct(actual, costoNuevo) === null) return actual;
  // Comparar centavos sin redondear el porcentaje mostrado.
  return Math.round(costoNuevo * 100) * 242 > Math.round(actual * 100) * 100 ? calculado : actual;
}
