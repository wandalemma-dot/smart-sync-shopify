// ============================================================================
// LECTURA DE LA FOTO DEL REMITO (11-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// La usa api/leer-remito.js. Pasa la foto a texto (código, talles y cantidades)
// para compararla con la factura. Con tipo 'entrega' lee la planilla de Family
// (también descripción y precios); con tipo 'factura', la factura en papel de Target (19-nov-2026). No decide nada: solo transcribe. Lo que no se
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
        required: ['codigo', 'cantidad', 'talles'],
        properties: {
          codigo: { type: 'string' },
          cantidad: { type: 'number', description: 'Total de unidades del artículo.' },
          talles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['talle', 'cantidad'],
              properties: {
                talle: { type: 'string' },
                cantidad: { type: 'number', description: 'Cantidad impresa del talle.' },
              },
            },
          },
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
- Las marcas a mano (tildes, cruces, «NO», números como «-1» con o sin flecha) NO cambian nada: anotalas en «dudas» indicando el código y, si se ve, el talle al que apuntan.
- Si hay una «cantidad total» o «total de unidades» impresa, compará con la suma de los artículos y anotá en «dudas» si no coincide.
- Remitos de Target y sus empresas (Tendence, Bag Company, All Brands): la columna DESPACHO ADUANA (por ejemplo 25001IC04213695-U) NO es el código. El código es el número al principio de la descripción: «16043 - Mochila Camping Discovery T2» → 16043. La foto puede estar girada.`;

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

// Factura de Target y sus empresas (19-nov-2026, gax): llegan en papel. Se transcribe la foto y las cuentas
// (renglones, bonificación, IVA, total) se controlan en la app (target.ts): lo que no cierra se avisa.
const ESQUEMA_FACTURA = {
  type: 'object',
  additionalProperties: false,
  required: ['empresa', 'numero', 'fecha', 'pedido', 'renglones', 'subtotal', 'bonificacionPct', 'bonificacion', 'neto', 'percepciones', 'iva', 'total', 'dudas'],
  properties: {
    empresa: { type: 'string', description: 'Razón social que emite la factura (por ejemplo TARGET, TENDENCE S.R.L., BAG COMPANY S.R.L., ALL BRANDS S.R.L.).' },
    numero: { type: 'string', description: 'Número de factura tal como está impreso (por ejemplo A000300172534).' },
    fecha: { type: 'string', description: 'Fecha de la factura en formato AAAA-MM-DD, o vacío.' },
    pedido: { type: 'string', description: 'El número que figura con «P» debajo de «I.V.A.» (por ejemplo 211313), o vacío.' },
    renglones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['cantidad', 'codigo', 'descripcion', 'unidad', 'precioUnitario', 'importe'],
        properties: {
          cantidad: { type: 'number' },
          codigo: { type: 'string', description: 'El número al principio de la descripción (16043 en «16043 - Mochila Camping Discovery T2»). No el despacho de aduana.' },
          descripcion: { type: 'string', description: 'La descripción sin el código (Mochila Camping Discovery T2).' },
          unidad: { type: 'string', description: '«Unidad», «x Par», etc., tal como figura.' },
          precioUnitario: { type: 'number', description: 'P. UNITARIO, sin $ ni separadores de miles.' },
          importe: { type: 'number', description: 'IMPORTE del renglón.' },
        },
      },
    },
    subtotal: { type: 'number', description: 'Primer importe del pie: la suma de los renglones.' },
    bonificacionPct: { type: 'number', description: 'Porcentaje de bonificación del pie (10,00 → 10). 0 si no hay.' },
    bonificacion: { type: 'number', description: 'Importe de la bonificación.' },
    neto: { type: 'number', description: 'Subtotal menos la bonificación (el importe sobre el que se calcula el IVA).' },
    percepciones: { type: 'number', description: 'Suma de las percepciones de ingresos brutos (IBB CABA, IBB MISIONES…). 0 si son 0.' },
    iva: { type: 'number', description: 'Importe del IVA (el que está al lado de 21,00).' },
    total: { type: 'number', description: 'Total de la factura.' },
    dudas: { type: 'array', items: { type: 'string' } },
  },
};

const INSTRUCCIONES_FACTURA = `Transcribí esta factura de un proveedor de accesorios (puede venir en varias fotos: son páginas de la misma factura; la foto puede estar girada).
Columnas de los renglones: CANTIDAD | DESPACHO ADUANA | DESCRIPCION («16043 - Mochila Camping Discovery T2») | unidad («Unidad», «x Par») | P. UNITARIO | IMPORTE.
- El código es el número al principio de la descripción (16043), NO el despacho de aduana (25001IC04213695-U).
- Números sin $ ni separadores de miles: 49.900,00 → 49900; 2.478.400,00 → 2478400.
Pie de la factura (de arriba hacia abajo, a la derecha): subtotal; a su izquierda el porcentaje de bonificación (10,00) y a la derecha su importe; el neto;
las percepciones de ingresos brutos (IBB CABA, IBB MISIONES; suelen ser 0,00); otra vez el neto; a la izquierda 21,00 y a la derecha el IVA; el total.
Reglas:
- No corrijas, no completes y no adivines. Si algo no se lee con seguridad, transcribí lo más probable y explicalo en «dudas».
- No hagas cuentas para completar lo que no se lee: la app las controla.
- Ignorá firmas, sellos y marcas a mano (anotalas en «dudas» si parecen importantes).`;

// Ullua (19-nov-2026, gax): marketplace (Thrasher, Spitfire, DTS). Trae un REMITO (precios CON IVA) o una
// FACTURA (precios SIN IVA). El precio es el de la CURVA entera y la curva está en la descripción
// («CURVA S1 M2 L3 XL2»). La app divide por 1,21 (remito) y por las unidades de la curva (ullua.ts).
const ESQUEMA_ULLUA = {
  type: 'object',
  additionalProperties: false,
  required: ['tipo', 'numero', 'fecha', 'remito', 'renglones', 'subtotal', 'iva', 'total', 'dudas'],
  properties: {
    tipo: { type: 'string', enum: ['remito', 'factura'], description: 'remito si dice REMITO (documento no válido como factura); factura si dice FACTURA.' },
    numero: { type: 'string', description: 'Número del comprobante tal como está impreso (por ejemplo 0001-00007680).' },
    fecha: { type: 'string', description: 'Fecha del comprobante en formato AAAA-MM-DD, o vacío.' },
    remito: { type: 'string', description: 'En una factura, el número de remito que menciona («REMITO: 7680»), o vacío.' },
    renglones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'descripcion', 'cantidad', 'precio', 'total'],
        properties: {
          codigo: { type: 'string', description: 'Código del artículo tal cual (580580C, 5101-A80C, 251451).' },
          descripcion: { type: 'string', description: 'La descripción COMPLETA tal como está impresa, incluida la curva («CURVA S1 M2 L3 XL2»), aunque esté cortada.' },
          cantidad: { type: 'number', description: 'Cantidad del renglón (curvas o unidades), tal como figura.' },
          precio: { type: 'number', description: 'Precio unitario del renglón, sin $ ni separadores de miles.' },
          total: { type: 'number', description: 'Importe total del renglón.' },
        },
      },
    },
    subtotal: { type: 'number', description: 'Subtotal (sin IVA) del pie, o 0 si no hay.' },
    iva: { type: 'number', description: 'Importe del IVA del pie, o 0 si no hay.' },
    total: { type: 'number', description: 'Total del comprobante.' },
    dudas: { type: 'array', items: { type: 'string' } },
  },
};

const INSTRUCCIONES_ULLUA = `Transcribí este comprobante (remito o factura) de Ullua (Thrasher, Spitfire, DTS). Puede venir en varias fotos: son páginas del mismo comprobante; la foto puede estar girada.
Columnas de los renglones: código | descripción | cantidad | precio unitario | importe.
- La descripción va COMPLETA, con la curva tal como está impresa («SP HOODIE OG CLASSIC MELANGE CURVA S1 M2 L3 XL2»). Si está cortada por el ancho de la columna, transcribí lo que se ve, sin completarla.
- Números sin $ ni separadores de miles: 484.000,00 → 484000.
- En la factura, el pie trae subtotal, IVA 21% y total; si menciona un remito («REMITO: 7680»), anotalo.
Reglas:
- No corrijas, no completes y no adivines. Si algo no se lee con seguridad, transcribí lo más probable y explicalo en «dudas» (código y qué no se lee).
- No hagas cuentas para completar lo que no se lee: la app las controla.
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

