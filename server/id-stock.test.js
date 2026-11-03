import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply, prepare } from './id-stock.js';
import handler from '../api/id-stock.js';
import { makeSession } from './access.js';

const locationId = 'gid://shopify/Location/1';
const row = { inventoryItemId: 'gid://shopify/InventoryItem/2', handle: 'modelo', code: 'ABC', talle: '42', sku: '', current: 4, desired: 2 };
const size = { productId: 'gid://shopify/Product/3', handle: 'modelo', code: 'ABC', talle: '43', opcion: 'Talle', precio: 20, costo: 10, desired: 3 };
const plan = { brand: 'converse', locationId, stock: [row], sizes: [size] };
const actor = 'bot:1:1';
function shop() {
  vi.stubEnv('APP_ACCESS_KEY', 'test-'.repeat(8));
  const product = { handle: 'modelo', vendor: 'Converse', tags: [] };
  const item = { id: row.inventoryItemId, sku: '', tracked: true, variants: { nodes: [{ title: '42', product }] },
    inventoryLevel: { quantities: [{ name: 'available', quantity: 4 }] } };
  const query = vi.fn(async (document) => {
    if (document.startsWith('query Contexto')) return { location: { id: locationId, name: 'ID (Converse - Le Coq Sportif)', isActive: true },
      currentAppInstallation: { accessScopes: ['write_products','write_inventory'].map(handle => ({handle})) } };
    if (document.startsWith('query Estado')) return { nodes: [item] };
    if (document.startsWith('query Talles')) return { product: { ...product, id: size.productId, options: [{name:'Talle'}],
      variants: { nodes: [{title:'42',price:'20'}], pageInfo: {hasNextPage:false} } } };
    if (document.startsWith('mutation Stock')) return { inventorySetQuantities: { inventoryAdjustmentGroup: {createdAt:'today'}, userErrors:[] } };
    if (document.startsWith('mutation Talles')) return { productVariantsBulkCreate: { productVariants:[{id:'new',title:'43'}], userErrors:[] } };
    if (document.startsWith('mutation Orden')) return { productOptionsReorder: {userErrors:[]} };
    throw Error('Unexpected query');
  });
  return { query, product, item };
}
const batch = (receipt, action) => ({ plan, receipt, action, indices:[0], confirmed:true });
afterEach(() => vi.unstubAllEnvs());
describe('operaciones de ID', () => {
  it('separa la verificación de la escritura y compara el stock antes de modificarlo', async () => {
    const {query} = shop();
    const receipt = await prepare(plan,actor,query);
    expect(query.mock.calls.every(([doc]) => doc.startsWith('query'))).toBe(true);
    expect((await apply(batch(receipt,'stock'),actor,query)).written).toBe(1);
    const [,variables] = query.mock.calls.find(([doc]) => doc.startsWith('mutation Stock'));
    expect(variables.input.quantities).toEqual([{locationId,inventoryItemId:row.inventoryItemId,changeFromQuantity:4,quantity:2}]);
    expect((await apply(batch(receipt,'sizes'),actor,query)).written).toBe(1);
    const [,create] = query.mock.calls.find(([doc]) => doc.startsWith('mutation Talles'));
    expect(create.variants[0].inventoryQuantities).toEqual([{locationId,availableQuantity:3}]);
  });
  it('rechaza planes alterados, otro actor, exclusiones y existencias que cambiaron', async () => {
    const {query,product,item} = shop();
    const receipt = await prepare(plan,actor,query);
    const payload = batch(receipt,'stock');
    await expect(apply({...payload,confirmed:false},actor,query)).rejects.toThrow();
    await expect(apply(payload,'bot:2:1',query)).rejects.toThrow();
    await expect(apply({...payload,plan:{...plan,sizes:[]}},actor,query)).rejects.toThrow();
    await expect(prepare({...plan,brand:'lecoq'},actor,query)).rejects.toThrow();
    product.tags.push('NO SINCRONIZAR');
    await expect(apply(payload,actor,query)).rejects.toThrow();
    product.tags.pop();
    item.inventoryLevel.quantities[0].quantity = 1;
    await expect(apply(payload,actor,query)).rejects.toThrow();
    expect(query.mock.calls.every(([doc]) => doc.startsWith('query'))).toBe(true);
  });
  it('bloquea anónimos, el token de lectura solo y una sesión en otro origen', async () => {
    shop();
    const read = 'reader-test-'.repeat(4);
    vi.stubEnv('AUTOMATION_READ_TOKEN',read);
    for (const headers of [{},{authorization:'Bearer '+read},{cookie:'__Host-stock_session='+makeSession(),origin:'https://example.org'}]) {
      const res = { setHeader:vi.fn(),status:vi.fn().mockReturnThis(),json:vi.fn() };
      await handler({method:'POST',headers,body:{mode:'prepare',plan}},res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });
});
