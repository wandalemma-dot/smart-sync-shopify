// ============================================================================
// CONOCIMIENTO POR MARCA DEL ASISTENTE
// ----------------------------------------------------------------------------
// Para sumar una marca nueva:
//   1) crear server/conocimiento/<marca>.js con sus reglas (copiar converse.js)
//   2) agregarla abajo en MARCAS_ASISTENTE con su proveedor y vendor de Shopify
//   3) npm test (asistente.test.js verifica que esté completa)
// El texto se manda tal cual al modelo: escribirlo como se lo explicarías a
// alguien nuevo en el negocio. No poner claves ni datos privados.
// ============================================================================
import { GENERAL } from './general.js';
import { PROVEEDOR_ID } from './id.js';
import { CONVERSE } from './converse.js';
import { LECOQ } from './lecoq.js';

export const PROVEEDORES_ASISTENTE = {
  id: { nombre: 'iD', sucursal: 'ID (Converse - Le Coq Sportif)', texto: PROVEEDOR_ID },
};

export const MARCAS_ASISTENTE = {
  converse: { nombre: 'Converse', proveedor: 'id', vendor: 'Converse', texto: CONVERSE },
  lecoq: { nombre: 'Le Coq Sportif', proveedor: 'id', vendor: 'Le Coq Sportif', texto: LECOQ },
};

export const SUCURSAL_PROPIA = 'DEPOSITO MARTINEZ';

/** Instrucciones completas para una marca: generales + proveedor + marca. Texto estable (se cachea). */
export function instruccionesMarca(marca) {
  const m = MARCAS_ASISTENTE[marca];
  if (!m) throw new Error('Marca no habilitada en el asistente.');
  const p = PROVEEDORES_ASISTENTE[m.proveedor];
  return [GENERAL.trim(), p.texto.trim(), m.texto.trim(),
    `Marca elegida en pantalla: ${m.nombre} (proveedor ${p.nombre}). Respondé sobre esta marca salvo que te pregunten otra cosa.`].join('\n\n');
}
