import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { processFiles, STOCK_LOCATION } from '../src/utils/syncLogic';
import { planStockWrite } from '../src/utils/writeStock';
import { mismaSucursal } from '../src/utils/shopify';
import { parsePlantillaPedido, esPlantillaPedido } from '../src/utils/plantillaPedido';
import { inspectReadQuery } from '../server/read-policy.js';
import { downloadIdStock } from './download-id.mjs';

const APP = 'https://smart-sync-shopify.vercel.app';
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));

export async function protectTransport(token: string) {
  if (!token || token.length < 32) throw new Error('Falta AUTOMATION_READ_TOKEN en el almacén de secretos.');
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const probeBody = JSON.stringify({ query: '{ shop { myshopifyDomain } }' });
  const anonymous = await nativeFetch(`${APP}/api/shopify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: probeBody, redirect: 'error', signal: AbortSignal.timeout(45000) });
  if (anonymous.status !== 401) throw new Error('La API no rechaza la consulta anónima con 401. No se inicia la automatización.');
  const readOnlyFetch: typeof fetch = async (input, init) => {
    if (input !== '/api/shopify' || init?.method !== 'POST' || typeof init.body !== 'string') throw new Error('Destino no permitido.');
    const body = JSON.parse(init.body);
    inspectReadQuery(body.query, true);
    return nativeFetch(`${APP}/api/shopify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000),
    });
  };
  const check = await readOnlyFetch('/api/shopify', { method: 'POST', body: probeBody });
  const data = await check.json();
  if (!check.ok || data?.data?.shop?.myshopifyDomain !== 'indy-com-ar.myshopify.com') throw new Error('No se pudo verificar el acceso autenticado a la tienda esperada.');
  globalThis.fetch = readOnlyFetch;
  return () => { globalThis.fetch = nativeFetch; };
}

export async function simulate(brand: 'converse' | 'lecoq', filename: string, destination: string, provenance: Record<string, unknown>) {
  if (!['converse', 'lecoq'].includes(brand)) throw new Error('Marca no admitida.');
  const bytes = await readFile(filename);
  if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new Error('Excel vacío o demasiado grande.');
  const workbook = XLSX.read(bytes);
  if (!workbook.Sheets.Plantilla) throw new Error('Falta la hoja Plantilla.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Plantilla, { header: 1 });
  if (!esPlantillaPedido(rows)) throw new Error('Formato de plantilla no reconocido.');
  const parsed = parsePlantillaPedido(rows, brand);
  if (parsed.productos === 0 || Object.values(parsed.items).some(p => Object.values(p.sizes).some(n => !Number.isSafeInteger(n) || n < 0))) throw new Error('Stock vacío o inválido. No se calculan bajas.');
  const config = { brand, sheetName: 'Plantilla' } as const;
  const inputFile = new File([bytes], `${brand}.xlsx`);
  const result = await processFiles(inputFile, null, null, config);
  const plan = await planStockWrite(result, config);
  if (!plan.locationFound || !plan.locationId || !mismaSucursal(plan.locationName, STOCK_LOCATION[brand])) throw new Error('Sucursal ID no verificada.');
  const unique = new Set();
  for (const change of plan.changes) {
    if (!change.inventoryItemId || unique.has(change.inventoryItemId) || !Number.isSafeInteger(change.current) || !Number.isSafeInteger(change.desired) || change.desired < 0) throw new Error('Plan con variantes repetidas o cantidades inválidas.');
    unique.add(change.inventoryItemId);
  }
  const report = {
    mode: 'simulation', approved: false, writesPerformed: 0, createdAt: new Date().toISOString(),
    shop: 'indy-com-ar', brand, sheet: 'Plantilla', provenance, inputSha256: sha256(bytes),
    sourceCommit: process.env.STOCK_SOURCE_COMMIT || 'local-unreleased',
    summary: { productsInFile: parsed.productos, changes: plan.changes.length, toZero: plan.changes.filter(c => c.desired === 0).length,
      unchanged: plan.unchanged, unmatched: plan.notFound.length, inactive: plan.sinActivar.length, excluded: plan.excluidos.length },
    plan, alerts: result.alerts,
  };
  const planHash = sha256(JSON.stringify(report));
  await mkdir(destination, { recursive: true });
  await writeFile(resolve(destination, `${brand}-simulation.json`), JSON.stringify({ ...report, planHash }, null, 2));
  const table = plan.changes.map(c => `<tr><td>${html(c.title)}</td><td>${html(c.code)}</td><td>${html(c.sku)}</td><td>${html(c.talle)}</td><td>${c.current}</td><td>${c.desired}</td><td>${c.desired-c.current}</td><td>${html(c.motivo)}</td></tr>`).join('');
  await writeFile(resolve(destination, `${brand}-simulation.html`), `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Simulación ${html(brand)}</title><style>body{font:16px system-ui;margin:32px;color:#15202b}table{border-collapse:collapse;width:100%}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:left}th{background:#edf2f7;position:sticky;top:0}code{overflow-wrap:anywhere}</style><h1>Simulación de stock: ${html(brand)}</h1><p>ELEVE SAS · DISPONIBLE · ${html(report.createdAt)}</p><p><b>No se aplicó ningún cambio.</b> Este informe no concede autorización para escribir.</p><p>Sucursal: ${html(plan.locationName)} · ${report.summary.changes} cambios · ${report.summary.toZero} pasan a cero · ${report.summary.unchanged} sin cambios · ${report.summary.excluded} productos excluidos.</p><p>Sin ubicar: ${report.summary.unmatched}. Sin alta: ${report.summary.inactive}. Talles corridos: ${plan.talleCorrido.length}. Detalles completos en el JSON adjunto.</p><table><thead><tr><th>Producto</th><th>Código ID</th><th>SKU</th><th>Talle</th><th>Actual</th><th>Propuesto</th><th>Diferencia</th><th>Motivo</th></tr></thead><tbody>${table}</tbody></table><p>Identificador de la simulación: <code>${planHash}</code></p></html>`);
  return report.summary;
}

async function main() {
  const brands = (process.env.STOCK_BRANDS || 'converse').split(',');
  if (brands.some(b => !['converse', 'lecoq'].includes(b)) || new Set(brands).size !== brands.length) throw new Error('STOCK_BRANDS inválido.');
  const restore = await protectTransport(process.env.AUTOMATION_READ_TOKEN || '');
  try {
    const root = resolve(process.env.STOCK_OUTPUT_DIR || 'automation-runs');
    for (const brand of brands as ('converse' | 'lecoq')[]) {
      const source = await downloadIdStock(brand, resolve(root, 'source'));
      const summary = await simulate(brand, source.filename, resolve(root, 'reports'), source);
      console.log(`${brand}: simulación guardada, ${summary.changes} cambios propuestos; 0 escrituras.`);
    }
  } finally { restore(); }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/automation/preview.ts')) main().catch(() => {
  // Raw Playwright errors can include field values. Never log them in CI.
  console.error('La simulación se detuvo. Revisar acceso, configuración y formato del proveedor. No se aplicaron cambios.');
  process.exitCode = 1;
});
