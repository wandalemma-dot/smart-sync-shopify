// ============================================================================
// ASISTENTE DE IA — núcleo del servidor (lo usa api/asistente.js)
// ----------------------------------------------------------------------------
// 9-nov-2026, pedido de gax: un asistente dentro de la app para ayudar con la
// carga de stock, costos ponderados, órdenes pendientes y control de remito /
// factura / nota de pedido. Empieza con iD (Converse y Le Coq); el conocimiento
// de cada marca vive en server/conocimiento/.
//
// 🔴 SOLO LECTURA. Las herramientas consultan Shopify con queries; no hay
// ninguna mutación acá. Si algún día se quiere que escriba, va por los botones
// existentes con confirmación humana, nunca desde el modelo.
// ============================================================================
import Anthropic from '@anthropic-ai/sdk';
import { MARCAS_ASISTENTE, PROVEEDORES_ASISTENTE, SUCURSAL_PROPIA, instruccionesMarca } from './conocimiento/index.js';
import { compararDocumentos, costoPonderado } from './asistente-calculos.js';
import { obtenerToken } from './shopify-token.js';
import { inspectReadQuery } from './read-policy.js';

const SHOP_URL = 'https://indy-com-ar.myshopify.com/admin/api/2026-07/graphql.json';
export const MODELO_POR_DEFECTO = 'claude-opus-5-5';
const MAX_VUELTAS = 8;

