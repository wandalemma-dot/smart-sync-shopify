// El modelo ya se identificó por código/etiqueta o EAN exacto.
// No cambiar SKU de existentes. Admitir el código anterior al cargar la nueva lista.
export function coincideVarianteReebok(
  data: { skuPorTalle?: Record<string, string>; skuProveedorPorTalle?: Record<string, string> },
  size: string,
  variant: { sku?: string; title?: string },
  calzado: boolean,
) {
  if (!calzado) return variant.sku === data.skuPorTalle?.[size];
  const sku = String(variant.sku || '').trim();
  if (!sku) return false;
  if (sku === data.skuPorTalle?.[size] || sku === data.skuProveedorPorTalle?.[size]) return true;
  // Las listas anteriores carecen de EAN: código del modelo + AR exacto,
  // solo para variantes que ya usan un EAN y no otro SKU de proveedor.
  return calzado && !/^\d{8,14}$/.test(data.skuPorTalle?.[size] || '')
    && /^\d{8,14}$/.test(sku) && String(variant.title || '').trim() === size;
}
