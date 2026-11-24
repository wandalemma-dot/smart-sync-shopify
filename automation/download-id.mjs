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
  let stage = 'abrir portal';
  let page;
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`${PORTAL}/ventaStock/nueva`, { waitUntil: 'domcontentloaded' });
    stage = 'completar acceso';
    await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill(process.env.ID_USERNAME);
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.ID_PASSWORD);
    // ID renamed its login button to Ingresar. Keep both exact labels, never a generic submit.
    await page.getByRole('button', { name: /^(Ingresar|Iniciar sesión)$/ }).click();
    stage = 'esperar selección de marca después del acceso';
    await page.getByRole('heading', { name: 'Seleccioná una marca', exact: true }).waitFor();
    stage = 'seleccionar marca';
    await page.getByRole('button', { name: BRANDS[brand], exact: true }).click();
    stage = 'cerrar selección de marca';
    await page.getByRole('heading', { name: 'Seleccioná una marca', exact: true }).waitFor({ state: 'hidden' });
    stage = 'abrir stock de la marca';
    await page.goto(`${PORTAL}/ventaStock/nueva`, { waitUntil: 'domcontentloaded' });
    stage = 'confirmar marca seleccionada';
    await page.getByRole('button', { name: BRANDS[brand], exact: true }).waitFor();
    stage = 'seleccionar cliente ELEVE SAS';
    await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill('ELEVE');
    await page.getByRole('option', { name: '(2059) ELEVE SAS', exact: true }).click();
    stage = 'seleccionar canal DISPONIBLE';
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
    stage = 'comprobar pedido vacío';
    // The empty order must remain non-submittable. Never fill quantity fields.
    if (await page.getByRole('button', { name: 'Enviar pedido', exact: true }).isEnabled()) {
      throw new Error('Hay cantidades cargadas; se cancela la descarga automática.');
    }
    stage = 'descargar Excel';
    const pending = page.waitForEvent('download', { timeout: 90000 });
    await page.getByRole('button', { name: DOWNLOAD, exact: true }).click();
    const download = await pending;
    const filename = resolve(directory, `${brand}.xlsx`);
    await download.saveAs(filename);
    if (await download.failure()) throw new Error('La descarga no se completó.');
    return { filename, account: 'ELEVE SAS', customerCode: '2059', brand, channel: 'DISPONIBLE', downloadedAt: new Date().toISOString() };
  } catch {
    // Only fixed stage labels: Playwright errors can contain credentials from fill().
    console.error(`ID: fallo en ${stage}. No se enviaron pedidos.`);
    if (['seleccionar marca', 'cerrar selección de marca', 'confirmar marca seleccionada'].includes(stage)) {
      // Private CI diagnostic: brand/navigation labels only, never inputs or page HTML.
      try {
        const controls = await page.locator('button, a, [role="button"]').evaluateAll(nodes => nodes
          .filter(n => n.getClientRects().length)
          .map(n => ({ tag: n.tagName, text: (n.innerText || '').trim().slice(0,150),
            label: n.getAttribute('aria-label'), images: [...n.querySelectorAll('img')].map(i => i.alt) }))
          .filter(n => /converse|coq|marca|stock/i.test(n.text + ' ' + n.label + ' ' + n.images.join(' '))).slice(0,20));
        console.error('ID: controles de marca visibles: ' + JSON.stringify(controls));
        const brandElements = await page.locator('body').evaluate(body => ({
          headings: [...body.querySelectorAll('h1,h2,h3')].filter(n => n.getClientRects().length).map(n => n.innerText.trim().slice(0,100)),
          labels: [...body.querySelectorAll('*')].filter(n => !n.children.length && n.getClientRects().length && /converse|coq/i.test(n.textContent || ''))
            .slice(0,20).map(n => ({ tag: n.tagName, text: n.textContent.trim().slice(0,100), parent: n.parentElement?.tagName, role: n.parentElement?.getAttribute('role') })),
          images: [...body.querySelectorAll('img')].filter(n => n.getClientRects().length).map(n => ({alt:n.alt, parent:n.parentElement?.tagName})).slice(0,20),
        }));
        console.error('ID: etiquetas de marca visibles: ' + JSON.stringify(brandElements));
      } catch { /* Diagnostics must not replace the original fixed-stage failure. */ }
    }
    throw new Error('No se pudo descargar el stock de ID.');
  } finally { await browser.close(); }
}
