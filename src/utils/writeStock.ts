// ============================================================================
// ESCRITURA DE STOCK EN SHOPIFY (con simulación / dry-run)
// ----------------------------------------------------------------------------
// Dos pasos, siempre en este orden:
//   1) planStockWrite()  -> LEE el stock actual en vivo y calcula qué cambiaría.
//                           NO escribe nada. Sirve para el preview.
//   2) executeStockWrite() -> ESCRIBE de verdad, usando el plan del paso 1.
//                             Solo toca cantidades (inventorySetQuantities).
// Nunca crea, borra ni cambia precios.
// ============================================================================

import { shopifyGraphQL, mismaSucursal } from './shopify';
import { talleMatches, STOCK_LOCATION, converseTablaInfo, talleShopifyLeCoq } from './syncLogic';
import type { SyncResult, SyncConfig } from './syncLogic';

export interface StockChange {
  handle: string;
  title: string;
  talle: string;
  sku: string;
  code: string; // código del proveedor (Código Item del Excel)
  inventoryItemId: string;
  current: number;
  desired: number;
  // Si viene, explica por qué se pone en 0 (el proveedor ya no lo lista).
  motivo?: string;
}

// Fila "informativa" (no se escribe nada): sirve para que se vea en pantalla que
// el producto SÍ fue procesado, aunque no haya nada para cambiar.
export interface StockRow {
  title: string;
  code: string;           // código del proveedor
  talle: string;          // talle como figura en Shopify (o el buscado, si no se ubicó)
  talleProveedor: string; // talle tal cual viene en el Excel del proveedor
  current: number | null; // null = no se pudo ubicar la variante en Shopify
  desired: number;
  // Solo lo llevan las filas de `sinActivar`: hace falta para darlas de alta.
  inventoryItemId?: string;
  // Solo lo llevan las filas de `notFound`: hace falta para poder CREAR el
  // talle que falta. Precio y costo salen del archivo de iD (regla de Wanda,
  // 31-ago-2026): costo = lista − 7%, precio = sugerido si es básico o ×2,27.
  handle?: string;
  productId?: string;
  opcion?: string;        // nombre de la opción en Shopify ("Talle")
  precio?: number;
  costo?: number;
}

// Un producto cuyos talles quedaron corridos en Shopify (dice 36 y es un 35).
export interface ProductoTalleCorrido {
  handle: string;
  productId: string;
  code: string;
  title: string;
  opcion: string;                 // nombre de la opción en Shopify ("Talle")
  aciertosConConversion: number;  // la evidencia que respalda el diagnóstico
  aciertosSinConversion: number;
  variantes: { variantId: string; sku: string; actual: string; nuevo: string }[];
}

export interface StockPlan {
  locationName: string;
  locationId: string | null;
  locationFound: boolean;
  changes: StockChange[];
  unchanged: number;
  unchangedRows: StockRow[]; // ya coinciden: solo para mostrar, no se escriben
  notFound: StockRow[];      // variantes del proveedor que no se pudieron ubicar en Shopify
  // Variantes que existen en Shopify pero NO están dadas de alta en esta
  // sucursal. Shopify no deja escribirles stock: devuelve
  // "The specified inventory item is not stocked at the location."
  // Se muestran, NO se escriben. Wanda decidió activarlas ella a mano.
  sinActivar: StockRow[];
  // Productos cuyos talles quedaron corridos en Shopify (residuo del error
  // viejo de Le Coq). NO se barren a cero hasta enderezarlos.
  talleCorrido: ProductoTalleCorrido[];
  // Filas de stock que quedaron APARTADAS porque su producto tiene el talle
  // corrido. No se escriben. Van separadas de `unchangedRows` a propósito: no
  // es que no tengan cambios, es que no se pueden aplicar todavía.
  apartadosPorCorrido: StockRow[];
}

export interface WriteResult {
  written: number;
  failed: number;
  errors: string[];
}

const LOCATIONS_QUERY = `query { locations(first: 50) { edges { node { id name } } } }`;

