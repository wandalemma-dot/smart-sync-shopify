import { describe, it, expect, vi, afterEach } from 'vitest';
import { aplicar, leerEnlaces, leerRegistro, leerTodo } from './control-facturas.js';
import { kv } from './kv.js';
import handler from '../api/control-facturas.js';
import { COOKIE, makeSession } from './access.js';

function memoria() {
  const db = new Map();
  const fn = async (cmds) => cmds.map(([op, key, campo, valor, ...mas]) => {
    if (op.startsWith('L')) {
      const l = db.get(key) ?? [];
      db.set(key, l);
      if (op === 'LPUSH') { l.unshift(campo); return l.length; }
      if (op === 'LTRIM') { l.splice(valor + 1); return 'OK'; }
      if (op === 'LRANGE') return l.slice(campo, valor + 1);
    }
    const h = db.get(key) ?? new Map();
    db.set(key, h);
    if (op === 'HMGET') return [campo, valor, ...mas].filter((x) => x !== undefined).map((c) => h.get(c) ?? null);
    if (op === 'HSET') { const par = [campo, valor, ...mas]; for (let i = 0; i + 1 < par.length; i += 2) h.set(par[i], par[i + 1]); return par.length / 2; }
    if (op === 'HSETNX') { if (h.has(campo)) return 0; h.set(campo, valor); return 1; }
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

  it('marca de carga en Shopify: una sola vez por entrega y artículo, sobrevive al borrado de la entrega', async () => {
    const { fn } = memoria();
    const base = { proveedor: 'family', entregaId: 'E-2026-10-30-x', codigo: 'SHBSPEC' };
    expect(await aplicar(fn, { ...base, accion: 'reservarCarga', firma: '2026-10-30|SHBSPEC|20|S:2', detalle: { accion: 'alta', titulo: 'Bermuda Short Familyarg Spectrum' } })).toEqual({ ok: true });
    // Otra pantalla (o un doble clic) no puede cargarla otra vez.
    const otra = await aplicar(fn, { ...base, accion: 'reservarCarga', firma: 'x' });
    expect(otra.ok).toBe(false);
    expect(otra.existente).toMatchObject({ estado: 'en curso', firma: '2026-10-30|SHBSPEC|20|S:2' });
    await aplicar(fn, { ...base, accion: 'terminarCarga', estado: 'cargada', detalle: { productoId: 'gid://shopify/Product/77', unidades: 20, productoFalso: 1 } });
    let t = await leerTodo(fn, 'family');
    expect(t.cargas['E-2026-10-30-x|SHBSPEC']).toMatchObject({ estado: 'cargada', detalle: { accion: 'alta', productoId: 'gid://shopify/Product/77', unidades: 20, titulo: 'Bermuda Short Familyarg Spectrum' } });
    expect(t.cargas['E-2026-10-30-x|SHBSPEC'].detalle.productoFalso).toBeUndefined();
    await aplicar(fn, { proveedor: 'family', accion: 'borrarEntrega', id: base.entregaId });
    t = await leerTodo(fn, 'family');
    expect(Object.keys(t.cargas)).toEqual(['E-2026-10-30-x|SHBSPEC']);
    await aplicar(fn, { ...base, accion: 'liberarCarga' });
    expect((await leerTodo(fn, 'family')).cargas).toEqual({});
    // Validaciones: estado, código, proveedor, y no se termina una carga que no se reservó.
    await expect(aplicar(fn, { ...base, accion: 'terminarCarga', estado: 'cargada' })).rejects.toThrow(/No encontré la marca/);
    await aplicar(fn, { ...base, accion: 'reservarCarga', firma: 'f' });
    await expect(aplicar(fn, { ...base, accion: 'terminarCarga', estado: 'en curso' })).rejects.toThrow(/Estado inválido/);
    await expect(aplicar(fn, { ...base, accion: 'reservarCarga', codigo: 'shb spec' })).rejects.toThrow(/Código inválido/);
    await expect(aplicar(fn, { ...base, proveedor: 'otro', accion: 'reservarCarga' })).rejects.toThrow();
  });

  it('Distrinando también carga en Shopify (13-nov-2026): marca por entrega y código, aparte de Family e iD', async () => {
    const { fn } = memoria();
    const c = { proveedor: 'distrinando', entregaId: 'F-0039-00283124', codigo: 'RBKLIX71-RBKGX9659' };
    expect((await leerTodo(fn, 'distrinando')).cargas).toEqual({});
    expect(await aplicar(fn, { ...c, accion: 'reservarCarga', firma: '2026-11-10|RBKLIX71-RBKGX9659|6|5:4|0085-00206200', factura: '0039-00283124', detalle: { accion: 'reposicion', titulo: 'Zapatillas Reebok Club C Cardi' } })).toEqual({ ok: true });
    expect((await aplicar(fn, { ...c, accion: 'reservarCarga', firma: 'x' })).ok).toBe(false);
    await aplicar(fn, { ...c, accion: 'terminarCarga', estado: 'cargada', detalle: { unidades: 4 } });
    expect((await leerTodo(fn, 'distrinando')).cargas['F-0039-00283124|RBKLIX71-RBKGX9659']).toMatchObject({ estado: 'cargada', factura: '0039-00283124' });
    expect((await leerTodo(fn, 'id')).cargas).toEqual({});
  });

  it('iD también carga en Shopify (12-nov-2026): su marca lleva el número de factura y va al registro', async () => {
    const { fn } = memoria();
    const c = { proveedor: 'id', entregaId: 'F-0011-00139953', codigo: 'CTO0325003' };
    await aplicar(fn, { proveedor: 'id', accion: 'guardarRemito', facturaId: c.entregaId, remito: { numero: '0013-00125274', renglones: [{ codigo: 'CTO0325003', cantidad: 3 }] } });
    expect(await aplicar(fn, { ...c, accion: 'reservarCarga', firma: '2026-11-10|CTO0325003|2|XL:2|0013-00125274', factura: '0011-00139953', detalle: { accion: 'reposicion', titulo: 'Remera Converse' } })).toEqual({ ok: true });
    expect((await aplicar(fn, { ...c, accion: 'reservarCarga', firma: 'x' })).ok).toBe(false);
    await aplicar(fn, { ...c, accion: 'terminarCarga', estado: 'cargada', detalle: { unidades: 2 } });
    expect((await leerTodo(fn, 'id')).cargas[`${c.entregaId}|CTO0325003`]).toMatchObject({ estado: 'cargada', factura: '0011-00139953' });
    expect((await leerTodo(fn, 'family')).cargas).toEqual({});
    const { eventos } = await leerRegistro(fn);
    expect(eventos[0]).toMatchObject({ proveedor: 'id', codigo: 'CTO0325003', factura: '0011-00139953', remito: '0013-00125274', entrega: { fecha: '2026-11-10' }, talles: [{ talle: 'XL', cantidad: 2 }] });
  });
});

describe('Entregas cerradas (14-nov-2026)', () => {
  it('«no llegó» queda guardado por entrega y código, y se puede deshacer', async () => {
    const { fn } = memoria();
    const c = { proveedor: 'distrinando', entregaId: 'F-0039-00283124', codigo: 'RBK1100033527' };
    expect((await leerTodo(fn, 'distrinando')).noLlego).toEqual({});
    expect(await aplicar(fn, { ...c, accion: 'marcarNoLlego', noLlego: true })).toEqual({ ok: true });
    expect(Object.keys((await leerTodo(fn, 'distrinando')).noLlego)).toEqual(['F-0039-00283124|RBK1100033527']);
    expect((await leerTodo(fn, 'id')).noLlego).toEqual({});
    await aplicar(fn, { ...c, accion: 'marcarNoLlego', noLlego: false });
    expect((await leerTodo(fn, 'distrinando')).noLlego).toEqual({});
    await expect(aplicar(fn, { ...c, codigo: 'mal código', accion: 'marcarNoLlego', noLlego: true })).rejects.toThrow(/Código inválido/);
  });

  it('dar por cerrada o volver a abrir una entrega; borrar la factura lo borra', async () => {
    const { fn } = memoria();
    const c = { proveedor: 'id', entregaId: 'F-0016-00006405' };
    await aplicar(fn, { ...c, accion: 'archivarEntrega', estado: 'cerrada' });
    expect((await leerTodo(fn, 'id')).archivo[c.entregaId]).toMatchObject({ estado: 'cerrada' });
    await aplicar(fn, { ...c, accion: 'archivarEntrega', estado: 'abierta' });
    expect((await leerTodo(fn, 'id')).archivo[c.entregaId]).toMatchObject({ estado: 'abierta' });
    await expect(aplicar(fn, { ...c, accion: 'archivarEntrega', estado: 'otra' })).rejects.toThrow(/Estado inválido/);
    await expect(aplicar(fn, { ...c, accion: 'archivarEntrega', entregaId: '../x', estado: 'cerrada' })).rejects.toThrow();
    await aplicar(fn, { proveedor: 'id', accion: 'borrarFactura', id: c.entregaId });
    expect((await leerTodo(fn, 'id')).archivo).toEqual({});
  });
});

describe('Registro de cargas en Shopify (11-nov-2026)', () => {
  const entrega = { id: 'E-2026-11-10-x', nombre: 'Planilla (foto)', fecha: '2026-11-10', origen: 'foto', renglones: [] };
  const base = { proveedor: 'family', entregaId: entrega.id };
  async function preparar() {
    const m = memoria();
    await aplicar(m.fn, { proveedor: 'family', accion: 'guardarEntrega', entrega });
    await aplicar(m.fn, { proveedor: 'family', accion: 'guardarRemito', facturaId: entrega.id, remito: { numero: '0001-00002716', renglones: [{ codigo: 'BFRMCPC29', cantidad: 8 }] } });
    return m;
  }

  it('cada carga terminada queda anotada una sola vez, con remito, entrega y talles, y sobrevive al borrado de la entrega', async () => {
    const { fn } = await preparar();
    const c = { ...base, codigo: 'BFRMCPC29' };
    await aplicar(fn, { ...c, accion: 'reservarCarga', firma: '2026-11-10|BFRMCPC29|8|L:2,M:2,S:1,XL:2,XXL:1', detalle: { accion: 'alta', titulo: 'Remera Familyarg Panchart Cry Regular Ladrillo' } });
    // Mientras está «en curso» no figura en el registro como carga terminada.
    expect((await leerRegistro(fn)).eventos[0]).toMatchObject({ estado: 'en curso', deMarca: true });
    await aplicar(fn, { ...c, accion: 'terminarCarga', estado: 'cargada', detalle: { productoId: 'gid://shopify/Product/5', unidades: 8, talles: [{ talle: 'S', cantidad: 1 }, { talle: 'XXL', cantidad: 1 }], mensaje: 'Creado' } });
    // Un segundo «terminar» (reintento) no la anota dos veces.
    await aplicar(fn, { ...c, accion: 'terminarCarga', estado: 'cargada', detalle: {} });
    await aplicar(fn, { proveedor: 'family', accion: 'borrarEntrega', id: entrega.id });
    const { eventos, completo } = await leerRegistro(fn);
    expect(completo).toBe(true);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: 'carga', proveedor: 'family', entregaId: entrega.id, codigo: 'BFRMCPC29', estado: 'cargada', accion: 'alta',
      entrega: { fecha: '2026-11-10', nombre: 'Planilla (foto)' }, remito: '0001-00002716', factura: '',
      titulo: 'Remera Familyarg Panchart Cry Regular Ladrillo', productoId: 'gid://shopify/Product/5', unidades: 8,
      talles: [{ talle: 'S', cantidad: 1 }, { talle: 'XXL', cantidad: 1 }],
    });
    expect(eventos[0].deMarca).toBeUndefined();
  });

  it('liberar a mano se anota; la liberación automática (Shopify rechazó la carga) no', async () => {
    const { fn } = await preparar();
    await aplicar(fn, { ...base, codigo: 'BFRMCSD01', accion: 'reservarCarga', firma: 'f' });
    await aplicar(fn, { ...base, codigo: 'BFRMCSD01', accion: 'liberarCarga' });
    expect((await leerRegistro(fn)).eventos).toEqual([]);
    await aplicar(fn, { ...base, codigo: 'BFRMCSD15', accion: 'reservarCarga', firma: '2026-11-10|BFRMCSD15|8|S:1', detalle: { accion: 'alta', titulo: 'Remera Arboleda' } });
    await aplicar(fn, { ...base, codigo: 'BFRMCSD15', accion: 'terminarCarga', estado: 'dudosa', detalle: { mensaje: 'No sé si se creó' } });
    await aplicar(fn, { ...base, codigo: 'BFRMCSD15', accion: 'liberarCarga', manual: true });
    const { eventos } = await leerRegistro(fn);
    expect(eventos.map((e) => [e.tipo, e.estado])).toEqual([['liberada', 'dudosa'], ['carga', 'dudosa']]);
    expect(eventos[0]).toMatchObject({ codigo: 'BFRMCSD15', remito: '0001-00002716', titulo: 'Remera Arboleda' });
    expect(eventos[0].mensaje).toMatch(/liberada a mano/);
    // Liberar a mano algo que ya no tiene marca no inventa un evento.
    await aplicar(fn, { ...base, codigo: 'BFRMCSD15', accion: 'liberarCarga', manual: true });
    expect((await leerRegistro(fn)).eventos).toHaveLength(2);
  });

  it('las cargas de antes del registro se arman con su marca: fecha y talles de la firma, remito de la entrega', async () => {
    const { db, fn } = await preparar();
    const vieja = { estado: 'cargada', fecha: '2026-11-11T19:20:58.000Z', firma: '2026-10-30|GSKPT23|10|L:2,M:2,S:1,XL:2,XXL:2,XXXL:1', detalle: { accion: 'alta', productoId: 'gid://shopify/Product/15571635142899', titulo: 'Pantalon Familyarg Garage', unidades: 10 } };
    db.set('cf:family:cargas', new Map([[`${entrega.id}|GSKPT23`, JSON.stringify(vieja)], ['E-borrada|SHBSPEC', JSON.stringify({ ...vieja, fecha: '2026-11-11T19:20:55.000Z', firma: '2026-10-30|SHBSPEC|20|S:2' })]]));
    const { eventos } = await leerRegistro(fn);
    expect(eventos.map((e) => e.codigo)).toEqual(['GSKPT23', 'SHBSPEC']);
    expect(eventos[0]).toMatchObject({ tipo: 'carga', deMarca: true, hora: vieja.fecha, estado: 'cargada', remito: '0001-00002716', unidades: 10, entrega: { fecha: '2026-10-30', nombre: 'Planilla (foto)' } });
    expect(eventos[0].talles).toContainEqual({ talle: 'XXXL', cantidad: 1 });
    // Entrega borrada: igual figura, sin remito.
    expect(eventos[1]).toMatchObject({ entregaId: 'E-borrada', remito: '', entrega: { fecha: '2026-10-30', nombre: '' }, talles: [{ talle: 'S', cantidad: 2 }] });
  });

  it('el registro se lee solo con sesión iniciada', async () => {
    const r = { headers: {}, code: 0, body: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
    await handler({ method: 'GET', headers: {}, query: { registro: '1' } }, r);
    expect(r.code).toBe(401);
  });
});

