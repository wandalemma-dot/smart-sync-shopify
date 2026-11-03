import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORTAL = 'https://store.idargentinasa.com';
const BRANDS = { converse: 'Converse', lecoq: 'Le Coq Sportif' };
const DOWNLOAD = 'Descargar el stock disponible de esta cuenta en excel para completar cantidades';

/** A fresh, non-persistent browser: never save cookies, traces or passwords. */
export async function downloadIdStock(brand, directory) {
  if (!BRANDS[brand]) throw new Error('Marca no admitida.');
  if (!process.env.ID_USERNAME || !process.env.ID_PASSWORD) throw new Error('Faltan ID_USERNAME e ID_PASSWORD en el almacén de secretos del ejecutor.');
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`${PORTAL}/ventaStock/nueva`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill(process.env.ID_USERNAME);
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.ID_PASSWORD);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByRole('heading', { name: 'Seleccioná una marca', exact: true }).waitFor();
    await page.getByRole('button', { name: BRANDS[brand], exact: true }).click();
    await page.getByRole('heading', { name: 'Seleccioná una marca', exact: true }).waitFor({ state: 'hidden' });
    await page.goto(`${PORTAL}/ventaStock/nueva`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: BRANDS[brand], exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill('ELEVE');
    await page.getByRole('option', { name: '(2059) ELEVE SAS', exact: true }).click();
    await page.getByRole('button', { name: 'Elegir canal', exact: true }).first().click();
    // Le Coq offers other channels as well. Never use the first Select button.
    const channel = page.getByRole('heading', { name: 'DISPONIBLE', exact: true });
    await channel.waitFor();
    // ID puts the label in an inner div and the action in the surrounding card.
    const card = channel.locator('..').locator('..');
    const select = card.getByRole('button', { name: 'Seleccionar', exact: true });
    if (await card.getByRole('heading').count() !== 1 || await select.count() !== 1) {
      throw new Error('Tarjeta DISPONIBLE ambigua. Se cancela sin elegir otro canal.');
    }
    await select.click();
    await page.getByRole('button', { name: 'DISPONIBLE', exact: true }).waitFor();
    // The empty order must remain non-submittable. Never fill quantity fields.
    if (await page.getByRole('button', { name: 'Enviar pedido', exact: true }).isEnabled()) {
      throw new Error('Hay cantidades cargadas; se cancela la descarga automática.');
    }
    const pending = page.waitForEvent('download', { timeout: 90000 });
    await page.getByRole('button', { name: DOWNLOAD, exact: true }).click();
    const download = await pending;
    const filename = resolve(directory, `${brand}.xlsx`);
    await download.saveAs(filename);
    if (await download.failure()) throw new Error('La descarga no se completó.');
    return { filename, account: 'ELEVE SAS', customerCode: '2059', brand, channel: 'DISPONIBLE', downloadedAt: new Date().toISOString() };
  } finally { await browser.close(); }
}