const PRODUCTS_BY_HANDLE = `
  query($q: String!, $loc: ID!) {
    products(first: 50, query: $q) {
      edges {
        node {
          id
          handle
          title
          tags
          options { name }
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                inventoryItem {
                  id
                  inventoryLevel(locationId: $loc) {
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const SET_MUTATION = `
  mutation Set($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

// Renombra el talle de varias variantes de UN producto, en una sola llamada.
// NO toca el stock: la mercadería se queda en la misma variante, que pasa a
// llamarse como corresponde (el 36 que en realidad era un 35 pasa a decir 35).
const RENAME_MUTATION = `
  mutation Renombrar($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id title }
      userErrors { field message }
    }
  }
`;

// Crea variantes nuevas en un producto que ya existe. Se usa para los talles
// que el proveedor tiene y en Shopify no existen ("No ubicados").
const CREATE_VARIANTS = `
  mutation CrearTalles($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id title }
      userErrors { field message }
    }
  }
`;

// Da de alta un inventory item en una sucursal y, de paso, le pone la cantidad.
// Es la ÚNICA forma de cargarle stock a una variante que todavía no existe en
// esa sucursal. Va de a una: Shopify no tiene versión en lote de esta mutación.
const ACTIVATE_MUTATION = `
  mutation Activar($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
      inventoryLevel { id }
      userErrors { field message }
    }
  }
`;

async function getLocationId(name: string): Promise<string | null> {
  const data = await shopifyGraphQL<any>(LOCATIONS_QUERY);
  const edges: any[] = data?.locations?.edges || [];
  const loc = edges.find((e) => mismaSucursal(e.node.name, name));
  return loc ? loc.node.id : null;
}

// PASO 1 — Calcula el plan (no escribe nada).
export async function planStockWrite(result: SyncResult, config: SyncConfig): Promise<StockPlan> {
  const locName = STOCK_LOCATION[config.brand];
  const locId = await getLocationId(locName);
  if (!locId) {
    return { locationName: locName, locationId: null, locationFound: false, changes: [], unchanged: 0, unchangedRows: [], notFound: [], sinActivar: [], talleCorrido: [], apartadosPorCorrido: [] };
  }

  // Productos que ya matchearon contra Shopify (tienen handle). Guardamos el
  // código del proveedor (la clave del excelMap) para mostrarlo en la tabla.
  const entries = Object.entries(result.excelMap)
    .filter(([, d]: [string, any]) => d.foundInShopify && d.shopifyHandle)
    .map(([cod, d]) => ({ cod, d }));

  // También traemos los productos que el proveedor YA NO LISTA: a esos les vamos
  // a poner el stock en 0 (no los borramos).
  const handlesPeligro = (result.enPeligro || []).map((p) => p.handle);
  const tituloPeligro = new Map((result.enPeligro || []).map((p) => [p.handle, p.titulo]));
  const codigoPeligro = new Map((result.enPeligro || []).map((p) => [p.handle, p.codigo || '']));

  const handles = [...new Set([
    ...entries.map((e) => e.d.shopifyHandle as string),
    ...handlesPeligro,
  ])];

  // Traemos las variantes en vivo (con inventoryItem id y stock actual) por lotes de handles.
  const liveByHandle: Record<string, any[]> = {};
  const titleByHandle: Record<string, string> = {}; // título REAL de Shopify
  const tagsByHandle: Record<string, string> = {};   // etiquetas (para la tabla de talle)
  const idByHandle: Record<string, string> = {};     // id del producto (para renombrar talles)
  const opcionByHandle: Record<string, string> = {}; // nombre de la opción ("Talle")
  const CHUNK = 20;
  for (let i = 0; i < handles.length; i += CHUNK) {
    const chunk = handles.slice(i, i + CHUNK);
    const q = chunk.map((h) => `handle:${JSON.stringify(h)}`).join(' OR ');
    const data = await shopifyGraphQL<any>(PRODUCTS_BY_HANDLE, { q, loc: locId });
    for (const edge of (data?.products?.edges || [])) {
      const p = edge.node;
      liveByHandle[p.handle] = (p.variants?.edges || []).map((e: any) => e.node);
      titleByHandle[p.handle] = String(p.title || '');
      tagsByHandle[p.handle] = Array.isArray(p.tags) ? p.tags.join(', ') : String(p.tags || '');
      idByHandle[p.handle] = String(p.id || '');
      opcionByHandle[p.handle] = String(p.options?.[0]?.name || 'Talle');
    }
  }

  const changes: StockChange[] = [];
  const unchangedRows: StockRow[] = [];
  const notFound: StockRow[] = [];
  const sinActivar: StockRow[] = [];
  const apartadosPorCorrido: StockRow[] = [];

  // ---- PRODUCTOS CON EL TALLE CORRIDO (residuo del error viejo de Le Coq) ----
  // Le Coq calzado: en Shopify el talle va UNO MENOS que en el Excel. Hasta el
  // 25-ago-2026 la app detectaba el calzado por una lista de palabras y los
  // modelos con nombre de fantasía (Strider, Omega X Active, R850...) se creaban
  // SIN restar. El código ya está arreglado, pero esos productos quedaron en
  // Shopify con el talle corrido: el que dice 36 es en realidad un 35.
  //
  // Cómo se detecta, sin adivinar: por cada producto se cuenta cuántos talles
  // del archivo caen en una variante que existe APLICANDO la conversión, y
  // cuántos caen SIN aplicarla. Si gana "sin aplicarla", ese producto está
  // corrido. Medido contra la tienda real (29-ago-2026), sobre 68 productos de
  // calzado Le Coq: 300 aciertos con la conversión contra 277 sin ella, o sea
  // que la regla general está bien y solo se apartan los casos puntuales.
  const talleCorrido: ProductoTalleCorrido[] = [];
  const evaluarCorrido = (handle: string, code: string, d: any, convTable: Record<string, string> | null) => {
    if (config.brand !== 'lecoq' || convTable) return;   // solo Le Coq (Converse usa tabla)
    const live = liveByHandle[handle] || [];
    if (!live.length) return;
    const enTienda = new Set(live.map((v: any) => String(v.title || '').trim()));
    let conConv = 0, sinConv = 0, hayCalzado = false;
    for (const size of Object.keys(d.sizes || {})) {
      const convertido = String(talleShopifyLeCoq(size, d.title));
      if (convertido === String(size)) continue;          // no es calzado: no opina
      hayCalzado = true;
      if (enTienda.has(convertido)) conConv++;
      if (enTienda.has(String(size))) sinConv++;
    }
    if (!hayCalzado || sinConv <= conConv) return;
    // Está corrido: proponemos bajar UN talle a cada variante numérica.
    const variantes = live
      .filter((v: any) => /^\d+(\.\d+)?$/.test(String(v.title || '').trim()) && v.id)
      .map((v: any) => {
        const actual = String(v.title).trim();
        return { variantId: String(v.id), sku: String(v.sku || ''), actual, nuevo: String(Number(actual) - 1) };
      })
      .sort((a, b) => Number(a.actual) - Number(b.actual));  // ascendente: al bajar, nunca choca
    if (!variantes.length) return;
    talleCorrido.push({
      handle, productId: idByHandle[handle] || '', code,
      title: titleByHandle[handle] || d.title,
      opcion: opcionByHandle[handle] || 'Talle',
      aciertosConConversion: conConv, aciertosSinConversion: sinConv,
      variantes,
    });
  };

  // ---- BARRIDO DE TALLES QUE EL PROVEEDOR YA NO TIENE (regla de Wanda) ----
  // El Excel de iD trae, por producto, SOLO los talles con stock. Los demás
  // vienen con guión (celda gris) y hasta ahora se salteaban: el talle se
  // quedaba en Shopify con el stock viejo, disponible para la venta, PARA
  // SIEMPRE. Regla de Wanda (28-ago-2026): si el archivo no le pone un número
  // a ese talle, en Shopify va a CERO, sea guión, gris o lo que sea.
  // Lo que sigue anota, por producto, qué variantes SÍ cubrió el archivo; las
  // que quedan afuera y todavía tienen stock se barren más abajo.
  const cubiertasPorHandle = new Map<string, Set<string>>();  // handle -> inventoryItemIds
  const codigoPorHandle = new Map<string, string>();
  // Productos donde la conversión de talle falló: NO se barren (ver abajo).
  const conversionDudosa = new Set<string>();
  const anotarCubierta = (handle: string, invId?: string) => {
    if (!invId) return;
    if (!cubiertasPorHandle.has(handle)) cubiertasPorHandle.set(handle, new Set());
    cubiertasPorHandle.get(handle)!.add(invId);
  };

  for (const { cod, d } of entries as { cod: string; d: any }[]) {
    const handle = d.shopifyHandle as string;
    const live = liveByHandle[handle] || [];
    // Como ya existe en Shopify, mostramos el título REAL de Shopify (no el del Excel).
    const shopTitle = titleByHandle[handle] || d.title;
    const code = cod.toUpperCase(); // código del proveedor (Código Item del Excel)
    // Converse: el proveedor manda talles US; Shopify los tiene en ARG. Convertimos
    // usando la tabla que indica la etiqueta del producto (TABLA DE TALLE CONVERSE X).
    // La tabla sale del CÓDIGO (maestro de curvas del proveedor). La etiqueta
    // solo se usa de respaldo, y únicamente la que dice "TABLA DE TALLE".
    const info = config.brand === 'converse'
      ? converseTablaInfo(code, tagsByHandle[handle] || '')
      : null;
    const convTable = info ? info.tabla : null;
    // Sin etiqueta y sin código en el maestro: la tabla está ADIVINADA. Ese
    // producto no se barre a cero.
    if (info && info.origen === 'default') conversionDudosa.add(handle);
    codigoPorHandle.set(handle, code);
    evaluarCorrido(handle, code, d, convTable);
    // Un producto con el talle corrido no se barre a cero: primero hay que
    // enderezarlo, si no apagaríamos talles que en realidad tienen mercadería.
    const estaCorrido = talleCorrido.some((t) => t.handle === handle);
    if (estaCorrido) conversionDudosa.add(handle);
    for (const [size, qtyRaw] of Object.entries(d.sizes || {})) {
      const desired = Number(qtyRaw);
      // ⚠ Si hay tabla de conversión pero este talle NO está en ella, no sabemos
      // a qué talle de Shopify corresponde. Ese producto queda EXCLUIDO del
      // barrido a cero: si no, un talle que el proveedor SÍ tiene podría
      // terminar en 0 solo porque no lo supimos traducir.
      if (convTable && !(String(size) in convTable)) conversionDudosa.add(handle);
      // Converse: US -> ARG por tabla. Le Coq calzado: el talle de Shopify es
      // UNO MENOS que el del Excel (Excel 40 = Shopify 39).
      const argSize = convTable
        ? (convTable[String(size)] || String(size))
        : config.brand === 'lecoq'
          ? talleShopifyLeCoq(size, d.title)
          : String(size);
      // ⚠⚠ PRODUCTO CON EL TALLE CORRIDO -> NO SE LE ESCRIBE NADA.
      // Los nombres de talle de este producto están desplazados: el que dice 36
      // es en realidad un 35. Entonces CUALQUIER match es un match a la variante
      // equivocada, y el stock terminaría en el talle que no es.
      // No alcanzaba con sacarlo del barrido a cero (`conversionDudosa`): las
      // filas igual se pusheaban a `changes` y se escribían, mientras la pantalla
      // le prometía a Wanda que a estos productos no se les escribe stock nuevo.
      // Se apartan acá, antes de buscar la variante.
      if (estaCorrido) {
        apartadosPorCorrido.push({
          title: shopTitle, code, talle: String(argSize),
          talleProveedor: String(size), current: null, desired,
        });
        continue;
      }
      // Si la marca tiene conversión de talle (Converse / Le Coq calzado) usamos
      // SOLO el talle convertido: si aceptáramos también el original podríamos
      // cargarle el stock al talle equivocado.
      const hayConversion = !!convTable || (config.brand === 'lecoq' && argSize !== String(size));
      const v = live.find((n: any) =>
        hayConversion ? talleMatches(argSize, n.title) : talleMatches(size, n.title));
      if (!v || !v.inventoryItem?.id) {
        // ⚠ No pudimos ubicar en Shopify un talle que el proveedor SÍ tiene.
        // Mientras no sepamos dónde va ese stock, este producto NO se barre a
        // cero: si no, apagaríamos talles que en realidad tienen mercadería.
        // (Caso real 28-ago-2026: A10547C, 103 unidades sin ubicar y el 41 con
        // 116 unidades que se habrían puesto en 0.)
        conversionDudosa.add(handle);
        notFound.push({
          title: shopTitle, code, talle: String(argSize),
          talleProveedor: String(size), current: null, desired,
          // Para poder crear el talle después, sin volver a consultar Shopify.
          // OJO: acá NO pueden caer productos con el talle corrido — esos se
          // apartan más arriba. Es lo que evita crear duplicados (el 36 corrido
          // y el 35 nuevo), que es la trampa documentada en CLAUDE.md.
          handle,
          productId: idByHandle[handle] || '',
          opcion: opcionByHandle[handle] || 'Talle',
          precio: Number(d.publicPrice) || 0,
          costo: Number(d.costFinal) || 0,
        });
        continue;
      }
      const lvl = v.inventoryItem.inventoryLevel;
      // ⚠ SI ESTO VIENE NULL, la variante NO está dada de alta en la sucursal.
      // NO es que tenga cero: directamente no existe ahí. Si la mandáramos a
      // escribir, Shopify rechaza el lote ENTERO con
      // "The specified inventory item is not stocked at the location"
      // y se caen también las 99 variantes buenas que iban en ese lote.
      // Por eso se aparta ACÁ, antes de escribir.
      if (!lvl) {
        anotarCubierta(handle, v.inventoryItem.id);
        sinActivar.push({
          title: shopTitle, code, talle: String(v.title || argSize),
          talleProveedor: String(size), current: null, desired,
          inventoryItemId: v.inventoryItem.id,
        });
        continue;
      }
      anotarCubierta(handle, v.inventoryItem.id);
      const qEntry = (lvl.quantities || []).find((x: any) => x.name === 'available');
      const current = qEntry ? Number(qEntry.quantity) : 0;
      if (current === desired) {
        unchangedRows.push({
          title: shopTitle, code, talle: String(v.title || argSize),
          talleProveedor: String(size), current, desired,
        });
        continue;
      }
      changes.push({
        handle,
        title: shopTitle,
        talle: String(v.title || argSize),
        sku: String(v.sku || ''),
        code,
        inventoryItemId: v.inventoryItem.id,
        current,
        desired,
      });
    }
  }

  // ---- TALLES QUE EL PROVEEDOR YA NO TIENE -> A CERO ----
  // El producto sigue en el Excel, pero ese talle ya no viene con número.
  // Regla de Wanda: si el archivo no le pone número, en Shopify va a cero.
  //
  // ⚠ SOLO para CONVERSE y LE COQ (depósito iD): ahí el Excel es el catálogo
  // COMPLETO del proveedor. Las otras marcas mandan listas PARCIALES
  // ("cargá esto"), y poner en 0 lo que no aparece sería un error grave.
  // Es la misma salvaguarda que ya usa `enPeligro` en syncLogic.ts.
  const marcaConCatalogoCompleto = config.brand === 'converse' || config.brand === 'lecoq';
  if (marcaConCatalogoCompleto) {
    for (const [handle, cubiertas] of cubiertasPorHandle) {
      // Si de este producto hubo algún talle que no supimos convertir, no lo
      // barremos: podríamos poner en 0 un talle que el proveedor SÍ tiene.
      if (conversionDudosa.has(handle)) continue;
      const live = liveByHandle[handle] || [];
      const shopTitle = titleByHandle[handle] || handle;
      for (const v of live) {
        const invId = v?.inventoryItem?.id;
        if (!invId || cubiertas.has(invId)) continue;   // el archivo sí lo trae
        const lvl = v.inventoryItem.inventoryLevel;
        if (!lvl) continue;                             // no está en la sucursal: nada que apagar
        const qEntry = (lvl.quantities || []).find((x: any) => x.name === 'available');
        const current = qEntry ? Number(qEntry.quantity) : 0;
        if (current <= 0) continue;                     // ya está en 0
        changes.push({
          handle,
          title: shopTitle,
          talle: String(v.title || ''),
          sku: String(v.sku || ''),
          code: codigoPorHandle.get(handle) || '',
          inventoryItemId: invId,
          current,
          desired: 0,
          motivo: 'El proveedor ya no tiene este talle',
        });
      }
    }
  }

  // El proveedor ya no lista estos productos -> les ponemos el stock en 0.
  // No se borran: solo dejan de estar disponibles para la venta.
  for (const handle of handlesPeligro) {
    const live = liveByHandle[handle] || [];
    const shopTitle = titleByHandle[handle] || tituloPeligro.get(handle) || handle;
    for (const v of live) {
      if (!v?.inventoryItem?.id) continue;
      const qEntry = (v.inventoryItem.inventoryLevel?.quantities || []).find((x: any) => x.name === 'available');
      const current = qEntry ? Number(qEntry.quantity) : 0;
      if (current <= 0) continue; // ya está en 0
      changes.push({
        handle,
        title: shopTitle,
        talle: String(v.title || ''),
        sku: String(v.sku || ''),
        code: codigoPeligro.get(handle) || '',
        inventoryItemId: v.inventoryItem.id,
        current,
        desired: 0,
        motivo: 'El proveedor ya no lo lista',
      });
    }
  }

  return {
    locationName: locName, locationId: locId, locationFound: true,
    changes, unchanged: unchangedRows.length, unchangedRows, notFound, sinActivar, talleCorrido, apartadosPorCorrido,
  };
}

// ============================================================================
// ENDEREZAR LOS TALLES CORRIDOS (botón aparte, con su propia confirmación)
// ----------------------------------------------------------------------------
// Solo cambia el NOMBRE del talle de variantes que ya existen. No crea, no
// borra y NO mueve stock: los 12 pares que hoy están en el "36" siguen en la
// misma variante, que pasa a llamarse "35" — que es el talle que realmente son.
//
// ⚠ Se renombra de MENOR A MAYOR y todo el producto en UNA sola llamada. Como
//   todos los talles bajan uno, si se hiciera de a uno y en desorden se podría
//   chocar con un talle que todavía no se renombró.
// ============================================================================
export async function enderezarTallesCorridos(
  productos: ProductoTalleCorrido[],
  onProgress?: (hechos: number, total: number) => void,
): Promise<WriteResult> {
  let written = 0, failed = 0;
  const errors: string[] = [];
  let hechos = 0;
  for (const p of productos) {
    if (!p.productId || !p.variantes.length) { hechos++; continue; }
    const variants = p.variantes.map((v) => ({
      id: v.variantId,
      optionValues: [{ optionName: p.opcion, name: v.nuevo }],
      // El SKU de la app es "{código}-{talle}": si no lo movemos queda mintiendo.
      ...(v.sku && v.sku.endsWith(`-${v.actual}`)
        ? { inventoryItem: { sku: `${v.sku.slice(0, -(v.actual.length + 1))}-${v.nuevo}` } }
        : {}),
    }));
    try {
      const data = await shopifyGraphQL<any>(RENAME_MUTATION, { productId: p.productId, variants });
      const errs = data?.productVariantsBulkUpdate?.userErrors || [];
      if (errs.length) {
        failed += p.variantes.length;
        errors.push(`${p.title}: ${errs.map((e: any) => e.message).join(' · ')}`);
      } else {
        written += p.variantes.length;
      }
    } catch (e: any) {
      failed += p.variantes.length;
      errors.push(`${p.title}: ${e?.message || e}`);
    }
    hechos++;
    onProgress?.(hechos, productos.length);
  }
  return { written, failed, errors };
}

// PASO 2-bis (OPCIONAL, botón aparte) — Da de alta en la sucursal las variantes
// que todavía no están, y les carga la cantidad del proveedor.
// Se ejecuta SOLO si Wanda lo confirma: es la única operación de la app que
// agrega una variante a una sucursal donde antes no estaba.
export async function activarEnSucursal(
  plan: StockPlan,
  onProgress?: (hechas: number, total: number) => void,
): Promise<WriteResult> {
  if (!plan.locationId) throw new Error('No se encontró la sucursal.');
  const filas = plan.sinActivar.filter((f) => !!f.inventoryItemId);
  let written = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    try {
      const data = await shopifyGraphQL<any>(ACTIVATE_MUTATION, {
        inventoryItemId: f.inventoryItemId,
        locationId: plan.locationId,
        available: f.desired,
      });
      const ue = data?.inventoryActivate?.userErrors || [];
      if (ue.length) {
        failed++;
        if (errors.length < 5) errors.push(`${f.title} ${f.talle}: ${ue[0].message}`);
      } else {
        written++;
      }
    } catch (err: any) {
      failed++;
      if (errors.length < 5) errors.push(`${f.title} ${f.talle}: ${err?.message || 'Error desconocido'}`);
    }
    onProgress?.(i + 1, filas.length);
  }

  return { written, failed, errors };
}

