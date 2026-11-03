// Stock y talles usan confirmaciones independientes y el mismo plan que se muestra.
export function idPlan(brand,source) {
  const stock=source.changes.map(({inventoryItemId,handle,code,talle,sku,current,desired})=>({inventoryItemId,handle,code,talle,sku,current,desired}));
  const sizes=source.notFound.filter(r=>r.productId && !r.motivoNoCrear).map(({productId,handle,code,talle,talleProveedor,opcion,precio,costo,desired})=>
    ({productId,handle,code,talle,talleProveedor,opcion,precio,costo,desired}));
  return {brand,locationId:source.locationId,stock,sizes};
}
export async function idRequest(body, options={}) {
  const response=await fetch(options.url||'/api/id-stock',{method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json',...options.headers},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'No se pudo completar la operación de ID.');
  return data;
}
export async function applyRows(plan,receipt,action,indices,request=idRequest,onResult=()=>{}) {
  const groups=[];
  if(action==='stock') {
    for(let i=0;i<indices.length;i+=50) groups.push(indices.slice(i,i+50));
  } else {
    const products=new Map();
    for(const i of indices) {
      const id=plan.sizes[i].productId;
      if(!products.has(id)) products.set(id,[]);
      products.get(id).push(i);
    }
    groups.push(...products.values());
  }
  let written=0;
  const warnings=[];
  for(const group of groups) {
    try {
      const response=await request({mode:'apply',action,indices:group,plan,receipt,confirmed:true});
      if(response.written!==group.length) throw Error('Shopify no confirmó el lote completo.');
      written+=response.written;
      if(response.warning) warnings.push(response.warning);
      await onResult({action,indices:group,written:response.written,warning:response.warning});
    } catch(e) {
      return {written,unconfirmed:indices.length-written,warnings,error:e.message};
    }
  }
  return {written,unconfirmed:0,warnings,error:''};
}

