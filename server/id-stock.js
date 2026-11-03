import { createHash, createHmac, randomUUID } from 'node:crypto';
import { sameSecret, validSecret } from './access.js';
import { ordenarTalles } from '../src/utils/ordenTalles.js';

const VENDORS = { converse: 'Converse', lecoq: 'Le Coq Sportif' };
const normal = value => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const ID_LOCATION = 'IDCONVERSELECOQSPORTIF';
const MAX_AGE = 15 * 60 * 1000;
export class PlanError extends Error {}
function requirePlan(condition, message) { if (!condition) throw new PlanError(message); }
function quantity(n) { return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647; }
function id(value, type) { return typeof value === 'string' && new RegExp('^gid://shopify/' + type + '/[0-9]+$').test(value); }
function unique(values) { return new Set(values).size === values.length; }
function checkProduct(product, row, brand) {
  requirePlan(product && product.handle === row.handle && normal(product.vendor) === normal(VENDORS[brand]) &&
    Array.isArray(product.tags) && !product.tags.some(t => normal(t) === 'NO SINCRONIZAR'),
    'El producto cambió de marca, identificación o exclusión. Volvé a simular.');
}
const CONTEXT = 'query Contexto($id: ID!) { location(id: $id) { id name isActive } currentAppInstallation { accessScopes { handle } } }';
const STOCK = 'query Estado($ids: [ID!]!, $loc: ID!) { nodes(ids:$ids) { ... on InventoryItem { id sku tracked variants(first:2) { nodes { title product { handle vendor tags } } } inventoryLevel(locationId:$loc) { quantities(names:["available"]) { name quantity } } } } }';
const PRODUCT = 'query Talles($id: ID!) { product(id:$id) { id handle vendor tags options { name } variants(first:100) { nodes { title sku price } pageInfo { hasNextPage } } } }';
const SET = 'mutation Stock($input: InventorySetQuantitiesInput!, $key: String!) { inventorySetQuantities(input:$input) @idempotent(key:$key) { inventoryAdjustmentGroup { createdAt } userErrors { message } } }';
const CREATE = 'mutation Talles($id:ID!, $variants:[ProductVariantsBulkInput!]!) { productVariantsBulkCreate(productId:$id,variants:$variants) { productVariants { id title } userErrors { message } } }';
const REORDER = 'mutation Orden($id:ID!, $options:[OptionReorderInput!]!) { productOptionsReorder(productId:$id,options:$options) { userErrors { message } } }';

