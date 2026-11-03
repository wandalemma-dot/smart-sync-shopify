// ID puede listar dos modelos distintos cuyos códigos difieren solo en un sufijo.
export function codigoStockId(handle: string, tags: string, skus: string[], codigos: string[]): string | undefined {
  const normalizar = (valor: string) => valor.toLowerCase().replace(/[^a-z0-9]/g, '');
  const etiquetas = tags.split(',').map(normalizar).filter(Boolean);
  const codigosSku = skus.map(normalizar);
  // Conservar los formatos históricos de ID cuando hay una única coincidencia.
  const candidatos = codigos.filter(codigo => {
    const id = normalizar(codigo);
    return id && (etiquetas.some(t => t.includes(id)) || codigosSku.some(sku => sku.startsWith(id)));
  });
  if (candidatos.length < 2) return candidatos[0];

  const modelosSku = new Set(skus.flatMap(sku => [
    normalizar(sku), normalizar(sku.trim().replace(/[-\s]+[^-\s]+$/, '')),
  ]));
  const porSku = candidatos.filter(c => modelosSku.has(normalizar(c)));
  const exactos = porSku.length ? porSku : candidatos.filter(c => etiquetas.includes(normalizar(c)));
  if (exactos.length === 1) return exactos[0];
  throw Error(`${handle}: varios códigos de ID coinciden (${candidatos.join(', ')}). Revisá sus SKU y etiquetas.`);
}
