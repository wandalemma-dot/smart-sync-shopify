import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORTAL = 'https://store.idargentinasa.com';
const BRANDS = { converse: 'Converse', lecoq: 'Le Coq Sportif' };
const DOWNLOAD = 'Descargar el stock disponible de esta cuenta en excel para completar cantidades';

export async function selectIdBrand(page, brand) {
  if (!BRANDS[brand]) throw new Error('Marca no admitida.');
  const heading = page.getByRole('heading', { name: 'Seleccioná una marca', exact: true });
  const desired = page.getByRole('button', { name: BRANDS[brand], exact: true });
  const current = page.getByRole('button', { name: /^(Converse|Le Coq Sportif)$/ });
  await current.or(heading).first().waitFor();
  if (!await heading.isVisible() && !await desired.isVisible()) {
    await current.click();
    await heading.waitFor();
  }
  if (await heading.isVisible()) {
    // The brand menu can be shown automatically or opened from the header.
    // Scope to its smallest container with both brand labels; never pick a page-wide duplicate.
    let container = heading.locator('..');
    let selected = false;
    for (let level = 0; level < 5; level++) {
      if (await container.getByText('Converse', { exact: true }).count() === 1 &&
          await container.getByText('Le Coq Sportif', { exact: true }).count() === 1) {
        await container.getByText(BRANDS[brand], { exact: true }).click();
        selected = true;
        break;
      }
      container = container.locator('..');
    }
    if (!selected) throw new Error('Selector de marca ambiguo.');
    await heading.waitFor({ state: 'hidden' });
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
    if (['esperar selección de marca después del acceso', 'seleccionar marca', 'cerrar selección de marca', 'confirmar marca seleccionada'].includes(stage)) {
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
        const visibleText = (await page.locator('body').innerText()).split(process.env.ID_PASSWORD).join('[REDACTED]').split(process.env.ID_USERNAME).join('[REDACTED]');
        console.error('ID: pantalla posterior al ingreso: ' + visibleText.slice(0,4000));
      } catch { /* Diagnostics must not replace the original fixed-stage failure. */ }
    }
    throw new Error('No se pudo descargar el stock de ID.');
  } finally { await browser.close(); }
}
