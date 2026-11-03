const ORDEN_LETRAS = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL'];
function posicionLetra(t) {
  const v = t.trim().toUpperCase();
  const n = v.match(/^([2-5])XL$/);
  return ORDEN_LETRAS.indexOf(n ? 'X'.repeat(Number(n[1])) + 'L' : v);
}

/**
 * Orden natural de los talles de un producto: numéricos de menor a mayor
 * (35, 36.5, 37…) o letras XS…XXL. Si mezcla tipos o hay un talle que no se
 * sabe ubicar (C6/7, TU, Izquierdo), devuelve null: no se adivina el orden.
 */
export function ordenarTalles(talles) {
  const valores = [...new Set(talles.map(t => String(t).trim()))];
  if (valores.length < 2) return null;
  const num = (t) => /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NaN;
  if (valores.every(t => Number.isFinite(num(t)))) {
    const nums = valores.map(num);
    if (new Set(nums).size !== nums.length) return null;
    return valores.sort((a, b) => num(a) - num(b));
  }
  if (valores.every(t => posicionLetra(t) >= 0)) {
    const pos = valores.map(posicionLetra);
    if (new Set(pos).size !== pos.length) return null;
    return valores.sort((a, b) => posicionLetra(a) - posicionLetra(b));
  }
  return null;
}