/** Normaliza lo que devuelve el modelo: textos cortos, cantidades enteras, total = suma de talles. */
export function normalizarRemito(crudo) {
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
    if (talles.length && total && total !== suma) dudas.push(`${codigo}: el total impreso (${total}) no coincide con la suma de talles (${suma}); se usa la suma.`);
    // Las marcas «-1» a mano NO se leen de la foto (12-nov-2026, gax: la lectura las asignaba al talle o
    // al artículo equivocado). Quedan en «dudas» y se escriben a mano en «Ver o corregir».
    renglones.push({ codigo, cantidad: talles.length ? suma : total, talles });
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

const importe = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1e11 ? Math.round(n * 100) / 100 : 0;
};

/** Normaliza la factura de Target leída de la foto. Las cuentas se controlan en la app. */
export function normalizarFactura(crudo) {
  const dudas = (Array.isArray(crudo?.dudas) ? crudo.dudas : []).slice(0, 50).map((d) => txt(d, 300)).filter(Boolean);
  const renglones = [];
  for (const r of (Array.isArray(crudo?.renglones) ? crudo.renglones : []).slice(0, 300)) {
    const codigo = txt(r?.codigo, 40).toUpperCase().replace(/\s+/g, '');
    if (!codigo) continue;
    renglones.push({
      codigo, descripcion: txt(r?.descripcion, 200), unidad: txt(r?.unidad, 30), cantidad: cant(r?.cantidad),
      precioUnitario: importe(r?.precioUnitario), importe: importe(r?.importe),
    });
  }
  const pct = Number(crudo?.bonificacionPct);
  return {
    empresa: txt(crudo?.empresa, 80), numero: txt(crudo?.numero, 40),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(crudo?.fecha || '')) ? crudo.fecha : '',
    pedido: txt(crudo?.pedido, 20).replace(/[^\d]/g, ''),
    renglones,
    subtotal: importe(crudo?.subtotal), bonificacionPct: Number.isFinite(pct) && pct >= 0 && pct < 100 ? Math.round(pct * 100) / 100 : 0,
    bonificacion: importe(crudo?.bonificacion), neto: importe(crudo?.neto), percepciones: importe(crudo?.percepciones),
    iva: importe(crudo?.iva), total: importe(crudo?.total), dudas, origen: 'foto',
  };
}

