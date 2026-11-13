import { parse, Kind } from 'graphql';

// Interpretar la operación real, incluidos aliases y fragments.
function inspectOperation(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 50000) throw new Error('Invalid query');
  const document = parse(query, { maxTokens: 10000 });
  const operations = document.definitions.filter(d => d.kind === Kind.OPERATION_DEFINITION);
  if (operations.length !== 1) throw new Error('Single operation required');
  if (document.definitions.some(d => ![Kind.OPERATION_DEFINITION, Kind.FRAGMENT_DEFINITION].includes(d.kind))) throw new Error('Invalid definition');
  const fragments = new Map(document.definitions.filter(d => d.kind === Kind.FRAGMENT_DEFINITION).map(d => [d.name.value, d]));
  const roots = [];
  function walk(set, visited = new Set()) {
    for (const selection of set.selections) {
      if (selection.kind === Kind.FIELD) roots.push(selection.name.value);
      else if (selection.kind === Kind.INLINE_FRAGMENT) walk(selection.selectionSet, visited);
      else {
        const name = selection.name.value;
        if (visited.has(name) || !fragments.has(name)) throw new Error('Invalid fragment');
        walk(fragments.get(name).selectionSet, new Set([...visited, name]));
      }
    }
  }
  walk(operations[0].selectionSet);
  return { operation: operations[0].operation, roots };
}

// Lecturas que van a la API 2026-07 (el resto sigue en 2024-04): los informes de ShopifyQL y las
// ventas sin preparar de iD (fulfillmentOrders con el filtro assigned_location_id, carga de iD 12-nov-2026).
const VERSION_NUEVA = new Set(['shopifyqlQuery', 'fulfillmentOrders']);
const versionNueva = roots => roots.some(name => VERSION_NUEVA.has(name));

// El bot sigue teniendo únicamente las consultas acotadas de stock.
export function inspectReadQuery(query, automation = false) {
  const { operation, roots } = inspectOperation(query);
  if (operation !== 'query') throw new Error('Read only');
  if (automation && roots.some(name => !['shop', 'locations', 'products'].includes(name))) throw new Error('Read scope');
  return { reports: versionNueva(roots) };
}

// Funciones manuales existentes, sin filtro de marca. Requiere sesión humana
// y mismo origen en el handler; no se habilita con parámetros del navegador.
const manualWrites = new Set([
  'inventorySetQuantities', 'inventoryActivate', 'productSet',
  'productVariantsBulkUpdate', 'productVariantsBulkCreate', 'productOptionsReorder',
  'tagsAdd', 'metafieldsSet', 'publishablePublish',
  // Carga de Distrinando (13-nov-2026, gax): la tabla de talle elegida reemplaza la etiqueta
  // «TABLA DE TALLE REEBOK …» anterior. Con confirmación, como el resto.
  'tagsRemove',
  // Carga de iD (12-nov-2026, gax): pasar a Martínez una venta asignada a iD, con confirmación.
  'fulfillmentOrderMove',
]);
export function inspectUserQuery(query) {
  const { operation, roots } = inspectOperation(query);
  if (operation === 'query') return { reports: versionNueva(roots) };
  if (operation !== 'mutation' || !roots.length || roots.some(name => !manualWrites.has(name))) throw new Error('Unsupported app operation');
  return { reports: false, write: true };
}
