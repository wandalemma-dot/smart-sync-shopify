import * as XLSX from 'xlsx';
import { escapeCSV, triggerDownload, todayStamp } from './csv';
import { shopifyGraphQL } from './shopify';

export type SyncMode = 'all' | 'stock_only' | 'cost_only' | 'price_only';

export interface SyncConfig {
  sheetName: string;
  brand: 'lecoq' | 'converse' | 'bloque' | 'orchard' | 'luxo';
}

export interface MissingProduct {
  coditm: string;
  title: string;
  wholesale: number;
  publicPrice?: number;
  sizes: Record<string, number>;
  vendor?: string;
  descCod?: string;
  artType?: string;
  costFinal?: number;
}

export interface UpdateAction {
  type: 'PRICE' | 'STOCK';
  variantId: string;
  inventoryItemId?: string;
  handle: string;
  sku: string;
  oldPrice?: number;
  newPrice?: number;
  oldStock?: number;
  newStock?: number;
}

export interface SyncResult {
  updatesToApply: UpdateAction[];
  missingProducts: MissingProduct[];
  alerts: AlertMessage[];
  excelMap: Record<string, any>;
}

export interface AlertMessage {
  type: 'warning' | 'danger' | 'info';
  title: string;
  message: string;
}

export const convTable1: Record<string, string> = { '3': '34', '4': '35', '4.5': '36', '5': '36.5', '5.5': '37', '6': '37.5', '6.5': '38', '7': '39', '7.5': '39.5', '8': '40', '8.5': '41', '9': '41.5', '9.5': '42', '10': '43', '11': '44', '11.5': '45', '12': '45.5', '13': '46.5', '14': '48' };
export const convTable2: Record<string, string> = { '3': '35', '3.5': '36', '4': '36.5', '4.5': '37', '5': '37.5', '5.5': '38', '6': '39', '6.5': '39.5', '7': '40', '7.5': '41', '8': '41.5', '8.5': '42', '9': '42.5', '9.5': '43', '10': '44', '10.5': '44.5', '11': '45', '11.5': '46', '12': '46.5', '13': '48', '14': '49' };
export const convTable3: Record<string, string> = { '5': '35', '5.5': '36', '6': '36.5', '6.5': '37', '7.5': '38', '8': '39', '9': '40', '9.5': '41' };
export const convTable4: Record<string, string> = { '10.5': '27', '11': '28', '11.5': '28.5', '12': '29', '12.5': '30', '13': '31', '13.5': '31.5', '1': '32', '1.5': '33', '2.5': '34', '3': '35' };
export const convTable5: Record<string, string> = { '4': '20', '6': '21', '7': '22', '8': '23', '9': '24', '10': '25', '11': '26' };

// Configuración de precios por marca.
// - markup: multiplicador sobre el precio mayorista para calcular el precio de venta.
// - providerDiscount: descuento que se aplica al costo (para el "Cost per item").
// - usePublicPrice: si es true, se usa el precio PÚBLICO que envía el proveedor tal cual (sin markup).
export const BRAND_PRICING: Record<SyncConfig['brand'], { markup: number; providerDiscount: number; usePublicPrice: boolean }> = {
  converse: { markup: 2.01, providerDiscount: 0,    usePublicPrice: false },
  lecoq:    { markup: 2.01, providerDiscount: 0,    usePublicPrice: false },
  orchard:  { markup: 0,    providerDiscount: 0.20, usePublicPrice: true  },
  bloque:   { markup: 2.0,  providerDiscount: 0.15, usePublicPrice: false },
  luxo:     { markup: 0,    providerDiscount: 0,    usePublicPrice: true  },
};

// Precio de venta final según la marca.
export function calcSellPrice(brand: SyncConfig['brand'], wholesale: number, publicPrice = 0): number {
  const cfg = BRAND_PRICING[brand];
  // Orchard: el proveedor ya manda el precio final, se usa tal cual.
  if (cfg.usePublicPrice) return publicPrice;
  const minP = wholesale * cfg.markup;
  let price = Math.floor(minP / 10000) * 10000 + 9900;
  if (price < minP) price += 10000;
  return price;
}

// Costo (Cost per item) según la marca, aplicando el descuento de proveedor.
export function calcCost(brand: SyncConfig['brand'], wholesale: number): number {
  const cfg = BRAND_PRICING[brand];
  return wholesale * (1 - cfg.providerDiscount);
}

// ---- ORDEN DE TALLES ----
// Orden de la ropa. Los nombres se respetan tal cual vienen (3XL y 4XL quedan así).
const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];

// Solo para ORDENAR: XXXL y 3XL valen lo mismo, XXXXL y 4XL también.
function sizeRankName(size: string): string {
  const s = String(size ?? '').trim().toUpperCase();
  if (s === 'XXXL') return '3XL';
  if (s === 'XXXXL') return '4XL';
  if (s === 'XXXXXL') return '5XL';
  if (s === '2XL') return 'XXL';
  return s;
}

// Clave de orden: primero numéricos (por valor), después las letras en su orden, después el resto.
function sizeSortKey(size: string): [number, number, string] {
  const s = sizeRankName(size);
  if (/^[0-9]+([.,][0-9]+)?$/.test(s)) return [0, parseFloat(s.replace(',', '.')), s];
  const i = LETTER_SIZES.indexOf(s);
  if (i >= 0) return [1, i, s];
  return [2, 0, s];
}

// Ordena los pares [talle, cantidad] con el criterio de arriba.
export function sortSizeEntries<T>(entries: [string, T][]): [string, T][] {
  return [...entries].sort((a, b) => {
    const ka = sizeSortKey(a[0]), kb = sizeSortKey(b[0]);
    return (ka[0] - kb[0]) || (ka[1] - kb[1]) || ka[2].localeCompare(kb[2]);
  });
}

// Peso en GRAMOS por tipo de artículo (Shopify necesita peso para calcular envíos).
// Orchard se define por su ARTICULO; Converse/Le Coq son zapatillas; Bloque skate.
const ORCHARD_WEIGHTS: Record<string, number> = {
  remera: 250, buzo: 700, campera: 900, gorra: 150, gorro: 120, medias: 100,
};
// Peso por tipo genérico (Luxo trae distintos tipos de prenda).
const TYPE_WEIGHTS: Record<string, number> = {
  remera: 250, musculosa: 200, camiseta: 250, buzo: 700, hoodie: 700, canguro: 700,
  campera: 900, chaqueta: 900, sweater: 400, sweaters: 400, camisa: 300,
  short: 300, bermuda: 300, pantalon: 500, jogger: 500, jean: 500, vestido: 350,
  gorra: 150, gorro: 120, piluso: 150, medias: 100, mochila: 700, bolso: 500,
  rinonera: 300, banano: 300,
};
export function calcWeightGrams(brand: SyncConfig['brand'], artType?: string): number {
  if (brand === 'converse' || brand === 'lecoq') return 900; // zapatillas
  if (brand === 'bloque') return 2000; // skate (tentativo)
  if (brand === 'orchard') return ORCHARD_WEIGHTS[artType || ''] ?? 250; // default remera
  if (brand === 'luxo') return TYPE_WEIGHTS[artType || ''] ?? 300; // por tipo, default 300
  return 0;
}

