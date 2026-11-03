import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { idPlan, idRequest, applyRows } from '../src/utils/idStockClient.js';
const root='automation-runs/reports/';
const endpoint='https://smart-sync-shopify.vercel.app/api/id-stock';
const preflight=process.env.ID_STOCK_PREFLIGHT_ONLY==='true';
const log={run:process.env.GITHUB_RUN_ID,stock:0,sizes:0,operations:[],errors:[]};
async function call(body) {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.actions.githubusercontent.com')) throw Error('Emisor de GitHub no reconocido.');
  url.searchParams.set('audience', endpoint);
  const response = await fetch(url, { headers: { Authorization: 'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN }, redirect: 'error' });
  if (!response.ok) throw Error('GitHub no autorizó esta ejecución.');
  const { value } = await response.json();
  return idRequest(body,{url:endpoint,headers:{Authorization:'Bearer '+process.env.AUTOMATION_READ_TOKEN,'X-Stock-Workflow':value}});
}
async function main() {
  if(process.env.GITHUB_REPOSITORY!=='wandalemma-dot/indy-stock-automation' || process.env.GITHUB_REF!=='refs/heads/main' ||
    !['schedule','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || !process.env.AUTOMATION_READ_TOKEN || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw Error('Ejecutor no configurado.');
  const report=JSON.parse(await readFile(root+'converse-simulation.json','utf8'));
  const {planHash,...original}=report;
  const hash=data=>createHash('sha256').update(data).digest('hex');
  const excel=await readFile('automation-runs/source/converse.xlsx');
  const age=Date.now()-Date.parse(report.provenance?.downloadedAt);
  if(hash(JSON.stringify(original))!==planHash || hash(excel)!==report.inputSha256 || !(age>=0 && age<=900000) ||
    report.sourceCommit!==process.env.STOCK_SOURCE_COMMIT || report.brand!=='converse' || report.shop!=='indy-com-ar' ||
    report.sheet!=='Plantilla' || report.mode!=='simulation' || report.writesPerformed!==0 ||
    report.provenance?.customerCode!=='2059' || report.provenance?.account!=='ELEVE SAS' || report.provenance?.brand!=='converse' ||
    report.provenance?.channel!=='DISPONIBLE' || !report.plan?.locationFound) throw Error('Falló la verificación de origen o antigüedad del Excel y su simulación.');
  const plan=idPlan('converse',report.plan);
  log.simulation=planHash;
  log.proposed={stock:plan.stock.length,sizes:plan.sizes.length};
  const {receipt}=await call({mode:'prepare',plan});
  if(preflight) {
    console.log('Verificación de solo lectura correcta: '+plan.stock.length+' cantidades y '+plan.sizes.length+' talles.');
    return;
  }
  for(const action of ['stock','sizes']) {
    const result=await applyRows(plan,receipt,action,plan[action].map((_,i)=>i),call,async entry=>{
      log[action]+=entry.written;
      log.operations.push(entry);
      await writeFile(root+'converse-resultado.json',JSON.stringify(log,null,2));
    });
    if(result.error) { log.errors.push(result.error);throw Error(result.error); }
  }
}
try { await main(); }
catch(e) { if(!log.errors.length)log.errors.push(String(e.message).slice(0,400));process.exitCode=1; }
finally {
  await writeFile(root+'converse-resultado.json',JSON.stringify(log,null,2));
  const text=preflight ? 'Verificación previa. Cambios aplicados: 0.' : 'Stock actualizado: '+log.stock+' variantes. Talles creados: '+log.sizes+'.';
  console.log(text);
  const clean=s=>String(s).replace(/[<>&\r\n`]/g,' ').slice(0,400);
  if(log.errors.length) console.error('Detenido: '+clean(log.errors[0]));
  if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,'\n### Resultado en Shopify\n\n'+text+'\n\n'+(log.errors.length?'Revisar la ejecución: '+clean(log.errors[0]):'Ejecución completada.')+'\n');
}

