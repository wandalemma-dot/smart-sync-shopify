import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { COOKIE, makeSession } from './access.js';
import { leerRemito, normalizarRemito, validarFotos } from './remito.js';
import handler from '../api/leer-remito.js';

const foto = { media: 'image/jpeg', datos: 'QUJD' };
const cliente = (respuesta) => {
  const create = vi.fn(async () => respuesta);
  return { create, cliente: { beta: { messages: { create } } } };
};
const json = (o) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(o) }] });

describe('lectura de la foto del remito', () => {
  it('manda las fotos con esquema y devuelve el remito normalizado', async () => {
    const { create, cliente: c } = cliente(json({
      numero: ' 0016-00125246 ', fecha: '2026-11-04', dudas: ['A12744C 10.0: marcado «NO» a mano'],
      renglones: [
        { codigo: '571818c', cantidad: 9, talles: [{ talle: '5,0', cantidad: 1 }, { talle: '6.0', cantidad: 2 }, { talle: '7.5', cantidad: 0 }] },
        { codigo: 'A10520C', cantidad: 3, talles: [] },
        { codigo: '', cantidad: 1, talles: [] },
      ],
    }));
    const r = await leerRemito({ fotos: [foto, foto], cliente: c });
    const pedido = create.mock.calls[0][0];
    expect(pedido.output_config.format.type).toBe('json_schema');
    expect(pedido.messages[0].content.filter((b) => b.type === 'image')).toHaveLength(2);
    expect(r.numero).toBe('0016-00125246');
    expect(r.renglones).toEqual([
      { codigo: '571818C', cantidad: 3, talles: [{ talle: '5.0', cantidad: 1 }, { talle: '6.0', cantidad: 2 }] },
      { codigo: 'A10520C', cantidad: 3, talles: [] },
    ]);
    expect(r.dudas.join(' ')).toMatch(/total impreso \(9\) no coincide con la suma de talles \(3\)/);
    expect(r.origen).toBe('foto');
  });

  it('rechaza fotos inválidas, demasiadas y respuestas sin artículos', async () => {
    expect(() => validarFotos([])).toThrow(/Falta la foto/);
    expect(() => validarFotos([{ media: 'application/pdf', datos: 'QUJD' }])).toThrow(/inválida/);
    expect(() => validarFotos(Array(6).fill(foto))).toThrow(/Máximo/);
    expect(() => validarFotos([{ media: 'image/png', datos: 'no es base64!' }])).toThrow(/inválida/);
    await expect(leerRemito({ fotos: [foto], cliente: cliente(json({ numero: '', fecha: '', renglones: [], dudas: [] })).cliente })).rejects.toThrow(/No encontré artículos/);
    await expect(leerRemito({ fotos: [foto], cliente: cliente({ stop_reason: 'refusal', content: [] }).cliente })).rejects.toThrow(/a mano/);
    await expect(leerRemito({ fotos: [foto], cliente: cliente({ stop_reason: 'max_tokens', content: [] }).cliente })).rejects.toThrow(/demasiado largo/);
    expect(normalizarRemito({ fecha: '04/11/2026', renglones: [{ codigo: 'A1', cantidad: -3, talles: [] }] })).toMatchObject({ fecha: '', renglones: [{ codigo: 'A1', cantidad: 0 }] });
  });
});

describe('api/leer-remito', () => {
  const origin = 'https://smart-sync-shopify.vercel.app';
  beforeEach(() => {
    vi.stubEnv('APP_ACCESS_KEY', 'user-test-only-'.padEnd(48, 'a'));
    vi.stubEnv('AUTOMATION_READ_TOKEN', 'bot-test-only-'.padEnd(48, 'b'));
    vi.stubEnv('APP_ORIGIN', origin);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  const run = async (headers, method = 'POST') => {
    const r = { statusCode: 0, body: null, headers: {} };
    r.status = (s) => { r.statusCode = s; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    await handler({ method, headers: { 'content-type': 'application/json', ...headers }, body: { fotos: [foto] } }, r);
    return r;
  };
  const humano = () => ({ origin, cookie: `${COOKIE}=${makeSession()}` });

  it('solo sesión humana y mismo origen; el bot no entra', async () => {
    expect((await run({})).statusCode).toBe(401);
    expect((await run({ origin, authorization: `Bearer ${'bot-test-only-'.padEnd(48, 'b')}` })).statusCode).toBe(401);
    expect((await run({ cookie: humano().cookie, origin: 'https://otro.example' })).statusCode).toBe(403);
    expect((await run(humano(), 'GET')).statusCode).toBe(405);
  });

  it('sin la clave de Anthropic avisa que se escriba a mano', async () => {
    const r = await run(humano());
    expect(r.statusCode).toBe(503);
    expect(r.body.sinClave).toBe(true);
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
});
