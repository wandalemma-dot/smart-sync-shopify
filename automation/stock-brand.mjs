// Apply and verify consume exactly one brand's download per job.
export function jobBrand() {
  const brand = process.env.STOCK_BRANDS ?? 'converse';
  if (brand !== 'converse' && brand !== 'lecoq') throw Error('Se requiere una marca de ID por ejecución.');
  return brand;
}
