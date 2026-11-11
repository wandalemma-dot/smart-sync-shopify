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

describe('Family: entregas sin factura (11-nov-2026)', () => {
  it('guarda la planilla con su consulta a Shopify, la lee y la borra junto con su remito', async () => {
    const { fn } = memoria();
    const entrega = {
      id: 'E-2026-10-30-x', nombre: 'Planilla', fecha: '2026-10-30', origen: 'excel',
      renglones: [{ codigo: 'SHBSPEC', descripcion: 'SHORT', precioMayor: 34500, precioPublico: 69000, cantidad: 20, totalImpreso: 20, talles: [{ talle: 'S', cantidad: 2 }] }],
      shopify: { fecha: '2026-11-11T12:00:00Z', codigos: { SHBSPEC: [], HPRST01: [{ titulo: 'Buzo', vendor: 'Familyarg', precios: [79200], costos: [33660], talles: ['S'] }] } },
    };
    await aplicar(fn, { proveedor: 'family', accion: 'guardarEntrega', entrega });
    await aplicar(fn, { proveedor: 'family', accion: 'guardarRemito', facturaId: entrega.id, remito: { numero: '0001-00002715', renglones: [{ codigo: 'SHBSPEC', cantidad: 20 }] } });
    let t = await leerTodo(fn, 'family');
    expect(t.entregas[0].renglones[0]).toMatchObject({ codigo: 'SHBSPEC', precioMayor: 34500, precioPublico: 69000, totalImpreso: 20 });
    expect(t.entregas[0].shopify.codigos.HPRST01[0].precios).toEqual([79200]);
    expect(t.remitos[entrega.id].numero).toBe('0001-00002715');
    expect((await leerTodo(fn, 'id')).entregas).toEqual([]);
    await expect(aplicar(fn, { proveedor: 'family', accion: 'guardarEntrega', entrega: { ...entrega, fecha: '30/10' } })).rejects.toThrow(/Fecha/);
    await aplicar(fn, { proveedor: 'family', accion: 'borrarEntrega', id: entrega.id });
    t = await leerTodo(fn, 'family');
    expect(t.entregas).toEqual([]);
    expect(t.remitos).toEqual({});
  });
});

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
    expect(t.trelloVistos[adj].version).toBe(1); // marcas viejas: se vuelven a revisar con el lector nuevo
    await aplicar(fn, { proveedor: 'id', accion: 'marcarTrelloVisto', adjunto: 'c'.repeat(24), motivo: 'no es pedido', version: 2 });
    expect((await leerTodo(fn, 'id')).trelloVistos['c'.repeat(24)].version).toBe(2);
    expect(t.pedidos.find((p) => p.id === 'p2').enlace).toBe('');
    expect(t.pedidos.find((p) => p.id.startsWith('T-')).enlace).toBe('https://trello.com/c/AbC123');
    await aplicar(fn, { proveedor: 'id', accion: 'borrarPedido', id: `T-${'b'.repeat(24)}` });
    t = await leerTodo(fn, 'id');
    expect(t.trelloVistos['b'.repeat(24)].motivo).toBe('borrado a mano');
    expect((await leerTodo(fn, 'distrinando')).trelloVistos).toEqual({});
    await expect(aplicar(fn, { proveedor: 'id', accion: 'marcarTrelloVisto', adjunto: '../x' })).rejects.toThrow(/Identificador/);
    // Una nota borrada a mano no vuelve sola: guardarla sin «recargar» se rechaza (11-nov-2026).
    const borrada = { id: `T-${'b'.repeat(24)}`, nombre: 'Tarjeta', fecha: '2026-11-01', lineas: [] };
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: borrada })).rejects.toThrow(/Volver a cargar/);
    // «Volver a cargar»: se guarda y la marca se borra en el mismo paso.
    await aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: borrada, recargar: true });
    const t2 = await leerTodo(fn, 'id');
    expect(t2.pedidos.some((p) => p.id === borrada.id)).toBe(true);
    expect(t2.trelloVistos['b'.repeat(24)]).toBeUndefined();
    // Al borrar se guarda el número y la huella, para reconocer una copia en otra tarjeta.
    await aplicar(fn, { proveedor: 'id', accion: 'borrarPedido', id: borrada.id, nro: '00002595', huella: 'abc123', extra: 'x' });
    expect((await leerTodo(fn, 'id')).trelloVistos['b'.repeat(24)]).toMatchObject({ motivo: 'borrado a mano', nro: '00002595', huella: 'abc123' });
    await aplicar(fn, { proveedor: 'id', accion: 'borrarPedido', id: borrada.id, huella: '../../x' });
    expect((await leerTodo(fn, 'id')).trelloVistos['b'.repeat(24)].huella).toBeUndefined();
    // Una copia de una nota borrada tampoco se guarda sola.
    const copia = { id: `T-${'d'.repeat(24)}`, nombre: 'Otra tarjeta', fecha: '2026-11-01', lineas: [] };
    await aplicar(fn, { proveedor: 'id', accion: 'marcarTrelloVisto', adjunto: 'd'.repeat(24), motivo: '«Otra tarjeta» n.xlsx: repite una nota que borraste de Pedidos', version: 3, huella: 'abc123' });
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: copia })).rejects.toThrow(/Volver a cargar/);
    await aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: copia, recargar: true });
    expect((await leerTodo(fn, 'id')).trelloVistos['d'.repeat(24)]).toBeUndefined();
  });

  it('una nota subida a mano y borrada queda anotada aparte, y deja de contar si se vuelve a subir', async () => {
    const { fn } = memoria();
    const nota = { id: 'P-00002595-2026-11-01', nombre: 'Nota', fecha: '2026-11-01', lineas: [] };
    await aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: nota });
    await aplicar(fn, { proveedor: 'id', accion: 'borrarPedido', id: nota.id, nro: '00002595', huella: 'abc123' });
    let t = await leerTodo(fn, 'id');
    expect(t.pedidos).toEqual([]);
    expect(t.trelloVistos[`P:${nota.id}`]).toMatchObject({ motivo: 'borrado a mano', nro: '00002595', huella: 'abc123' });
    await aplicar(fn, { proveedor: 'id', accion: 'guardarPedido', pedido: nota });
    t = await leerTodo(fn, 'id');
    expect(t.trelloVistos[`P:${nota.id}`]).toBeUndefined();
    // Sin huella no hay nada que reconocer: no se anota.
    await aplicar(fn, { proveedor: 'id', accion: 'borrarPedido', id: nota.id });
    expect((await leerTodo(fn, 'id')).trelloVistos).toEqual({});
  });

  it('guarda el remito de cada factura y lo borra con la factura', async () => {
    const { fn } = memoria();
    await aplicar(fn, { proveedor: 'id', accion: 'guardarFactura', factura: { id: 'f1', numero: '1', fecha: '2026-11-02', renglones: [] } });
    await aplicar(fn, { proveedor: 'id', accion: 'guardarRemito', facturaId: 'f1', remito: {
      numero: '0016-00125246', fecha: '2026-11-04', origen: 'foto', dudas: ['A12744C 10.0: marcado NO a mano'],
      renglones: [{ codigo: '571818C', cantidad: 8, talles: [{ talle: '5.0', cantidad: 1 }, { talle: '6.0', cantidad: 7 }] }], extra: 'x' } });
    let t = await leerTodo(fn, 'id');
    expect(t.remitos.f1.renglones[0].talles[1]).toEqual({ talle: '6.0', cantidad: 7 });
    expect(t.remitos.f1.origen).toBe('foto');
    expect(t.remitos.f1.extra).toBeUndefined();
    expect(t.config).toEqual({});
    expect((await leerTodo(fn, 'distrinando')).remitos).toEqual({});
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarRemito', facturaId: 'f1', remito: { renglones: [{ codigo: 'A', cantidad: 'muchas' }] } })).rejects.toThrow(/Número/);
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarRemito', facturaId: 'f1', remito: { renglones: 'x' } })).rejects.toThrow(/Lista/);
    await aplicar(fn, { proveedor: 'id', accion: 'borrarFactura', id: 'f1' });
    t = await leerTodo(fn, 'id');
    expect(t.remitos).toEqual({});
    await aplicar(fn, { proveedor: 'id', accion: 'guardarRemito', facturaId: 'f2', remito: { renglones: [] } });
    await aplicar(fn, { proveedor: 'id', accion: 'borrarRemito', facturaId: 'f2' });
    expect((await leerTodo(fn, 'id')).remitos).toEqual({});
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
