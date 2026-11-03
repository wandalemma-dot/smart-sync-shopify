import { appendFile, readFile } from 'node:fs/promises';
import { protectTransport, simulate } from './preview';
import { idPlan } from '../src/utils/idStockClient.js';

const root = 'automation-runs/reports';
const report = JSON.parse(await readFile(root + '/converse-simulation.json', 'utf8'));
const restore = await protectTransport(process.env.AUTOMATION_READ_TOKEN || '');
try {
  await simulate('converse', 'automation-runs/source/converse.xlsx', root + '/verificacion', report.provenance);
  const fresh = JSON.parse(await readFile(root + '/verificacion/converse-simulation.json', 'utf8'));
  const remaining = idPlan('converse', fresh.plan);
  const text = 'Comparación final con el mismo Excel: ' + remaining.stock.length +
    ' diferencias de cantidad y ' + remaining.sizes.length + ' talles habilitados pendientes.';
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, '\n' + text + '\n');
  if (remaining.stock.length || remaining.sizes.length) process.exitCode = 1;
} finally {
  restore();
}
