export interface KappaCobertura {
  modelosPresentes: string[];
  modelosProtegidos: string[];
  identificadoresPresentes: string[];
}

export function codigosKappa(tags: string, skus: string[]) {
  return [...new Set([...tags.split(',').map(t => t.trim()), ...skus]
    .map(s => s.toUpperCase().match(/^(K\d[A-Z0-9]*-[A-Z0-9]+)(?:-|$)/)?.[1])
    .filter((s): s is string => !!s))];
}

export function esCalzadoKappa(title: string, tags: string, vendor: string) {
  return vendor.trim().toLowerCase() === 'kappa' &&
    (/^(?:Zapatillas?|Botines?|Ojotas?|Sandalias?|Calzado|Zuecos?)\s+Kappa\b/i.test(title) ||
      /(?:^|,\s*)TABLA DE TALLE KAPPA /i.test(tags));
}

export function ausenteKappa(p: { title: string; tags: string; vendor?: string; variants: { edges: { node: { sku: string } }[] } }, c: KappaCobertura) {
  if (!esCalzadoKappa(p.title, p.tags, p.vendor || '')) return false;
  const skus = p.variants.edges.map(e => e.node.sku);
  const codes = codigosKappa(p.tags, skus);
  return codes.length > 0 && codes.every(code => !c.modelosPresentes.includes(code) && !c.modelosProtegidos.includes(code)) &&
    !skus.some(s => c.identificadoresPresentes.includes(s));
}

// Un código desconocido o un pack no demuestra una ausencia de talle individual.
export function varianteIndividualKappa(sku: string, talle: string, codes: string[]) {
  const ar = String(talle).trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(ar) || Number(ar) < 20 || Number(ar) > 55) return false;
  return /^\d{8,14}$/.test(sku) || codes.some(c => sku.toUpperCase().startsWith(c + '-') &&
    /^\d+(?:\.\d+)?$/.test(sku.slice(c.length + 1)));
}