// ---------------------------------------------------------------- Shopify
export async function consultarShopify(query, variables) {
  inspectReadQuery(query); // garantía extra: jamás una mutación
  const token = await obtenerToken();
  const r = await fetch(SHOP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  if (!r.ok) throw new Error(`Shopify respondió ${r.status}.`);
  const data = await r.json();
  if (data.errors?.length) throw new Error('Shopify: ' + data.errors.map(e => e.message).join('; '));
  return data.data;
}

const PRODUCTOS = `query AsistenteProductos($q: String!) {
  products(first: 4, query: $q) {
    nodes { id title vendor status tags
      variants(first: 40) { nodes { title sku barcode price
        inventoryItem { unitCost { amount }
          inventoryLevels(first: 5) { nodes { location { name } quantities(names: ["available", "committed", "incoming"]) { name quantity } } } } } }
    }
  }
}`;

const SUCURSALES = `query AsistenteSucursales { locations(first: 50) { nodes { id name } } }`;

const PENDIENTES = `query AsistentePendientes($q: String!, $after: String) {
  fulfillmentOrders(first: 25, after: $after, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { status
      order { name cancelledAt closed displayFinancialStatus tags }
      lineItems(first: 30) { nodes { remainingQuantity sku productTitle variantTitle vendor } }
    }
  }
}`;

const comillas = s => String(s).replace(/["\\]/g, ' ').trim();
const esCodigo = s => /^[A-Z0-9][A-Z0-9-]{4,}$/i.test(s.trim()) && /\d/.test(s);

export async function buscarProducto({ texto }, marca) {
  const t = String(texto || '').trim();
  if (!t) throw new Error('Falta el código o nombre a buscar.');
  const vendor = MARCAS_ASISTENTE[marca].vendor;
  const codigo = t.split('-')[0];
  const filtro = esCodigo(t) ? `(tag:"${comillas(codigo)}" OR sku:${comillas(codigo)}*)` : `title:*${comillas(t)}*`;
  const data = await consultarShopify(PRODUCTOS, { q: `${filtro} AND vendor:"${comillas(vendor)}"` });
  const productos = data.products.nodes.map(p => ({
    titulo: p.title, estado: p.status,
    etiquetas_tabla: p.tags.filter(x => /^TABLA DE TALLE/i.test(x)),
    codigos: p.tags.filter(x => /^[A-Z0-9]{6,}$/i.test(x) && /\d/.test(x)),
    no_sincronizar: p.tags.some(x => x.trim().toUpperCase() === 'NO SINCRONIZAR'),
    variantes: p.variants.nodes.map(v => {
      const stock = {};
      for (const lvl of v.inventoryItem?.inventoryLevels?.nodes || []) {
        stock[lvl.location.name] = Object.fromEntries(lvl.quantities.map(q => [q.name, q.quantity]));
      }
      return { talle: v.title, sku: v.sku, barcode: v.barcode, precio: Number(v.price),
        costo: v.inventoryItem?.unitCost ? Number(v.inventoryItem.unitCost.amount) : null,
        stock_por_sucursal: stock };
    }),
  }));
  return { encontrados: productos.length, aviso: productos.length === 4 ? 'Puede haber más productos: afiná la búsqueda.' : undefined,
    nota: 'Una sucursal que no figura en stock_por_sucursal significa que la variante no está dada de alta ahí (no es cero).', productos };
}

const EXCLUIR_ETIQUETAS = ['solucionar', 'pedido id'];
export async function ordenesPendientes(_input, marca) {
  const { sucursal } = PROVEEDORES_ASISTENTE[MARCAS_ASISTENTE[marca].proveedor];
  const locs = (await consultarShopify(SUCURSALES)).locations.nodes;
  const loc = locs.find(l => l.name.trim().toUpperCase() === sucursal.toUpperCase());
  if (!loc) throw new Error(`No encontré la sucursal «${sucursal}» en Shopify.`);
  const num = loc.id.split('/').pop();
  const q = `assigned_location_id:${num} AND (status:open OR status:in_progress)`;
  const vendor = MARCAS_ASISTENTE[marca].vendor.toUpperCase();
  const lineas = [], excluidas = new Map();
  let after = null;
  for (let pagina = 0; pagina < 12; pagina++) {
    const d = (await consultarShopify(PENDIENTES, { q, after })).fulfillmentOrders;
    for (const fo of d.nodes) {
      const o = fo.order;
      const tags = o.tags.map(t => t.trim().toLowerCase());
      const motivo = o.cancelledAt ? 'cancelada' : o.closed ? 'cerrada'
        : !['PAID', 'PARTIALLY_REFUNDED'].includes(o.displayFinancialStatus) ? `pago: ${o.displayFinancialStatus}`
          : EXCLUIR_ETIQUETAS.find(t => tags.includes(t)) ? `etiqueta «${EXCLUIR_ETIQUETAS.find(t => tags.includes(t))}»` : null;
      const propias = fo.lineItems.nodes.filter(l => l.remainingQuantity > 0 && String(l.vendor || '').toUpperCase() === vendor);
      if (!propias.length) continue;
      if (motivo) { excluidas.set(o.name, motivo); continue; }
      for (const l of propias) lineas.push({ orden: o.name, producto: l.productTitle, talle: l.variantTitle, sku: l.sku, pendientes: l.remainingQuantity });
    }
    if (!d.pageInfo.hasNextPage) { after = null; break; }
    after = d.pageInfo.endCursor;
  }
  return {
    sucursal, marca: MARCAS_ASISTENTE[marca].nombre,
    completo: after === null,
    aviso: after === null ? undefined : 'Hay más preparaciones de las que se leyeron: el listado está INCOMPLETO.',
    unidades_pendientes: lineas.reduce((s, l) => s + l.pendientes, 0),
    lineas,
    ordenes_excluidas: [...excluidas].map(([orden, motivo]) => ({ orden, motivo })),
  };
}

// ---------------------------------------------------------------- herramientas
const renglon = {
  type: 'object',
  properties: {
    codigo: { type: 'string', description: 'Código del artículo tal cual el documento (ej. A12975C-055, LFO0125241).' },
    talle: { type: 'string', description: 'Talle si el documento lo trae por separado; vacío si no.' },
    descripcion: { type: 'string' },
    cantidad: { type: 'number' },
    costo_unitario: { type: 'number', description: 'Costo o precio unitario sin IVA, si figura.' },
  },
  required: ['codigo', 'cantidad'],
};
const documento = {
  type: 'object',
  properties: {
    nombre: { type: 'string', description: 'Nombre corto: «remito», «factura», «nota de pedido», «orden de compra».' },
    total_impreso: { type: 'number', description: 'Total de unidades impreso en el documento, si figura.' },
    renglones: { type: 'array', items: renglon },
  },
  required: ['nombre', 'renglones'],
};

export const HERRAMIENTAS = [
  { name: 'buscar_producto',
    description: 'Busca en Shopify un producto de la marca elegida por código de modelo (etiqueta/SKU) o por nombre. Devuelve talles, SKU, precio, costo y stock por sucursal (Martínez e iD). Solo lectura.',
    input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } },
  { name: 'ordenes_pendientes',
    description: 'Lista las órdenes con unidades pendientes de preparar en la sucursal del proveedor (iD) para la marca elegida, ya filtradas por las reglas de la tienda. Solo lectura.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'costo_ponderado',
    description: 'Calcula el costo promedio ponderado exacto (con centavos) al recibir mercadería en Martínez.',
    input_schema: { type: 'object', properties: {
      stock_actual: { type: 'number', description: 'Unidades disponibles hoy en DEPOSITO MARTINEZ, antes de cargar lo recibido.' },
      costo_actual: { type: 'number', description: 'Costo guardado hoy en Shopify.' },
      unidades_nuevas: { type: 'number' }, costo_nuevo: { type: 'number', description: 'Costo unitario de la factura, sin IVA.' },
    }, required: ['stock_actual', 'costo_actual', 'unidades_nuevas', 'costo_nuevo'] } },
  { name: 'comparar_documentos',
    description: 'Compara dos documentos renglón por renglón (código + talle): cantidades y costos. Usala para remito contra factura, factura contra nota de pedido, u orden de compra contra factura. Pasá TODOS los renglones leídos.',
    input_schema: { type: 'object', properties: { a: documento, b: documento }, required: ['a', 'b'] } },
];

export async function ejecutarHerramienta(nombre, input, marca) {
  switch (nombre) {
    case 'buscar_producto': return buscarProducto(input, marca);
    case 'ordenes_pendientes': return ordenesPendientes(input, marca);
    case 'costo_ponderado': return costoPonderado(input);
    case 'comparar_documentos': return compararDocumentos(input.a, input.b);
    default: throw new Error('Herramienta desconocida.');
  }
}

// ---------------------------------------------------------------- mensajes
const LIMITE_TEXTO = 400000;
/** Arma los mensajes para Claude a partir de lo que manda la pantalla. Valida todo. */
export function armarMensajes(turnos) {
  if (!Array.isArray(turnos) || !turnos.length || turnos.length > 40) throw new Error('Conversación inválida.');
  let texto = 0;
  const mensajes = turnos.map((t, i) => {
    const rol = i % 2 === 0 ? 'user' : 'assistant';
    if (t?.rol !== rol || typeof t.texto !== 'string' || !t.texto.trim()) throw new Error('Conversación inválida.');
    texto += t.texto.length;
    if (rol === 'assistant') return { role: rol, content: t.texto };
    const content = [];
    for (const adj of Array.isArray(t.adjuntos) ? t.adjuntos.slice(0, 10) : []) {
      const nombre = String(adj?.nombre || 'archivo').slice(0, 120);
      if (adj?.tipo === 'texto' && typeof adj.datos === 'string') {
        texto += adj.datos.length;
        content.push({ type: 'text', text: `<documento nombre="${nombre.replace(/"/g, '')}">\n${adj.datos}\n</documento>` });
      } else if (adj?.tipo === 'pdf' && typeof adj.datos === 'string') {
        content.push({ type: 'document', title: nombre, source: { type: 'base64', media_type: 'application/pdf', data: adj.datos } });
      } else if (adj?.tipo === 'imagen' && typeof adj.datos === 'string' && ['image/jpeg', 'image/png', 'image/webp'].includes(adj.media)) {
        content.push({ type: 'text', text: `Imagen: ${nombre}` });
        content.push({ type: 'image', source: { type: 'base64', media_type: adj.media, data: adj.datos } });
      } else throw new Error('Adjunto inválido.');
    }
    content.push({ type: 'text', text: t.texto });
    return { role: rol, content };
  });
  if (texto > LIMITE_TEXTO) throw new Error('La conversación es demasiado larga. Empezá una nueva.');
  if (mensajes[mensajes.length - 1].role !== 'user') throw new Error('Conversación inválida.');
  return mensajes;
}

// ---------------------------------------------------------------- conversación
/**
 * Corre la conversación con herramientas hasta que Claude responde.
 * `cliente` se inyecta en los tests para no llamar a la API real.
 */
export async function conversar({ marca, turnos, cliente, ejecutar = ejecutarHerramienta }) {
  if (!MARCAS_ASISTENTE[marca]) throw new Error('Marca no habilitada en el asistente.');
  const client = cliente || new Anthropic();
  const mensajes = armarMensajes(turnos);
  const herramientasUsadas = [];
  const system = [{ type: 'text', text: instruccionesMarca(marca), cache_control: { type: 'ephemeral' } }];
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const respuesta = await client.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || MODELO_POR_DEFECTO,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: process.env.ANTHROPIC_EFFORT || 'medium' },
      cache_control: { type: 'ephemeral' },
      system,
      tools: HERRAMIENTAS,
      messages: mensajes,
    });
    if (respuesta.stop_reason === 'refusal') {
      return { texto: 'No pude responder esa consulta. Probá reformularla.', herramientas: herramientasUsadas };
    }
    if (respuesta.stop_reason !== 'tool_use') {
      const texto = respuesta.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const cortado = respuesta.stop_reason === 'max_tokens' ? '\n\n⚠️ La respuesta quedó cortada por largo.' : '';
      return { texto: (texto || 'No obtuve respuesta.') + cortado, herramientas: herramientasUsadas };
    }
    mensajes.push({ role: 'assistant', content: respuesta.content });
    const resultados = await Promise.all(respuesta.content.filter(b => b.type === 'tool_use').map(async b => {
      herramientasUsadas.push(b.name);
      try {
        return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await ejecutar(b.name, b.input || {}, marca)) };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: b.id, is_error: true, content: e instanceof Error ? e.message : 'Error' };
      }
    }));
    mensajes.push({ role: 'user', content: resultados });
  }
  return { texto: '⚠️ La consulta necesitó demasiados pasos. Probá dividirla en preguntas más chicas.', herramientas: herramientasUsadas };
}

export function marcasDisponibles() {
  return Object.entries(MARCAS_ASISTENTE).map(([id, m]) => ({ id, nombre: m.nombre, proveedor: PROVEEDORES_ASISTENTE[m.proveedor].nombre }));
}
export { SUCURSAL_PROPIA };
