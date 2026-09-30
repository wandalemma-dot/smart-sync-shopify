import { describe, it, expect } from 'vitest';
import { KAPPA_TABLAS, convertirTalleKappa } from '../kappaTalles';

describe('tablas Kappa del proveedor', () => {
  it('convierte por EU explícito, incluido medio talle, sin extrapolar', () => {
    expect(convertirTalleKappa(40, 'UNISEX')).toEqual({arg:'39',us:null,eu:'40',cm:'25.7'});
    expect(convertirTalleKappa('36,5', 'UNISEX')?.arg).toBe('35.5');
    expect(convertirTalleKappa(25, 'NINO')?.arg).toBe('24');
    expect(convertirTalleKappa(25, 'UNISEX')).toBeNull();
    expect(convertirTalleKappa(39.5, 'UNISEX')).toBeNull();
    expect(convertirTalleKappa('', 'UNISEX')).toBeNull();
  });
  it('conserva ambas tablas y sus coincidencias sin inventar US', () => {
    expect(Object.keys(KAPPA_TABLAS.UNISEX)).toHaveLength(17);
    expect(Object.keys(KAPPA_TABLAS.NINO)).toHaveLength(19);
    for (const t of Object.values(KAPPA_TABLAS.UNISEX)) {
      expect(t.us).toBeNull();
      const compartido=Object.values(KAPPA_TABLAS.NINO).find(n=>n.arg===t.arg);
      if(compartido) expect(compartido).toEqual(t);
    }
  });
});
