import { describe, it, expect, vi, afterEach } from 'vitest';
import { claveEnv, mensajeSeguro, ocultarSecretos } from './secretos.js';

// Valores inventados con el formato real de cada servicio.
const TOKEN_TRELLO = 'ATTA' + '1a'.repeat(32) + 'DEADBEEF';
const KEY_TRELLO = 'abcdef0123456789abcdef0123456789';

describe('claves de Vercel: limpias y nunca en un mensaje (11-nov-2026)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('claveEnv saca espacios, saltos de línea y comillas de los costados, nada del medio', () => {
    vi.stubEnv('TRELLO_TOKEN', `  "${TOKEN_TRELLO}"\r\n`);
    expect(claveEnv('TRELLO_TOKEN')).toBe(TOKEN_TRELLO);
    vi.stubEnv('TRELLO_TOKEN', `'a b'`);
    expect(claveEnv('TRELLO_TOKEN')).toBe('a b');
    vi.stubEnv('TRELLO_TOKEN', '"abc');
    expect(claveEnv('TRELLO_TOKEN')).toBe('"abc'); // comilla de un solo lado: no se toca
    expect(claveEnv('NO_EXISTE_ESTA_CLAVE')).toBe('');
  });

  it('tapa el valor de cada clave, tal cual está guardado y limpio', () => {
    vi.stubEnv('TRELLO_TOKEN', `${TOKEN_TRELLO}\n`);
    vi.stubEnv('TRELLO_KEY', KEY_TRELLO);
    vi.stubEnv('KV_REST_API_TOKEN', 'AXYZkvtokenkvtoken123');
    vi.stubEnv('SHOPIFY_CLIENT_SECRET', 'secretodeshopify999');
    // El mensaje real de Node, con el salto de línea adentro.
    const real = `Headers.append: "OAuth oauth_consumer_key="${KEY_TRELLO}", oauth_token="${TOKEN_TRELLO}\n"" is an invalid header value.`;
    const limpio = ocultarSecretos(real);
    expect(limpio).not.toContain(TOKEN_TRELLO);
    expect(limpio).not.toContain(KEY_TRELLO);
    expect(limpio).toContain('is an invalid header value');
    expect(ocultarSecretos('Bearer AXYZkvtokenkvtoken123 y secretodeshopify999')).toBe('Bearer ••• y •••');
  });

  it('tapa los formatos conocidos aunque la clave no esté en esta función', () => {
    const t = ocultarSecretos([
      `oauth_token="${TOKEN_TRELLO}"`,
      `token suelto ${TOKEN_TRELLO}`,
      'x-api-key sk-ant-api03-AbCdEfGhIjKlMnOp_qr',
      ['shp', 'at_', '0123456789abcdef'.repeat(2)].join(''), // armado en partes: GitHub frena cualquier cosa con forma de token
      'https://api.trello.com/1/boards?key=abc123&token=zzz999',
      'rediss://default:clave123@host.upstash.io:6379',
      'Authorization: Basic dXN1YXJpbzpjbGF2ZQ==',
    ].join(' | '));
    for (const secreto of [TOKEN_TRELLO, 'sk-ant-api03', 'shpat_0123', 'abc123', 'zzz999', 'clave123', 'dXN1YXJpbzpjbGF2ZQ']) expect(t).not.toContain(secreto);
  });

  it('también tapa la clave escrita dentro de un JSON (\\n, comillas)', () => {
    vi.stubEnv('KV_REST_API_TOKEN', 'AXyzABCDEF12\nGHIJKLMNOP');
    const t = ocultarSecretos(JSON.stringify({ h: 'Bearer AXyzABCDEF12\nGHIJKLMNOP' }));
    expect(t).not.toContain('AXyzABCDEF12');
    expect(t).not.toContain('GHIJKLMNOP');
  });

  it('no estropea los mensajes comunes', () => {
    for (const m of [
      'Falta el token configurado en TRELLO_TOKEN de Vercel.',
      'Trello respondió 404 (board not found).',
      'La base de datos respondió 500.',
      'Iniciá sesión en la app.',
    ]) expect(ocultarSecretos(m)).toBe(m);
    // Claves vacías o muy cortas no se usan para tapar (taparían letras sueltas).
    vi.stubEnv('TRELLO_KEY', 'k');
    expect(ocultarSecretos('kilo')).toBe('kilo');
  });

  it('mensajeSeguro: Error, texto u otra cosa', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-xxxxxxxxxxxxxxxx');
    expect(mensajeSeguro(new Error('falló con sk-ant-xxxxxxxxxxxxxxxx'))).toBe('falló con •••');
    expect(mensajeSeguro('texto')).toBe('texto');
    expect(mensajeSeguro({ raro: 1 }, 'Error con Trello.')).toBe('Error con Trello.');
  });
});
