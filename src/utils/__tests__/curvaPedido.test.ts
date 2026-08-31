// ============================================================================
// RED DE SEGURIDAD — QUÉ CURVA SE USA PARA ARMAR EL PEDIDO A iD
// ----------------------------------------------------------------------------
// La pestaña Reposición convierte el talle ARGENTINO de la tienda al talle US
// que hay que pedirle a iD. Elegir mal la curva significa PEDIR EL TALLE
// EQUIVOCADO: no es un error de pantalla, llega mercadería que no va.
//
// REGLA (29-ago-2026, la misma que en la sincronización): la ETIQUETA
// "TABLA DE TALLE ..." del producto MANDA sobre el maestro de curvas.
//
// CASO REAL QUE LO OBLIGÓ. `A11716C` «Zapatillas Converse Sport Casual Ox
// Blanco» tiene en Shopify la etiqueta TABLA DE TALLE CONVERSE 1, pero en el
// maestro figura como tabla 2. La reposición pedía **US 7.5 para el AR 41**
// cuando corresponde **US 8.5**, y así todos sus talles.
//
// ⚠ SI UN CAMBIO HACE FALLAR ESTE ARCHIVO, EL CAMBIO ESTÁ MAL.
//   Correr con: npm test
// ============================================================================
import { describe, it, expect } from 'vitest';
import { convertirConverse, curvaDesdeEtiqueta } from '../conversorTalles';

describe('la etiqueta manda al armar el pedido', () => {
  it('A11716C: con su etiqueta TABLA 1, el AR 41 se pide como US 8.5', () => {
    const c = convertirConverse('A11716C', '41', 'zapatillas hombre, TABLA DE TALLE CONVERSE 1, converse, Calzado, A11716C');
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.tallePedido).toBe('8.5');
  });

  it('el resto de la curva de A11716C también sale por la etiqueta', () => {
    const etq = 'TABLA DE TALLE CONVERSE 1, A11716C';
    const pedido = (ar: string) => {
      const c = convertirConverse('A11716C', ar, etq);
      return c.ok ? c.tallePedido : `ERROR: ${c.motivo}`;
    };
    expect([pedido('42'), pedido('43'), pedido('44'), pedido('45')])
      .toEqual(['9.5', '10', '11', '11.5']);
  });

  it('sin etiqueta cae al maestro de curvas (respaldo, no adivina)', () => {
    // Sin etiqueta, A11716C usa el maestro: ahí es tabla 2 y el AR 41 = US 7.5.
    const c = convertirConverse('A11716C', '41', '');
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.tallePedido).toBe('7.5');
  });

  it('sin etiqueta y sin código en el maestro NO adivina', () => {
    const c = convertirConverse('ZZ9999Z', '41', '');
    expect(c.ok).toBe(false);
  });

  it('lee la etiqueta correcta y ninguna otra', () => {
    // "zapatillas hombre" y "converse mujer" son etiquetas de marketing: la
    // curva sale SOLO de la que empieza con "TABLA DE TALLE".
    expect(curvaDesdeEtiqueta('converse mujer, TABLA DE TALLE CONVERSE 2, calzado')).toBe('8');
    expect(curvaDesdeEtiqueta('converse mujer, zapatillas para niña')).toBeNull();
    expect(curvaDesdeEtiqueta('TABLA DE TALLE CONVERSE MUJER')).toBe('8A');
    expect(curvaDesdeEtiqueta('TABLA DE TALLE CONVERSE NIÑO')).toBe('4');
    expect(curvaDesdeEtiqueta('TABLA DE TALLE CONVERSE BEBE')).toBe('5');
  });
});
