// ============================================================================
// LECTURA DE LA FOTO DEL REMITO (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// La usa api/leer-remito.js. Pasa la foto a texto (código, talles y cantidades)
// para compararla con la factura. Con tipo 'entrega' lee la planilla de Family
// (también descripción y precios). No decide nada: solo transcribe. Lo que no se
// lee bien vuelve en «dudas» y la usuaria lo corrige en pantalla antes de usarlo.
// La foto no se guarda. SOLO LECTURA: no toca Shopify ni la base.
// Costo aproximado: US$ 0,01–0,03 por foto con el modelo por defecto.
// ============================================================================
import Anthropic from '@anthropic-ai/sdk';
import { claveEnv } from './secretos.js';

export const MODELO_POR_DEFECTO = 'claude-sonnet-5-5'; // el mismo que eligió gax para el asistente
const MEDIOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FOTOS = 5;
/** Errores propios (se muestran tal cual); los de la API se muestran genéricos. */
const falla = (msg) => Object.assign(new Error(msg), { propio: true });
const MAX_BASE64 = 1_500_000; // por foto (~1,1 MB): el navegador la achica antes

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['numero', 'fecha', 'renglones', 'dudas'],
  properties: {
    numero: { type: 'string', description: 'Número del remito tal como está impreso, o vacío.' },
    fecha: { type: 'string', description: 'Fecha del remito en formato AAAA-MM-DD, o vacío.' },
    renglones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'cantidad', 'talles', 'retirado'],
        properties: {
          codigo: { type: 'string' },
          cantidad: { type: 'number', description: 'Total de unidades del artículo.' },
          talles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['talle', 'cantidad', 'retirado'],
              properties: {
                talle: { type: 'string' },
                cantidad: { type: 'number', description: 'Cantidad impresa del talle.' },
                retirado: { type: 'number', description: 'Número de una marca a mano «-n» junto a este talle (0 si no hay).' },
              },
            },
          },
          retirado: { type: 'number', description: 'Marca a mano «-n» del artículo entero, solo si no detalla talles (0 si no hay).' },
        },
      },
    },
    dudas: { type: 'array', items: { type: 'string' } },
  },
};

const INSTRUCCIONES = `Transcribí este remito de un proveedor de calzado e indumentaria (puede venir en varias fotos: son páginas del mismo remito).
Por cada artículo devolvé:
- codigo: el código de artículo exacto como está impreso (por ejemplo 571818C, A12744C, LFO0125084, RBK110S236105). Sin el talle.
  Si el código viene partido en dos columnas (modelo y color, por ejemplo RBKLIP15 y RBKGY2120), escribilos juntos con guion: RBKLIP15-RBKGY2120.
  Si el código trae un agregado después de «---» (por ejemplo RBK1100225417---M12U 5/7,5 (3441)), escribí solo lo de antes: RBK1100225417.
- talles: cada talle con su cantidad, tal como figura (por ejemplo 5.0, 5.5, 10.0, 040, S, M, XL, TU). Si el artículo no detalla talles, lista vacía.
- cantidad: el total del artículo tal como está impreso (si son packs, la cantidad de packs; no la conviertas a pares).
También el número de remito y la fecha (AAAA-MM-DD) si se leen.
Reglas:
- No corrijas, no completes y no adivines. Si un código, talle o cantidad no se lee con seguridad, transcribí lo más probable y explicalo en «dudas» (código y qué no se lee).
- Si el total impreso de un artículo no coincide con la suma de sus talles, anotalo en «dudas».
- Ignorá firmas y sellos. Las marcas a mano no cambian la cantidad impresa.
- Una marca a mano con un número negativo («-1», «-2», a veces con una flecha «└> -1») junto a un talle es lo que el depósito sacó para órdenes ya vendidas: poné ese número, sin el signo, en «retirado» de ESE talle (si el artículo no detalla talles, en el «retirado» del artículo). En todo lo demás, retirado = 0. Si no se sabe a qué talle apunta la marca o no se lee el número, dejá retirado en 0 y anotalo en «dudas».
- Las demás marcas a mano (tildes, cruces, «NO», otros números) anotalas en «dudas» indicando el código y el talle.
- Si hay una «cantidad total» o «total de unidades» impresa, compará con la suma de los artículos y anotá en «dudas» si no coincide.`;