/** Normaliza el remito o la factura de Ullua. Las curvas, el IVA y las cuentas se resuelven en la app (ullua.ts). */
export function normalizarUllua(crudo) {
  const dudas = (Array.isArray(crudo?.dudas) ? crudo.dudas : []).slice(0, 50).map((d) => txt(d, 300)).filter(Boolean);
  const renglones = [];
  for (const r of (Array.isArray(crudo?.renglones) ? crudo.renglones : []).slice(0, 300)) {
    const codigo = txt(r?.codigo, 40).toUpperCase().replace(/\s+/g, '');
    if (!codigo) continue;
    const n = Number(r?.cantidad);
    renglones.push({
      codigo, descripcion: txt(r?.descripcion, 200),
      cantidad: Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : 0,
      precio: importe(r?.precio), total: importe(r?.total),
    });
  }
  return {
    tipo: crudo?.tipo === 'factura' ? 'factura' : 'remito',
    numero: txt(crudo?.numero, 40),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(crudo?.fecha || '')) ? crudo.fecha : '',
    remito: txt(crudo?.remito, 40),
    renglones, subtotal: importe(crudo?.subtotal), iva: importe(crudo?.iva), total: importe(crudo?.total), dudas, origen: 'foto',
  };
}

/**
 * Lee el remito (o, con tipo 'entrega', la planilla de entrega de Family) de las fotos.
 * `cliente` se inyecta en los tests para no llamar a la API real.
 */
export async function leerRemito({ fotos, cliente, tipo = 'remito' }) {
  const validas = validarFotos(fotos);
  const esEntrega = tipo === 'entrega';
  const esFactura = tipo === 'factura';
  const esUllua = tipo === 'ullua';
  const client = cliente || new Anthropic({ apiKey: claveEnv('ANTHROPIC_API_KEY') });
  const content = [
    ...validas.map((f) => ({ type: 'image', source: { type: 'base64', media_type: f.media, data: f.datos } })),
    { type: 'text', text: esUllua ? INSTRUCCIONES_ULLUA : esFactura ? INSTRUCCIONES_FACTURA : esEntrega ? INSTRUCCIONES_ENTREGA : INSTRUCCIONES },
  ];
  const respuesta = await client.beta.messages.create({
    model: process.env.ANTHROPIC_MODEL || MODELO_POR_DEFECTO,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: process.env.ANTHROPIC_EFFORT || 'medium', format: { type: 'json_schema', schema: esUllua ? ESQUEMA_ULLUA : esFactura ? ESQUEMA_FACTURA : esEntrega ? ESQUEMA_ENTREGA : ESQUEMA } },
    messages: [{ role: 'user', content }],
  });
  if (respuesta.stop_reason === 'refusal') throw falla('No se pudo leer la foto. Escribí el remito a mano.');
  if (respuesta.stop_reason === 'max_tokens') throw falla(`${esFactura ? 'La factura' : esUllua ? 'El comprobante' : 'El remito'} es demasiado largo para leerlo de una vez: subí las fotos de a menos.`);
  const texto = (respuesta.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let crudo;
  try { crudo = JSON.parse(texto); } catch { throw falla('No se pudo leer la foto. Probá de nuevo o escribí el remito a mano.'); }
  const leido = esUllua ? normalizarUllua(crudo) : esFactura ? normalizarFactura(crudo) : esEntrega ? normalizarEntrega(crudo) : normalizarRemito(crudo);
  if (!leido.renglones.length) throw falla(`No encontré artículos en la foto. ¿Es ${esUllua ? 'el remito o la factura' : esFactura ? 'la factura' : esEntrega ? 'la planilla de entrega' : 'el remito'}? Probá con una foto más clara${esFactura ? '' : ' o escribilo a mano'}.`);
  return leido;
}