// CREAR LOS TALLES QUE FALTAN (botón aparte, con confirmación)
// ----------------------------------------------------------------------------
// Para los "No ubicados": el producto está en Shopify pero ese talle no existe.
// Se crea la variante, con su stock, precio y costo, en la sucursal del plan.
//
// ⚠ DOS SALVAGUARDAS QUE NO SE SACAN:
//   1) Los productos con el TALLE CORRIDO nunca llegan a `notFound` (se apartan
//      antes), así que es imposible que esto cree el duplicado clásico: el 36
//      corrido conviviendo con el 35 nuevo. Si algún día se cambia ese orden,
//      esta función pasa a ser peligrosa.
//   2) Se crea de a un producto por llamada, agrupando sus talles, y solo las
//      filas que Wanda dejó tildadas.
export async function crearTallesFaltantes(
  plan: StockPlan,
  filas: StockRow[],
  onProgress?: (hechas: number, total: number) => void,
): Promise<WriteResult> {
  if (!plan.locationId) throw new Error('No se encontró la sucursal.');
  // Agrupamos por producto: la mutación de Shopify trabaja por producto.
  const porProducto = new Map<string, StockRow[]>();
  for (const f of filas) {
    if (!f.productId) continue;
    if (!porProducto.has(f.productId)) porProducto.set(f.productId, []);
    porProducto.get(f.productId)!.push(f);
  }

  let written = 0;
  let failed = 0;
  const errors: string[] = [];
  let hechas = 0;
  const total = filas.length;

  for (const [productId, lista] of porProducto) {
    const variants = lista.map((f) => {
      const v: any = {
        optionValues: [{ name: String(f.talle), optionName: f.opcion || 'Talle' }],
        inventoryItem: { tracked: true },
        inventoryQuantities: [{ locationId: plan.locationId, availableQuantity: Number(f.desired) || 0 }],
      };
      if (f.precio && f.precio > 0) v.price = String(f.precio);
      if (f.costo && f.costo > 0) v.inventoryItem.cost = String(f.costo);
      return v;
    });
    try {
      const data = await shopifyGraphQL<any>(CREATE_VARIANTS, { productId, variants });
      const ue = data?.productVariantsBulkCreate?.userErrors || [];
      if (ue.length) {
        failed += lista.length;
        if (errors.length < 5) errors.push(`${lista[0].title}: ${ue[0].message}`);
      } else {
        written += lista.length;
      }
    } catch (err: any) {
      failed += lista.length;
      if (errors.length < 5) errors.push(`${lista[0].title}: ${err?.message || 'Error desconocido'}`);
    }
    hechas += lista.length;
    onProgress?.(hechas, total);
  }

  return { written, failed, errors };
}