// ---- MATCH POR NOMBRE (Orchard) ----
// Convierte un texto a "slug": minúsculas, sin acentos, separado por guiones.
// Ej: "Remera Orchard Icons 2.0" -> "remera-orchard-icons-2-0"
export function slugify(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// El proveedor escribe los colores en inglés (BLACK/WHITE) y Shopify en español
// (Negro/Blanco). Canonizamos ambos lados para que el match por nombre coincida.
const COLOR_SYNONYMS: Record<string, string> = { black: 'negro', white: 'blanco' };
export function canonName(slug: string): string {
  return slug.split('-').map(tok => COLOR_SYNONYMS[tok] || tok).join('-');
}

// Compara un talle del proveedor con el "Option1 Value" de Shopify.
// Trata como equivalentes todas las variantes de "talle único".
export function talleMatches(provSize: string, shopTalle: string): boolean {
  const norm = (t: string) => {
    const u = String(t || '').trim().toUpperCase();
    if (['UNICO', 'ÚNICO', 'U', 'TU', 'DEFAULT TITLE', ''].includes(u)) return 'UNICO';
    return u;
  };
  return norm(provSize) === norm(shopTalle);
}

// Sucursal de Shopify donde se carga/escribe el stock, según la marca.
export const STOCK_LOCATION: Record<SyncConfig['brand'], string> = {
  converse: 'ID (Converse - Le Coq Sportif)',
  lecoq: 'ID (Converse - Le Coq Sportif)',
  orchard: 'ORCHARD',
  bloque: 'BLOQUE DISTRIBUTION',
  luxo: 'LUXO',
};

// ---- TRAER PRODUCTOS DE SHOPIFY EN VIVO (sin subir CSV) ----
// Filtro por marca (vendor) para cada opción. Bloque matchea por SKU y su vendor
// no es fijo, así que ese sigue usando el flujo de PDFs.
const VENDOR_QUERY: Partial<Record<SyncConfig['brand'], string>> = {
  converse: 'vendor:Converse',
  lecoq: 'vendor:"Le Coq Sportif"',
  orchard: 'vendor:Orchard',
  luxo: 'vendor:Luxo',
};

const LIVE_LOCATIONS_QUERY = `query { locations(first: 50) { edges { node { id name } } } }`;

const LIVE_PRODUCTS_QUERY = `
  query($cursor: String, $q: String!, $loc: ID!) {
    products(first: 50, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          handle
          title
          tags
          variants(first: 100) {
            edges {
              node {
                title
                sku
                price
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

// Para Bloque no hay vendor fijo: buscamos las variantes por SKU (los códigos que
// salen de los PDFs del proveedor).
const LIVE_VARIANTS_BY_SKU_QUERY = `
  query($q: String!, $loc: ID!) {
    productVariants(first: 100, query: $q) {
      edges {
        node {
          title
          sku
          price
          inventoryItem {
            id
            inventoryLevel(locationId: $loc) {
              quantities(names: ["available"]) { name quantity }
            }
          }
          product { handle title tags }
        }
      }
    }
  }
`;

async function fetchLocationIdByName(name: string): Promise<string | null> {
  const data = await shopifyGraphQL<any>(LIVE_LOCATIONS_QUERY);
  const edges: any[] = data?.locations?.edges || [];
  const loc = edges.find((e) => String(e.node.name).trim() === name);
  return loc ? loc.node.id : null;
}

// Extract Sheet names
export async function extractSheetNames(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  return workbook.SheetNames;
}

async function readExcel(file: File, sheetName: string): Promise<any[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Pestaña ${sheetName} no encontrada.`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1 });
}

// Extrae texto completo de un PDF (línea por línea)
async function readPdfText(file: File): Promise<string> {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) throw new Error("Librería PDF.js no cargó correctamente.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    let lastY = -1;
    let textStr = '';
    for (const item of textContent.items) {
      if (lastY !== item.transform[5] && textStr !== '') {
        textStr += '\n';
      }
      textStr += item.str;
      lastY = item.transform[5];
    }
    fullText += textStr + '\n';
  }
  return fullText;
}

