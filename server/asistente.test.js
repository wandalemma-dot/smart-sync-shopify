import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/asistente.js';
import { COOKIE, makeSession } from './access.js';
import { compararDocumentos, costoPonderado } from './asistente-calculos.js';
import { armarMensajes, conversar, HERRAMIENTAS, buscarProducto, ordenesPendientes } from './asistente.js';
import { MARCAS_ASISTENTE, PROVEEDORES_ASISTENTE, instruccionesMarca } from './conocimiento/index.js';

const origin = 'https://smart-sync-shopify.vercel.app';
const botKey = 'bot-test-only-'.padEnd(48, 'b');
function response() {
  return { statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; } };
}
async function run({ method = 'POST', headers, body } = {}) {
  const res = response();
  await handler({ method, headers: { 'content-type': 'application/json', ...headers }, body }, res);
  return res;
}
const humano = () => ({ origin, cookie: `${COOKIE}=${makeSession()}` });
beforeEach(() => {
  vi.stubEnv('APP_ACCESS_KEY', 'user-test-only-'.padEnd(48, 'a'));
  vi.stubEnv('AUTOMATION_READ_TOKEN', botKey);
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('SHOPIFY_CLIENT_ID', ''); vi.stubEnv('SHOPIFY_CLIENT_SECRET', '');
  vi.stubEnv('SHOPIFY_ADMIN_TOKEN', 'shpat_test');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('acceso al asistente', () => {
  it('rechaza sin sesión y rechaza el token del bot', async () => {
    expect((await run({ headers: { origin } })).statusCode).toBe(401);
    expect((await run({ headers: { origin, authorization: `Bearer ${botKey}` } })).statusCode).toBe(401);
  });
  it('rechaza otro origen', async () => {
    expect((await run({ headers: { ...humano(), origin: 'https://otro.example' } })).statusCode).toBe(403);
  });
  it('sin clave de Anthropic avisa qué falta', async () => {
    const r = await run({ headers: humano(), body: { marca: 'converse', turnos: [{ rol: 'user', texto: 'hola' }] } });
    expect(r.statusCode).toBe(503);
    expect(r.body.error).toMatch(/ANTHROPIC_API_KEY/);
    const g = await run({ method: 'GET', headers: humano() });
    expect(g.body).toMatchObject({ configurado: false });
    expect(g.body.marcas.map(m => m.id)).toEqual(['converse', 'lecoq']);
  });
});

describe('conocimiento por marca', () => {
  it('cada marca tiene proveedor, vendor y texto', () => {
    for (const [id, m] of Object.entries(MARCAS_ASISTENTE)) {
      expect(PROVEEDORES_ASISTENTE[m.proveedor], id).toBeTruthy();
      expect(m.vendor, id).toBeTruthy();
      expect(m.texto.length, id).toBeGreaterThan(100);
      expect(instruccionesMarca(id)).toContain('SOLO LECTURA');
    }
  });
  it('las reglas clave de iD están presentes', () => {
    expect(instruccionesMarca('converse')).toMatch(/lista − 10%/);
    expect(instruccionesMarca('lecoq')).toMatch(/UNO MENOS/);
  });
  it('no hay herramientas que escriban', () => {
    expect(HERRAMIENTAS.map(h => h.name).sort()).toEqual(['buscar_producto', 'comparar_documentos', 'costo_ponderado', 'ordenes_pendientes']);
  });
});

describe('comparar documentos', () => {
  const factura = { nombre: 'factura', total_impreso: 6, renglones: [
    { codigo: 'A12975C-055', cantidad: 3, costo_unitario: 67095.72 },
    { codigo: 'a12975c - 060', cantidad: 2, costo_unitario: 67095.72 },
    { codigo: 'A10520C-100', cantidad: 1, costo_unitario: 43272.19 },
  ] };
  it('detecta cantidad distinta, faltantes y costos en centavos', () => {
    const nota = { nombre: 'nota de pedido', renglones: [
      { codigo: 'A12975C-055', cantidad: 3, costo_unitario: '67.095,72' },
      { codigo: 'A12975C-060', cantidad: 1, costo_unitario: 67095.72 },
      { codigo: 'A10520C-100', cantidad: 1, costo_unitario: 43272.18 },
      { codigo: 'A14641C-110', cantidad: 4 },
    ] };
    const r = compararDocumentos(factura, nota);
    const por = Object.fromEntries(r.filas.map(f => [f.codigo, f.estado]));
    expect(por['A12975C-055']).toBe('coincide');
    expect(por['A12975C-060']).toBe('cantidad distinta');
    expect(por['A10520C-100']).toBe('costo distinto');
    expect(por['A14641C-110']).toBe('solo en nota de pedido');
    expect(r.todo_coincide).toBe(false);
  });
  it('avisa cuando la suma leída no da el total impreso', () => {
    const r = compararDocumentos({ ...factura, total_impreso: 7 }, factura);
    expect(r.avisos.join(' ')).toMatch(/no coincide con el total impreso/);
    expect(r.todo_coincide).toBe(false);
    expect(compararDocumentos(factura, factura).todo_coincide).toBe(true);
  });
  it('sin talles en un documento compara por código', () => {
    const a = { nombre: 'remito', renglones: [{ codigo: 'X1', talle: '40', cantidad: 2 }, { codigo: 'X1', talle: '41', cantidad: 1 }] };
    const b = { nombre: 'factura', renglones: [{ codigo: 'X1', cantidad: 3 }] };
    const r = compararDocumentos(a, b);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].estado).toBe('coincide');
    expect(r.avisos[0]).toMatch(/total por código/);
  });
});

