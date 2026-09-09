// ============================================================================
// RECREAR PRODUCTOS BORRADOS — lectura del texto de la transferencia
// ----------------------------------------------------------------------------
// ⚠ LO QUE CUIDA ESTE ARCHIVO:
//   1) Que el SKU quede TAL CUAL: es lo único que reengancha la transferencia.
//   2) Que se reconozca el SKU POR CÓMO ES y no por su posición. Se intentó
//      leer de a 3 líneas fijas y falló dos veces: la cantidad de líneas en
//      blanco que copia Shopify es VARIABLE y el talle a veces no está.
//      De 8 productos leía 4, y corría los renglones (un producto quedaba con
//      el título del siguiente como talle).
//
// ⚠ SI UN CAMBIO HACE FALLAR ESTE ARCHIVO, EL CAMBIO ESTÁ MAL.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { parseRecrear, esSku } from '../recrearProductos';

describe('reconocer cuál línea es el SKU', () => {
  it('los tres formatos reales son SKU', () => {
    expect(esSku('2221110009!20!33')).toBe(true);   // código!color!talle
    expect(esSku('13225058!U')).toBe(true);         // código!talle
    expect(esSku('IFNX1J2CP4RR0IZ')).toBe(true);    // mayúsculas + números
    expect(esSku('ICHW1I1MACAN3ST')).toBe(true);
    expect(esSku('7795456688744')).toBe(true);      // código de barras
  });

  it('los títulos y los talles NO son SKU', () => {
    expect(esSku('Bolsa De Dormir Montagne Tenorio Pro Rojo')).toBe(false); // tiene espacios
    expect(esSku('Izquierdo')).toBe(false);   // tiene minúsculas
    expect(esSku('Derecho')).toBe(false);
    expect(esSku('33')).toBe(false);          // muy corto
    expect(esSku('M')).toBe(false);
  });
});

// Texto REAL copiado por Wanda de una transferencia de Montagne. Tiene líneas
// en blanco de más, productos con variante (Izquierdo/Derecho) y otros sin.
const MONTAGNE = `Mat Colchoneta Montagne Prana Azul

ICHW1I1MACAN3ST

Bolsa De Dormir Montagne Tenorio Pro Petroleo

Izquierdo
IFNX1J2CP4VE0IZ



Bolsa De Dormir Montagne Tenorio Pro Petroleo

Derecho
IFNX1J2CP4VE0DE

Bolsa De Dormir Montagne Tenorio Pro Rojo

Izquierdo
IFNX1J2CP4RR0IZ

Bolsa De Dormir Montagne Tenorio Pro Rojo

Derecho
IFNX1J2CP4RR0DE

Botella De Hidratacion Montagne 400 ML Azul

IWUYBOTUAMAL0ST


Inflador De Pie Montagne Negro

IIMP1I2439ZZZZ`;

describe('el texto real de Montagne', () => {
  it('lee los 7 SKU (antes leía 4)', () => {
    expect(parseRecrear(MONTAGNE).lineas).toHaveLength(7);
  });

  it('las dos bolsas quedan como UN producto con Izquierdo y Derecho', () => {
    const r = parseRecrear(MONTAGNE);
    const rojo = r.productos.find((p) => p.titulo.includes('Tenorio Pro Rojo'))!;
    expect(rojo.sinTalle).toBe(false);
    expect(rojo.talles.map((t) => t.talle)).toEqual(['Izquierdo', 'Derecho']);
    expect(rojo.talles.map((t) => t.sku)).toEqual(['IFNX1J2CP4RR0IZ', 'IFNX1J2CP4RR0DE']);
  });

  it('la colchoneta, la botella y el inflador van SIN variante', () => {
    const r = parseRecrear(MONTAGNE);
    for (const t of ['Colchoneta', 'Botella', 'Inflador']) {
      expect(r.productos.find((p) => p.titulo.includes(t))!.sinTalle).toBe(true);
    }
  });

  it('ningún título se come el del siguiente', () => {
    const r = parseRecrear(MONTAGNE);
    expect(r.productos.map((p) => p.titulo)).toEqual([
      'Mat Colchoneta Montagne Prana Azul',
      'Bolsa De Dormir Montagne Tenorio Pro Petroleo',
      'Bolsa De Dormir Montagne Tenorio Pro Rojo',
      'Botella De Hidratacion Montagne 400 ML Azul',
      'Inflador De Pie Montagne Negro',
    ]);
    expect(r.ignoradas).toHaveLength(0);
  });
});

describe('el texto real de Quiksilver (talle en su propia línea)', () => {
  const BERMUDAS = `Bermuda Quiksilver Slim Basic Blue Azul Claro
33
2221110009!20!33
Bermuda Quiksilver Slim Basic Blue Azul Claro
28
2231110023!20!28
Bermuda Quiksilver Modern Wave Vontage Blue Azul
31
2231110021!20!31`;

  it('agrupa los talles del mismo modelo y conserva los SKU exactos', () => {
    const r = parseRecrear(BERMUDAS);
    expect(r.productos).toHaveLength(2);
    const slim = r.productos[0];
    expect(slim.talles.map((t) => t.talle)).toEqual(['33', '28']);
    expect(slim.talles.map((t) => t.sku)).toEqual(['2221110009!20!33', '2231110023!20!28']);
  });
});

describe('accesorios sin talle (la línea del medio viene vacía)', () => {
  const ACC = `Piluso Thrasher Godzilla Camuflado M 2118M

3251117021!20!U
Gorro Champion Bordo

7795456688744
Gorra Converse Chuck 70s Rosa

194433896801`;

  it('quedan los 3, cada uno con su título y sin variante', () => {
    const r = parseRecrear(ACC);
    expect(r.productos).toHaveLength(3);
    expect(r.productos.every((p) => p.sinTalle)).toBe(true);
    expect(r.sinTalleCount).toBe(3);
    expect(r.productos[1].titulo).toBe('Gorro Champion Bordo');
  });

  it('un talle "U" también cuenta como sin talle', () => {
    expect(parseRecrear('Gorra X\nU\n999!20!U').productos[0].sinTalle).toBe(true);
  });
});

describe('casos borde', () => {
  it('mismo título Y mismo talle = dos productos (Shopify no acepta duplicado)', () => {
    const r = parseRecrear('Remera X\nM\nAAA111M\nRemera X\nM\nBBB222M');
    expect(r.productos).toHaveLength(2);
    expect(r.productos.map((p) => p.talles[0].sku)).toEqual(['AAA111M', 'BBB222M']);
  });

  it('no repite un SKU que viene dos veces', () => {
    const r = parseRecrear('Algo\n33\n111!20!33\nAlgo\n33\n111!20!33');
    expect(r.lineas).toHaveLength(1);
    expect(r.skusRepetidos).toEqual(['111!20!33']);
  });

  it('no inventa nada con texto suelto', () => {
    const r = parseRecrear('hola\nque tal\n');
    expect(r.productos).toHaveLength(0);
    expect(r.ignoradas.length).toBeGreaterThan(0);
  });
});
