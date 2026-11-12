import { describe, expect, it } from 'vitest';
import { nombreArchivoPlanilla } from '../entregasUi';

describe('nombre del Excel marcado para Trello', () => {
  it('lleva el N° de nota, la tarjeta y la fecha de la nota', () => {
    expect(nombreArchivoPlanilla({ nroProveedor: '00002595', nombre: 'Reposición Converse', fecha: '2026-11-05' }, '2026-11-12'))
      .toBe('Nota 00002595 - Reposición Converse - 05-11-2026 - entregado 12-11.xlsx');
  });
  it('no repite el N° si la tarjeta se llama igual', () => {
    expect(nombreArchivoPlanilla({ nroProveedor: '00002601', nombre: 'Pedido 00002601', fecha: '2026-11-06' }, '2026-11-12'))
      .toBe('Nota 00002601 - 06-11-2026 - entregado 12-11.xlsx');
  });
  it('saca los caracteres que no van en un nombre de archivo', () => {
    expect(nombreArchivoPlanilla({ nombre: 'Le Coq: 50/50 "ropa"', fecha: '2026-11-01' }, '2026-11-12'))
      .toBe('Le Coq 50 50 ropa - 01-11-2026 - entregado 12-11.xlsx');
  });
  it('nota subida a mano: el nombre del archivo sin la extensión', () => {
    expect(nombreArchivoPlanilla({ nombre: 'TIMB.xlsx', fecha: '' }, '2026-11-12')).toBe('TIMB - entregado 12-11.xlsx');
  });
});
