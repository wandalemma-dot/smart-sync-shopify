/** iD vende packs; INDY vende por par. Xn puede estar en medio del nombre. */
export function unidadesPorPackId(nombre: string): number {
  const match = nombre.trim().match(/(?:^|\s)[x×]\s*([1-9]\d*)(?=\s|$)/i);
  const cantidad = match ? Number(match[1]) : 1;
  return Number.isSafeInteger(cantidad) ? cantidad : 1;
}