function canonical(plan) {
  requirePlan(plan && Object.hasOwn(VENDORS,plan.brand) && id(plan.locationId,'Location') &&
    Array.isArray(plan.stock) && Array.isArray(plan.sizes) && plan.stock.length + plan.sizes.length <= 12000, 'Plan de ID inválido.');
  for (const row of [...plan.stock,...plan.sizes]) {
    requirePlan(row && quantity(row.desired) && [row.handle,row.talle,row.code].every(v=>typeof v==='string' && v.length>0 && v.length<=255), 'Fila de stock inválida.');
  }
  requirePlan(plan.stock.every(r=>id(r.inventoryItemId,'InventoryItem') && Number.isSafeInteger(r.current) && r.current!==r.desired && typeof r.sku==='string')
    && unique(plan.stock.map(r=>r.inventoryItemId)), 'Variante o cantidad ambigua.');
  requirePlan(plan.sizes.every(r=>id(r.productId,'Product') && r.opcion && Number.isFinite(r.precio) && r.precio>0 && Number.isFinite(r.costo) && r.costo>=0)
    && unique(plan.sizes.map(r=>r.productId+'|'+normal(r.talle))), 'Talle, precio o costo inválido.');
  return plan;
}
async function checkLocation(plan, query) {
  const {location,currentAppInstallation} = await query(CONTEXT,{id:plan.locationId});
  requirePlan(location?.id===plan.locationId && location.isActive && normal(location.name).replace(/[^A-Z0-9]/g,'')===ID_LOCATION, 'La sucursal no es ID.');
  const scopes = new Set(currentAppInstallation?.accessScopes?.map(s=>s.handle));
  requirePlan(!plan.stock.length || scopes.has('write_inventory'), 'A la app de Shopify le falta write_inventory.');
  requirePlan(!plan.sizes.length || (scopes.has('write_products') && scopes.has('write_inventory')), 'A la app de Shopify le falta permiso para variantes o inventario.');
}
async function checkStock(rows,plan,query) {
  const {nodes}=await query(STOCK,{ids:rows.map(r=>r.inventoryItemId),loc:plan.locationId});
  requirePlan(Array.isArray(nodes) && nodes.length===rows.length,'Shopify no devolvió todos los artículos.');
  for (let i=0;i<rows.length;i++) {
    const r=rows[i], item=nodes[i], variants=item?.variants?.nodes;
    requirePlan(item?.id===r.inventoryItemId && item.tracked && variants?.length===1 &&
      variants[0].title===r.talle && (item.sku??'')===r.sku,'Cambió la identificación de una variante. Volvé a simular.');
    checkProduct(variants[0].product,r,plan.brand);
    const available=item.inventoryLevel?.quantities?.find(q=>q.name==='available');
    requirePlan(available?.quantity===r.current, r.code+' talle '+r.talle+': cambió el stock. Volvé a simular.');
  }
}
async function checkSizes(rows,plan,query) {
  const {product}=await query(PRODUCT,{id:rows[0].productId});
  const variants=product?.variants?.nodes;
  requirePlan(product?.id===rows[0].productId && Array.isArray(variants) && variants.length>0 && variants.length<100 &&
    product.variants.pageInfo?.hasNextPage===false && product.options?.length===1,'Catálogo incompleto. Volvé a simular.');
  for(const r of rows) {
    checkProduct(product,r,plan.brand);
    requirePlan(product.id===r.productId && product.options[0].name===r.opcion &&
      variants.every(v=>Math.round(Number(v.price)*100)===Math.round(r.precio*100)), 'Cambió el precio o la opción del producto. Volvé a simular.');
    requirePlan(!variants.some(v=>normal(v.title)===normal(r.talle)), r.code+': el talle '+r.talle+' ya existe. Volvé a simular.');
  }
  return variants.map(v=>v.title);
}
function batches(rows,limit) {
  const result=[];
  for(let i=0;i<rows.length;i+=limit) result.push(rows.slice(i,i+limit));
  return result;
}
function byProduct(rows) {
  const groups=new Map();
  for(const r of rows) {
    if(!groups.has(r.productId)) groups.set(r.productId,[]);
    groups.get(r.productId).push(r);
  }
  return groups.values();
}
function sign(plan,receipt,actor) {
  if(!validSecret(process.env.APP_ACCESS_KEY)) throw new PlanError('Falta configurar el acceso seguro.');
  return createHmac('sha256',process.env.APP_ACCESS_KEY).update(JSON.stringify(['id-stock-v1',actor,receipt.id,receipt.expires,plan])).digest('hex');
}
export async function prepare(plan,actor,query) {
  canonical(plan);
  if(actor.startsWith('bot:')) requirePlan(plan.brand==='converse','El bot solo puede procesar Converse.');
  await checkLocation(plan,query);
  for(const rows of batches(plan.stock,50)) await checkStock(rows,plan,query);
  for(const rows of byProduct(plan.sizes)) await checkSizes(rows,plan,query);
  const receipt={id:randomUUID(),expires:Date.now()+MAX_AGE};
  return {...receipt,signature:sign(plan,receipt,actor)};
}
function checkedPayload(payload) {
  requirePlan(payload && Array.isArray(payload.userErrors), 'Shopify no confirmó la operación. Volvé a simular.');
  requirePlan(!payload.userErrors.length, payload.userErrors.map(e=>e.message).join(' · '));
  return payload;
}
export async function apply({plan,receipt,action,indices,confirmed},actor,query) {
  canonical(plan);
  requirePlan(confirmed===true && receipt && receipt.expires>Date.now() && receipt.expires<=Date.now()+MAX_AGE &&
    sameSecret(receipt.signature,sign(plan,receipt,actor)), 'La simulación venció o cambió. Volvé a simular.');
  requirePlan(action==='stock' || action==='sizes','Acción no admitida.');
  requirePlan(Array.isArray(indices) && indices.length>0 && indices.length<=100 && unique(indices) &&
    indices.every(i=>Number.isSafeInteger(i) && i>=0 && i<plan[action].length),'Selección inválida.');
  const rows=indices.map(i=>plan[action][i]);
  await checkLocation(plan,query);
  if(action==='stock') {
    requirePlan(rows.length<=50,'Lote demasiado grande.');
    await checkStock(rows,plan,query);
    const key=createHash('sha256').update(receipt.id+':'+indices.join(',')).digest('hex');
    const input={name:'available',reason:'correction',referenceDocumentUri:'gid://indy/StockPlan/'+receipt.id,
      quantities:rows.map(r=>({inventoryItemId:r.inventoryItemId,locationId:plan.locationId,quantity:r.desired,changeFromQuantity:r.current}))};
    const data=await query(SET,{input,key});
    requirePlan(checkedPayload(data.inventorySetQuantities).inventoryAdjustmentGroup,'Shopify no confirmó el ajuste.');
    return {written:rows.length,warning:''};
  }
  const original=await checkSizes(rows,plan,query);
  const productId=rows[0].productId;
  const variants=rows.map(r=>({optionValues:[{name:r.talle,optionName:r.opcion}],price:String(r.precio),
    inventoryItem:{tracked:true,...(r.costo>0?{cost:String(r.costo)}:{})},
    inventoryQuantities:[{locationId:plan.locationId,availableQuantity:r.desired}]}));
  const data=await query(CREATE,{id:productId,variants});
  const created=checkedPayload(data.productVariantsBulkCreate).productVariants;
  requirePlan(Array.isArray(created) && created.length===rows.length && rows.every(r=>created.some(v=>v.id && v.title===r.talle)), 'Alta sin confirmar por completo. Volvé a simular antes de reintentar.');
  const order=ordenarTalles([...original,...rows.map(r=>r.talle)]);
  let warning='';
  if(order) try {
    const sorted=await query(REORDER,{id:productId,options:[{name:rows[0].opcion,values:order.map(name=>({name}))}]});
    checkedPayload(sorted.productOptionsReorder);
  } catch { warning='Los talles se crearon, pero no se pudo confirmar su orden.'; }
  return {written:created.length,warning};
}

