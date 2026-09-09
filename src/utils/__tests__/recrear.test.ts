// ============================================================================
// RECREAR PRODUCTOS BORRADOS — lectura del texto de la transferencia
// ----------------------------------------------------------------------------
// ⚠ LO QUE CUIDA ESTE ARCHIVO: que el SKU quede TAL CUAL y que dos productos
//   con el MISMO TÍTULO no se mezclen. Si se agruparan por título, la Bermuda
//   Slim Basic (que existe con dos códigos de temporadas distintas) quedaría
//   como un solo producto y la transferencia no engancharía.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { parseRecrear } from '../recrearProductos';

// El ejemplo REAL que pegó Wanda.
const REAL = `Bermuda Quiksilver Slim Basic Blue Azul Claro
33
2221110009!20!33
Bermuda Quiksilver Slim Basic Blue Azul Claro
28
2231110023!20!28
Bermuda Quiksilver Modern Wave Vontage Blue Azul
31
2231110021!20!31`;

describe('el texto que copia de la transferencia', () => {
  it('lee título, talle y SKU de a tres líneas', () => {
    const r = parseRecrear(REAL);
    expect(r.lineas).toHaveLength(3);
    expect(r.ignoradas).toHaveLength(0);
    expect(r.lineas[0]).toMatchObject({
      titulo: 'Bermuda Quiksilver Slim Basic Blue Azul Claro',
      talle: '33',
      sku: '2221110009!20!33',
      codigo: '2221110009',
    });
  });

  it('🔴 MISMO TÍTULO PERO DISTINTO CÓDIGO = DOS PRODUCTOS', () => {
    // Las dos Slim Basic son de temporadas distintas (222… y 223…).
    const r = parseRecrear(REAL);
    expect(r.productos).toHaveLength(3);
    const slim = r.productos.filter((p) => p.titulo.includes('Slim Basic'));
    expect(slim).toHaveLength(2);
    expect(slim.map((p) => p.codigo).sort()).toEqual(['2221110009', '2231110023']);
  });

  it('el SKU se conserva EXACTO (es lo que reengancha la transferencia)', () => {
    const r = parseRecrear(REAL);
    expect(r.productos.flatMap((p) => p.talles.map((t) => t.sku)))
      .toEqual(['2221110009!20!33', '2231110023!20!28', '2231110021!20!31']);
  });

  it('junta los talles del mismo código en un solo producto', () => {
    const r = parseRecrear(`Short Test
S
9990001!20!S
Short Test
M
9990001!20!M`);
    expect(r.productos).toHaveLength(1);
    expect(r.productos[0].talles.map((t) => t.talle)).toEqual(['S', 'M']);
  });

  it('avisa cuando el talle no coincide con el final del SKU', () => {
    const r = parseRecrear(`Remera Rara
L
9911110002!20!XL`);
    expect(r.sospechosas).toHaveLength(1);
    expect(r.sospechosas[0].talleDelSku).toBe('XL');
  });

  it('no repite un SKU que viene dos veces', () => {
    const r = parseRecrear(`Algo
33
111!20!33
Algo
33
111!20!33`);
    expect(r.lineas).toHaveLength(1);
    expect(r.skusRepetidos).toEqual(['111!20!33']);
  });

  // ⚠ ESTE BLOQUE ES EL QUE MÁS IMPORTA. Se rompió una vez: el lector borraba
  // las líneas vacías y, como en los accesorios el talle viene vacío, se corría
  // TODO un renglón y cada producto se quedaba con el título del siguiente
  // como talle. Si estos tests fallan, se volvió a romper lo mismo.
  describe('accesorios: el talle viene VACÍO', () => {
    // Texto real de Wanda: título / (vacío) / SKU.
    const ACCESORIOS = [
      'Piluso Thrasher Godzilla Camuflado M 2118M', '', '3251117021!20!U',
      'Medias Dc Willis Boys Rojo Azul', '', '13225058!U',
      'Gorro Champion Bordo', '', '7795456688744',
    ].join('\n');

    it('NO se corre un renglón: cada producto se queda con SU título', () => {
      const r = parseRecrear(ACCESORIOS);
      expect(r.productos).toHaveLength(3);
      expect(r.productos.map((p) => p.titulo)).toEqual([
        'Piluso Thrasher Godzilla Camuflado M 2118M',
        'Medias Dc Willis Boys Rojo Azul',
        'Gorro Champion Bordo',
      ]);
    });

    it('quedan marcados SIN talle (se crean sin variante)', () => {
      const r = parseRecrear(ACCESORIOS);
      expect(r.productos.every((p) => p.sinTalle)).toBe(true);
      expect(r.sinTalleCount).toBe(3);
    });

    it('no dispara alertas falsas de "el talle no coincide"', () => {
      expect(parseRecrear(ACCESORIOS).sospechosas).toHaveLength(0);
    });

    it('acepta el SKU como código de barras, sin ningún "!"', () => {
      const r = parseRecrear('Gorro Champion Bordo\n\n7795456688744');
      expect(r.productos[0].talles[0].sku).toBe('7795456688744');
      expect(r.productos[0].codigo).toBe('7795456688744');
    });

    it('acepta el SKU con un solo "!"', () => {
      const r = parseRecrear('Medias Dc Willis Boys Rojo Azul\n\n13225058!U');
      expect(r.productos[0].codigo).toBe('13225058');
      expect(r.productos[0].sinTalle).toBe(true);
    });

    it('un talle "U" también cuenta como sin talle', () => {
      const r = parseRecrear('Gorra X\nU\n999!20!U');
      expect(r.productos[0].sinTalle).toBe(true);
    });

    it('mezcla accesorios y ropa en el mismo pegado', () => {
      const r = parseRecrear([
        'Gorro Champion Bordo', '', '7795456688744',
        'Bermuda Quiksilver Slim Basic', '33', '2221110009!20!33',
      ].join('\n'));
      expect(r.productos).toHaveLength(2);
      expect(r.productos[0].sinTalle).toBe(true);
      expect(r.productos[1].sinTalle).toBe(false);
      expect(r.productos[1].talles[0].talle).toBe('33');
    });
  });

  it('no inventa nada con texto suelto', () => {
    const r = parseRecrear('hola\nque tal\n');
    expect(r.productos).toHaveLength(0);
    expect(r.ignoradas.length).toBeGreaterThan(0);
  });
});
