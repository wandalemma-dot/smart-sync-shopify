import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { downloadIdStock } from './download-id.mjs';

vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));
let directory;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it.each(['Ingresar', 'Iniciar sesión'])('envía el acceso con el nombre real %s y espera la marca', async label => {
  directory = await mkdtemp(join(tmpdir(), 'id-login-test-'));
  vi.stubEnv('ID_USERNAME', 'fixture@example.invalid');
  vi.stubEnv('ID_PASSWORD', 'fixture-secret');
  const submitted = vi.fn();
  const closed = vi.fn();
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const page = {
    setDefaultTimeout() {}, goto: async () => {},
    getByLabel: () => ({ fill: async () => {} }),
    getByRole(role, { name }) {
      if (role === 'textbox') return { fill: async () => {} };
      if (role === 'button') return { click: async () => {
        if (!(name instanceof RegExp && name.test(label))) throw new Error('Botón no encontrado');
        expect(name.test('Ingresar pedido')).toBe(false);
        submitted();
      } };
      // Stop at the authenticated boundary: this test must never select a channel or order.
      return { waitFor: async () => { throw new Error('Authentication fixture boundary'); } };
    },
  };
  chromium.launch.mockResolvedValue({ newContext: async () => ({ newPage: async () => page }), close: closed });
  await expect(downloadIdStock('converse', directory)).rejects.toThrow('No se pudo descargar');
  expect(submitted).toHaveBeenCalledOnce();
  expect(logged).toHaveBeenCalledWith('ID: fallo en esperar selección de marca después del acceso. No se enviaron pedidos.');
  expect(closed).toHaveBeenCalledOnce();
});

it('no expone valores de campos cuando Playwright falla al completar el acceso', async () => {
  directory = await mkdtemp(join(tmpdir(), 'id-login-test-'));
  vi.stubEnv('ID_USERNAME', 'fixture@example.invalid');
  vi.stubEnv('ID_PASSWORD', 'fixture-secret');
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const page = {
    setDefaultTimeout() {}, goto: async () => {},
    getByRole: () => ({ fill: async () => {} }),
    getByLabel: () => ({ fill: async value => { throw new Error(`fill(${value}) failed`); } }),
  };
  chromium.launch.mockResolvedValue({ newContext: async () => ({ newPage: async () => page }), close: async () => {} });
  await expect(downloadIdStock('lecoq', directory)).rejects.toThrow('No se pudo descargar el stock de ID.');
  expect(logged.mock.calls.flat().join(' ')).toBe('ID: fallo en completar acceso. No se enviaron pedidos.');
});