describe('costo ponderado', () => {
  it('promedia con centavos', () => {
    expect(costoPonderado({ stock_actual: 2, costo_actual: 40000, unidades_nuevas: 3, costo_nuevo: 43267.38 }).costo_ponderado).toBe(41960.43);
  });
  it('sin stock usa el costo nuevo; costo desconocido no inventa', () => {
    expect(costoPonderado({ stock_actual: 0, costo_actual: 0, unidades_nuevas: 1, costo_nuevo: 100.5 }).costo_ponderado).toBe(100.5);
    expect(costoPonderado({ stock_actual: 3, costo_actual: 0, unidades_nuevas: 1, costo_nuevo: 100 }).costo_ponderado).toBeNull();
  });
});

describe('mensajes', () => {
  it('valida roles alternados y adjuntos', () => {
    expect(() => armarMensajes([{ rol: 'assistant', texto: 'x' }])).toThrow();
    expect(() => armarMensajes([{ rol: 'user', texto: 'x', adjuntos: [{ tipo: 'exe', datos: 'x' }] }])).toThrow();
    const m = armarMensajes([{ rol: 'user', texto: 'compará', adjuntos: [{ tipo: 'texto', nombre: 'nota.xlsx', datos: 'a,b' }] }]);
    expect(m[0].content[0].text).toContain('<documento nombre="nota.xlsx">');
  });
});

describe('conversación con herramientas', () => {
  it('ejecuta la herramienta y devuelve la respuesta final', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'costo_ponderado', input: { stock_actual: 1, costo_actual: 10, unidades_nuevas: 1, costo_nuevo: 20 } }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'El costo ponderado es $15,00.' }] });
    const r = await conversar({ marca: 'converse', turnos: [{ rol: 'user', texto: 'costo?' }], cliente: { beta: { messages: { create } } } });
    expect(r.texto).toBe('El costo ponderado es $15,00.');
    const segunda = create.mock.calls[1][0];
    const resultado = segunda.messages.at(-1).content[0];
    expect(JSON.parse(resultado.content).costo_ponderado).toBe(15);
    expect(segunda.system[0].text).toContain('Converse');
  });
});

describe('lecturas de Shopify', () => {
  function shopify(respuestas) {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      return { ok: true, json: async () => ({ data: respuestas(body) }) };
    }));
    return calls;
  }
  it('busca por código con filtro de marca y no confunde alta faltante con cero', async () => {
    const calls = shopify(() => ({ products: { nodes: [{ title: 'Converse X', vendor: 'Converse', status: 'ACTIVE', tags: ['A12975C', 'TABLA DE TALLE CONVERSE 2'],
      variants: { nodes: [{ title: '40', sku: 'A12975C-40', barcode: null, price: '99900.00', inventoryItem: { unitCost: { amount: '43267.38' },
        inventoryLevels: { nodes: [{ location: { name: 'DEPOSITO MARTINEZ' }, quantities: [{ name: 'available', quantity: 2 }] }] } } }] } }] } }));
    const r = await buscarProducto({ texto: 'A12975C-055' }, 'converse');
    expect(calls[0].variables.q).toBe('(tag:"A12975C" OR sku:A12975C*) AND vendor:"Converse"');
    expect(calls[0].query.trim().startsWith('query')).toBe(true);
    expect(r.productos[0].variantes[0].stock_por_sucursal).toEqual({ 'DEPOSITO MARTINEZ': { available: 2 } });
    expect(r.productos[0].etiquetas_tabla).toEqual(['TABLA DE TALLE CONVERSE 2']);
  });
  it('órdenes pendientes: solo la marca, excluye etiquetas y canceladas', async () => {
    shopify(body => body.query.includes('locations')
      ? { locations: { nodes: [{ id: 'gid://shopify/Location/7', name: 'ID (Converse - Le Coq Sportif)' }] } }
      : { fulfillmentOrders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
        { status: 'OPEN', order: { name: '#1', cancelledAt: null, closed: false, displayFinancialStatus: 'PAID', tags: [] },
          lineItems: { nodes: [{ remainingQuantity: 2, sku: 'A1', productTitle: 'Converse A', variantTitle: '40', vendor: 'Converse' },
            { remainingQuantity: 1, sku: 'L1', productTitle: 'Le Coq L', variantTitle: '41', vendor: 'Le Coq Sportif' }] } },
        { status: 'OPEN', order: { name: '#2', cancelledAt: null, closed: false, displayFinancialStatus: 'PAID', tags: ['Pedido ID'] },
          lineItems: { nodes: [{ remainingQuantity: 1, sku: 'A2', productTitle: 'Converse B', variantTitle: '39', vendor: 'Converse' }] } },
      ] } });
    const r = await ordenesPendientes({}, 'converse');
    expect(r.unidades_pendientes).toBe(2);
    expect(r.lineas.map(l => l.orden)).toEqual(['#1']);
    expect(r.ordenes_excluidas).toEqual([{ orden: '#2', motivo: 'etiqueta «pedido id»' }]);
    expect(r.completo).toBe(true);
  });
});
