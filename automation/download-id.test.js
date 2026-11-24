import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { downloadIdStock, selectIdBrand, selectIdCustomer } from './download-id.mjs';

vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));
let directory;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it.each(['Ingresar', 'Iniciar sesión'])('envía el acceso con el nombre real %s y busca Pedidos de Stock', async label => {
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
  expect(logged).toHaveBeenCalledWith('ID: fallo en abrir Pedidos de Stock. No se enviaron pedidos.');
  expect(closed).toHaveBeenCalledOnce();
});

it('espera la cuenta seleccionada automáticamente sin escribir en el buscador', async () => {
  const page = { getByText: vi.fn(() => ({ waitFor: async () => {}, count: async () => 1 })),
    getByRole: vi.fn(() => { throw new Error('No debe buscar otra cuenta'); }) };
  await selectIdCustomer(page);
  expect(page.getByRole).not.toHaveBeenCalled();
  expect(page.getByText).toHaveBeenCalledWith('(2059) ELEVE SAS', { exact: true });
});

it('busca únicamente ELEVE SAS cuando no se seleccionó automáticamente', async () => {
  const waitFor = vi.fn().mockRejectedValueOnce(new Error('No auto-selection')).mockResolvedValue(undefined);
  const fill = vi.fn(), click = vi.fn();
  const page = { getByText: () => ({ waitFor, count: async () => 1 }),
    getByRole: vi.fn(role => role === 'combobox' ? { fill } : { click }) };
  await selectIdCustomer(page);
  expect(fill).toHaveBeenCalledWith('ELEVE');
  expect(page.getByRole).toHaveBeenCalledWith('option', { name: '(2059) ELEVE SAS', exact: true });
  expect(click).toHaveBeenCalledOnce();
});

function brandPage(currentBrand, initialMenu = false, ambiguous = false) {
  let menu = initialMenu;
  const clicked = [];
  function container(depth) {
    return { locator: () => container(depth + 1), getByRole: () => ({ count: async () => 1 }), getByText: name => ({
      count: async () => !depth ? 0 : ambiguous ? 2 : 1,
      click: async () => { clicked.push(name); currentBrand = name; menu = false; },
    }) };
  }
  const heading = { isVisible: async () => menu, locator: () => container(0),
    count: async () => menu ? 1 : 0, all: async () => menu ? [heading] : [],
    waitFor: async options => { expect(menu).toBe(options?.state !== 'hidden'); } };
  const current = { or: () => ({ first: () => ({ waitFor: async () => {} }) }),
    click: async () => { clicked.push('open menu'); menu = true; } };
  const page = { getByText: () => ({ first: () => ({ waitFor: async () => { expect(menu).toBe(true); } }) }),
    getByRole: (role, { name }) => role === 'heading' ? heading : name instanceof RegExp ? current : name === 'Elegir marca' ? {
      isVisible: async () => !currentBrand, click: async () => { clicked.push('choose brand'); menu = true; },
    } : {
    isVisible: async () => menu || currentBrand === name,
    waitFor: async () => { expect(currentBrand).toBe(name); expect(menu).toBe(false); },
    count: async () => currentBrand === name && !menu ? 1 : 0,
  } };
  return { page, clicked };
}

it('conserva la marca correcta cuando el portal ya la recuerda', async () => {
  const fixture = brandPage('Converse');
  await selectIdBrand(fixture.page, 'converse');
  expect(fixture.clicked).toEqual([]);
});

it('abre Elegir marca en una sesión nueva, aunque el portal muestre un encabezado sin opciones', async () => {
  const fixture = brandPage(null);
  await selectIdBrand(fixture.page, 'converse');
  expect(fixture.clicked).toEqual(['choose brand', 'Converse']);
});

it('cambia la marca desde el encabezado antes de descargar', async () => {
  const fixture = brandPage('Converse');
  await selectIdBrand(fixture.page, 'lecoq');
  expect(fixture.clicked).toEqual(['open menu', 'Le Coq Sportif']);
});

it('elige la marca en el menú inicial y rechaza opciones ambiguas', async () => {
  const fixture = brandPage('Le Coq Sportif', true);
  await selectIdBrand(fixture.page, 'converse');
  expect(fixture.clicked).toEqual(['Converse']);
  const invalid = brandPage('Le Coq Sportif', true, true);
  await expect(selectIdBrand(invalid.page, 'converse')).rejects.toThrow('ambiguo');
  expect(invalid.clicked).toEqual([]);
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
