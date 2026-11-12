// Control de facturas contra pedidos: guardado de pedidos, facturas, remitos,
// asignaciones manuales, recepción del depósito y condiciones de pago, por proveedor.
// Family (sin factura): planillas de entrega + remito, con la consulta a Shopify del momento,
// y la marca de qué artículos de cada entrega ya se cargaron en Shopify («cargas»).
// Registro de cargas (cf:registro): cada carga en Shopify y cada marca liberada a mano, con el
// remito y la factura de la entrega, para ver después qué se cargó y cuándo.
// Los archivos se leen en el navegador; acá solo se valida y se guarda el JSON.
// No toca Shopify: la carga la hace el navegador por /api/shopify, con confirmación.
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

// ---------------------------------------------------------------------------
// CARGAS DE FAMILY EN SHOPIFY: una marca por entrega y artículo, para no cargar dos veces.
// «en curso» se pone con HSETNX ANTES de escribir en Shopify (si ya existe, no se carga);
// después queda «cargada», «parcial» o «dudosa» (respuesta incompleta: revisar en Shopify).
// Solo «liberarCarga» (a mano, con confirmación) la borra. Borrar la entrega no la borra.
// ---------------------------------------------------------------------------
const RE_COD_CARGA = /^[A-Z0-9][A-Z0-9._/-]{1,79}$/;
const ESTADOS_CARGA = ['cargada', 'parcial', 'dudosa'];
const campoCarga = (body) => {
  const cod = String(body?.codigo ?? '');
  if (!RE_COD_CARGA.test(cod)) throw new Error('Código inválido.');
  return `${id(body?.entregaId)}|${cod}`;
};
function limpiarDetalleCarga(d) {
  const x = d && typeof d === 'object' ? d : {};
  const out = {};
  if (['alta', 'reposicion'].includes(x.accion)) out.accion = x.accion;
  if (/^gid:\/\/shopify\/Product\/\d{1,20}$/.test(String(x.productoId ?? ''))) out.productoId = String(x.productoId);
  if (x.titulo) out.titulo = txt(x.titulo, 200);
  if (x.unidades !== undefined) out.unidades = num(x.unidades);
  if (x.mensaje) out.mensaje = txt(x.mensaje, 600);
  if (x.talles !== undefined) out.talles = talles(x.talles);
  return out;
}

// ---------------------------------------------------------------------------
// REGISTRO DE CARGAS (pedido de gax, 11-nov-2026): una lista para todos los proveedores, la más
// nueva primero. Cada evento guarda lo que había al momento (fecha y nombre de la entrega, número
// de remito y de factura), así no depende de que la entrega siga guardada. Solo se agrega: nadie
// lo edita ni lo borra desde la app.
// ---------------------------------------------------------------------------
const REGISTRO = 'cf:registro';
const MAX_REGISTRO = 5000;
export const VER_REGISTRO = 500;
const json = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

/** Fecha y talles de la firma de la carga: «2026-10-30|SHBSPEC|20|L:4,S:2». */
function deFirma(firma) {
  const [f = '', , , ts = ''] = String(firma || '').split('|');
  return {
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : '',
    talles: ts.split(',').map((x) => /^(.+):(\d+(?:\.\d+)?)$/.exec(x)).filter(Boolean).map((m) => ({ talle: m[1], cantidad: Number(m[2]) })),
  };
}

/** Un evento del registro a partir de la marca de carga y lo guardado de la entrega en ese momento. */
function eventoRegistro({ tipo, prov, campo, marca, entrega, remito, hora, estado }) {
  const [entregaId, codigo] = campo.split('|');
  const d = marca?.detalle || {};
  const f = deFirma(marca?.firma);
  const ent = json(entrega);
  const rem = json(remito);
  return {
    tipo, hora, proveedor: prov, entregaId, codigo,
    entrega: { fecha: f.fecha || txt(ent?.fecha, 10), nombre: txt(ent?.nombre, 160) },
    remito: txt(rem?.numero, 40),
    // Family no factura. Los demás proveedores, cuando carguen desde acá, mandan la suya.
    factura: txt(marca?.factura, 40),
    estado,
    ...(d.accion ? { accion: d.accion } : {}),
    ...(d.titulo ? { titulo: d.titulo } : {}),
    ...(d.productoId ? { productoId: d.productoId } : {}),
    ...(d.unidades !== undefined ? { unidades: d.unidades } : {}),
    talles: Array.isArray(d.talles) ? d.talles : f.talles,
    ...(d.mensaje ? { mensaje: d.mensaje } : {}),
  };
}
const agregarAlRegistro = (evento) => [['LPUSH', REGISTRO, JSON.stringify(evento)], ['LTRIM', REGISTRO, 0, MAX_REGISTRO - 1]];

