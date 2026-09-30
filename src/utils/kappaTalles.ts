import unisex from './kappaUnisex.json';
import nino from './kappaNino.json';

export const KAPPA_TABLAS = { UNISEX: unisex, NINO: nino };
export type TablaKappa = keyof typeof KAPPA_TABLAS;

/** Solo equivalencias explícitas del proveedor; no extrapolar ni usar Reebok. */
export function convertirTalleKappa(eu: string | number, tabla: TablaKappa) {
  const valor = String(eu).trim().replace(',', '.');
  return Object.values(KAPPA_TABLAS[tabla]).find(talle => talle.eu === valor) ?? null;
}
