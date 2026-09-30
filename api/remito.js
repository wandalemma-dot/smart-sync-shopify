// Lee la FOTO de un remito / factura de proveedor con IA (Claude, de Anthropic)
// y devuelve los renglones como datos: código, descripción, color, talle,
// cantidad y precio. Lo usa la pestaña «Control de remitos».
//
// SEGURIDAD / COSTO:
// - La clave va en la variable de entorno ANTHROPIC_API_KEY de Vercel. NUNCA en
//   el código.
// - El endpoint es público (la app no tiene login), así que limitamos cuánto se
//   puede mandar por pedido (cantidad de fotos y tamaño) para que nadie gaste
//   la cuenta de Anthropic mandando cosas gigantes.
// - Solo LEE la foto. No toca Shopify.

export const config = { maxDuration: 120 };

const MAX_FOTOS = 8;
const MAX_BYTES_FOTO = 3_000_000; // ~3 MB en base64 por foto (el navegador ya las achica)
const TIPOS_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Modelo: se puede cambiar desde Vercel con ANTHROPIC_MODEL sin tocar código.
const MODELO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const INSTRUCCIONES = `Sos un asistente que transcribe remitos y facturas de proveedores de ropa y calzado de Argentina.
Te paso las fotos de UN comprobante (puede tener varias páginas, en cualquier orden).
Transcribí TODOS los renglones de artículos, EXACTAMENTE como están impresos, en el orden en que aparecen (página 1 primero).

Reglas:
- No inventes ni completes nada. Si un dato no se lee, dejalo vacío y marcá "dudoso": true en ese renglón.
- Las marcas de resaltador, tildes o birome encima del papel NO son datos: ignoralas.
- Los renglones suelen estar desalineados en la foto (el papel está torcido). Usá la cantidad de renglones, los precios y los montos (cantidad × precio = monto) para asignar bien cada talle y cantidad a su renglón.
- "codigo": el código de artículo tal cual (ej. P52SA210, O570707). Ojo con la letra O y el número 0: copiá lo que se ve.
- "descripcion": el nombre del artículo SIN el color. "color": lo que va entre corchetes o la columna de color (ej. "Negro", "P. Gris").
- "talle": tal cual (S, M, L, XL, XXL, 3XL, 38, 40, 7.5...). Vacío si el artículo no tiene talle (gorras, bolsos, accesorios).
- "cantidad": número de unidades (1.00 → 1).
- "precio_unitario": precio unitario sin separadores de miles (31,800.00 → 31800). 0 si no figura.
- En el encabezado: proveedor (razón social de quien EMITE el comprobante), tipo y número de comprobante, fecha en formato AAAA-MM-DD.
- Si el comprobante imprime "Cantidad total" y/o "Filas", copialos en cantidad_total_impresa y filas_impresas (si no, 0).`;

const HERRAMIENTA = {
  name: 'registrar_remito',
  description: 'Registra los datos transcriptos del comprobante.',
  input_schema: {
    type: 'object',
    properties: {
      proveedor: { type: 'string' },
      tipo_comprobante: { type: 'string', description: 'Remito, Factura A, Factura B, etc.' },
      numero: { type: 'string' },
      fecha: { type: 'string', description: 'AAAA-MM-DD' },
      cantidad_total_impresa: { type: 'number' },
      filas_impresas: { type: 'number' },
      renglones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            codigo: { type: 'string' },
            descripcion: { type: 'string' },
            color: { type: 'string' },
            talle: { type: 'string' },
            cantidad: { type: 'number' },
            precio_unitario: { type: 'number' },
            dudoso: { type: 'boolean' },
          },
          required: ['codigo', 'descripcion', 'color', 'talle', 'cantidad', 'precio_unitario'],
        },
      },
      observaciones: { type: 'string', description: 'Cualquier cosa que no se pudo leer bien.' },
    },
    required: ['proveedor', 'numero', 'fecha', 'renglones'],
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave) {
    return res.status(500).json({
      error: 'Falta configurar ANTHROPIC_API_KEY en Vercel (la clave para leer las fotos).',
    });
  }

  const { fotos } = req.body || {};
  if (!Array.isArray(fotos) || fotos.length === 0) {
    return res.status(400).json({ error: 'No llegó ninguna foto.' });
  }
  if (fotos.length > MAX_FOTOS) {
    return res.status(400).json({ error: `Máximo ${MAX_FOTOS} fotos por remito.` });
  }
  for (const f of fotos) {
    if (!f || typeof f.data !== 'string' || !TIPOS_OK.includes(f.mediaType)) {
      return res.status(400).json({ error: 'Formato de foto no válido (usá JPG o PNG).' });
    }
    if (f.data.length > MAX_BYTES_FOTO) {
      return res.status(400).json({ error: 'Una de las fotos es demasiado grande.' });
    }
  }

  const contenido = [];
  fotos.forEach((f, i) => {
    contenido.push({ type: 'text', text: `Foto ${i + 1} de ${fotos.length}:` });
    contenido.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
  });
  contenido.push({ type: 'text', text: 'Transcribí el comprobante completo con la herramienta registrar_remito.' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': clave,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 16000,
        system: INSTRUCCIONES,
        tools: [HERRAMIENTA],
        tool_choice: { type: 'tool', name: 'registrar_remito' },
        messages: [{ role: 'user', content: contenido }],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || JSON.stringify(data).slice(0, 300);
      return res.status(502).json({ error: 'La IA no pudo leer la foto: ' + msg });
    }
    const uso = (data.content || []).find((c) => c.type === 'tool_use');
    if (!uso || !uso.input) {
      return res.status(502).json({ error: 'La IA no devolvió datos del remito.' });
    }
    return res.status(200).json({ remito: uso.input, modelo: MODELO, corto: data.stop_reason === 'max_tokens' });
  } catch (e) {
    console.error('Anthropic error', e);
    return res.status(500).json({ error: 'Error hablando con la IA: ' + (e?.message || e) });
  }
}
