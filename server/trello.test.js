import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import * as XLSX from 'xlsx';
import { unzipSync, zipSync } from 'fflate';
import { bajarAdjunto, fechaCreacion, listarTarjetas, MAX_ADJUNTO } from './trello.js';
import { leerPedidoAuto } from '../src/utils/lectoresFacturas.ts';
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

  it('un Excel de iD con fotos de más de 3 MB se baja sin las fotos y se lee igual (11-nov-2026)', async () => {
    vi.stubEnv('TRELLO_KEY', 'k'); vi.stubEnv('TRELLO_TOKEN', 't');
    // Nota de iD como la real: fila 1 con N° y fecha, fila 2 encabezados, una columna «Imagen».
    const filas = [
      [null, 'Pedido N° 00002595', '2059 — ELEVE SAS', '01/11/2026'],
      ['Imagen', 'Código', 'Descripción', 'Color', '055', '060', 'S', 'M', 'Total', 'Precio unit.', 'Subtotal', 'Bonif. %'],
      [null, 'A13438C', 'CHUCK 70', '1', 4, 3, null, null, 7, 58770.05, 411390.35, 10],
      [null, 'CTO0325003', 'REMERA MANGA CORTA', '1', null, null, 5, 6, 11, 21336.9, 234705.9, 10],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Pedido');
    const zip = unzipSync(new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
    zip['xl/media/image1.png'] = new Uint8Array(randomBytes(MAX_ADJUNTO + 500_000)); // la «foto»: no se comprime
    const pesado = Buffer.from(zipSync(zip, { level: 0 }));
    expect(pesado.length).toBeGreaterThan(MAX_ADJUNTO);
    const fetchImpl = vi.fn(async (url) => {
      const ruta = url.replace('https://api.trello.com/1', '');
      const json = ruta.startsWith('/boards/') ? { id: BOARD_ID }
        : ruta.startsWith(`/cards/${CARD}/attachments/${ATT}?`) ? { id: ATT, name: 'f5a02c7c.xlsx', bytes: pesado.length, isUpload: true }
          : { idBoard: BOARD_ID };
      return { ok: true, status: 200, json: async () => json, arrayBuffer: async () => pesado.buffer.slice(pesado.byteOffset, pesado.byteOffset + pesado.length) };
    });
    const r = await bajarAdjunto(CARD, ATT, fetchImpl);
    const liviano = Buffer.from(r.datos, 'base64');
    expect(liviano.length).toBeLessThan(MAX_ADJUNTO);
    const leido = XLSX.read(liviano);
    const hoja = XLSX.utils.sheet_to_json(leido.Sheets[leido.SheetNames[0]], { header: 1, raw: true });
    const p = leerPedidoAuto(hoja, 'x', 'Converse', '2026-11-03');
    expect(p.proveedor).toBe('id');
    expect(p.nroProveedor).toBe('00002595');
    expect(p.pedido.fecha).toBe('2026-11-01');
    expect(p.pedido.lineas.reduce((s, l) => s + l.cantidad, 0)).toBe(18);
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