// Planilla «ENTREGA MERCADERIA» de Family (11-nov-2026): además de talles trae precios.
const ESQUEMA_ENTREGA = {
  type: 'object',
  additionalProperties: false,
  required: ['fecha', 'renglones', 'dudas'],
  properties: {
    fecha: { type: 'string', description: 'Fecha de la planilla en formato AAAA-MM-DD, o vacío.' },
    renglones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'descripcion', 'precioMayor', 'precioPublico', 'cantidad', 'talles'],
        properties: {
          codigo: { type: 'string' },
          descripcion: { type: 'string', description: 'Artículo, modelo, corte y color, tal como figuran.' },
          precioMayor: { type: 'number', description: 'Precio por mayor, sin símbolos (0 si no figura).' },
          precioPublico: { type: 'number', description: 'Precio público, sin símbolos (0 si no figura).' },
          cantidad: { type: 'number', description: 'TOTAL impreso del artículo.' },
          talles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['talle', 'cantidad'],
              properties: { talle: { type: 'string' }, cantidad: { type: 'number' } },
            },
          },
        },
      },
    },
    dudas: { type: 'array', items: { type: 'string' } },
  },
};

const INSTRUCCIONES_ENTREGA = `Transcribí esta planilla de entrega de mercadería de un proveedor de indumentaria (la foto puede estar girada; puede venir en varias fotos).
Columnas habituales: CODIGO, ARTICULO, MODELO, CORTE, COLOR, PRECIOXMAYOR, PRECIO PUBLICO, una columna por talle (S, M, L, XL, 2XL, 3XL…) y TOTAL.
Por cada artículo devolvé:
- codigo: exacto como está impreso (por ejemplo SHBSPEC, GSKPT23).
- descripcion: artículo, modelo, corte y color, en ese orden, como figuran.
- precioMayor y precioPublico: como número, sin $ ni separadores de miles ($34,500.00 → 34500).
- talles: cada talle con su cantidad; las celdas vacías no van.
- cantidad: el TOTAL impreso del artículo.
También la fecha de la planilla (AAAA-MM-DD) si se lee.
Reglas:
- No corrijas, no completes y no adivines. Si algo no se lee con seguridad, transcribí lo más probable y explicalo en «dudas» (código y qué no se lee).
- Si el TOTAL impreso no coincide con la suma de los talles, anotalo en «dudas».
- Ignorá firmas y sellos; las marcas a mano anotalas en «dudas».`;

/** Valida las fotos que manda la pantalla. */
export function validarFotos(fotos) {
  if (!Array.isArray(fotos) || !fotos.length) throw falla('Falta la foto del remito.');
  if (fotos.length > MAX_FOTOS) throw falla(`Máximo ${MAX_FOTOS} fotos por remito.`);
  return fotos.map((f) => {
    if (!MEDIOS.includes(f?.media) || typeof f?.datos !== 'string' || !f.datos || f.datos.length > MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(f.datos)) {
      throw falla('Foto inválida o demasiado grande.');
    }
    return { media: f.media, datos: f.datos };
  });
}

const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const cant = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n) : 0;
};

/** Marca a mano «-n»: salió para órdenes. Nunca más de lo impreso; si se pasa, no se aplica y queda en dudas. */
function conRetirado(x, crudo, donde, dudas) {
  const n = cant(crudo);
  if (!n) return x;
  if (n > x.cantidad) { dudas.push(`${donde}: la marca a mano dice -${n} y llegaron ${x.cantidad}; no se descontó.`); return x; }
  return { ...x, retirado: n };
}

/** Normaliza lo que devuelve el modelo: textos cortos, cantidades enteras, total = suma de talles. */
export function normalizarRemito(crudo) {
  const dudas = (Array.isArray(crudo?.dudas) ? crudo.dudas : []).slice(0, 50).map((d) => txt(d, 300)).filter(Boolean);
  const renglones = [];
  for (const r of (Array.isArray(crudo?.renglones) ? crudo.renglones : []).slice(0, 500)) {
    const codigo = txt(r?.codigo, 80).toUpperCase().replace(/\s+/g, '');
    if (!codigo) continue;
    const talles = (Array.isArray(r?.talles) ? r.talles : []).slice(0, 60)
      .map((t) => conRetirado({ talle: txt(t?.talle, 20).toUpperCase().replace(',', '.'), cantidad: cant(t?.cantidad) }, t?.retirado, `${codigo} talle ${txt(t?.talle, 20)}`, dudas))
      .filter((t) => t.talle && t.cantidad > 0);
    const suma = talles.reduce((s, t) => s + t.cantidad, 0);
    const total = cant(r?.cantidad);
    if (talles.length && total && total !== suma) dudas.push(`${codigo}: el total impreso (${total}) no coincide con la suma de talles (${suma}); se usa la suma.`);
    const renglon = { codigo, cantidad: talles.length ? suma : total, talles };
    renglones.push(talles.length ? renglon : conRetirado(renglon, r?.retirado, codigo, dudas));
  }
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(crudo?.fecha || '')) ? crudo.fecha : '';
  return { numero: txt(crudo?.numero, 40), fecha, renglones, dudas, origen: 'foto' };
}