describe('Enlaces rápidos a planillas propias (11-nov-2026)', () => {
  const url = 'https://docs.google.com/spreadsheets/d/ABC123/edit?usp=sharing';
  const guardar = (fn, enlaces, antes) => aplicar(fn, { accion: 'guardarEnlaces', enlaces, antes });
  it('guarda y lee los enlaces: solo https, sin usuario ni clave, hasta 5, sin pisar la configuración de los proveedores', async () => {
    const { fn, db } = memoria();
    expect(await leerEnlaces(fn)).toEqual({ enlaces: [] });
    const r = await guardar(fn, [{ nombre: '  Control de ingreso   de mercadería ', url: `  ${url} ` }], []);
    const uno = [{ nombre: 'Control de ingreso de mercadería', url }];
    expect(r.enlaces).toEqual(uno);
    expect(await leerEnlaces(fn)).toEqual({ enlaces: uno });
    await aplicar(fn, { proveedor: 'id', accion: 'guardarConfig', config: { condicionesPago: '30 días' } });
    expect((await leerTodo(fn, 'id')).config).toEqual({ condicionesPago: '30 días' });
    expect((await leerEnlaces(fn)).enlaces).toHaveLength(1);
    for (const mala of ['javascript:alert(1)', 'http://docs.google.com/x', 'https://yo:clave@docs.google.com/x', 'no es un enlace', '', `https://x.com/${'a'.repeat(500)}`]) {
      await expect(guardar(fn, [{ nombre: 'x', url: mala }], uno)).rejects.toThrow();
    }
    await expect(guardar(fn, Array.from({ length: 6 }, () => ({ url })), uno)).rejects.toThrow(/hasta 5/);
    await expect(aplicar(fn, { accion: 'guardarEnlaces', enlaces: 'x', antes: uno })).rejects.toThrow(/Faltan/);
    await expect(aplicar(fn, { accion: 'guardarEnlaces', enlaces: [] })).rejects.toThrow(/Faltan/);
    // Lo rechazado no cambió nada.
    expect((await leerEnlaces(fn)).enlaces).toEqual(uno);
    expect((await guardar(fn, [{ url }], uno)).enlaces[0].nombre).toBe('Planilla');
    await guardar(fn, [], [{ nombre: 'Planilla', url }]);
    expect(await leerEnlaces(fn)).toEqual({ enlaces: [] });
    // Un valor dañado en la base no rompe la pantalla.
    db.get('cf:config').set('enlaces', '{roto');
    expect(await leerEnlaces(fn)).toEqual({ enlaces: [] });
  });

  it('no pisa enlaces que se agregaron desde otra pantalla mientras se editaba', async () => {
    const { fn } = memoria();
    const a = { nombre: 'Control de ingreso de mercadería', url };
    const b = { nombre: 'Otra', url: 'https://docs.google.com/spreadsheets/d/OTRA/edit' };
    await guardar(fn, [a], []);
    // La computadora 1 leyó [a]; la 2 agrega b.
    await guardar(fn, [a, b], [a]);
    // La 1 guarda a partir de lo que había leído: se rechaza y b sigue.
    await expect(guardar(fn, [{ ...a, nombre: 'Ingreso' }], [a])).rejects.toThrow(/cambiaron/);
    expect((await leerEnlaces(fn)).enlaces).toEqual([a, b]);
    // Una pantalla que no pudo leer (y cree que no hay ninguno) tampoco puede borrarlos.
    await expect(guardar(fn, [a], [])).rejects.toThrow(/cambiaron/);
    expect((await leerEnlaces(fn)).enlaces).toEqual([a, b]);
  });

  it('se leen solo con sesión iniciada', async () => {
    const r = { headers: {}, code: 0, body: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
    await handler({ method: 'GET', headers: {}, query: { enlaces: '1' } }, r);
    expect(r.code).toBe(401);
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

  describe('claves de la base con caracteres de más (11-nov-2026)', () => {
    const TOKEN = 'AX' + 'y'.repeat(40);
    afterEach(() => vi.unstubAllGlobals());
    /** Como fetch de verdad: Node valida el encabezado antes de mandar nada. */
    const real = () => vi.fn(async (url, opts) => { new Headers(opts.headers); return { ok: true, json: async () => [{ result: 1 }] }; });

    it('se limpian espacios, saltos de línea y comillas de los costados', async () => {
      vi.stubEnv('KV_REST_API_URL', ' "https://db.example/"\n');
      vi.stubEnv('KV_REST_API_TOKEN', `\n${TOKEN}\r\n`);
      const f = real();
      expect(await kv([['GET', 'k']], f)).toEqual([1]);
      expect(f.mock.calls[0][0]).toBe('https://db.example/pipeline');
      expect(f.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('un token partido en dos renglones no aparece en el error ni en la respuesta', async () => {
      vi.stubEnv('KV_REST_API_URL', 'https://db.example');
      vi.stubEnv('KV_REST_API_TOKEN', `${TOKEN.slice(0, 20)}\n${TOKEN.slice(20)}`);
      const e = await kv([['GET', 'k']], real()).catch((x) => x);
      expect(e.status).toBe(503);
      expect(e.message).toMatch(/KV_REST_API_URL o KV_REST_API_TOKEN en Vercel tienen un formato inválido/);
      expect(e.message).not.toContain(TOKEN.slice(0, 20));
      // Por el endpoint, con sesión: lo que llega al navegador tampoco trae la clave.
      vi.stubEnv('APP_ACCESS_KEY', 's'.repeat(40));
      vi.stubGlobal('fetch', real());
      const r = res();
      await handler({ method: 'GET', headers: { cookie: `${COOKIE}=${makeSession()}` }, query: { proveedor: 'id' } }, r);
      expect(r.code).toBe(503);
      expect(JSON.stringify(r.body)).not.toContain(TOKEN.slice(0, 20));
      expect(JSON.stringify(r.body)).not.toContain(TOKEN.slice(20));
    });

    it('un corte de red se informa como pasajero, sin el motivo crudo', async () => {
      vi.stubEnv('KV_REST_API_URL', 'https://db.example');
      vi.stubEnv('KV_REST_API_TOKEN', TOKEN);
      const e = await kv([['GET', 'k']], vi.fn(async () => { throw new TypeError(`fetch failed Bearer ${TOKEN}`); })).catch((x) => x);
      expect(e.status).toBe(502);
      expect(e.message).toMatch(/No me pude conectar con la base de datos/);
      expect(e.message).not.toContain(TOKEN);
      vi.stubEnv('KV_REST_API_URL', 'db.example sin https');
      const u = await kv([['GET', 'k']], fetch).catch((x) => x);
      expect(u.status).toBe(503);
    });

    it('si la base contesta con la clave adentro, se tapa', async () => {
      vi.stubEnv('KV_REST_API_URL', 'https://db.example');
      vi.stubEnv('KV_REST_API_TOKEN', TOKEN);
      vi.stubEnv('APP_ACCESS_KEY', 's'.repeat(40));
      vi.stubGlobal('fetch', vi.fn(async (url, opts) => ({ ok: true, json: async () => JSON.parse(opts.body).map(() => ({ error: `WRONGPASS invalid token ${TOKEN}` })) })));
      const r = res();
      await handler({ method: 'GET', headers: { cookie: `${COOKIE}=${makeSession()}` }, query: { proveedor: 'id' } }, r);
      expect(r.code).toBe(502);
      expect(r.body.error).toMatch(/Error de la base de datos/);
      expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    });
  });
});

describe('listas de pedidos pendientes en Trello (11-nov-2026)', () => {
  const A = 'a'.repeat(24), B = 'b'.repeat(24);
  it('guarda en qué lista está cada tarjeta, por proveedor, y las listas elegidas para todo el tablero', async () => {
    const { fn } = memoria();
    let t = await leerTodo(fn, 'id');
    expect(t.tarjetasTrello).toEqual({});
    expect(t.listasTrello).toEqual([]);
    await aplicar(fn, { proveedor: 'id', accion: 'guardarTarjetas', tarjetas: {
      [A]: { pendiente: true, visto: false, fuera: '2026-11-11', lista: 'PEDIDOS PENDIENTES' },
      [B]: { pendiente: false, visto: false, fuera: '2026-11-12', lista: 'RECIBIDOS' },
    } });
    t = await leerTodo(fn, 'id');
    // Adentro: visto y sin fecha de salida.
    expect(t.tarjetasTrello[A]).toEqual({ pendiente: true, visto: true, fuera: '', lista: 'PEDIDOS PENDIENTES' });
    expect(t.tarjetasTrello[B]).toEqual({ pendiente: false, visto: false, fuera: '2026-11-12', lista: 'RECIBIDOS' });
    expect((await leerTodo(fn, 'distrinando')).tarjetasTrello).toEqual({});
    await aplicar(fn, { accion: 'guardarListasTrello', listas: [A, A, B] });
    expect((await leerTodo(fn, 'distrinando')).listasTrello).toEqual([A, B]);
    await aplicar(fn, { accion: 'guardarListasTrello', listas: [] });
    expect((await leerTodo(fn, 'id')).listasTrello).toEqual([]);
    // Family sigue leyendo sus cargas en su lugar.
    await aplicar(fn, { proveedor: 'family', accion: 'reservarCarga', entregaId: 'E-1', codigo: 'X1', firma: 'f' });
    expect(Object.keys((await leerTodo(fn, 'family')).cargas)).toEqual(['E-1|X1']);
  });

  it('rechaza tarjetas o listas inválidas', async () => {
    const { fn } = memoria();
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarTarjetas', tarjetas: { x: { pendiente: true } } })).rejects.toThrow(/inválida/);
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarTarjetas', tarjetas: {} })).rejects.toThrow(/inválida/);
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarTarjetas', tarjetas: [] })).rejects.toThrow(/inválidas/);
    await expect(aplicar(fn, { proveedor: 'id', accion: 'guardarTarjetas', tarjetas: { [A]: { pendiente: false, fuera: 'ayer' } } })).rejects.toThrow(/Fecha/);
    await expect(aplicar(fn, { accion: 'guardarListasTrello', listas: ['PEDIDOS'] })).rejects.toThrow(/inválida/);
  });
});

describe('nota con lo marcado en verde y sus copias en Trello (12-nov-2026)', () => {
  it('guarda la celda, lo entregado y las copias; descarta lo inválido', async () => {
    const { limpiarPedido } = await import('./control-facturas.js');
    const T = 'c'.repeat(24), A = 'd'.repeat(24);
    const p = limpiarPedido({
      id: 'T-' + A, nombre: 'n', fecha: '2026-10-19', lector: 5,
      copias: [{ tarjeta: T, adjunto: A, fecha: '2026-10-23', nombre: 'INDU-19-10.xlsx' }],
      lineas: [
        { sku: 'A-40', codigo: 'A', talle: '40', cantidad: 2, celda: 'H4', celdaTotal: 'S4', entregado: 2, entregadoDesde: '2026-10-23' },
        { sku: 'A-41', codigo: 'A', talle: '41', cantidad: 1, celda: 'H4; DROP', entregado: 0 },
      ],
    });
    expect(p.lineas[0]).toMatchObject({ celda: 'H4', celdaTotal: 'S4', entregado: 2, entregadoDesde: '2026-10-23' });
    expect(p.lineas[1].celda).toBeUndefined();
    expect(p.lineas[1].entregado).toBeUndefined();
    expect(p.lector).toBe(5);
    expect(p.copias).toEqual([{ tarjeta: T, adjunto: A, fecha: '2026-10-23', nombre: 'INDU-19-10.xlsx' }]);
    expect(() => limpiarPedido({ id: 'x', lineas: [], copias: [{ tarjeta: '../x', adjunto: A }] })).toThrow(/Copia/);
    expect(() => limpiarPedido({ id: 'x', lineas: [{ sku: 'a', entregado: 1, entregadoDesde: 'ayer' }] })).toThrow(/Fecha/);
  });
});

describe('mails del aviso de cambio de precio (12-nov-2026)', () => {
  it('se guardan en la base, para todos los proveedores, sin repetir ni pisar las cargas', async () => {
    const { fn } = memoria();
    expect((await leerTodo(fn, 'id')).mailsAviso).toEqual({ para: [], copia: [] });
    await aplicar(fn, { accion: 'guardarMailsAviso', para: [' Deposito@Example.com ', 'deposito@example.com'], copia: ['jefa@example.com.ar', 'deposito@example.com'] });
    expect((await leerTodo(fn, 'id')).mailsAviso).toEqual({ para: ['deposito@example.com'], copia: ['jefa@example.com.ar'] });
    expect((await leerTodo(fn, 'family')).mailsAviso.para).toEqual(['deposito@example.com']);
    await aplicar(fn, { proveedor: 'id', accion: 'reservarCarga', entregaId: 'E-1', codigo: 'X1', firma: 'f' });
    expect(Object.keys((await leerTodo(fn, 'id')).cargas)).toEqual(['E-1|X1']);
    await aplicar(fn, { accion: 'guardarMailsAviso', para: [], copia: [] });
    expect((await leerTodo(fn, 'id')).mailsAviso).toEqual({ para: [], copia: [] });
  });
  it('rechaza direcciones inválidas o un mail sin destinatario', async () => {
    const { fn } = memoria();
    await expect(aplicar(fn, { accion: 'guardarMailsAviso', para: ['no es mail'], copia: [] })).rejects.toThrow(/no es una dirección/);
    await expect(aplicar(fn, { accion: 'guardarMailsAviso', para: ['a@b.com,c@d.com'], copia: [] })).rejects.toThrow(/no es una dirección/);
    await expect(aplicar(fn, { accion: 'guardarMailsAviso', para: [], copia: ['a@b.com'] })).rejects.toThrow(/Para/);
    await expect(aplicar(fn, { accion: 'guardarMailsAviso', para: Array(6).fill('a@b.com'), copia: [] })).rejects.toThrow(/Hasta/);
  });
});
