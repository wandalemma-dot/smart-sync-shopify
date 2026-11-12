import { describe, expect, it } from 'vitest';
import { cambiosDePrecio, enlacesMail, pesos, textoAvisoPrecio } from '../avisoPrecio';
import type { ReposicionFamily, ResultadoCarga } from '../cargaFamily';

const repo = (codigo: string, ajuste: Partial<NonNullable<ReposicionFamily['ajuste']>> | undefined) => ({
  codigo,
  accion: { tipo: 'reposicion', productoId: `gid://shopify/Product/${codigo}`, titulo: `Zapatillas ${codigo}`, lineas: [], etiquetar: false,
    ajuste: ajuste && { costoNuevo: 40000, precioActual: 89900, precios: [89900], margen: 40, ok: false, basico: false, sugerido: 99900, variantes: [], costos: [], ponderados: [], ...ajuste } } as unknown as ReposicionFamily,
});

describe('aviso de cambio de precio (12-nov-2026)', () => {
  it('lista solo los productos cuyo precio se cambió y quedó escrito (o hay que revisar)', () => {
    const acciones = [
      repo('A1', { precio: 99900 }),
      repo('A2', { precio: 109900, precioActual: null, precios: [89900, 94900] }),
      repo('A3', undefined), // sin ajuste
      repo('A4', { precio: 99900 }), // falló: no se avisa
      repo('A5', { precio: 99900 }), // no sé si quedó
      repo('A6', { precio: 89900 }), // mismo precio
    ];
    const res: ResultadoCarga[] = [
      { codigo: 'A1', estado: 'cargada', mensaje: '' }, { codigo: 'A2', estado: 'parcial', mensaje: '' },
      { codigo: 'A3', estado: 'cargada', mensaje: '' }, { codigo: 'A4', estado: 'error', mensaje: '' },
      { codigo: 'A5', estado: 'dudosa', mensaje: '' }, { codigo: 'A6', estado: 'cargada', mensaje: '' },
    ];
    const c = cambiosDePrecio(acciones, res);
    expect(c.map((x) => x.codigo)).toEqual(['A1', 'A2', 'A5']);
    expect(c[0]).toMatchObject({ antes: 89900, nuevo: 99900, dudoso: false });
    expect(c[2].dudoso).toBe(true);
    const { asunto, cuerpo } = textoAvisoPrecio(c, { proveedor: 'iD', factura: '0011-00139937', remito: '0013-00125274', fecha: '12/11/2026' });
    expect(asunto).toBe('Cambio de precio — iD factura 0011-00139937 (3 productos)');
    expect(cuerpo).toContain('• A1 — Zapatillas A1: $ 89.900 → $ 99.900 (toda la curva)');
    expect(cuerpo).toContain('precios distintos ($ 89.900 / $ 94.900) → $ 109.900');
    expect(cuerpo).toContain('A5 — Zapatillas A5: $ 89.900 → $ 99.900 (toda la curva) — REVISAR');
    expect(cuerpo).toContain('(factura 0011-00139937, remito 0013-00125274) el 12/11/2026');
  });

  it('corta una lista muy larga para que el enlace del mail funcione', () => {
    const acciones = Array.from({ length: 60 }, (_, i) => repo(`COD${i}`, { precio: 99900 }));
    const c = cambiosDePrecio(acciones, acciones.map((a) => ({ codigo: a.codigo, estado: 'cargada' as const, mensaje: '' })));
    const { cuerpo } = textoAvisoPrecio(c, { proveedor: 'iD' });
    expect(cuerpo.length).toBeLessThan(1800);
    expect(cuerpo).toMatch(/… y \d+ productos más/);
  });

  it('arma los enlaces de Gmail y del programa de mail con destinatarios y copia', () => {
    const { gmail, mailto } = enlacesMail({ para: ['deposito@example.com'], copia: ['jefa@example.com.ar'] }, 'Cambio de precio', 'Hola,\nA1: $ 1 → $ 2');
    const g = new URL(gmail);
    expect(g.hostname).toBe('mail.google.com');
    expect(g.searchParams.get('to')).toBe('deposito@example.com');
    expect(g.searchParams.get('cc')).toBe('jefa@example.com.ar');
    expect(g.searchParams.get('body')).toBe('Hola,\nA1: $ 1 → $ 2');
    expect(mailto.startsWith('mailto:deposito@example.com?cc=jefa%40example.com.ar&subject=Cambio%20de%20precio&body=Hola%2C%0D%0A')).toBe(true);
    expect(pesos(109900)).toBe('$ 109.900');
    expect(pesos(1234.5)).toBe('$ 1.234,50');
  });
});