const precio = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1e9 ? Math.round(n * 100) / 100 : 0;
};

/** Normaliza la planilla de entrega de Family: como el remito, más descripción y precios. */
export function normalizarEntrega(crudo) {
  const dudas = (Array.isArray(crudo?.dudas) ? crudo.dudas : []).slice(0, 50).map((d) => txt(d, 300)).filter(Boolean);
  const renglones = [];
  for (const r of (Array.isArray(crudo?.renglones) ? crudo.renglones : []).slice(0, 500)) {
    const codigo = txt(r?.codigo, 80).toUpperCase().replace(/\s+/g, '');
    if (!codigo) continue;
    const talles = (Array.isArray(r?.talles) ? r.talles : []).slice(0, 60)
      .map((t) => ({ talle: txt(t?.talle, 20).toUpperCase().replace(',', '.'), cantidad: cant(t?.cantidad) }))
      .filter((t) => t.talle && t.cantidad > 0);
    const suma = talles.reduce((s, t) => s + t.cantidad, 0);
    const total = cant(r?.cantidad);
    if (talles.length && total && total !== suma) dudas.push(`${codigo}: el TOTAL impreso (${total}) no coincide con la suma de talles (${suma}); se usa la suma.`);
    renglones.push({
      codigo, descripcion: txt(r?.descripcion, 200), precioMayor: precio(r?.precioMayor), precioPublico: precio(r?.precioPublico),
      cantidad: talles.length ? suma : total, talles, ...(total ? { totalImpreso: total } : {}),
    });
  }
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(crudo?.fecha || '')) ? crudo.fecha : '';
  return { fecha, renglones, dudas, origen: 'foto' };
}

/**
 * Lee el remito (o, con tipo 'entrega', la planilla de entrega de Family) de las fotos.
 * `cliente` se inyecta en los tests para no llamar a la API real.
 */
export async function leerRemito({ fotos, cliente, tipo = 'remito' }) {
  const validas = validarFotos(fotos);
  const esEntrega = tipo === 'entrega';
  const client = cliente || new Anthropic({ apiKey: claveEnv('ANTHROPIC_API_KEY') });
  const content = [
    ...validas.map((f) => ({ type: 'image', source: { type: 'base64', media_type: f.media, data: f.datos } })),
    { type: 'text', text: esEntrega ? INSTRUCCIONES_ENTREGA : INSTRUCCIONES },
  ];
  const respuesta = await client.beta.messages.create({
    model: process.env.ANTHROPIC_MODEL || MODELO_POR_DEFECTO,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: process.env.ANTHROPIC_EFFORT || 'medium', format: { type: 'json_schema', schema: esEntrega ? ESQUEMA_ENTREGA : ESQUEMA } },
    messages: [{ role: 'user', content }],
  });
  if (respuesta.stop_reason === 'refusal') throw falla('No se pudo leer la foto. Escribí el remito a mano.');
  if (respuesta.stop_reason === 'max_tokens') throw falla('El remito es demasiado largo para leerlo de una vez: subí las fotos de a menos.');
  const texto = (respuesta.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let crudo;
  try { crudo = JSON.parse(texto); } catch { throw falla('No se pudo leer la foto. Probá de nuevo o escribí el remito a mano.'); }
  const leido = esEntrega ? normalizarEntrega(crudo) : normalizarRemito(crudo);
  if (!leido.renglones.length) throw falla(`No encontré artículos en la foto. ¿Es ${esEntrega ? 'la planilla de entrega' : 'el remito'}? Probá con una foto más clara o escribilo a mano.`);
  return leido;
}
