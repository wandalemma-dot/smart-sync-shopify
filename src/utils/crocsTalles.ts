import hombre from './crocsHombre.json';
import mujer from './crocsMujer.json';
import nino from './crocsNino.json';
import type { SizeConversion } from './reebokCalzado';

// Tablas suministradas por Wanda el 9-oct-2026. Clave = talle web de la variante.
// ARG conserva el rango de la tabla. No derivar centímetros ni usar tablas Reebok.
export const CROCS_TABLAS: Record<'HOMBRE' | 'MUJER' | 'NIÑO', SizeConversion> = { HOMBRE: hombre, MUJER: mujer, NIÑO: nino };

/** Recibe únicamente el sufijo del SKU individual; no el código completo ni un pack. */
export function talleCrocsAdulto(usOriginal: string) {
  const us = usOriginal.trim().toUpperCase().replace(/\s+/g, '').replace('|', '/');
  const tipo = /^M\d+(?:\/W\d+)?$/.test(us) ? 'HOMBRE' : /^W\d+$/.test(us) ? 'MUJER' : null;
  if (!tipo) return null;
  const tabla = CROCS_TABLAS[tipo];
  const match = Object.entries(tabla).find(([, ref]) => ref.us === us ||
    (tipo === 'HOMBRE' && /^M\d+$/.test(us) && ref.us?.split('/')[0] === us));
  if (!match) return null;
  return { talleWeb: match[0], tipo, tablaTalle: `TABLA DE TALLE CROCS ${tipo}`, sizeConversion: tabla };
}

export function talleCrocs(usOriginal: string, permitirDoblesNino = false) {
  const adulto = talleCrocsAdulto(usOriginal);
  if (adulto) return adulto;
  const us = usOriginal.trim().toUpperCase();
  const doble = us.match(/^C(\d+)\/(?:C)?(\d+)$/);
  const referencia = doble && permitirDoblesNino && Number(doble[2]) === Number(doble[1]) + 1 ? `C${doble[1]}` : us;
  const match = Object.entries(CROCS_TABLAS.NIÑO).find(([,ref]) => ref.us === referencia);
  if (!match) return null;
  return { talleWeb: match[0], tipo: 'NIÑO' as const, tablaTalle: 'TABLA DE TALLE CROCS NIÑO', sizeConversion: CROCS_TABLAS.NIÑO };
}
