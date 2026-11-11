// Control de facturas contra pedidos: guardado de pedidos, facturas, remitos,
// asignaciones manuales, recepción del depósito y condiciones de pago, por proveedor.
// Family (sin factura): planillas de entrega + remito, con la consulta a Shopify del momento.
// Los archivos se leen en el navegador; acá solo se valida y se guarda el JSON.
// No toca Shopify.
export const PROVEEDORES = ['distrinando', 'id', 'family'];
// «entregas»: planillas de Family (marketplace, sin factura). El resto, factura + remito + nota.
const TIPOS = ['pedidos', 'facturas', 'asignaciones', 'recepciones', 'remitos', 'entregas'];
const RE_ID = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_LINEAS = 5000;

const clave = (prov, tipo) => `cf:${prov}:${tipo}`;
const txt = (v, max = 200) => String(v ?? '').slice(0, max);
const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new Error('Número inválido.');
  return n;
};
const fecha = (v) => {
  const s = txt(v, 10);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Fecha inválida.');
  return s;
};
const id = (v) => {
  const s = String(v ?? '');
  if (!RE_ID.test(s)) throw new Error('Identificador inválido.');
  return s;
};
const lista = (v, max = MAX_LINEAS) => {
  if (!Array.isArray(v) || v.length > max) throw new Error('Lista inválida o demasiado larga.');
  return v;
};

export function limpiarPedido(p) {
  return {
    id: id(p?.id),
    nombre: txt(p?.nombre, 160),
    fecha: fecha(p?.fecha),
    nroProveedor: txt(p?.nroProveedor, 40),
    origen: txt(p?.origen || 'manual', 40),
    enlace: /^https:\/\/trello\.com\/c\/[A-Za-z0-9]+$/.test(String(p?.enlace || '')) ? String(p.enlace) : '',
    lineas: lista(p?.lineas).map((l) => ({
      sku: txt(l?.sku, 80), codigo: txt(l?.codigo, 80), descripcion: txt(l?.descripcion), talle: txt(l?.talle, 40),
      unidadesPorUdm: num(l?.unidadesPorUdm || 1), precioLista: num(l?.precioLista || 0), descuento: num(l?.descuento || 0), cantidad: num(l?.cantidad || 0),
    })),
  };
}

export function limpiarFactura(f) {
  return {
    id: id(f?.id), numero: txt(f?.numero, 40), fecha: fecha(f?.fecha), remito: txt(f?.remito, 40),
    pedidoProveedor: txt(f?.pedidoProveedor, 120), condicionVenta: txt(f?.condicionVenta, 120), vencimiento: fecha(f?.vencimiento),
    renglones: lista(f?.renglones, 2000).map((r) => ({
      codigo: txt(r?.codigo, 80), descripcion: txt(r?.descripcion), precioUnitario: num(r?.precioUnitario || 0),
      bonificacion: num(r?.bonificacion || 0), cantidad: num(r?.cantidad || 0), total: num(r?.total || 0),
    })),
    subtotal: num(f?.subtotal || 0), iva: num(f?.iva || 0), percepcionCaba: num(f?.percepcionCaba || 0),
    percepcionBsAs: num(f?.percepcionBsAs || 0), total: num(f?.total || 0),
  };
}

export function limpiarRecepcion(r) {
  const recibido = {};
  const entradas = Object.entries(r?.recibido && typeof r.recibido === 'object' ? r.recibido : {});
  if (entradas.length > MAX_LINEAS) throw new Error('Recepción demasiado larga.');
  for (const [k, v] of entradas) recibido[txt(k, 120)] = num(v);
  return {
    recibido,
    extras: lista(r?.extras || [], 500).map((e) => ({ codigo: txt(e?.codigo, 80), talle: txt(e?.talle, 40), cantidad: num(e?.cantidad || 0) })),
    nota: txt(r?.nota, 1000),
    actualizado: new Date().toISOString(),
  };
}

/** Remito de una entrega (lo que llegó), leído de la foto o escrito a mano. Solo el texto: la foto no se guarda. */
export function limpiarRemito(r) {
  return {
    numero: txt(r?.numero, 40),
    fecha: fecha(r?.fecha),
    origen: r?.origen === 'foto' ? 'foto' : 'manual',
    dudas: lista(r?.dudas || [], 50).map((d) => txt(d, 300)),
    renglones: lista(r?.renglones, 1000).map((x) => ({
      codigo: txt(x?.codigo, 80),
      cantidad: num(x?.cantidad || 0),
      talles: talles(x?.talles),
    })),
    actualizado: new Date().toISOString(),
  };
}