// PASO 2 — Escribe de verdad, en lotes. Solo cantidades.
export async function executeStockWrite(
  plan: StockPlan,
  onProgress?: (done: number, total: number) => void,
): Promise<WriteResult> {
  if (!plan.locationId) throw new Error('No se encontró la sucursal para escribir.');
  const total = plan.changes.length;
  let written = 0;
  let failed = 0;
  const errors: string[] = [];
  const BATCH = 100;

  for (let i = 0; i < plan.changes.length; i += BATCH) {
    const batch = plan.changes.slice(i, i + BATCH);
    const input = {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: batch.map((c) => ({
        inventoryItemId: c.inventoryItemId,
        locationId: plan.locationId,
        quantity: c.desired,
      })),
    };
    let loteOk = false;
    try {
      const data = await shopifyGraphQL<any>(SET_MUTATION, { input });
      const ue = data?.inventorySetQuantities?.userErrors || [];
      if (!ue.length) { written += batch.length; loteOk = true; }
      else if (errors.length < 5) errors.push(...ue.slice(0, 2).map((e: any) => e.message));
    } catch (err: any) {
      if (errors.length < 5) errors.push(err?.message || 'Error desconocido');
    }

    // ⚠ Shopify rechaza el LOTE ENTERO si una sola variante falla. Antes eso
    // contaba 100 fallidas y perdíamos 99 escrituras que estaban bien.
    // Ahora, si el lote falla, se reintenta de a una: así solo se pierde la
    // que realmente tiene el problema.
    if (!loteOk) {
      for (const c of batch) {
        try {
          const d = await shopifyGraphQL<any>(SET_MUTATION, {
            input: {
              name: 'available',
              reason: 'correction',
              ignoreCompareQuantity: true,
              quantities: [{ inventoryItemId: c.inventoryItemId, locationId: plan.locationId, quantity: c.desired }],
            },
          });
          const ue = d?.inventorySetQuantities?.userErrors || [];
          if (ue.length) {
            failed++;
            if (errors.length < 5) errors.push(`${c.title} ${c.talle}: ${ue[0].message}`);
          } else written++;
        } catch (err: any) {
          failed++;
          if (errors.length < 5) errors.push(`${c.title} ${c.talle}: ${err?.message || 'Error'}`);
        }
      }
    }
    onProgress?.(Math.min(i + BATCH, total), total);
  }

  return { written, failed, errors };
}
