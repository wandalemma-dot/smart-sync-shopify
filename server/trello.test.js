import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import * as XLSX from 'xlsx';
import { unzipSync, zipSync } from 'fflate';
import { bajarAdjunto, fechaCreacion, listarTarjetas, MAX_ADJUNTO } from './trello.js';
import { leerPedidoAuto } from '../src/utils/lectoresFacturas.ts';
import handler from '../api/trello.js';
import { makeSession, COOKIE } from './access.js';

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

  it('la descarga sigue la redirección al archivo SIN las claves; a Trello sí se las manda (11-nov-2026)', async () => {
    vi.stubEnv('TRELLO_KEY', 'k'); vi.stubEnv('TRELLO_TOKEN', 't');
    const llamadas = [];
    const fetchImpl = vi.fn(async (url, opts) => {
      llamadas.push({ url, auth: opts.headers.Authorization, redirect: opts.redirect });
      const ruta = url.replace('https://api.trello.com/1', '');
      if (url.startsWith('https://archivos.example.com/')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('XLSX').buffer };
      if (ruta.includes('/download/')) return { ok: false, status: 302, headers: new Headers({ location: 'https://archivos.example.com/f.xlsx?firma=abc' }) };
      if (ruta.startsWith('/boards/')) return { ok: true, status: 200, json: async () => ({ id: BOARD_ID }) };
      if (ruta.startsWith(`/cards/${CARD}/attachments/`)) return { ok: true, status: 200, json: async () => ({ id: ATT, name: 'f5a02c7c.xlsx', bytes: 4, isUpload: true }) };
      return { ok: true, status: 200, json: async () => ({ idBoard: BOARD_ID }) };
    });
    const r = await bajarAdjunto(CARD, ATT, fetchImpl);
    expect(Buffer.from(r.datos, 'base64').toString()).toBe('XLSX');
    const final = llamadas.find((l) => l.url.startsWith('https://archivos.example.com/'));
    expect(final.auth).toBeUndefined(); // el servidor del archivo rechaza un pedido con otra firma
    expect(llamadas.filter((l) => l.url.startsWith('https://api.trello.com/')).every((l) => l.auth && l.redirect === 'manual')).toBe(true);
  });

  it('si Trello limita los pedidos (429) espera y reintenta; los errores dicen el motivo', async () => {
    vi.stubEnv('TRELLO_KEY', 'k'); vi.stubEnv('TRELLO_TOKEN', 't');
    let veces = 0;
    const limitado = vi.fn(async (url) => {
      if (url.includes('/lists')) return { ok: true, status: 200, json: async () => [] };
      if (url.includes('/cards?')) {
        veces++;
        if (veces < 3) return { ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }), text: async () => 'API_TOKEN_LIMIT_EXCEEDED' };
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => ({ name: 'COMPRAS Y ENTREGAS' }) };
    });
    expect((await listarTarjetas(limitado)).tablero).toBe('COMPRAS Y ENTREGAS');
    expect(veces).toBe(3);
    // Sin Retry-After (como responde Trello) espera de verdad antes de reintentar: 2 s, 4 s…
    vi.useFakeTimers();
    try {
      let n = 0;
      const sinCabecera = vi.fn(async (url) => {
        if (url.includes('/cards?')) { n++; return n < 2 ? new Response('API_TOKEN_LIMIT_EXCEEDED', { status: 429 }) : Response.json([]); }
        return url.includes('/lists') ? Response.json([]) : Response.json({ name: 'X' });
      });
      const p = listarTarjetas(sinCabecera);
      await vi.advanceTimersByTimeAsync(1500);
      expect(n).toBe(1); // todavía esperando
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).tablero).toBe('X');
      expect(n).toBe(2);
    } finally { vi.useRealTimers(); }
    const rechazo = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized permission requested' }));
    await expect(listarTarjetas(rechazo)).rejects.toThrow(/401 \(unauthorized permission requested\)/);
    const s3 = vi.fn(async () => ({ ok: false, status: 400, text: async () => '<Error><Code>InvalidArgument</Code><Message>Only one auth mechanism allowed</Message></Error>' }));
    await expect(listarTarjetas(s3)).rejects.toThrow(/400 \(Only one auth mechanism allowed\)/);
  });

  it('avisa los adjuntos que no son Excel subidos (enlaces, PDF)', async () => {
    vi.stubEnv('TRELLO_KEY', 'k'); vi.stubEnv('TRELLO_TOKEN', 't');
    const f = falso({
      '/boards/RzHl0YNS?': { name: 'COMPRAS Y ENTREGAS' },
      '/boards/RzHl0YNS/lists': [],
      '/boards/RzHl0YNS/cards': [{ id: CARD, name: 'Converse 3/11', attachments: [
        { id: ATT, name: 'nota.xlsx', isUpload: false }, { id: OTRA, name: 'factura.pdf', isUpload: true }] }],
    });
    const r = await listarTarjetas(f);
    expect(r.tarjetas[0].adjuntos).toEqual([]);
    expect(r.tarjetas[0].otrosAdjuntos).toEqual(['nota.xlsx (enlace)', 'factura.pdf']);
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

  describe('claves de Vercel con caracteres de más (11-nov-2026)', () => {
    // Formato real: key de 32 hex y token ATTA… (inventados, no son los de la tienda).
    const KEY = '0123456789abcdef0123456789abcdef';
    const TOKEN = 'ATTA' + 'f'.repeat(64) + '0ABC1234';
    const sesion = () => {
      vi.stubEnv('APP_ACCESS_KEY', 's'.repeat(40));
      return { cookie: `${COOKIE}=${makeSession()}` };
    };
    const res = () => { const r = { code: 0, body: null, setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
    /** Como fetch de verdad: Node valida el encabezado antes de mandar nada. */
    const trelloReal = (respuestas = {}) => vi.fn(async (url, opts) => {
      new Headers(opts.headers); // tira «… is an invalid header value» si hay un salto de línea
      if (url.includes('/lists')) return Response.json([]);
      if (url.includes('/cards?')) return Response.json(respuestas.cards ?? []);
      return Response.json({ name: 'COMPRAS Y ENTREGAS' });
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each([
      ['salto de línea al final (el caso real)', `${TOKEN}\n`],
      ['Windows: \\r\\n', `${TOKEN}\r\n`],
      ['espacios alrededor', `  ${TOKEN}  `],
      ['entre comillas', `"${TOKEN}"`],
    ])('token con %s: se limpia y Trello se lee', async (_, sucio) => {
      vi.stubEnv('TRELLO_KEY', `${KEY}\n`); vi.stubEnv('TRELLO_TOKEN', sucio);
      const f = trelloReal();
      expect((await listarTarjetas(f)).tablero).toBe('COMPRAS Y ENTREGAS');
      for (const [, opts] of f.mock.calls) expect(opts.headers.Authorization).toBe(`OAuth oauth_consumer_key="${KEY}", oauth_token="${TOKEN}"`);
    });

    it('un carácter raro en el medio: avisa cuál de las dos claves es, sin mostrarla', async () => {
      vi.stubEnv('TRELLO_KEY', KEY); vi.stubEnv('TRELLO_TOKEN', `${TOKEN.slice(0, 30)} ${TOKEN.slice(30)}`);
      const f = trelloReal();
      const e = await listarTarjetas(f).catch((x) => x);
      expect(e.status).toBe(503);
      expect(e.message).toMatch(/TRELLO_TOKEN en Vercel tiene caracteres que no van/);
      expect(e.message).not.toContain(TOKEN.slice(0, 30));
      expect(f).not.toHaveBeenCalled(); // ni se intentó
    });

    it('la pantalla nunca recibe las claves: ni del error de Node ni de lo que conteste Trello', async () => {
      const cookie = sesion().cookie;
      vi.stubEnv('TRELLO_KEY', KEY); vi.stubEnv('TRELLO_TOKEN', TOKEN);
      const casos = [
        // fetch tira un error que copia el encabezado entero (lo que pasó el 11-nov)
        async (url, opts) => { throw new TypeError(`Headers.append: "${opts.headers.Authorization}\n" is an invalid header value.`); },
        // se corta la conexión y el motivo trae la dirección con las claves
        async () => { throw new TypeError(`fetch failed: https://api.trello.com/1/x?key=${KEY}&token=${TOKEN}`); },
        // Trello responde un error que repite el token
        async () => new Response(`invalid token ${TOKEN} for key ${KEY}`, { status: 401 }),
        async () => new Response(`<Error><Message>bad oauth_token="${TOKEN}"</Message></Error>`, { status: 400 }),
      ];
      for (const caso of casos) {
        vi.stubGlobal('fetch', vi.fn(caso));
        const r = res();
        await handler({ method: 'GET', headers: { cookie }, query: { accion: 'tarjetas' } }, r);
        expect(r.code).toBeGreaterThanOrEqual(400);
        const texto = JSON.stringify(r.body);
        expect(texto).not.toContain(TOKEN);
        expect(texto).not.toContain(TOKEN.slice(4, 40));
        expect(texto).not.toContain(KEY);
        expect(r.body.error).toBeTruthy();
      }
    });

    it('el error de Node por un encabezado inválido se explica sin copiar el encabezado', async () => {
      vi.stubEnv('TRELLO_KEY', KEY); vi.stubEnv('TRELLO_TOKEN', TOKEN);
      const roto = vi.fn(async (url, opts) => { throw new TypeError(`Headers.append: "${opts.headers.Authorization}" is an invalid header value.`); });
      const e = await listarTarjetas(roto).catch((x) => x);
      expect(e.status).toBe(503);
      expect(e.message).toMatch(/Las claves de Trello en Vercel tienen un carácter que no va/);
      expect(e.message).not.toContain(TOKEN);
    });
  });
});