/**
 * Registro de cargas: los últimos eventos, la más nueva primero. Las cargas hechas antes de que
 * existiera el registro (o que se cortaron sin terminar) se arman con su marca, para que también se vean.
 */
export async function leerRegistro(kv) {
  const [crudos, hash] = await kv([['LRANGE', REGISTRO, 0, VER_REGISTRO - 1], ['HGETALL', clave('family', 'cargas')]]);
  const eventos = (Array.isArray(crudos) ? crudos : []).map(json).filter((e) => e && typeof e === 'object');
  const sinRegistro = Object.entries(parsear(hash)).filter(([, m]) => m && !m.registrado);
  if (sinRegistro.length) {
    const ids = [...new Set(sinRegistro.map(([campo]) => campo.split('|')[0]))];
    const [ents, rems] = await kv([['HMGET', clave('family', 'entregas'), ...ids], ['HMGET', clave('family', 'remitos'), ...ids]]);
    const pos = new Map(ids.map((x, i) => [x, i]));
    for (const [campo, marca] of sinRegistro) {
      const i = pos.get(campo.split('|')[0]);
      eventos.push({
        ...eventoRegistro({ tipo: 'carga', prov: 'family', campo, marca, entrega: ents?.[i], remito: rems?.[i], hora: txt(marca.fecha, 30), estado: marca.estado }),
        deMarca: true,
      });
    }
  }
  eventos.sort((a, b) => String(b.hora).localeCompare(String(a.hora)));
  return { eventos, completo: !Array.isArray(crudos) || crudos.length < VER_REGISTRO };
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
  const extra = prov === 'family' ? [['HGETALL', clave(prov, 'cargas')]] : [];
  const res = await kv([
    ...TIPOS.map((t) => ['HGETALL', clave(prov, t)]), ['HGET', 'cf:config', prov], ['HGETALL', clave(prov, 'trello')],
    ['HGETALL', clave(prov, 'tarjetas')], ['HGET', 'cf:config', 'listasTrello'], ...extra,
  ]);
  const [pedidos, facturas, asignaciones, recepciones, remitos, entregas] = res.slice(0, TIPOS.length).map(parsear);
  const crudo = res[TIPOS.length];
  let config = {};
  try { config = crudo ? JSON.parse(crudo) : {}; } catch { config = {}; }
  const listas = json(res[TIPOS.length + 3]);
  const out = {
    pedidos: Object.values(pedidos), facturas: Object.values(facturas), asignaciones, recepciones, remitos, entregas: Object.values(entregas), config,
    trelloVistos: parsear(res[TIPOS.length + 1]),
    // En qué lista de Trello está cada tarjeta con notas (ver guardarTarjetas) y qué listas son de pedidos pendientes.
    tarjetasTrello: parsear(res[TIPOS.length + 2]),
    listasTrello: Array.isArray(listas) ? listas.filter((x) => RE_TRELLO.test(String(x))) : [],
  };
  if (prov === 'family') out.cargas = parsear(res[TIPOS.length + 4]);
  return out;
}

// ---------------------------------------------------------------------------
// LISTAS DE PEDIDOS PENDIENTES EN TRELLO (11-nov-2026, gax: «solo tené en cuenta esto»,
// con las listas «PEDIDOS PENDIENTES» y «PENDIENDE DE INDUMENTARIA/CALZADO»).
// Solo las tarjetas de esas listas traen notas; una nota cuya tarjeta salió de ellas no se
// elige sola para las facturas posteriores (cf:{proveedor}:tarjetas guarda desde cuándo).
const RE_TRELLO = /^[a-f0-9]{24}$/;
const MAX_TARJETAS = 1000;

/** Listas elegidas a mano (vacío = las que dicen «pendiente» en el nombre). Son del tablero, no de un proveedor. */
async function guardarListasTrello(kv, body) {
  const ids = lista(body?.listas ?? [], 30).map((x) => {
    if (!RE_TRELLO.test(String(x))) throw new Error('Lista de Trello inválida.');
    return String(x);
  });
  await kv([ids.length ? ['HSET', 'cf:config', 'listasTrello', JSON.stringify([...new Set(ids)])] : ['HDEL', 'cf:config', 'listasTrello']]);
  return { ok: true };
}

/** Estado de cada tarjeta con notas: si está en una lista de pendientes, si alguna vez lo estuvo y desde cuándo salió. */
export function limpiarTarjetas(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Tarjetas inválidas.');
  const entradas = Object.entries(v);
  if (!entradas.length || entradas.length > MAX_TARJETAS) throw new Error('Lista inválida o demasiado larga.');
  return entradas.map(([k, e]) => {
    if (!RE_TRELLO.test(k)) throw new Error('Tarjeta de Trello inválida.');
    return [k, {
      pendiente: e?.pendiente === true,
      visto: e?.visto === true || e?.pendiente === true,
      fuera: e?.pendiente === true ? '' : fecha(e?.fuera),
      lista: txt(e?.lista, 100),
    }];
  });
}

