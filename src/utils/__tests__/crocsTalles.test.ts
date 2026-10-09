import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { talleCrocsAdulto } from '../crocsTalles';

describe('Tablas Crocs aportadas por Wanda', () => {
  it('separa W solo de equivalencias dobles M/W, incluso cuando el talle web coincide', () => {
    const mujer=talleCrocsAdulto('W10')!,hombre=talleCrocsAdulto('M8/W10')!;
    expect(mujer.talleWeb).toBe('40');expect(hombre.talleWeb).toBe('40');
    expect(mujer.sizeConversion['40']).toEqual({arg:'39-40',us:'W10',cm:'26.3'});
    expect(hombre.sizeConversion['40']).toEqual({arg:'39-40',us:'M8/W10',cm:'25.5'});
  });
  it('acepta M solo y las equivalencias dobles exactas; no inventa otras',()=>{
    expect(talleCrocsAdulto('M8')?.talleWeb).toBe('40');
    expect(talleCrocsAdulto('M3 | W5')?.talleWeb).toBe('35');
    expect(talleCrocsAdulto('M13')?.talleWeb).toBe('45');
    for(const us of ['M8/W11','W13','M14','C10/11','J1','M6 W5/W9 (11121)','C10001-C001-M8/W10'])expect(talleCrocsAdulto(us)).toBeNull();
  });
  const path='C:/Users/maxim/Downloads/STOCKPROMOCROCS (1).xlsx';
  it.skipIf(!existsSync(path))('todos los talles adultos individuales del archivo coinciden con su descripción',()=>{
    const w=XLSX.read(readFileSync(path)),rs=XLSX.utils.sheet_to_json<unknown[]>(w.Sheets['Sheet1'],{header:1});
    let hombres=0,mujeres=0;
    for(const r of rs.slice(1)){
      if(String(r[5]).toUpperCase()!=='CALZADO'||/PACK/i.test(String(r[8])))continue;
      const code=String(r[6]),sku=String(r[1]);
      if(!sku.startsWith(code+'-'))continue;
      const us=sku.slice(code.length+1);
      if(!/^(M\d+(?:\/W\d+)?|W\d+)$/.test(us))continue;
      const mapped=talleCrocsAdulto(us);
      expect(mapped,`SKU ${sku}`).not.toBeNull();
      expect(mapped!.talleWeb,sku).toBe(String(r[7]).match(/(\d+)$/)?.[1]);
      if(mapped!.tipo==='HOMBRE')hombres++;else mujeres++;
    }
    expect({hombres,mujeres}).toEqual({hombres:308,mujeres:25});
  });
});
