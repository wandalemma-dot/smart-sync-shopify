import { createHash } from 'node:crypto';
import { allowedOrigin, identity, noStore } from '../server/access.js';
import { workflowActor } from '../server/stock-workflow.js';
import { obtenerToken } from '../server/shopify-token.js';
import { apply, prepare, PlanError } from '../server/id-stock.js';
export const maxDuration = 120;
const URL = 'https://indy-com-ar.myshopify.com/admin/api/2026-07/graphql.json';
export default async function handler(req,res) {
  noStore(res);
  if(req.method!=='POST') return res.status(405).json({error:'Se requiere POST.'});
  const caller = identity(req);
  const bot = caller === 'automation' && await workflowActor(req.headers['x-stock-workflow']);
  const human = caller === 'user' && allowedOrigin(req);
  if (!bot && !human) return res.status(401).json({error:'Acceso de escritura no autorizado.'});
  if(!String(req.headers['content-type']||'').startsWith('application/json')) return res.status(415).json({error:'Se requiere JSON.'});
  if(!['prepare','apply'].includes(req.body?.mode)) return res.status(400).json({error:'Operación inválida.'});
  const actor=bot || 'user:'+createHash('sha256').update((req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-stock_session='))||'').digest('hex');
  async function query(document,variables) {
    const token=await obtenerToken();
    const response=await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query:document,variables}),redirect:'error',signal:AbortSignal.timeout(45000)});
    if(!response.ok) throw Error('Shopify API');
    const json=await response.json();
    if(json.errors?.length || !json.data) throw new PlanError(json.errors?.[0]?.message?.slice(0,280)||'Shopify no confirmó el resultado.');
    return json.data;
  }
  try {
    const result=req.body.mode==='prepare'?{receipt:await prepare(req.body.plan,actor,query)}:await apply(req.body,actor,query);
    return res.status(200).json(result);
  } catch(e) {
    return res.status(e instanceof PlanError?409:502).json({error:e instanceof PlanError?e.message:'No se pudo verificar la respuesta de Shopify. Volvé a simular antes de reintentar.'});
  }
}

