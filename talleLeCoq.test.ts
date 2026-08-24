// ============================================================================
// RED DE SEGURIDAD — LE COQ: EL TALLE VA UNO MENOS QUE EL DEL PROVEEDOR
// ----------------------------------------------------------------------------
// Regla de Wanda: en el CALZADO Le Coq, el talle del Excel del proveedor es uno
// MÁS que el de Shopify (proveedor 45 -> Shopify 44). En lo que NO es calzado,
// el talle va tal cual.
//
// Esta regla ya se rompió una vez en silencio (agosto 2026): se detectaba el
// calzado por una lista de palabras (RUNNING, SNEAKER, STAR, COURT) y todos los
// modelos con nombre de fantasía quedaban sin convertir. El stock del 45 se
// cargaba en el 45. Nadie se dio cuenta porque las filas caían en
// "Ya estaban bien".
//
// ⚠ SI UN CAMBIO HACE FALLAR ESTE ARCHIVO, EL CAMBIO ESTÁ MAL. No se "ajusta"
//   el test para que pase: se arregla el código.
//   Correr con: npm test
// ============================================================================
import { describe, it, expect } from 'vitest';
import { talleShopifyLeCoq, esCalzadoLeCoq } from '../syncLogic';

// Nombres reales sacados de la tienda de Wanda (captura del 24-ago-2026).
// Ninguno tiene las palabras RUNNING/SNEAKER/STAR/COURT: son justo los que
// rompían la regla.
const CALZADO_SIN_PALABRA_CLAVE = [
  'Strider Negro Gris Celeste',
  'Carc Slides 2026 Azul Fr',
  'Aa 75 Negro/Gris/Lime',
  'Veloce Soft Negro Amarillo Spruce',
  'Lcs R500 Blanco',
  'Break Cuir Negro',
];

describe('Le Coq calzado: el talle de Shopify es UNO MENOS', () => {
  it.each(CALZADO_SIN_PALABRA_CLAVE)('resta 1 aunque el nombre no diga "running": %s', (nombre) => {
    expect(talleShopifyLeCoq('45', nombre)).toBe('44');
    expect(talleShopifyLeCoq('40', nombre)).toBe('39');
    expect(talleShopifyLeCoq('36', nombre)).toBe('35');
  });

  it('sigue restando 1 en los nombres que sí traen la palabra', () => {
    expect(talleShopifyLeCoq('42', 'R2024 Running Blanco')).toBe('41');
    expect(talleShopifyLeCoq('40', 'LCS Court Blanco')).toBe('39');
    expect(talleShopifyLeCoq('44', 'Sneaker Negro')).toBe('43');
  });

  it('resta 1 aunque no sepamos el nombre del producto', () => {
    expect(talleShopifyLeCoq('45')).toBe('44');
    expect(talleShopifyLeCoq('45', '')).toBe('44');
  });

  it('el talle del Excel viene con ceros adelante o como número', () => {
    expect(talleShopifyLeCoq('040', 'Strider Negro')).toBe('39');
    expect(talleShopifyLeCoq(45, 'Strider Negro')).toBe('44');
  });
});

describe('Le Coq NO calzado: el talle NO se toca', () => {
  it('pantalones (talle numérico de cintura)', () => {
    expect(talleShopifyLeCoq('38', 'Rain Pant Negro')).toBe('38');
    expect(talleShopifyLeCoq('40', 'Chino Beige')).toBe('40');
  });

  it('medias (talles 1 y 2)', () => {
    expect(talleShopifyLeCoq('1', 'Socks Tripack')).toBe('1');
    expect(talleShopifyLeCoq('2', 'Socks Tripack')).toBe('2');
  });

  it('vestidos', () => {
    expect(talleShopifyLeCoq('039', 'Dress Azul')).toBe('039');
  });

  it('indumentaria con talle de letra', () => {
    for (const t of ['S', 'M', 'L', 'XL', '3XL', 'TU']) {
      expect(talleShopifyLeCoq(t, 'Tee Blanca')).toBe(t);
      expect(talleShopifyLeCoq(t, 'Strider Negro')).toBe(t);
    }
  });

  it('accesorios sin talle', () => {
    expect(talleShopifyLeCoq('TU', 'Backpack Negro')).toBe('TU');
    expect(talleShopifyLeCoq('', 'Morral Lcs One Shoulder Negro')).toBe('');
  });
});

describe('esCalzadoLeCoq', () => {
  it('nombre desconocido + talle de calzado = calzado', () => {
    expect(esCalzadoLeCoq('Strider Negro', '45')).toBe(true);
    expect(esCalzadoLeCoq(undefined, '45')).toBe(true);
  });

  it('nombre de indumentaria = no es calzado, aunque el talle sea numérico', () => {
    expect(esCalzadoLeCoq('Rain Pant Negro', '38')).toBe(false);
    expect(esCalzadoLeCoq('Dress Azul', '039')).toBe(false);
  });

  it('talle no numérico o numérico chico = no es calzado', () => {
    expect(esCalzadoLeCoq('Strider Negro', 'L')).toBe(false);
    expect(esCalzadoLeCoq('Socks Tripack', '1')).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// La conversión tiene que ser REVERSIBLE: si el proveedor manda 45 y en Shopify
// queda 44, entonces 44 + 1 tiene que volver a dar 45. Si esto falla, el stock
// se está cargando corrido.
// ----------------------------------------------------------------------------
describe('la conversión no pierde ni corre talles', () => {
  it('todo el rango de calzado va y vuelve', () => {
    for (let prov = 34; prov <= 48; prov++) {
      const shopify = talleShopifyLeCoq(String(prov), 'Strider Negro');
      expect(Number(shopify)).toBe(prov - 1);
    }
  });
});