// Analiza los archivos (Excel o PDFs de Bloque) y genera los UpdateActions
export async function processFiles(
  providerFile: File,
  remitoFile: File | null,
  shopifyExportFile: File | null,
  config: SyncConfig
): Promise<SyncResult> {
  const alerts: AlertMessage[] = [];
  const excelMap: Record<string, { wholesale: number, publicPrice?: number, sizes: Record<string, number>, foundInShopify: boolean, title: string, vendor?: string, shopifyHandle?: string, shopifyVariants?: any[], descCod?: string, artType?: string, costFinal?: number }> = {};

  if (config.brand === 'bloque' && /\.xlsx?$/i.test(providerFile.name)) {
    // Bloque en Excel (ej. la preventa de Protec).
    // Columnas: A=SKU | PRODUCTO | (barcode) | COLOR | TALLE | COSTO | PUBLICO | CANTIDAD
    const ab = await providerFile.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[];
    let h = -1;
    for (let r = 0; r < rows.length; r++) {
      const line = Array.from((rows[r] as any[]) || [], x => String(x || '').toLowerCase());
      if (line.some(c => c.includes('producto')) && line.some(c => c.includes('talle'))) { h = r; break; }
    }
    if (h < 0) throw new Error('No encontré el encabezado (PRODUCTO / TALLE) en el Excel de Bloque.');
    const hdr = Array.from((rows[h] as any[]) || [], x => String(x || '').toLowerCase());
    const idx = (needle: string) => hdr.findIndex(c => c.includes(needle));
    const cName = idx('producto');
    const cColor = idx('color');
    const cTalle = idx('talle');
    const cCosto = idx('costo');
    const cPublico = idx('publico');
    const cCant = idx('cantidad');
    // Vamos siguiendo la categoría principal (col C: HELMETS, PADS, ACCESORIES)
    // y el subgrupo (col B: KEYCHAINS, etc.) para anteponer la palabra en español.
    let currentCat = '';
    let currentSub = '';
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r] as any[];
      if (!row) continue;
      const sku = String(row[0] || '').trim().toLowerCase();
      const colB = cName >= 0 ? String(row[cName] || '').trim() : String(row[1] || '').trim();
      const colC = String(row[2] || '').trim();
      if (!/[0-9a-z]/.test(sku)) {
        // Fila de encabezado (sin código): actualizamos categoría o subgrupo.
        if (colC) { currentCat = colC; currentSub = ''; }
        else if (colB) { currentSub = colB; }
        continue;
      }
      const name = colB;
      if (!name) continue;
      const color = cColor >= 0 ? String(row[cColor] || '').trim() : '';
      const talle = (cTalle >= 0 ? String(row[cTalle] || '').trim() : '') || 'unico';
      const costo = cCosto >= 0 ? (parseFloat(row[cCosto]) || 0) : 0;
      const publico = cPublico >= 0 ? (parseFloat(row[cPublico]) || 0) : 0;
      const qty = cCant >= 0 ? (parseFloat(row[cCant]) || 0) : 0;
      // Palabra de categoría en español según la sección.
      const catU = currentCat.toUpperCase();
      const subU = currentSub.toUpperCase();
      let catWord = '';
      if (subU.includes('KNEE')) catWord = 'Rodilleras';
      else if (subU.includes('WRIST')) catWord = 'Muñequeras';
      else if (subU.includes('HIP') || subU.includes('CULERA')) catWord = 'Protectores de cadera';
      else if (subU.includes('KEYCHAIN') || catU.includes('KEYCHAIN')) catWord = 'Llavero';
      else if (catU.includes('HELMET')) catWord = 'Casco';
      else if (catU.includes('PAD')) catWord = 'Protecciones';
      // Título en formato normal (Primera Letra De Cada Palabra), no TODO EN MAYÚSCULA.
      const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      const title = [catWord, titleCase(name), titleCase(color)].filter(Boolean).join(' ').trim();
      if (!excelMap[sku]) excelMap[sku] = { wholesale: costo, publicPrice: publico, sizes: {}, foundInShopify: false, title, vendor: 'Bloque' };
      excelMap[sku].sizes[talle] = (excelMap[sku].sizes[talle] || 0) + qty;
    }
  } else if (config.brand === 'bloque') {
    if (!remitoFile) throw new Error("Falta Remito de Bloque");
    const presupuestoText = await readPdfText(providerFile);
    const remitoText = await readPdfText(remitoFile);
    
    // 1. Extraer precios del presupuesto
    // Formato: SKAWI004 SKATE WORLD INDUSTRIES DETENTION MULTIC 6.5 1.00 122,500.00 122,500.00
    const priceMap: Record<string, number> = {};
    const linesP = presupuestoText.split('\n');
    for (const line of linesP) {
      const parts = line.trim().split(/\s+/);
      if (parts.length > 3) {
         const sku = parts[0].toLowerCase();
         // El precio mayorista suele ser el antepenúltimo o último número largo
         // Buscamos números con coma o punto
         const priceStr = parts[parts.length - 2]?.replace(/,/g, '');
         const price = parseFloat(priceStr);
         if (sku.startsWith('sk') && !isNaN(price)) {
            priceMap[sku] = price;
         }
      }
    }

    // 2. Extraer Título, Color y Talles del Remito
    // Formato: 1 SKAWI004 SKATE WORLD INDUSTRIES DETENTION MULTICOLOR 6.5
    const linesR = remitoText.split('\n');
    for (const line of linesR) {
      const parts = line.trim().split(/\s+/);
      if (parts.length > 4 && !isNaN(parseInt(parts[0]))) {
         const qty = parseFloat(parts[0]);
         const sku = parts[1].toLowerCase();
         const size = parts[parts.length - 1]; // Último elemento es talle
         const color = parts[parts.length - 2]; // Anteúltimo es color
         const title = parts.slice(2, parts.length - 2).join(' ') + ' ' + color; // Título largo con color
         
         const wholesale = priceMap[sku] || 0;
         
         if (!excelMap[sku]) {
            excelMap[sku] = { wholesale, sizes: {}, foundInShopify: false, title, vendor: 'Bloque Distribution' };
         }
         excelMap[sku].sizes[size] = (excelMap[sku].sizes[size] || 0) + qty;
      }
    }
  } else if (config.brand === 'orchard') {
    // Orchard: la hoja tiene la columna A vacía, pero SheetJS la descarta (rango B1:G),
    // así que en el array los índices ya arrancan en la columna B:
    //   row[0]=ARTICULO | row[1]=DESCRIPCION | row[2]=TALLE | row[3]=COSTO NETO | row[4]=PUBLICO | row[5]=CANTIDAD
    // El proveedor ya envía el precio final (PUBLICO). Solo hay que:
    //   - usar PUBLICO (col F) como precio de venta, sin markup
    //   - aplicar 15% de descuento al COSTO NETO (col E) para el costo
    // Mapa ARTICULO del proveedor -> palabra de tipo que aparece en el título de Shopify.
    const orchardTypeMap: Record<string, string> = {
      REMERA: 'remera', BUZO: 'buzo', CAMPERA: 'campera',
      GORRA: 'gorra', BEANIE: 'gorro', MEDIAS: 'medias',
    };
    const excelData = await readExcel(providerFile, config.sheetName);
    for (let r = 1; r < excelData.length; r++) {
      const row = excelData[r] as any[];
      if (!row) continue;
      const artRaw = String(row[0] || '').trim().toUpperCase(); // ARTICULO (tipo)
      const desc = String(row[1] || '').trim(); // ej DEMON INSIDE
      const rawSize = String(row[2] || '').trim(); // ej M, L, XL
      const costoNeto = parseFloat(row[3] || 0); // costo neto
      const publico = parseFloat(row[4] || 0); // precio público final
      const qty = parseFloat(row[5] || 0); // cantidad
      if (!desc || !rawSize || isNaN(costoNeto)) continue;
      // descCod normaliza igual que Shopify (cualquier símbolo, incluido el punto, → guion).
      // Así "ICONS 2.0" pasa a "icons-2-0" y coincide con el tag de Shopify.
      const descCod = desc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      // Un mismo nombre puede repetirse en distinto ARTICULO (ej BEANIE vs GORRA SPIRIT)
      // y son productos DISTINTOS: la clave interna incluye el tipo + la descripción.
      const artType = orchardTypeMap[artRaw] || artRaw.toLowerCase();
      const cod = `${artType}::${descCod}`;
      if (!excelMap[cod]) {
        excelMap[cod] = { wholesale: costoNeto, publicPrice: publico, sizes: {}, foundInShopify: false, title: desc, descCod, artType };
      }
      if (!isNaN(qty)) {
        excelMap[cod].sizes[rawSize] = (excelMap[cod].sizes[rawSize] || 0) + qty;
      }
    }
  } else if (config.brand === 'luxo') {
    // Luxo: plantilla INDY (productos nuevos). Encabezado con "Código SKU"; una fila por talle.
    //   A=Código SKU | C=Descripción | D=Costo sin descuento | E=Precio | F=Talle | G=Cantidad | I=Descuento (%)
    // Precio = col E tal cual. Costo = col D menos el % de la col I. El link de foto se ignora.
    const excelData = await readExcel(providerFile, config.sheetName);
    let hRow = -1;
    for (let r = 0; r < excelData.length; r++) {
      const row = ((excelData[r] as any[]) || []).map(x => String(x || '').toLowerCase());
      if (row.some(c => c.includes('digo sku'))) { hRow = r; break; }
    }
    if (hRow < 0) throw new Error('No encontré el encabezado "Código SKU" en la plantilla de Luxo.');
    const luxoTypes = ['remera','musculosa','camiseta','buzo','hoodie','canguro','campera','chaqueta','sweaters','sweater','camisa','short','bermuda','pantalon','jogger','jean','vestido','gorra','gorro','piluso','medias','mochila','bolso','rinonera','banano'];
    for (let r = hRow + 1; r < excelData.length; r++) {
      const row = excelData[r] as any[];
      if (!row) continue;
      const cod = String(row[0] || '').trim();
      if (!cod) continue;
      const desc = String(row[2] || '').trim();
      const costo = parseFloat(row[3] || 0);
      const precio = parseFloat(row[4] || 0);
      const rawSize = String(row[5] || '').trim() || 'unico';
      const qty = parseFloat(row[6] || 0);
      const dpct = parseFloat(row[8] || 0) || 0;
      if (isNaN(costo) && isNaN(precio)) continue;
      const norm = desc.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const artType = luxoTypes.find(t => norm.includes(t)) || '';
      const costFinal = Math.round(costo * (1 - dpct));
      if (!excelMap[cod]) {
        excelMap[cod] = { wholesale: costo, publicPrice: precio, costFinal, sizes: {}, foundInShopify: false, title: desc, vendor: 'Luxo', artType };
      }
      if (!isNaN(qty)) excelMap[cod].sizes[rawSize] = (excelMap[cod].sizes[rawSize] || 0) + qty;
    }
  } else {
    // Converse / Le Coq
    const excelData = await readExcel(providerFile, config.sheetName);
    if (excelData.length < 2) throw new Error('Excel sin suficientes filas.');

    // Detectar el formato NUEVO del proveedor (vertical): tiene "Código Item (SKU)" y
    // "Cantidad Disponible", con una fila por código/color/talle.
    const hdr0 = ((excelData[0] as any[]) || []).map(x => String(x || '').toLowerCase());
    const esFormatoNuevo = hdr0.some(h => h.includes('digo item')) && hdr0.some(h => h.includes('cantidad disponible'));

    if (esFormatoNuevo) {
      const idx = (needle: string) => hdr0.findIndex(h => h.includes(needle));
      const cCod = 0;
      const cDesc = idx('descripci') >= 0 ? idx('descripci') : 1;
      const cTalle = idx('talle') >= 0 ? idx('talle') : 5;
      const cCant = idx('cantidad disponible') >= 0 ? idx('cantidad disponible') : 7;
      for (let r = 1; r < excelData.length; r++) {
        const row = excelData[r] as any[];
        if (!row) continue;
        const cod = String(row[cCod] || '').trim().toLowerCase();
        const desc = String(row[cDesc] || '').trim();
        const rawSize = String(row[cTalle] || '').trim();
        const qty = parseFloat(row[cCant]);
        if (!cod || !rawSize || isNaN(qty)) continue;
        let norm = rawSize;
        if (config.brand === 'lecoq') norm = rawSize.replace(/^0+/, '') || rawSize;
        if (config.brand === 'converse') {
          const num = parseInt(rawSize, 10);
          if (!isNaN(num)) norm = (num / 10).toString();
        }
        // El formato nuevo no trae costo -> wholesale 0 (solo stock, no toca precio)
        if (!excelMap[cod]) excelMap[cod] = { wholesale: 0, sizes: {}, foundInShopify: false, title: desc };
        excelMap[cod].sizes[norm] = (excelMap[cod].sizes[norm] || 0) + qty;
      }
    } else {
      // Formato VIEJO (horizontal): talles en columnas, cabecera en la 2da fila.
      if (excelData.length < 3) throw new Error('Excel sin suficientes filas.');
      const excelHeaders = excelData[1] as any[];
      const startSizeCol = 7;
      for (let r = 2; r < excelData.length; r++) {
        const row = excelData[r] as any[];
        if (!row) continue;
        const desc = String(row[2] || '').trim();
        const cod = String(row[1] || '').trim().toLowerCase();
        const wholesale = parseFloat(row[4] || 0);
        if (cod) {
          excelMap[cod] = { wholesale, sizes: {}, foundInShopify: false, title: desc };
          for (let c = startSizeCol; c < excelHeaders.length; c++) {
            const rawSize = String(excelHeaders[c] || '').trim();
            if (!rawSize || rawSize.toLowerCase().includes('total')) continue;
            let norm = rawSize;
            if (config.brand === 'lecoq') norm = rawSize.replace(/^0+/, '');
            if (config.brand === 'converse') {
               const num = parseInt(rawSize, 10);
               if (!isNaN(num)) norm = (num / 10).toString();
            }
            const cellVal = row[c];
            if (cellVal !== undefined && cellVal !== null && String(cellVal).trim() !== '') {
              const qty = parseFloat(cellVal);
              if (!isNaN(qty)) {
                excelMap[cod].sizes[norm] = qty;
              }
            }
          }
        }
      }
    }
  }

  // 3. Leer datos de Shopify desde el CSV exportado que el usuario subió
  interface ShopifyProductNode {
    handle: string;
    title: string;
    tags: string;
    variants: { edges: { node: { id: string; title: string; sku: string; price: string; inventoryQuantity: number } }[] };
  }
  const shopifyProducts: ShopifyProductNode[] = [];
  
  if (shopifyExportFile) {
    await new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target!.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet) as any[];
          // Toma la primera columna que exista de una lista de nombres posibles.
          // Así soportamos tanto el "Export de productos" (Variant SKU, Variant Price,
          // Variant Inventory Qty) como el "Export de inventario" (SKU, On hand...).
          const pick = (row: any, keys: string[]): string => {
            for (const k of keys) {
              const v = row[k];
              if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
            }
            return '';
          };
          const prodMap: Record<string, ShopifyProductNode> = {};
          for (const row of rows) {
            const handle = String(row['Handle'] || '').trim();
            if (!handle) continue;
            const tagsVal = pick(row, ['Tags']);
            if (!prodMap[handle]) {
              prodMap[handle] = {
                handle,
                title: String(row['Title'] || ''),
                tags: tagsVal,
                variants: { edges: [] }
              };
            }
            if (tagsVal && !prodMap[handle].tags) prodMap[handle].tags = tagsVal;
            const sku = pick(row, ['Variant SKU', 'SKU']);
            // Evita duplicar variantes: el export de inventario trae una fila por
            // sucursal, así que una misma variante (SKU) puede venir repetida.
            if (sku && prodMap[handle].variants.edges.some(e => e.node.sku === sku)) continue;
            prodMap[handle].variants.edges.push({
              node: {
                id: pick(row, ['Variant Inventory Item ID']),
                title: pick(row, ['Option1 Value']),
                sku,
                price: pick(row, ['Variant Price']) || '0',
                inventoryQuantity: parseInt(
                  pick(row, ['Variant Inventory Qty', 'On hand (new)', 'On hand (current)', 'Available (not editable)']) || '0'
                )
              }
            });
          }
          Object.values(prodMap).forEach(p => shopifyProducts.push(p));
          resolve();
        } catch(err: any) { reject(new Error('Error leyendo CSV Shopify: ' + err.message)); }
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo CSV'));
      reader.readAsArrayBuffer(shopifyExportFile);
    });
  } else if (config.brand === 'bloque') {
    // Bloque: sin vendor fijo. Buscamos por los SKU que salieron de los PDFs.
    const skus = Object.keys(excelMap);
    if (skus.length) {
      const locId = await fetchLocationIdByName(STOCK_LOCATION.bloque);
      if (!locId) throw new Error(`No encontré la sucursal "${STOCK_LOCATION.bloque}" en Shopify.`);
      const prodMap: Record<string, { handle: string; title: string; tags: string; variants: { edges: { node: any }[] } }> = {};
      const CHUNK = 20;
      for (let i = 0; i < skus.length; i += CHUNK) {
        const chunk = skus.slice(i, i + CHUNK);
        const q = chunk.map((s) => `sku:${s.toUpperCase()}`).join(' OR ');
        const data: any = await shopifyGraphQL<any>(LIVE_VARIANTS_BY_SKU_QUERY, { q, loc: locId });
        for (const edge of (data?.productVariants?.edges || [])) {
          const node = edge.node;
          const p = node.product;
          if (!p) continue;
          const handle = String(p.handle || '');
          if (!prodMap[handle]) {
            prodMap[handle] = {
              handle,
              title: String(p.title || ''),
              tags: Array.isArray(p.tags) ? p.tags.join(', ') : String(p.tags || ''),
              variants: { edges: [] },
            };
          }
          const lvl = node.inventoryItem?.inventoryLevel;
          const qEntry = (lvl?.quantities || []).find((x: any) => x.name === 'available');
          prodMap[handle].variants.edges.push({
            node: {
              id: String(node.inventoryItem?.id || ''),
              title: String(node.title || ''),
              sku: String(node.sku || ''),
              price: String(node.price || '0'),
              inventoryQuantity: qEntry ? Number(qEntry.quantity) : 0,
            },
          });
        }
      }
      Object.values(prodMap).forEach((p) => shopifyProducts.push(p as any));
    }
  } else {
    // Sin CSV: traemos los productos directo de Shopify (en vivo).
    const vendorQuery = VENDOR_QUERY[config.brand];
    if (vendorQuery) {
      const locName = STOCK_LOCATION[config.brand];
      const locId = await fetchLocationIdByName(locName);
      if (!locId) throw new Error(`No encontré la sucursal "${locName}" en Shopify.`);
      let cursor: string | null = null;
      let hasNext = true;
      let guard = 0;
      while (hasNext && guard < 200) {
        guard++;
        const data: any = await shopifyGraphQL<any>(LIVE_PRODUCTS_QUERY, { cursor, q: vendorQuery, loc: locId });
        const conn = data?.products;
        for (const edge of (conn?.edges || [])) {
          const n = edge.node;
          const variants = (n.variants?.edges || []).map((ve: any) => {
            const node = ve.node;
            const lvl = node.inventoryItem?.inventoryLevel;
            const qEntry = (lvl?.quantities || []).find((x: any) => x.name === 'available');
            return {
              node: {
                id: String(node.inventoryItem?.id || ''),
                title: String(node.title || ''),
                sku: String(node.sku || ''),
                price: String(node.price || '0'),
                inventoryQuantity: qEntry ? Number(qEntry.quantity) : 0,
              },
            };
          });
          shopifyProducts.push({
            handle: String(n.handle || ''),
            title: String(n.title || ''),
            tags: Array.isArray(n.tags) ? n.tags.join(', ') : String(n.tags || ''),
            variants: { edges: variants },
          });
        }
        hasNext = !!conn?.pageInfo?.hasNextPage;
        cursor = conn?.pageInfo?.endCursor || null;
      }
    }
  }

  const updatesToApply: UpdateAction[] = [];

  // Mapear Shopify contra el ExcelMap
  for (const prod of shopifyProducts) {
    const tags = String(prod.tags || '').toLowerCase();
    
    for (const [cod, provData] of Object.entries(excelMap)) {
      let match = false;
      if (config.brand === 'bloque') {
         match = prod.variants.edges.some((v) => v.node.sku?.toLowerCase() === cod);
      } else if (config.brand === 'orchard') {
         // Match POR NOMBRE: el título de Shopify tiene la forma
         // "{Tipo} Orchard {Nombre}" (ej "Remera Orchard No More Tears Negro").
         // Comparamos contra el nombre del Excel del proveedor, exigiendo que
         // el título contenga la marca ("orchard"), el tipo (remera/buzo/…) y el
         // nombre. Canonizamos colores EN/ES para que "Black" ↔ "Negro" coincidan.
         const titleCanon = canonName(slugify(prod.title));
         const dCod = canonName(provData.descCod || '');
         const aType = provData.artType || '';
         match = !!dCod
           && titleCanon.includes('orchard')
           && (!aType || titleCanon.includes(aType))
           && titleCanon.includes(dCod);
      } else {
         match = tags.includes(cod.toLowerCase());
      }
      
      if (match) {
        provData.foundInShopify = true;
        provData.shopifyHandle = prod.handle;
        provData.shopifyVariants = prod.variants.edges.map((e: any) => e.node);
        
        // Precio de venta según la marca (Orchard usa el precio público directo).
        const calculatedPrice = calcSellPrice(config.brand, provData.wholesale, provData.publicPrice || 0);

        for (const vEdge of prod.variants.edges) {
           const variant = vEdge.node;
           const variantPrice = parseFloat(variant.price);
           
           // ACTUALIZACIÓN DE PRECIO
           // Ojo: Si el precio de venta sugerido cambia, preparamos acción.
           // variantPrice > 0 evita falsos positivos cuando el CSV no trae precio
           // (ej. el export de inventario), que dejaría el precio en 0.
           if (calculatedPrice !== variantPrice && variantPrice > 0 && provData.wholesale > 0) {
              updatesToApply.push({
                type: 'PRICE',
                variantId: variant.id,
                handle: prod.handle,
                sku: variant.sku || cod,
                oldPrice: variantPrice,
                newPrice: calculatedPrice
              });
           }
        }

        // ---- REVISIÓN DE STOCK Y PRECIO (Orchard) ----
        // Para cada talle del proveedor, buscamos la variante equivalente en Shopify
        // y avisamos si el stock o el precio difieren, o si el talle no existe.
        if (config.brand === 'orchard') {
          const missingSizes: string[] = [];
          for (const [size, provQtyRaw] of sortSizeEntries(Object.entries(provData.sizes))) {
            const provQty = Number(provQtyRaw);
            const vEdge = prod.variants.edges.find(e => talleMatches(size, e.node.title));
            if (!vEdge) { missingSizes.push(size); continue; }
            const shopQty = Number(vEdge.node.inventoryQuantity);
            if (provQty !== shopQty) {
              alerts.push({
                type: 'warning',
                title: 'Stock distinto',
                message: `${prod.title} · talle ${size}: proveedor ${provQty} vs Shopify ${shopQty}`,
              });
            }
            const shopPrice = parseFloat(vEdge.node.price);
            const provPrice = provData.publicPrice || 0;
            if (shopPrice > 0 && provPrice > 0 && shopPrice !== provPrice) {
              alerts.push({
                type: 'danger',
                title: 'Precio distinto',
                message: `${prod.title} · talle ${size}: proveedor $${provPrice} vs Shopify $${shopPrice}`,
              });
            }
          }
          if (missingSizes.length > 0) {
            alerts.push({
              type: 'info',
              title: 'Talles del proveedor que no están en Shopify',
              message: `${prod.title}: ${missingSizes.join(', ')}`,
            });
          }
        }
      }
    }
  }

  // Identificar faltantes
  const missingProducts: MissingProduct[] = [];
  for (const [cod, data] of Object.entries(excelMap)) {
    if (!data.foundInShopify && data.wholesale > 0) {
      missingProducts.push({
        coditm: cod,
        title: data.title,
        wholesale: data.wholesale,
        publicPrice: data.publicPrice,
        sizes: data.sizes,
        vendor: data.vendor,
        descCod: data.descCod,
        artType: data.artType,
        costFinal: data.costFinal
      });
    }
  }

  return {
    updatesToApply,
    missingProducts,
    alerts,
    excelMap
  };
}

