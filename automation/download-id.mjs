import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORTAL = 'https://store.idargentinasa.com';
const BRANDS = { converse: 'Converse', lecoq: 'Le Coq Sportif' };
const DOWNLOAD = 'Descargar el stock disponible de esta cuenta en excel para completar cantidades';

export async function selectIdBrand(page, brand) {
  if (!BRANDS[brand]) throw new Error('Marca no admitida.');
  const headings = page.getByRole('heading', { name: 'Seleccioná una marca', exact: true });
  const desired = page.getByRole('button', { name: BRANDS[brand], exact: true });
  const current = page.getByRole('button', { name: /^(Converse|Le Coq Sportif)$/ });
  const choose = page.getByRole('button', { name: 'Elegir marca', exact: true });
  await current.or(choose).first().waitFor();
  if (await choose.isVisible()) {
    await choose.click();
  } else if (!await desired.isVisible()) {
    await current.click();
  }
  if (await headings.count()) {
    await page.getByText('Converse', { exact: true }).first().waitFor();
    await page.getByText('Le Coq Sportif', { exact: true }).first().waitFor();
    // The brand menu can be shown automatically or opened from the header.
    // Scope to its smallest container with both brand labels; never pick a page-wide duplicate.
    let selected = false;
    for (const heading of await headings.all()) {
      let container = heading.locator('..');
      for (let level = 0; level < 5; level++) {
        if (await container.getByRole('heading', { name: 'Seleccioná una marca', exact: true }).count() === 1 &&
            await container.getByText('Converse', { exact: true }).count() === 1 &&
            await container.getByText('Le Coq Sportif', { exact: true }).count() === 1) {
          await container.getByText(BRANDS[brand], { exact: true }).click();
          await heading.waitFor({ state: 'hidden' });
          selected = true;
          break;
        }
        container = container.locator('..');
      }
      if (selected) break;
    }
    if (!selected) throw new Error('Selector de marca ambiguo.');
  }
  await desired.waitFor();
  if (await desired.count() !== 1) throw new Error('No se pudo confirmar la marca.');
}

export async function selectIdCustomer(page) {
  const customer = page.getByText('(2059) ELEVE SAS', { exact: true });
  // The new portal selects the account automatically. Allow that transition to finish first.
  try { await customer.waitFor({ timeout: 8000 }); }
  catch {
    await page.getByRole('combobox', { name: /buscar cliente/i }).fill('ELEVE');
    await page.getByRole('option', { name: '(2059) ELEVE SAS', exact: true }).click();
    await customer.waitFor();
  }
  if (await customer.count() !== 1) throw new Error('Cliente ambiguo.');
}

/** A fresh, non-persistent browser: never save cookies, traces or passwords. */
export async function downloadIdStock(brand, directory) {
  if (!BRANDS[brand]) throw new Error('Marca no admitida.');
  if (!process.env.ID_USERNAME || !process.env.ID_PASSWORD) throw new Error('Faltan ID_USERNAME e ID_PASSWORD en el almacén de secretos del ejecutor.');
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let stage = 'abrir portal';
  let page;
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(PORTAL, { waitUntil: 'domcontentloaded' });
    stage = 'completar acceso';
    await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill(process.env.ID_USERNAME);
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.ID_PASSWORD);
    // ID renamed its login button to Ingresar. Keep both exact labels, never a generic submit.
    await page.getByRole('button', { name: /^(Ingresar|Iniciar sesión)$/ }).click();
    stage = 'abrir Pedidos de Stock';
    await page.getByRole('button', { name: /^Pedidos de Stock\s+Cargar y seguir pedidos de stock\.$/ }).click();
    stage = 'seleccionar marca';
    await selectIdBrand(page, brand);
    stage = 'seleccionar cliente ELEVE SAS';
    await selectIdCustomer(page);
    stage = 'comprobar pedido vacío';
    // The empty order must remain non-submittable. Never fill quantity fields.
    const submit = page.getByRole('button', { name: 'Finalizar compra', exact: true });
    await submit.waitFor();
    if (await submit.isEnabled()) {
      throw new Error('Hay cantidades cargadas; se cancela la descarga automática.');
    }
    stage = 'descargar Excel';
    // As demonstrated by the owner on 24 Nov, this exports available account stock
    // even with Canal = Sin elegir. It is independent of the order's channel selector.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      page.getByRole('button', { name: DOWNLOAD, exact: true }).click(),
    ]);
    const filename = resolve(directory, `${brand}.xlsx`);
    await download.saveAs(filename);
    if (await download.failure()) throw new Error('La descarga no se completó.');
    return { filename, account: 'ELEVE SAS', customerCode: '2059', brand, channel: 'DISPONIBLE',
      exportMode: 'stock-disponible-por-cuenta', channelSelected: false, downloadedAt: new Date().toISOString() };
  } catch {
    // Only fixed stage labels: Playwright errors can contain credentials from fill().
    console.error(`ID: fallo en ${stage}. No se enviaron pedidos.`);
    throw new Error('No se pudo descargar el stock de ID.');
  } finally { await browser.close(); }
}
