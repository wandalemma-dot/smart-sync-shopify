import { describe, it, expect, vi, afterEach } from 'vitest';
import { aplicar, leerTodo } from './control-facturas.js';
import { kv } from './kv.js';
import handler from '../api/control-facturas.js';

function memoria() {
  const db = new Map();
  const fn = async (cmds) => cmds.map(([op, key, campo, valor]) => {
    const h = db.get(key) ?? new Map();
    db.set(key, h);
    if (op === 'HSET') { h.set(campo, valor); return 1; }
    if (op === 'HDEL') return h.delete(campo) ? 1 : 0;
    if (op === 'HGET') return h.get(campo) ?? null;
    if (op === 'HGETALL') return [...h.entries()].flat();
    throw new Error('op');
  });
  return { db, fn };
}

describe('guardado del control de facturas', () => {
  it('guarda, lee y borra por proveedor', async () => {
    const { fn } = memoria();
    await aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: { id: 'p1', nombre: 'P', fecha: '2026-11-01', lineas: [{ codigo: 'A', talle: '40', cantidad: 2, precioLista: 10 }] } });
    await aplicar(fn, { proveedor: 'id', accion: 'guardarFactura', factura: { id: 'f1', numero: '1', fecha: '2026-11-02', renglones: [] } });
    await aplicar(fn, { proveedor: 'id', accion: 'guardarRecepcion', facturaId: 'f1', recepcion: { recibido: { 'A|40': 2 }, extras: [] } });
    await aplicar(fn, { proveedor: 'id', accion: 'guardarConfig', config: { condicionesPago: 'contado 7%' } });
    let t = await leerTodo(fn, 'id');
    expect(t.pedidos[0].lineas[0].cantidad).toBe(2);
    expect(t.recepciones.f1.recibido['A|40']).toBe(2);
    expect(t.config.condicionesPago).toBe('contado 7%');
    expect((await leerTodo(fn, 'distrinando')).pedidos).toEqual([]);
    await aplicar(fn, { proveedor: 'id', accion: 'borrarFactura', id: 'f1' });
    t = await leerTodo(fn, 'id');
    expect(t.facturas).toEqual([]);
    expect(t.recepciones).toEqual({});
  });

  it('recuerda los adjuntos de Trello revisados y los pedidos de Trello borrados, por proveedor', async () => {
    const { fn } = memoria();
    const adj = 'a'.repeat(24);
    await aplicar(fn, { proveedor: 'id', accion: 'marcarTrelloVisto', adjunto: adj, motivo: 'es de Distrinando' });
    await aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: { id: `T-${'b'.repeat(24)}`, nombre: 'Tarjeta', fecha: '2026-11-01', enlace: 'https://trello.com/c/AbC123', lineas: [] } });
    await aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: { id: 'p2', nombre: 'X', fecha: '2026-11-01', enlace: 'javascript:alert(1)', lineas: [] } });
    let t = await leerTodo(fn, 'id');
    expect(t.trelloVistos[adj].motivo).toBe('es de Distrinando');
    expect(t.pedidos.find((p) => p.id === 'p2').enlace).toBe('');
    expect(t.pedidos.find((p) => p.id.startsWith('T-')).enlace).toBe('https://trello.com/c/AbC123');
    await aplicar(fn, { proveedor: 'id', accion: 'borrarPedido', id: `T-${'b'.repeat(24)}` });
    t = await leerTodo(fn, 'id');
    expect(t.trelloVistos['b'.repeat(24)].motivo).toBe('borrado a mano');
    expect((await leerTodo(fn, 'distrinando')).trelloVistos).toEqual({});
    await expect(aplicar(fn, { proveedor: 'id', accion: 'marcarTrelloVisto', adjunto: '../x' })).rejects.toThrow(/Identificador/);
  });

  it('rechaza proveedor, acción, ids y números inválidos', async () => {
    const { fn } = memoria();
    await expect(aplicar(fn, { proveedor: 'otro', accion: 'guardarPedido' })).rejects.toThrow(/Proveedor/);
    await expect(aplicar(fn, { proveedor: 'id', accion: 'FLUSHALL' })).rejects.toThrow(/Acción/);
    await expect(aplicar(fn, { proveedor: 'id', accion: 'borrarPedido', id: 'a b' })).rejects.toThrow(/Identificador/);
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: { id: 'p', lineas: [{ cantidad: 'x' }] } })).rejects.toThrow(/Número/);
  });
});

describe('endpoint', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  const res = () => { const r = { headers: {}, code: 0, body: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

  it('sin sesión: 401; sin base: 503', async () => {
    const r1 = res();
    await handler({ method: 'GET', headers: {}, query: { proveedor: 'id' } }, r1);
    expect(r1.code).toBe(401);
  });

  it('el token del bot no entra', async () => {
    vi.stubEnv('AUTOMATION_READ_TOKEN', 'x'.repeat(40));
    const r = res();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${'x'.repeat(40)}` }, query: { proveedor: 'id' } }, r);
    expect(r.code).toBe(401);
  });

  it('kv usa el pipeline REST con el token del entorno', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://db.example');
    vi.stubEnv('KV_REST_API_TOKEN', 'tok');
    const f = vi.fn(async () => ({ ok: true, json: async () => [{ result: 1 }] }));
    expect(await kv([['HSET', 'k', 'a', 'b']], f)).toEqual([1]);
    expect(f.mock.calls[0][0]).toBe('https://db.example/pipeline');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
});