export function downloadUpdateCSV(result: SyncResult, config: SyncConfig) {
  if (result.updatesToApply.length === 0) {
    alert("No hay actualizaciones para descargar.");
    return;
  }

  // Columnas necesarias para actualizar precio: Handle, Variant SKU, Variant Price
  const headers = ['Handle', 'Variant SKU', 'Variant Price'];
  let csvContent = headers.join(',') + '\n';

  result.updatesToApply.forEach(u => {
    if (u.type === 'PRICE') {
      const row = [
        u.handle,
        `"${u.sku}"`,
        u.newPrice
      ];
      csvContent += row.join(',') + '\n';
    }
  });

  triggerDownload(csvContent, `Actualizacion_Precios_${config.brand}_${todayStamp()}.csv`);
}

// Versión estructurada de la matriz (misma lógica que el CSV) para poder crear
// los productos directo por la API además de exportarlos.
export interface MatrixVariant { sku: string; optionName: string; optionValue: string; price: number; cost: number; qty: number; }
export interface MatrixProduct { handle: string; title: string; vendor: string; productType: string; tags: string; weightGrams: number; hasSizes: boolean; variants: MatrixVariant[]; }

export function buildMatrixProducts(result: SyncResult, config: SyncConfig): MatrixProduct[] {
  const out: MatrixProduct[] = [];
  const vendorDefaults: Record<SyncConfig['brand'], string> = { lecoq: 'Le Coq Sportif', converse: 'Converse', orchard: 'Orchard', bloque: 'Bloque', luxo: 'Luxo' };

  for (const prod of result.missingProducts) {
    let handle = prod.coditm.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const vendor = prod.vendor || vendorDefaults[config.brand];
    const price = calcSellPrice(config.brand, prod.wholesale, prod.publicPrice || 0);
    const cost = prod.costFinal ?? calcCost(config.brand, prod.wholesale);
    let displayTitle = prod.title;
    let tagValue = prod.coditm;
    let productType = '';
    if (config.brand === 'orchard') {
      const typeLabels: Record<string, string> = { gorra: 'Gorra', gorro: 'Gorro Beanie', remera: 'Remera', buzo: 'Buzo', campera: 'Campera', medias: 'Medias' };
      const aType = prod.artType || '';
      productType = typeLabels[aType] || (aType ? aType.charAt(0).toUpperCase() + aType.slice(1) : '');
      const descTitle = prod.title.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      displayTitle = `${productType} Orchard ${descTitle}`.replace(/\s+/g, ' ').trim();
      tagValue = prod.descCod || prod.coditm;
      handle = `${aType}-orchard-${prod.descCod || ''}`.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    if (config.brand === 'luxo') {
      const t = (prod.title || '').trim();
      displayTitle = t ? t.charAt(0).toUpperCase() + t.slice(1) : prod.coditm;
      tagValue = 'Luxo';
      productType = (prod.artType || '') ? (prod.artType as string).charAt(0).toUpperCase() + (prod.artType as string).slice(1) : '';
      handle = `${displayTitle}-${prod.coditm}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    const variants: MatrixVariant[] = [];
    let hasSizes = false;
    for (const [size, qty] of sortSizeEntries(Object.entries(prod.sizes))) {
      const isUnico = ['unico', 'único', 'tu', ''].includes(String(size).toLowerCase());
      let variantSku = prod.coditm;
      if (config.brand === 'converse' || config.brand === 'lecoq') variantSku = `${prod.coditm}-${size}`;
      else if (config.brand === 'orchard') variantSku = `ORC-${(prod.descCod || '').toUpperCase()}-${String(size).toUpperCase()}`;
      else if (config.brand === 'luxo') variantSku = isUnico ? prod.coditm : `${prod.coditm}-${String(size).toUpperCase()}`;
      const useTitleOption = config.brand === 'luxo' && isUnico;
      if (!useTitleOption) hasSizes = true;
      variants.push({
        sku: variantSku,
        optionName: useTitleOption ? 'Title' : 'Talle',
        optionValue: useTitleOption ? 'Default Title' : String(size),
        price,
        cost,
        qty: config.brand === 'luxo' ? 0 : Number(qty) || 0,
      });
    }
    out.push({ handle, title: displayTitle, vendor, productType, tags: tagValue, weightGrams: calcWeightGrams(config.brand, prod.artType), hasSizes, variants });
  }
  return out;
}

export function downloadMatrixCSV(result: SyncResult, config: SyncConfig, _tableSelections?: Record<string, number>) {
  if (result.missingProducts.length === 0) {
    alert("No hay productos faltantes para descargar.");
    return;
  }

  // Formato del template nuevo de Shopify (product_template): URL handle, Weight value (grams), Cost per item, etc.
  const headers = [
    'Title', 'URL handle', 'Description', 'Vendor', 'Product category', 'Type', 'Tags',
    'Published on online store', 'Status', 'SKU', 'Barcode',
    'Option1 name', 'Option1 value', 'Option1 Linked To',
    'Option2 name', 'Option2 value', 'Option2 Linked To',
    'Option3 name', 'Option3 value', 'Option3 Linked To',
    'Price', 'Compare-at price', 'Cost per item', 'Charge tax', 'Tax code',
    'Unit price total measure', 'Unit price total measure unit', 'Unit price base measure', 'Unit price base measure unit',
    'Inventory tracker', 'Inventory quantity', 'Continue selling when out of stock',
    'Weight value (grams)', 'Weight unit for display', 'Requires shipping', 'Fulfillment service',
    'Product image URL', 'Image position', 'Image alt text', 'Variant image URL', 'Gift card',
    'SEO title', 'SEO description', 'Color (product.metafields.shopify.color-pattern)',
    'Google Shopping / Google product category', 'Google Shopping / Gender', 'Google Shopping / Age group',
    'Google Shopping / Manufacturer part number (MPN)', 'Google Shopping / Ad group name', 'Google Shopping / Ads labels',
    'Google Shopping / Condition', 'Google Shopping / Custom product',
    'Google Shopping / Custom label 0', 'Google Shopping / Custom label 1', 'Google Shopping / Custom label 2',
    'Google Shopping / Custom label 3', 'Google Shopping / Custom label 4'
  ];

  let csvContent = headers.join(',') + '\n';

  result.missingProducts.forEach(prod => {
    let handle = prod.coditm.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const vendorDefaults: Record<SyncConfig['brand'], string> = { lecoq: 'Le Coq Sportif', converse: 'Converse', orchard: 'Orchard', bloque: 'Bloque', luxo: 'Luxo' };
    const vendor = prod.vendor || vendorDefaults[config.brand];

    const price = calcSellPrice(config.brand, prod.wholesale, prod.publicPrice || 0);
    const cost = prod.costFinal ?? calcCost(config.brand, prod.wholesale);

    // Orchard: nombre/tag/handle según tipo + descripción (gorro, gorra, remera, etc.)
    let displayTitle = prod.title;
    let tagValue = prod.coditm;
    let productType = '';
    if (config.brand === 'orchard') {
      const typeLabels: Record<string, string> = { gorra: 'Gorra', gorro: 'Gorro Beanie', remera: 'Remera', buzo: 'Buzo', campera: 'Campera', medias: 'Medias' };
      const aType = prod.artType || '';
      const typeLbl = typeLabels[aType] || (aType ? aType.charAt(0).toUpperCase() + aType.slice(1) : '');
      productType = typeLbl;
      const descTitle = prod.title.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      displayTitle = `${typeLbl} Orchard ${descTitle}`.replace(/\s+/g, ' ').trim();
      tagValue = prod.descCod || prod.coditm;
      handle = `${aType}-orchard-${prod.descCod || ''}`.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    if (config.brand === 'luxo') {
      const t = (prod.title || '').trim();
      displayTitle = t ? t.charAt(0).toUpperCase() + t.slice(1) : prod.coditm;
      tagValue = 'Luxo';
      productType = (prod.artType || '') ? (prod.artType as string).charAt(0).toUpperCase() + (prod.artType as string).slice(1) : '';
      handle = `${displayTitle}-${prod.coditm}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    let isFirstVariant = true;

    for (const [size, qty] of sortSizeEntries(Object.entries(prod.sizes))) {
      const outRow: any = {};
      headers.forEach(h => outRow[h] = '');

      // URL handle en todas las filas (liga las variantes del mismo producto)
      outRow['URL handle'] = handle;
      if (isFirstVariant) {
        outRow['Title'] = displayTitle;
        outRow['Description'] = displayTitle;
        outRow['Vendor'] = vendor;
        outRow['Type'] = productType;
        outRow['Tags'] = tagValue;
        outRow['Published on online store'] = 'FALSE'; // borrador hasta ponerle precio/publicar
        outRow['Status'] = 'Active';
      }

      const isUnico = ['unico', 'único', 'tu', ''].includes(String(size).toLowerCase());
      let variantSku = prod.coditm;
      if (config.brand === 'converse' || config.brand === 'lecoq') {
        variantSku = `${prod.coditm}-${size}`;
      } else if (config.brand === 'orchard') {
        variantSku = `ORC-${(prod.descCod || '').toUpperCase()}-${String(size).toUpperCase()}`;
      } else if (config.brand === 'luxo') {
        variantSku = isUnico ? prod.coditm : `${prod.coditm}-${String(size).toUpperCase()}`;
      }
      outRow['SKU'] = variantSku;
      if (config.brand === 'luxo' && isUnico) {
        outRow['Option1 name'] = 'Title';
        outRow['Option1 value'] = 'Default Title';
      } else {
        outRow['Option1 name'] = 'Talle';
        outRow['Option1 value'] = size;
      }
      outRow['Price'] = price;
      outRow['Cost per item'] = cost;
      outRow['Charge tax'] = 'TRUE';
      outRow['Inventory tracker'] = 'shopify';
      // En Luxo el stock va por separado a la sucursal LUXO -> el producto se crea en 0.
      outRow['Inventory quantity'] = config.brand === 'luxo' ? '0' : qty.toString();
      outRow['Continue selling when out of stock'] = 'DENY';
      outRow['Weight value (grams)'] = String(calcWeightGrams(config.brand, prod.artType));
      outRow['Weight unit for display'] = 'g';
      outRow['Requires shipping'] = 'TRUE';
      outRow['Fulfillment service'] = 'manual';

      const rowArray = headers.map(h => escapeCSV(outRow[h]));
      csvContent += rowArray.join(',') + '\n';
      
      isFirstVariant = false;
    }
  });

  triggerDownload(csvContent, `Matriz_Faltantes_${config.brand}_${todayStamp()}.csv`);
}

export function downloadInventoryCSV(result: SyncResult, config: SyncConfig) {
  if (Object.keys(result.excelMap).length === 0) {
    alert("No hay datos de inventario para descargar.");
    return;
  }

  const headers = [
    'Handle', 'Title', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value',
    'Option3 Name', 'Option3 Value', 'SKU', 'Location', 'On hand (new)'
  ];

  // Luxo: productos nuevos, stock directo a la sucursal LUXO.
  if (config.brand === 'luxo') {
    let csvLuxo = headers.join(',') + '\n';
    for (const [cod, data] of Object.entries(result.excelMap)) {
      const t = (data.title || '').trim();
      const title = t ? t.charAt(0).toUpperCase() + t.slice(1) : cod;
      const handle = `${title}-${cod}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      for (const [size, qty] of sortSizeEntries(Object.entries(data.sizes))) {
        const isUnico = ['unico', 'único', 'tu', ''].includes(String(size).toLowerCase());
        const sku = isUnico ? cod : `${cod}-${String(size).toUpperCase()}`;
        const oName = isUnico ? 'Title' : 'Talle';
        const oValue = isUnico ? 'Default Title' : String(size).toUpperCase();
        const row = [handle, title, oName, oValue, '', '', '', '', sku, 'LUXO', String(qty)];
        csvLuxo += row.map(escapeCSV).join(',') + '\n';
      }
    }
    triggerDownload(csvLuxo, `Stock_LUXO_${todayStamp()}.csv`);
    return;
  }

  // Sucursal donde se carga el stock, según la marca.
  const stockLocation: Record<SyncConfig['brand'], string> = {
    converse: 'ID (Converse - Le Coq Sportif)',
    lecoq: 'ID (Converse - Le Coq Sportif)',
    orchard: 'ORCHARD',
    bloque: 'BLOQUE DISTRIBUTION',
    luxo: 'LUXO',
  };
  // Sucursales que deben quedar en 0 para esa marca (se maneja en una sola sucursal).
  const zeroLocations: Partial<Record<SyncConfig['brand'], string[]>> = {
    orchard: ['DEPOSITO MARTINEZ'],
  };
  const mainLoc = stockLocation[config.brand];
  const zeros = zeroLocations[config.brand] || [];

  let csvContent = headers.join(',') + '\n';

  for (const [coditm, data] of Object.entries(result.excelMap)) {
    if (!data.foundInShopify) continue; // Solo inventario para productos que ya existen

    let handle = data.shopifyHandle || coditm.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    // Auto-detect table for Converse
    let bestTable: Record<string, string> | null = null;
    if (config.brand === 'converse' && data.shopifyVariants) {
       const tables = [convTable1, convTable2, convTable3, convTable4, convTable5];
       const variantTitles = data.shopifyVariants.map((v: any) => String(v.title));
       let bestScore = -1;
       for (const table of tables) {
          let score = 0;
          for (const size of Object.keys(data.sizes)) {
             if (table[size] && variantTitles.includes(table[size])) score++;
          }
          if (score > bestScore) {
             bestScore = score;
             bestTable = table;
          }
       }
    }

    for (const [size, qty] of sortSizeEntries(Object.entries(data.sizes))) {
      const outRow: any = {};
      headers.forEach(h => outRow[h] = '');

      outRow['Handle'] = handle;
      outRow['Title'] = data.title;
      outRow['Option1 Name'] = 'Talle';

      let option1Value = size;
      if (config.brand === 'converse' && bestTable) {
         option1Value = bestTable[size] || size;
      } else if (config.brand === 'lecoq') {
         const sizeNum = parseInt(size, 10);
         if (!isNaN(sizeNum)) {
             option1Value = (sizeNum - 1).toString();
         }
      }

      // Buscar variante exacta en Shopify
      let exactVariant = null;
      if (data.shopifyVariants) {
         exactVariant = data.shopifyVariants.find((v: any) => String(v.title) === String(option1Value) || String(v.sku).includes(coditm));
         if (!exactVariant) {
             // Si no coincide por titulo exacto, probamos si contiene
             exactVariant = data.shopifyVariants.find((v: any) => String(v.sku).toLowerCase().includes(coditm.toLowerCase()));
         }
      }

      if (exactVariant && exactVariant.title !== 'Default Title') {
          outRow['Option1 Value'] = exactVariant.title;
      } else {
          outRow['Option1 Value'] = option1Value;
      }
      
      if (exactVariant && exactVariant.sku) {
         outRow['SKU'] = exactVariant.sku;
      } else {
         if (config.brand === 'converse' || config.brand === 'lecoq') {
            outRow['SKU'] = `${coditm}-${option1Value}`;
         } else {
            outRow['SKU'] = coditm;
         }
      }
      
      // Fila principal: la sucursal de la marca con la cantidad del proveedor.
      outRow['Location'] = mainLoc;
      outRow['On hand (new)'] = String(qty);
      csvContent += headers.map(h => escapeCSV(outRow[h])).join(',') + '\n';

      // Filas extra: dejar en 0 las demás sucursales de esa marca (ej. Orchard -> DEPOSITO MARTINEZ).
      for (const zloc of zeros) {
        outRow['Location'] = zloc;
        outRow['On hand (new)'] = '0';
        csvContent += headers.map(h => escapeCSV(outRow[h])).join(',') + '\n';
      }
    }
  }

  triggerDownload(csvContent, `Actualizacion_Stock_${config.brand}_${todayStamp()}.csv`);
}

// redeploy: asegurar peso por tipo en produccion
