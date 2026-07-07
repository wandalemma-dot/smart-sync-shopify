import * as XLSX from 'xlsx';

export type SyncMode = 'all' | 'stock_only' | 'cost_only' | 'price_only';

export interface SyncConfig {
  sheetName: string;
  brand: 'lecoq' | 'converse' | 'bloque' | 'orchard';
}

export interface MissingProduct {
  coditm: string;
  title: string;
  wholesale: number;
  sizes: Record<string, number>;
  vendor?: string;
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

// Utility: Call Shopify via our Vercel Serverless Function Proxy
async function fetchShopifyGraphQL(query: string, variables: any = {}) {
  const res = await fetch('/api/shopify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) {
    const rawText = await res.text();
    console.error("Shopify Raw Error:", rawText);
    throw new Error(`Error de Conexión (${res.status}): ${rawText.substring(0, 100)}`);
  }
  const json = await res.json();
  if (json.errors) {
     console.error(json.errors);
     throw new Error('Shopify Error: ' + JSON.stringify(json.errors));
  }
  return json.data;
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
  config: SyncConfig
): Promise<SyncResult> {
  const alerts: AlertMessage[] = [];
  const excelMap: Record<string, { wholesale: number, sizes: Record<string, number>, foundInShopify: boolean, title: string, vendor?: string }> = {};

  if (config.brand === 'bloque') {
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
  } else {
    // Lectura de Excel estándar (Converse / LeCoq)
    const excelData = await readExcel(providerFile, config.sheetName);
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
          const qty = parseFloat(row[c] || 0) || 0;
          if (norm) excelMap[cod].sizes[norm] = qty;
        }
      }
    }
  }

  // 3. Obtener Inventario y Precios de Shopify via GraphQL
  let hasNextPage = true;
  let cursor = null;
  const shopifyProducts: any[] = [];
  
  while(hasNextPage) {
    const q = `
      query getProducts($cursor: String) {
        products(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id title handle tags
              variants(first: 50) {
                edges {
                  node {
                    id sku price inventoryQuantity
                    inventoryItem { id }
                  }
                }
              }
            }
          }
        }
      }
    `;
    const data = await fetchShopifyGraphQL(q, { cursor });
    const connection = data.products;
    for (const edge of connection.edges) {
      shopifyProducts.push(edge.node);
    }
    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  const updatesToApply: UpdateAction[] = [];

  // Mapear lo de Shopify contra el ExcelMap
  for (const prod of shopifyProducts) {
    const tags = String(prod.tags || '').toLowerCase();
    
    for (const [cod, provData] of Object.entries(excelMap)) {
      // Detección: Si es bloque miramos el SKU. Si es converse/lecoq miramos el TAG.
      let match = false;
      if (config.brand === 'bloque') {
         match = prod.variants.edges.some((v: any) => v.node.sku?.toLowerCase() === cod);
      } else {
         match = tags.includes(cod);
      }
      
      if (match) {
        provData.foundInShopify = true;
        // Bonificación comercial del 15% para Bloque (y solo para Bloque)
        // El costo interno será provData.wholesale * 0.85, lo usaremos luego al sincronizar costos.
        
        // El multiplicador depende de cada marca
        let marginMultiplier = 2.01; // Default para las demás
        if (config.brand === 'bloque') {
          marginMultiplier = 2.0; // "criterio de markup orientativo de 2,0"
        }
        
        // Precio sugerido = PRECIO MAYORISTA ORIGINAL x Multiplicador
        const minP = provData.wholesale * marginMultiplier;
        let calculatedPrice = Math.floor(minP / 10000) * 10000 + 9900;
        if (calculatedPrice < minP) calculatedPrice += 10000;

        for (const vEdge of prod.variants.edges) {
           const variant = vEdge.node;
           const variantPrice = parseFloat(variant.price);
           
           // ACTUALIZACIÓN DE PRECIO
           // Ojo: Si el precio de venta sugerido cambia, preparamos acción
           if (calculatedPrice !== variantPrice && provData.wholesale > 0) {
              updatesToApply.push({
                type: 'PRICE',
                variantId: variant.id,
                handle: prod.handle,
                sku: variant.sku || cod,
                oldPrice: variantPrice,
                newPrice: calculatedPrice
              });
           }

           // ACTUALIZACIÓN DE STOCK A 0 (Para variantes que están en 0 en el proveedor)
           // Por ahora la lógica antigua ponía en 0 lo que estaba en Deposito Martinez y el prov decía 0
           // Con API, si el proveedor lo envía y la cantidad es 0 en el Excel, lo bajamos a 0.
           // Pero necesitamos la Location ID! Asumiremos que se usa inventoryAdjustQuantities
           // Para esta etapa de análisis, marcamos todo lo que está en 0
           // ... A IMPLEMENTAR ...
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
        sizes: data.sizes,
        vendor: data.vendor
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

  triggerDownload(csvContent, `Actualizacion_Precios_${config.brand}_${new Date().toISOString().split('T')[0]}.csv`);
}

function escapeCSV(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadMatrixCSV(result: SyncResult, config: SyncConfig, _tableSelections?: Record<string, number>) {
  if (result.missingProducts.length === 0) {
    alert("No hay productos faltantes para descargar.");
    return;
  }

  const headers = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
    'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty',
    'Variant Inventory Policy', 'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price',
    'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position',
    'Image Alt Text', 'Gift Card', 'SEO Title', 'SEO Description', 'Google Shopping / Google Product Category',
    'Google Shopping / Gender', 'Google Shopping / Age Group', 'Google Shopping / MPN',
    'Google Shopping / AdWords Grouping', 'Google Shopping / AdWords Labels', 'Google Shopping / Condition',
    'Google Shopping / Custom Product', 'Google Shopping / Custom Label 0', 'Google Shopping / Custom Label 1',
    'Google Shopping / Custom Label 2', 'Google Shopping / Custom Label 3', 'Google Shopping / Custom Label 4',
    'Variant Image', 'Variant Weight Unit', 'Variant Tax Code', 'Cost per item', 'Included / Argentina',
    'Price / Argentina', 'Compare At Price / Argentina', 'Included / International', 'Price / International',
    'Compare At Price / International', 'Status'
  ];

  let csvContent = headers.join(',') + '\n';

  result.missingProducts.forEach(prod => {
    const handle = prod.coditm.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const vendor = prod.vendor || (config.brand === 'lecoq' ? 'Le Coq Sportif' : config.brand === 'converse' ? 'Converse' : 'Bloque');
    
    let marginMultiplier = 2.01;
    if (config.brand === 'bloque') marginMultiplier = 2.0;
    
    const minP = prod.wholesale * marginMultiplier;
    let price = Math.floor(minP / 10000) * 10000 + 9900;
    if (price < minP) price += 10000;
    
    const cost = config.brand === 'bloque' ? prod.wholesale * 0.85 : prod.wholesale;

    let isFirstVariant = true;

    for (const [size, qty] of Object.entries(prod.sizes)) {
      const outRow: any = {};
      headers.forEach(h => outRow[h] = '');

      outRow['Handle'] = handle;
      if (isFirstVariant) {
        outRow['Title'] = prod.title;
        outRow['Body (HTML)'] = prod.title;
        outRow['Vendor'] = vendor;
        outRow['Tags'] = prod.coditm;
        outRow['Published'] = 'FALSE'; // Para que lo publiquen a mano o con POS
        outRow['Status'] = 'active';
      }

      outRow['Option1 Name'] = 'Talle';
      outRow['Option1 Value'] = size;
      
      outRow['Variant SKU'] = prod.coditm;
      outRow['Variant Price'] = price;
      outRow['Cost per item'] = cost;
      
      outRow['Variant Inventory Tracker'] = 'shopify';
      outRow['Variant Inventory Qty'] = qty.toString();
      outRow['Variant Inventory Policy'] = 'deny';
      outRow['Variant Fulfillment Service'] = 'manual';
      outRow['Variant Requires Shipping'] = 'TRUE';

      const rowArray = headers.map(h => escapeCSV(outRow[h]));
      csvContent += rowArray.join(',') + '\n';
      
      isFirstVariant = false;
    }
  });

  triggerDownload(csvContent, `Matriz_Faltantes_${config.brand}_${new Date().toISOString().split('T')[0]}.csv`);
}

export function downloadInventoryCSV(result: SyncResult, config: SyncConfig) {
  if (Object.keys(result.excelMap).length === 0) {
    alert("No hay datos de inventario para descargar.");
    return;
  }

  const headers = [
    'Handle', 'Title', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value',
    'Option3 Name', 'Option3 Value', 'SKU', 'Location', 'Available'
  ];

  let csvContent = headers.join(',') + '\n';

  for (const [coditm, data] of Object.entries(result.excelMap)) {
    const handle = coditm.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    for (const [size, qty] of Object.entries(data.sizes)) {
      const outRow: any = {};
      headers.forEach(h => outRow[h] = '');

      outRow['Handle'] = handle;
      outRow['Title'] = data.title;
      outRow['Option1 Name'] = 'Talle';
      outRow['Option1 Value'] = size;
      
      // In the old script, SKU for converse/lecoq was coditm + '-' + size
      // We'll just use the coditm for now, since Matrix uses coditm
      outRow['SKU'] = coditm;
      
      outRow['Location'] = 'ID (Converse - Le Coq Sportif)'; // Default for old script
      outRow['Available'] = String(qty);

      const rowArray = headers.map(h => escapeCSV(outRow[h]));
      csvContent += rowArray.join(',') + '\n';
    }
  }

  triggerDownload(csvContent, `Actualizacion_Stock_${config.brand}_${new Date().toISOString().split('T')[0]}.csv`);
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob(["\uFEFF" + content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
