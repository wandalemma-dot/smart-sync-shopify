// ============================================================================
// CONVERSE — PRODUCTOS BÁSICOS CON PRECIO SUGERIDO OBLIGATORIO
// ----------------------------------------------------------------------------
// ⚠ REGLA DE NEGOCIO (confirmada por Wanda):
//   Estos modelos son los "básicos" (Chuck Taylor Core / Hi / Ox / Leather /
//   Platform, Chuck 70 y las de niño y bebé). SIEMPRE van al PRECIO SUGERIDO
//   del proveedor (columna RETAIL PRICE de la sábana).
//   NUNCA se les aplica el markup 2,27. No se negocia.
//
// Todo el resto de Converse y Le Coq sí lleva el markup.
// ============================================================================

export const CONVERSE_PRECIO_SUGERIDO: string[] = [
  '156991C', '156993C', '156994C', '156996C', '156998C', '156999C',
  '157000C', '157002C', '157004C', '157005C', '157196C', '157197C',
  '166582C', '166584C', '166585C', '166586C', '166587C',
  '166694C', '166695C', '166696C',
  '169953C', '169954C', '169955C', '169957C',
  '356991C', '356993C', '356994C', '356996C', '356998C', '356999C', '357196C',
  '756991C', '756993C', '756994C', '756996C', '756998C', '756999C',
  'A12975C', 'A12976C', 'A15206C', 'A15490C', 'A15491C',
  'A15542C', 'A15543C', 'A16516C',
];

const SET = new Set(CONVERSE_PRECIO_SUGERIDO.map((c) => c.toUpperCase()));

export function esPrecioSugerido(codigo: string): boolean {
  return SET.has(String(codigo || '').trim().toUpperCase());
}
