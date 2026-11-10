import { describe, it, expect, vi, afterEach } from 'vitest';
import { bajarAdjunto, fechaCreacion, listarTarjetas } from './trello.js';
import handler from '../api/trello.js';

const CARD = '6650f0a0' + '0'.repeat(16);
const ATT = 'a'.repeat(24);
const OTRA = 'b'.repeat(24);
const BOARD_ID = 'c'.repeat(24);

function falso(rutas) {
  return vi.fn(async (url, opts) => {
    const ruta = url.replace('https://api.trello.com/1', '');
    const k = Object.keys(rutas).find((p) => ruta.startsWith(p));
    if (!k) return { ok: false, status: 404 };
    const v = rutas[k];
    return { ok: true, status: 200, json: async () => v, arrayBuffer: async () => new TextEncoder().encode(String(v)).buffer, opts };
  });
}

describe('Trello (solo lectura)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('lista tarjetas abiertas con sus Excel y la fecha de creación; claves en el encabezado', async () => {
    vi.stubEnv('TRELLO_KEY', 'k'); vi.stubEnv('TRELLO_TOKEN', 't');
    const f = falso({
      '/boards/RzHl0YNS?': { name: 'COMPRAS Y ENTREGAS' },
      '/boards/RzHl0YNS/lists': [{ id: 'L1', name: 'Pedidos enviados' }],
      '/boards/RzHl0YNS/cards': [
        { id: CARD, name: 'Converse 2595', idList: 'L1', desc: 'x', labels: [{ name: 'iD' }], shortUrl: 'https://trello.com/c/Ab12Cd', attachments: [
          { id: ATT, name: 'pedido.xlsx', bytes: 100, isUpload: true }, { id: OTRA, name: 'foto.png', isUpload: true }] },
        { id: OTRA, name: 'Archivada', closed: true, attachments: [] },
      ],
    });
    const r = await listarTarjetas(f);
    expect(r.tablero).toBe('COMPRAS Y ENTREGAS');
    expect(r.tarjetas).toHaveLength(1);
    expect(r.tarjetas[0]).toMatchObject({ nombre: 'Converse 2595', lista: 'Pedidos enviados', etiquetas: ['iD'], creada: fechaCreacion(CARD), enlace: 'https://trello.com/c/Ab12Cd' });
    expect(r.tarjetas[0].adjuntos.map((a) => a.nombre)).toEqual(['pedido.xlsx']);
    for (const [url, opts] of f.mock.calls) {
      expect(url).not.toMatch(/key=|token=/);
      expect(opts.headers.Authorization).toBe('OAuth oauth_consumer_key="k", oauth_token="t"');
    }
  });

  it('baja el adjunto solo si la tarjeta es del tablero', async () => {
    vi.stubEnv('TRELLO_KEY', 'k'); vi.stubEnv('TRELLO_TOKEN', 't');
    const base = {
      [`/boards/RzHl0YNS?`]: { id: BOARD_ID },
      [`/cards/${CARD}/attachments/${ATT}/download/`]: 'XLSX',
      [`/cards/${CARD}/attachments/${ATT}?`]: { id: ATT, name: 'pedido.xlsx', bytes: 4, isUpload: true },
    };
    const ok = await bajarAdjunto(CARD, ATT, falso({ ...base, [`/cards/${CARD}?`]: { idBoard: BOARD_ID } }));
    expect(Buffer.from(ok.datos, 'base64').toString()).toBe('XLSX');
    await expect(bajarAdjunto(CARD, ATT, falso({ ...base, [`/cards/${CARD}?`]: { idBoard: OTRA } }))).rejects.toThrow(/no es del tablero/);
    await expect(bajarAdjunto('../x', ATT, falso(base))).rejects.toThrow(/inválido/);
  });

  it('endpoint: sin sesión 401; el token del bot no entra', async () => {
    const res = () => { const r = { code: 0, setHeader() {}, status(c) { r.code = c; return r; }, json() { return r; } }; return r; };
    const r1 = res();
    await handler({ method: 'GET', headers: {}, query: { accion: 'tarjetas' } }, r1);
    expect(r1.code).toBe(401);
    vi.stubEnv('AUTOMATION_READ_TOKEN', 'x'.repeat(40));
    const r2 = res();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${'x'.repeat(40)}` }, query: { accion: 'tarjetas' } }, r2);
    expect(r2.code).toBe(401);
  });
});
