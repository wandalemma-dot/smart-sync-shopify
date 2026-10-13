import { talleCrocs } from './crocsTalles';

export interface CrocsCobertura {
  modelosPresentes: string[];
  modelosProtegidos: string[];
  identificadoresPresentes: string[];
}
export function codigosCrocs(tags: string, skus: string[]) {
  return [...new Set([...tags.split(',').map(t=>t.trim()), ...skus]
    .map(s=>s.toUpperCase().match(/^(C\d+-[A-Z0-9]+)(?:-|$)/)?.[1])
    .filter((c): c is string=>!!c))];
}
export function esCalzadoCrocs(title: string, tags: string, vendor: string) {
  return vendor.trim().toLowerCase()==='crocs' && !/JIBBITZ|ACCESORIO/i.test(title) &&
    (/(?:^|,\s*)TABLA DE TALLE CROCS (?:HOMBRE|MUJER|NIÑO)(?:,|$)/i.test(tags) ||
      /^(?:Calzado|Zuecos?|Sandalias?|Ojotas?)\s+Crocs\b/i.test(title));
}
export function ausenteCrocs(p: {title:string;tags:string;vendor?:string;variants:{edges:{node:{sku:string}}[]}}, c:CrocsCobertura) {
  if(!esCalzadoCrocs(p.title,p.tags,p.vendor || ''))return false;
  const skus=p.variants.edges.map(e=>e.node.sku),codes=codigosCrocs(p.tags,skus);
  return codes.length>0 && codes.every(code=>!c.modelosPresentes.includes(code)&&!c.modelosProtegidos.includes(code)) &&
    !skus.some(s=>c.identificadoresPresentes.includes(s));
}
// Un pack, un talle doble infantil o un SKU sin equivalencia no demuestra ausencia.
export function varianteIndividualCrocs(sku:string,talle:string,codes:string[]) {
  const code=codes.find(c=>sku.toUpperCase().startsWith(c+'-'));
  return !!code && talleCrocs(sku.slice(code.length+1))?.talleWeb===talle.trim();
}
