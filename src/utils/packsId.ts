/** iD vende packs; INDY vende por par. Xn puede estar en medio del nombre. */
export function unidadesPorPackId(nombre: string): number {
  const match = nombre.trim().match(/(?:^|\s)[x×]\s*([1-9]\d*)(?=\s|$)/i);
  const cantidad = match ? Number(match[1]) : 1;
  return Number.isSafeInteger(cantidad) ? cantidad : 1;
}

/**
 * Artículos de iD que vienen en pack aunque la factura o el nombre en Shopify no lo digan (13-nov-2026, gax: «te paso
 * cuáles son todos los SKU que tienen por 6»). Sale de la PlantillaPedido 12 de Le Coq que mandó gax: 39 artículos con
 * «X6» / «X 6» en el nombre, todos de 6 y todos con el código terminado en P. El mismo código sin la P es la unidad
 * suelta (LAN0122018 «TRIPACK POLIESTER» frente a LAN0122018P «TRIPACK POLIESTER X 6», seis tripacks).
 *
 * Lo usa la carga de Control de entregas, donde la factura corta el nombre («LCS SHORT SPORTY WRISTBAND BLA») y hay
 * productos en Shopify sin «X6» en el título (Bipack, Tripack, Pumas Home Fan 2026…). Sincronización y el armado del
 * pedido leen el «X6» del nombre en la plantilla, que siempre lo trae.
 */
const PACKS_DE_6 = [
  'LAN0122010P', 'LAN0122011P', 'LAN0122012P', 'LAN0122016P', 'LAN0122018P', 'LAN0122026P',
  'LAN0122027P', 'LAN0122028P', 'LAN0122029P', 'LAN0125034P', 'LAN0125035P', 'LAN0125047P',
  'LAN0125048P', 'LAN0224024P', 'LAN0225021P', 'LAN0225022P', 'LAN0226001P', 'LAN0226002P',
  'LAN0226004P', 'LAN0226009P', 'LAN0226010P', 'LAN0226012P', 'LAN0226013P', 'LAN0226015P',
  'LAN0226023P', 'LAN0226024P', 'LAN0226027P', 'LAN0226032P', 'LAN0226035P', 'LAN0226037P',
  'LAN0226038P', 'LAN0426009P', 'LAN0426010P', 'LAN0426012P', 'LAN0426013P', 'LAN0426014P',
  'LTN0224098P', 'LTN0224099P', 'LTN0424039P',
];

/** Código → unidades por pack, según la plantilla de iD. */
export const PACKS_ID: ReadonlyMap<string, number> = new Map(PACKS_DE_6.map((c) => [c, 6]));

/** Unidades por pack que dice la plantilla de iD para ese código (undefined si no está en la lista). */
export function packConocidoId(codigo: string): number | undefined {
  return PACKS_ID.get(String(codigo ?? '').trim().toUpperCase());
}

/**
 * Código de Le Coq terminado en P (LAN0122026P, LTN0424039P): en la plantilla de iD todos son packs. Sirve para que un
 * pack nuevo, que todavía no está en la lista, no se cargue como una unidad cuando nadie dice cuántas trae.
 */
export function pareceCodigoPackId(codigo: string): boolean {
  return /^L[A-Z]{2}\d{6,8}P$/.test(String(codigo ?? '').trim().toUpperCase());
}