const talles = (v) => lista(v || [], 60).map((t) => ({ talle: txt(t?.talle, 20), cantidad: num(t?.cantidad || 0) }));

/** Lo que había en Shopify al controlar la entrega de Family (solo para mostrar). */
function limpiarConsulta(c) {
  if (!c || typeof c !== 'object') return null;
  const codigos = {};
  const entradas = Object.entries(c.codigos && typeof c.codigos === 'object' ? c.codigos : {});
  if (entradas.length > 1000) throw new Error('Consulta demasiado larga.');
  for (const [k, productos] of entradas) {
    codigos[txt(k, 80)] = lista(productos || [], 20).map((p) => ({
      titulo: txt(p?.titulo, 200), vendor: txt(p?.vendor, 80),
      precios: lista(p?.precios || [], 30).map(num), costos: lista(p?.costos || [], 30).map(num),
      talles: lista(p?.talles || [], 100).map((t) => txt(t, 20)),
    }));
  }
  return { fecha: txt(c.fecha, 30), ...(c.error ? { error: txt(c.error, 200) } : {}), codigos };
}

/** Planilla «ENTREGA MERCADERIA» de Family: artículos, precios y talles. */
export function limpiarEntrega(e) {
  return {
    id: id(e?.id),
    nombre: txt(e?.nombre, 160),
    fecha: fecha(e?.fecha),
    origen: ['excel', 'foto', 'manual'].includes(e?.origen) ? e.origen : 'manual',
    renglones: lista(e?.renglones, 1000).map((r) => ({
      codigo: txt(r?.codigo, 80), descripcion: txt(r?.descripcion), precioMayor: num(r?.precioMayor || 0), precioPublico: num(r?.precioPublico || 0),
      cantidad: num(r?.cantidad || 0), talles: talles(r?.talles),
      ...(r?.totalImpreso !== undefined && r?.totalImpreso !== null ? { totalImpreso: num(r.totalImpreso) } : {}),
    })),
    dudas: lista(e?.dudas || [], 50).map((d) => txt(d, 300)),
    shopify: limpiarConsulta(e?.shopify),
    actualizado: new Date().toISOString(),
  };
}

/** Número de la nota y huella de sus líneas (para reconocer una nota borrada a mano en otra tarjeta). */
function firmaNota(body) {
  const out = {};
  const nro = txt(body?.nro, 40).trim();
  if (nro) out.nro = nro;
  if (/^[a-z0-9]{1,16}$/.test(String(body?.huella ?? ''))) out.huella = String(body.huella);
  return out;
}

const parsear = (hash) => {
  const out = {};
  // Upstash devuelve HGETALL como [campo, valor, campo, valor…].
  const arr = Array.isArray(hash) ? hash : [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    try { out[arr[i]] = JSON.parse(arr[i + 1]); } catch { /* registro dañado: se ignora */ }
  }
  return out;
};

export async function leerTodo(kv, prov) {
  const res = await kv([...TIPOS.map((t) => ['HGETALL', clave(prov, t)]), ['HGET', 'cf:config', prov], ['HGETALL', clave(prov, 'trello')]]);
  const [pedidos, facturas, asignaciones, recepciones, remitos, entregas] = res.slice(0, TIPOS.length).map(parsear);
  const crudo = res[TIPOS.length];
  let config = {};
  try { config = crudo ? JSON.parse(crudo) : {}; } catch { config = {}; }
  return { pedidos: Object.values(pedidos), facturas: Object.values(facturas), asignaciones, recepciones, remitos, entregas: Object.values(entregas), config, trelloVistos: parsear(res[TIPOS.length + 1]) };
}