// ---------------------------------------------------------------------------
// ENLACES RÁPIDOS (11-nov-2026, pedido de gax): planillas propias, como «Control
// de ingreso de mercadería» en Google Sheets, a un clic desde Control de entregas.
// Se guardan en la base y no en el código, porque el repositorio es público.
// Campo «enlaces» de cf:config (los otros campos de ese hash son los proveedores).
// ---------------------------------------------------------------------------
export const MAX_ENLACES = 5;
function limpiarEnlace(x) {
  const crudo = String(x?.url ?? '').trim();
  if (!crudo) throw new Error('Falta el enlace.');
  if (crudo.length > 500) throw new Error('El enlace es demasiado largo.');
  let u;
  try { u = new URL(crudo); } catch { throw new Error(`«${crudo.slice(0, 60)}» no es una dirección web.`); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('El enlace tiene que empezar con https://.');
  const nombre = txt(x?.nombre, 60).replace(/\s+/g, ' ').trim() || 'Planilla';
  return { nombre, url: u.href };
}

export async function leerEnlaces(kv) {
  const [crudo] = await kv([['HGET', 'cf:config', 'enlaces']]);
  let lista = [];
  try { lista = crudo ? JSON.parse(crudo) : []; } catch { lista = []; }
  const enlaces = (Array.isArray(lista) ? lista : []).flatMap((x) => { try { return [limpiarEnlace(x)]; } catch { return []; } });
  return { enlaces: enlaces.slice(0, MAX_ENLACES) };
}

async function guardarEnlaces(kv, body) {
  if (!Array.isArray(body?.enlaces) || !Array.isArray(body?.antes)) throw new Error('Faltan los enlaces.');
  if (body.enlaces.length > MAX_ENLACES) throw new Error(`Se pueden guardar hasta ${MAX_ENLACES} enlaces.`);
  const enlaces = body.enlaces.map(limpiarEnlace);
  // Se guarda la lista ENTERA: si cambió desde que la pantalla la leyó (otra computadora, otra
  // pestaña), no se pisa, para no borrar un enlace que alguien agregó en el medio.
  const plano = (l) => JSON.stringify(l.map((x) => [String(x?.nombre ?? ''), String(x?.url ?? '')]));
  if (plano((await leerEnlaces(kv)).enlaces) !== plano(body.antes)) {
    throw new Error('Las planillas guardadas cambiaron desde que abriste el editor (¿desde otra computadora?). Volvé a abrirlo.');
  }
  await kv([['HSET', 'cf:config', 'enlaces', JSON.stringify(enlaces)]]);
  return { ok: true, enlaces };
}

/** Aplica una acción de guardado o borrado. Valida todo antes de escribir. */
export async function aplicar(kv, body) {
  // Los enlaces rápidos son de toda la pantalla, no de un proveedor.
  if (body?.accion === 'guardarEnlaces') return guardarEnlaces(kv, body);
  if (body?.accion === 'guardarListasTrello') return guardarListasTrello(kv, body);
  const prov = String(body?.proveedor || '');
  if (!PROVEEDORES.includes(prov)) throw new Error('Proveedor inválido.');
  switch (body?.accion) {
    case 'guardarPedido': {
      const p = limpiarPedido(body.pedido);
      const cmds = [['HSET', clave(prov, 'pedidos'), p.id, JSON.stringify(p)]];
      const adj = /^T-([a-f0-9]{24})$/.exec(p.id);
      if (adj) {
        // Una nota de Trello borrada a mano (o una copia de ella) solo vuelve si la usuaria toca «Volver a cargar».
        if (body.recargar === true) cmds.push(['HDEL', clave(prov, 'trello'), adj[1]]);
        else {
          const [marca] = await kv([['HGET', clave(prov, 'trello'), adj[1]]]);
          let motivo = '';
          try { motivo = marca ? String(JSON.parse(marca).motivo || '') : ''; } catch { motivo = ''; }
          if (motivo === 'borrado a mano' || /: repite una nota que borraste/.test(motivo)) throw new Error('Esa nota la borraste de Pedidos: para traerla de nuevo usá «Volver a cargar».');
        }
      } else cmds.push(['HDEL', clave(prov, 'trello'), `P:${p.id}`]); // subida a mano otra vez: ya no cuenta como borrada
      await kv(cmds);
      return { ok: true };
    }
    case 'borrarPedido': {
      const pid = id(body.id);
      const cmds = [['HDEL', clave(prov, 'pedidos'), pid]];
      // Un pedido traído de Trello que se borra a mano no vuelve a importarse solo. Se guarda
      // su número y su huella para reconocer también una copia en otra tarjeta.
      const adj = /^T-([a-f0-9]{24})$/.exec(pid);
      const firma = firmaNota(body);
      const marca = JSON.stringify({ motivo: 'borrado a mano', fecha: new Date().toISOString().slice(0, 10), ...firma });
      if (adj) cmds.push(['HSET', clave(prov, 'trello'), adj[1], marca]);
      // Una nota subida a mano no tiene adjunto: se anota aparte («P:»), para que su copia en Trello tampoco vuelva sola.
      else if (firma.huella) cmds.push(['HSET', clave(prov, 'trello'), `P:${pid}`, marca]);
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
      // Las marcas de carga en Shopify quedan: si se vuelve a subir la misma planilla, no se carga dos veces.
      const eid = id(body.id);
      await kv([['HDEL', clave(prov, 'entregas'), eid], ['HDEL', clave(prov, 'remitos'), eid]]);
      return { ok: true };
    }
    case 'reservarCarga': {
      if (prov !== 'family') throw new Error('Acción inválida.');
      const campo = campoCarga(body);
      const marca = { estado: 'en curso', fecha: new Date().toISOString(), firma: txt(body.firma, 400), detalle: limpiarDetalleCarga(body.detalle) };
      const [puesto, actual] = await kv([['HSETNX', clave(prov, 'cargas'), campo, JSON.stringify(marca)], ['HGET', clave(prov, 'cargas'), campo]]);
      if (Number(puesto) === 1) return { ok: true };
      let existente = null;
      try { existente = actual ? JSON.parse(actual) : null; } catch { existente = null; }
      return { ok: false, existente };
    }
    case 'terminarCarga': {
      if (prov !== 'family') throw new Error('Acción inválida.');
      const campo = campoCarga(body);
      if (!ESTADOS_CARGA.includes(body.estado)) throw new Error('Estado inválido.');
      const eid = campo.split('|')[0];
      const [actual, entrega, remito] = await kv([['HGET', clave(prov, 'cargas'), campo], ['HGET', clave(prov, 'entregas'), eid], ['HGET', clave(prov, 'remitos'), eid]]);
      const previa = json(actual);
      if (!previa) throw new Error('No encontré la marca de esa carga.');
      const hora = new Date().toISOString();
      const marca = { ...previa, estado: body.estado, fecha: hora, detalle: { ...(previa.detalle || {}), ...limpiarDetalleCarga(body.detalle) } };
      // Al registro va una sola vez: cuando la carga termina (de «en curso» a su resultado).
      const nueva = previa.estado === 'en curso' && !previa.registrado;
      if (nueva) marca.registrado = true;
      await kv([
        ['HSET', clave(prov, 'cargas'), campo, JSON.stringify(marca)],
        ...(nueva ? agregarAlRegistro(eventoRegistro({ tipo: 'carga', prov, campo, marca, entrega, remito, hora, estado: body.estado })) : []),
      ]);
      return { ok: true };
    }
    case 'liberarCarga': {
      if (prov !== 'family') throw new Error('Acción inválida.');
      const campo = campoCarga(body);
      // La app libera sola la marca cuando Shopify rechazó la carga (no se escribió nada): eso no se
      // anota. Lo que libera la usuaria a mano sí, porque permite cargar ese artículo otra vez.
      if (body.manual !== true) {
        await kv([['HDEL', clave(prov, 'cargas'), campo]]);
        return { ok: true };
      }
      const eid = campo.split('|')[0];
      const [actual, entrega, remito] = await kv([['HGET', clave(prov, 'cargas'), campo], ['HGET', clave(prov, 'entregas'), eid], ['HGET', clave(prov, 'remitos'), eid]]);
      const previa = json(actual);
      const cmds = [['HDEL', clave(prov, 'cargas'), campo]];
      if (previa) {
        const ev = eventoRegistro({ tipo: 'liberada', prov, campo, marca: previa, entrega, remito, hora: new Date().toISOString(), estado: previa.estado });
        cmds.push(...agregarAlRegistro({ ...ev, mensaje: txt(`Marca liberada a mano: la app deja cargar este artículo otra vez. Antes estaba «${previa.estado}».`, 600) }));
      }
      await kv(cmds);
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
    case 'guardarTarjetas': {
      const tarjetas = limpiarTarjetas(body.tarjetas);
      await kv([['HSET', clave(prov, 'tarjetas'), ...tarjetas.flatMap(([k, e]) => [k, JSON.stringify(e)])]]);
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
