// Solo usar luego de identificar la etiqueta exacta del modelo.
export function etiquetaModelo(tags: string, codigo: string): boolean {
  return tags.split(',').some(t => t.trim().toUpperCase() === codigo.trim().toUpperCase());
}
export function mismoTalleEtiqueta(a: string, b?: string): boolean {
  const normal = (s: string) => {
    const t = s.trim().toUpperCase().replace(',', '.');
    return /^\d+(?:\.\d+)?$/.test(t) ? String(Number(t)) : t;
  };
  return !!a.trim() && !!b?.trim() && normal(a) === normal(b);
}
export function validarTallesEtiqueta(sizes: string[], variantes: { title?: string }[], codigo: string) {
  if (sizes.some(s => variantes.filter(v => mismoTalleEtiqueta(s, v.title)).length > 1) ||
      variantes.some(v => sizes.filter(s => mismoTalleEtiqueta(s, v.title)).length > 1)) {
    throw new Error(`${codigo}: talles ambiguos o repetidos; revisar antes de sincronizar.`);
  }
}