/** Aplica una acción de guardado o borrado. Valida todo antes de escribir. */
export async function aplicar(kv, body) {
  const prov = String(body?.proveedor || '');
  if (!PROVEEDORES.includes(prov)) throw new Error('Proveedor inválido.');
  switch (body?.accion) {
    case 'guardarPedido': {
      const p = limpiarPedido(body.pedido);
      const cmds = [['HSET', clave(prov, 'pedidos'), p.id, JSON.stringify(p)]];
      const adj = /^T-([a-f0-9]{24})$/.exec(p.id);
      if (adj) {
        // Una nota de Trello borrada a mano solo vuelve si la usuaria toca «Volver a cargar».
        if (body.recargar === true) cmds.push(['HDEL', clave(prov, 'trello'), adj[1]]);
        else {
          const [marca] = await kv([['HGET', clave(prov, 'trello'), adj[1]]]);
          let motivo = '';
          try { motivo = marca ? JSON.parse(marca).motivo : ''; } catch { motivo = ''; }
          if (motivo === 'borrado a mano') throw new Error('Esa nota la borraste de Pedidos: para traerla de nuevo usá «Volver a cargar».');
        }
      }
      await kv(cmds);
      return { ok: true };
    }
    case 'borrarPedido': {
      const pid = id(body.id);
      const cmds = [['HDEL', clave(prov, 'pedidos'), pid]];
      // Un pedido traído de Trello que se borra a mano no vuelve a importarse solo. Se guarda
      // su número y su huella para reconocer también una copia en otra tarjeta.
      const adj = /^T-([a-f0-9]{24})$/.exec(pid);
      if (adj) cmds.push(['HSET', clave(prov, 'trello'), adj[1], JSON.stringify({ motivo: 'borrado a mano', fecha: new Date().toISOString().slice(0, 10), ...firmaNota(body) })]);
      await kv(cmds);
      return { ok: true };
    }
    case 'guardarFactura': {
      const f = limpiarFactura(body.factura);
      await kv([['HSET', clave(prov, 'facturas'), f.id, JSON.stringify(f)]]);
      return { ok: true };
    }
    case 'borrarFactura': {
      const fid = id(body.id);
      await kv([['HDEL', clave(prov, 'facturas'), fid], ['HDEL', clave(prov, 'asignaciones'), fid], ['HDEL', clave(prov, 'recepciones'), fid], ['HDEL', clave(prov, 'remitos'), fid]]);
      return { ok: true };
    }
    case 'guardarAsignacion': {
      const fid = id(body.facturaId);
      const pedidos = lista(body.pedidos || [], 50).map(id);
      await kv([pedidos.length ? ['HSET', clave(prov, 'asignaciones'), fid, JSON.stringify(pedidos)] : ['HDEL', clave(prov, 'asignaciones'), fid]]);
      return { ok: true };
    }
    case 'guardarRecepcion': {
      const fid = id(body.facturaId);
      await kv([['HSET', clave(prov, 'recepciones'), fid, JSON.stringify(limpiarRecepcion(body.recepcion))]]);
      return { ok: true };
    }
    case 'guardarRemito': {
      const fid = id(body.facturaId);
      await kv([['HSET', clave(prov, 'remitos'), fid, JSON.stringify(limpiarRemito(body.remito))]]);
      return { ok: true };
    }
    case 'borrarRemito': {
      await kv([['HDEL', clave(prov, 'remitos'), id(body.facturaId)]]);
      return { ok: true };
    }
    case 'guardarEntrega': {
      const e = limpiarEntrega(body.entrega);
      await kv([['HSET', clave(prov, 'entregas'), e.id, JSON.stringify(e)]]);
      return { ok: true };
    }
    case 'borrarEntrega': {
      const eid = id(body.id);
      await kv([['HDEL', clave(prov, 'entregas'), eid], ['HDEL', clave(prov, 'remitos'), eid]]);
      return { ok: true };
    }
    case 'marcarTrelloVisto': {
      // Adjuntos de Trello ya leídos que no son pedidos de este proveedor: no volver a bajarlos.
      const adj = String(body.adjunto ?? '');
      if (!/^[a-f0-9]{24}$/.test(adj)) throw new Error('Identificador inválido.');
      const version = Number.isInteger(body.version) && body.version > 0 && body.version < 1000 ? body.version : 1;
      await kv([['HSET', clave(prov, 'trello'), adj, JSON.stringify({ motivo: txt(body.motivo, 200), fecha: new Date().toISOString().slice(0, 10), version, ...firmaNota(body) })]]);
      return { ok: true };
    }
    case 'guardarConfig': {
      const config = { condicionesPago: txt(body.config?.condicionesPago, 300) };
      await kv([['HSET', 'cf:config', prov, JSON.stringify(config)]]);
      return { ok: true };
    }
    default:
      throw new Error('Acción inválida.');
  }
}
