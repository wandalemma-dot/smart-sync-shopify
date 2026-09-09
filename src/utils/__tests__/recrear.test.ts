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
  // ⚠ TODOS ESTOS SON SKU REALES DE LA TIENDA DE WANDA. Son un despelote:
  // separadores "!" y "$", con y sin minúsculas, de 6 a 16 caracteres.
  // Cuando uno NO se reconoce, el título se come el producto siguiente entero
  // (pasó: "Bermuda Gotcha Basic Niño Negro 10 GKS20600$10 Bermuda Quiksilver
  // Spikas Niño Azul" quedó como un solo título).
  const SKUS_REALES = [
    '2221110009!20!33', '13225058!U', '2221110032!10!20',   // separador "!"
    '20BFLS1912$6', 'GKS20600$10',                          // separador "$"
    'grid10E',                                              // con minúsculas
    'IFNX1J2CP4RR0IZ', 'ICHW1I1MACAN3ST', 'IWUYBOTUAMAL0ST', 'IIMP1I2439ZZZZ',
    'UA220510A', '20B19128', '110230116B', '20BFLS140548J', 'FKW1630110E',
    'BAR1620136A', '010292A', '01360100110E', '12000225A', '21911010288A',
    '016578Y', '2318170285',
    '7795456688744', '7791000175777', '194433896801',       // códigos de barras
  ];

  it.each(SKUS_REALES)('%s es un SKU', (sku) => {
    expect(esSku(sku)).toBe(true);
  });

  const NO_SON_SKU = [
    'Bolsa De Dormir Montagne Tenorio Pro Rojo',   // título: tiene espacios
    'Bermuda Rusty Blummer Runt Niño Negro Bordo',
    'Izquierdo', 'Derecho',                        // talle sin números
    'M', 'U', 'XL',
    '33', '28', '10', '16', '8', '2', '25', '6',   // talles: cortos
  ];

  it.each(NO_SON_SKU)('%s NO es un SKU', (linea) => {
    expect(esSku(linea)).toBe(false);
  });
});

describe('el caso que pegoteaba los títulos', () => {
  // Antes, al no reconocer "20BFLS1912$6" ni "grid10E", el título seguía
  // acumulando y salía "Bermuda Vans Gridlock Niño Negro 10 grid10E Jogger
  // Rusty Hook Out Niño Azul Gastado" como un solo producto.
  const PEGOTEADO = `Bermuda Rusty Blummer Runt Niño Negro Bordo
6
20BFLS1912$6
Bermuda Rusty Blummer Runt Niño Negro Bordo
2
20BFLS1912$2
Bermuda Vans Gridlock Niño Negro
10
grid10E
Jogger Rusty Hook Out Niño Azul Gastado
6
BAR1620136A
Bermuda Gotcha Basic Niño Negro
10
GKS20600$10`;

  it('cada producto queda con SU título, sin comerse el siguiente', () => {
    const r = parseRecrear(PEGOTEADO);
    expect(r.productos.map((p) => p.titulo)).toEqual([
      'Bermuda Rusty Blummer Runt Niño Negro Bordo',
      'Bermuda Vans Gridlock Niño Negro',
      'Jogger Rusty Hook Out Niño Azul Gastado',
      'Bermuda Gotcha Basic Niño Negro',
    ]);
    expect(r.ignoradas).toHaveLength(0);
  });

  it('la Blummer junta sus dos talles en un producto', () => {
    const r = parseRecrear(PEGOTEADO);
    expect(r.productos[0].talles).toEqual([
      { talle: '6', sku: '20BFLS1912$6' },
      { talle: '2', sku: '20BFLS1912$2' },
    ]);
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
