export interface KappaCobertura {
  categoria: 'calzado' | 'indumentaria';
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

export function coincideCategoriaKappa(title: string, tags: string, vendor: string, categoria: KappaCobertura['categoria']) {
  if (categoria === 'calzado') return esCalzadoKappa(title, tags, vendor);
  const titulo = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return vendor.trim().toLowerCase() === 'kappa' && !esCalzadoKappa(title, tags, vendor) &&
    /^(?:Indumentaria|Remera|Pantalon|Campera|Buzo|Conjunto|Calza|Top(?: deportivo)?|Short|Bermuda|Musculosa|Chomba|Camisa)\s+Kappa\b/i.test(titulo);
}

export function ausenteKappa(p: { title: string; tags: string; vendor?: string; variants: { edges: { node: { sku: string } }[] } }, c: KappaCobertura) {
  if (!coincideCategoriaKappa(p.title, p.tags, p.vendor || '', c.categoria)) return false;
  const skus = p.variants.edges.map(e => e.node.sku);
  const codes = codigosKappa(p.tags, skus);
  return codes.length > 0 && codes.every(code => !c.modelosPresentes.includes(code) && !c.modelosProtegidos.includes(code)) &&
    !skus.some(s => c.identificadoresPresentes.includes(s));
}

// Un código desconocido o un pack no demuestra una ausencia de talle individual.
export function varianteIndividualKappa(sku: string, talle: string, codes: string[], categoria: KappaCobertura['categoria'] = 'calzado') {
  const ar = String(talle).trim().replace(',', '.');
  const individual = (s: string) => categoria === 'calzado'
    ? /^\d+(?:\.\d+)?$/.test(s) && Number(s) >= 20 && Number(s) <= 55
    : /^(?:X{0,4}[SML]|[2-6]XL|TU|UNICO)$/.test(s.toUpperCase());
  if (!individual(ar)) return false;
  return /^\d{8,14}$/.test(sku) || codes.some(c => sku.toUpperCase().startsWith(c + '-') &&
    individual(sku.slice(c.length + 1)));
}
