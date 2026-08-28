// ============================================================================
// RED DE SEGURIDAD — LAS TABLAS DE TALLE SON LAS OFICIALES DE CONVERSE
// ----------------------------------------------------------------------------
// Las tablas US -> ARG de `syncLogic.ts` tienen que ser EXACTAMENTE las de
// `tallesConverseLecoq.json`, que sale de las planillas oficiales del proveedor
// (ARG Material Conversion ID Chart + ID MASTER - CURVA DE CONVERSION).
//
// POR QUÉ EXISTE ESTE ARCHIVO (28-ago-2026). Había DOS copias de las tablas y
// no coincidían. La de `syncLogic.ts` estaba cargada a mano y:
//   · le faltaban 32 talles (la de MUJER no tenía el US 7, la de BEBÉ no tenía
//     el US 5, la de NIÑO no tenía el US 2...). Ese stock se perdía en silencio.
//   · la de BEBÉ estaba CORRIDA UN TALLE: decía US 6 -> AR 21 cuando es AR 22,
//     y así hasta el US 11. El stock entraba en el talle equivocado.
//
// ⚠ SI ESTE ARCHIVO FALLA, ALGUIEN EDITÓ LAS TABLAS A MANO. No se ajusta el
//   test: se regeneran las tablas desde el JSON.
//   Correr con: npm test
// ============================================================================
import { describe, it, expect } from 'vitest';
import { convTable1, convTable2, convTable3, convTable4, convTable5 } from '../syncLogic';
import maestro from '../tallesConverseLecoq.json';

// Qué curva del JSON le corresponde a cada tabla del código.
const CURVA_DE: [string, Record<string, string>, string][] = [
  ['convTable1 (TABLA DE TALLE CONVERSE 1)', convTable1, '2'],
  ['convTable2 (TABLA DE TALLE CONVERSE 2)', convTable2, '8'],
  ['convTable3 (MUJER)', convTable3, '8A'],
  ['convTable4 (NIÑO)', convTable4, '4'],
  ['convTable5 (BEBÉ)', convTable5, '5'],
];

// El JSON guarda AR -> US; nosotros necesitamos US -> AR.
function oficial(curva: string): Record<string, string> {
  const arAus: Record<string, string> = (maestro as any).curvas[curva].ar_a_us;
  const out: Record<string, string> = {};
  for (const [ar, us] of Object.entries(arAus)) out[String(us)] = String(ar);
  return out;
}

describe('las tablas de talle son las oficiales', () => {
  for (const [nombre, tabla, curva] of CURVA_DE) {
    it(`${nombre} coincide con la planilla oficial`, () => {
      expect(tabla).toEqual(oficial(curva));
    });
  }

  // Los tres agujeros concretos que le costaban stock a Wanda.
  it('MUJER tiene el US 7 (le faltaba: A13016C)', () => {
    expect(convTable3['7']).toBe('37.5');
  });

  it('NIÑO tiene el US 2 (le faltaba: 356993C, 50 pares)', () => {
    expect(convTable4['2']).toBe('33.5');
  });

  it('BEBÉ tiene el US 5 y NO está corrida (le faltaba: 756996C, 50 pares)', () => {
    expect(convTable5['5']).toBe('21');
    // Lo que estaba mal: decía 21 en vez de 22, y así todo corrido.
    expect(convTable5['6']).toBe('22');
    expect(convTable5['11']).toBe('27');
  });
});
