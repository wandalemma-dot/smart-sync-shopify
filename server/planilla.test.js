// Fila en la planilla «CONTROL INGRESO MERCADERIA» (16-nov-2026, gax).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { anotarFila, corregirFila, probarPlanilla, validarFila } from './planilla.js';
import handler from '../api/planilla.js';
import { makeSession, COOKIE } from './access.js';

const URL_OK = `https://script.google.com/macros/s/${'A'.repeat(40)}/exec`;
const fila = { fecha: '10/11/26', proveedor: 'ID CONVERSE', numero: '0011-00139953', factura: 'FAC.OK - 0011-00139953', remito: '0013-00125274', monto: 1215508.21, observaciones: 'APP - ok', ok: true, carga: '16/11/26' };

function script(respuesta) {
  const llamadas = [];
  const f = vi.fn(async (url, opts) => { llamadas.push({ url, cuerpo: JSON.parse(opts.body), opts }); return new Response(typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta)); });
  return { f, llamadas };
}
function res() {
  const r = { code: 0, body: null, headers: {} };
  return Object.assign(r, { setHeader: (k, v) => { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } });
}

describe('Planilla de ingreso', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('manda la fila con la clave al Apps Script y devuelve en qué fila quedó', async () => {
    vi.stubEnv('PLANILLA_URL', URL_OK); vi.stubEnv('PLANILLA_SECRETO', 'clave-secreta-larga');
    const { f, llamadas } = script({ ok: true, fila: 237 });
    expect(await anotarFila(fila, f)).toEqual({ ok: true, yaEstaba: false, fila: 237 });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe(URL_OK);
    expect(llamadas[0].cuerpo).toEqual({ accion: 'anotar', fila, clave: 'clave-secreta-larga' });
    expect(llamadas[0].opts.redirect).toBe('follow');
  });

  it('factura ya anotada: no la repite', async () => {
    vi.stubEnv('PLANILLA_URL', URL_OK); vi.stubEnv('PLANILLA_SECRETO', 'clave-secreta-larga');
    const { f } = script({ ok: true, yaEstaba: true, fila: 236 });
    expect(await anotarFila(fila, f)).toEqual({ ok: true, yaEstaba: true, fila: 236 });
  });

  it('corregir (25-nov-2026): manda la fila con «corregir» y devuelve la fila y lo que decía antes; sin factura no se corrige', async () => {
    vi.stubEnv('PLANILLA_URL', URL_OK); vi.stubEnv('PLANILLA_SECRETO', 'clave-secreta-larga');
    const { f, llamadas } = script({ ok: true, fila: 54, antes: 'APP - Facturado sin pedir ($ 1.274.342,28 neto)' });
    expect(await corregirFila(fila, f)).toEqual({ ok: true, noEsta: false, sinCambios: false, fila: 54, antes: 'APP - Facturado sin pedir ($ 1.274.342,28 neto)' });
    expect(llamadas[0].cuerpo).toEqual({ accion: 'corregir', fila, clave: 'clave-secreta-larga' });
    expect(await corregirFila(fila, script({ ok: true, noEsta: true }).f)).toEqual({ ok: true, noEsta: true, sinCambios: false });
    const family = { ...fila, factura: '', numero: '0001-00002716', remito: '0001-00002716' };
    await expect(corregirFila(family, script({ ok: true }).f)).rejects.toThrow(/facturas/);
    // El Apps Script de antes no conoce «corregir».
    await expect(corregirFila(fila, script({ error: 'Pedido inválido.' }).f)).rejects.toThrow(/Pedido inválido/);
  });

  it('valida la fila: fechas, número, monto y nada que empiece como fórmula', () => {
    expect(validarFila(fila)).toMatchObject({ monto: 1215508.21, ok: true });
    expect(validarFila({ ...fila, monto: null }).monto).toBeNull();
    for (const mala of [{ fecha: '2026-11-10' }, { carga: '' }, { numero: '../x' }, { monto: -1 }, { monto: 'abc' }, { proveedor: '=IMPORTXML("x")' }, { observaciones: '+1' }, { remito: '@x' }, { observaciones: 'x'.repeat(301) }]) {
      expect(() => validarFila({ ...fila, ...mala })).toThrow();
    }
  });

  it('aviso (26-nov-2026, diferencia de precio de iD): pasa solo si la fila no está ok', () => {
    expect(validarFila({ ...fila, ok: false, aviso: true }).aviso).toBe(true);
    expect(validarFila({ ...fila, ok: true, aviso: true }).aviso).toBeUndefined();
    expect(validarFila({ ...fila, ok: false, aviso: 'si' }).aviso).toBeUndefined();
  });
  it('Family (sin factura): va con el remito; sin factura ni remito, o con otro número, no', () => {
    const fam = { fecha: '11/11/26', proveedor: 'Familyarg', numero: '0001-00002716', factura: '', remito: '0001-00002716', monto: null, observaciones: 'APP - ok', ok: true, carga: '16/11/26' };
    expect(validarFila(fam)).toMatchObject({ factura: '', remito: '0001-00002716', monto: null });
    expect(() => validarFila({ ...fam, remito: '' })).toThrow();
    expect(() => validarFila({ ...fam, numero: '0001-00009999' })).toThrow(/remito/);
  });

  it('sin configurar, con una dirección que no es de Apps Script, o una respuesta que no es JSON: error claro sin la clave', async () => {
    const { f } = script({ ok: true });
    await expect(anotarFila(fila, f)).rejects.toThrow(/PLANILLA_URL y PLANILLA_SECRETO/);
    vi.stubEnv('PLANILLA_URL', 'https://otro.example/exec'); vi.stubEnv('PLANILLA_SECRETO', 'clave-secreta-larga');
    await expect(anotarFila(fila, f)).rejects.toThrow(/Apps Script/);
    expect(f).not.toHaveBeenCalled();
    vi.stubEnv('PLANILLA_URL', URL_OK);
    await expect(anotarFila(fila, script('<html>Iniciar sesión</html>').f)).rejects.toThrow(/Cualquier usuario/);
    const e = await anotarFila(fila, script({ error: 'Clave incorrecta: clave-secreta-larga' }).f).catch((x) => x);
    expect(e.message).toMatch(/Clave incorrecta/);
    expect(e.message).not.toContain('clave-secreta-larga');
  });

  it('probar no escribe: solo pregunta la hoja', async () => {
    vi.stubEnv('PLANILLA_URL', URL_OK); vi.stubEnv('PLANILLA_SECRETO', 'clave-secreta-larga');
    const { f, llamadas } = script({ ok: true, hoja: 'INGRESOS' });
    expect(await probarPlanilla(f)).toEqual({ ok: true, hoja: 'INGRESOS' });
    expect(llamadas[0].cuerpo).toEqual({ accion: 'probar', clave: 'clave-secreta-larga' });
  });

  it('el endpoint: solo sesión humana, mismo origen y JSON; sin configurar avisa', async () => {
    vi.stubEnv('APP_ACCESS_KEY', 's'.repeat(40));
    const r1 = res();
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { accion: 'anotar', fila } }, r1);
    expect(r1.code).toBe(401);
    const r2 = res();
    await handler({ method: 'POST', headers: { cookie: `${COOKIE}=${makeSession()}`, origin: 'https://otro.example', host: 'app.example', 'content-type': 'application/json' }, body: { accion: 'anotar', fila } }, r2);
    expect(r2.code).toBe(403);
    const r3 = res();
    await handler({ method: 'GET', headers: { cookie: `${COOKIE}=${makeSession()}` }, query: { accion: 'probar' } }, r3);
    expect(r3.code).toBe(503);
    expect(r3.body.sinPlanilla).toBe(true);
  });
});
