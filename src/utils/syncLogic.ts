import * as XLSX from 'xlsx';
import Papa from 'papaparse';

export interface SyncConfig {
  sheetName: string;
  brand: 'lecoq' | 'converse';
  marginMultiplier: number;
}

export interface MissingProduct {
  coditm: string;
  title: string;
  wholesale: number;
  sizes: Record<string, number>;
}

export interface PriceReview {
  handle: string;
  costoNuevo: number;
  precioActual: number;
  precioSugerido: number;
}

export interface SyncResult {
  pricesCsv: string;
  inventoryCsv: string;
  priceReviewsCsv: string;
  missingProducts: MissingProduct[];
  alerts: AlertMessage[];
  prodHeaders: string[];
}



export function generateNewProductsCsv(
  missingProducts: MissingProduct[], 
  tableSelections: Record<string, number>, 
  config: SyncConfig,
  prodHeaders: string[]
): string {
  const idxHandleProd = prodHeaders.indexOf('Handle');
  const idxTitleProd = prodHeaders.indexOf('Title');
  const idxVendorProd = prodHeaders.indexOf('Vendor');
  const idxTagsProd = prodHeaders.indexOf('Tags');
  const idxOpt1NameProd = prodHeaders.indexOf('Option1 Name');
  const idxOpt1ValProd = prodHeaders.indexOf('Option1 Value');
  const idxPriceProd = prodHeaders.indexOf('Variant Price');
  const idxCostProd = prodHeaders.indexOf('Cost per item');
  const idxInvQtyProd = prodHeaders.indexOf('Variant Inventory Qty');
  const idxInvTrackerProd = prodHeaders.indexOf('Variant Inventory Tracker');
  const idxStatusProd = prodHeaders.indexOf('Status');

  const outNewProducts: any[][] = [prodHeaders];

  for (const obj of missingProducts) {
    const handle = `nuevo-modelo-${obj.coditm}`;
    const vendor = config.brand === 'converse' ? 'Converse' : 'Le Coq Sportif';
    let isFirstVariant = true;
    
    // Determine which table to use
    let tableId = tableSelections[obj.coditm] || 1;
    let tableTag = 'TABLA DE TALLE CONVERSE 1';
    if (tableId === 2) tableTag = 'TABLA DE TALLE CONVERSE 2';
    if (tableId === 3) tableTag = 'TABLA DE TALLE CONVERSE MUJER';
    if (tableId === 4) tableTag = 'TABLA DE TALLE CONVERSE NIÑO';
    if (tableId === 5) tableTag = 'TABLA DE TALLE CONVERSE BEBE';
    
    for (const [usSize, qty] of Object.entries(obj.sizes)) {
      let shopifySize = usSize;
      if (config.brand === 'converse') {
          const table = tableId === 1 ? convTable1 : tableId === 2 ? convTable2 : tableId === 3 ? convTable3 : tableId === 4 ? convTable4 : convTable5;
          shopifySize = table[usSize] || usSize;
      } else if (config.brand === 'lecoq') {
          const n = parseFloat(usSize);
          if (!isNaN(n)) shopifySize = (n - 1).toString();
      }

      const minP = obj.wholesale * config.marginMultiplier;
      let calculatedPrice = Math.floor(minP / 10000) * 10000 + 9900;
      if (calculatedPrice < minP) calculatedPrice += 10000;

      const newRow = new Array(prodHeaders.length).fill('');
      if (idxHandleProd !== -1) newRow[idxHandleProd] = handle;
      if (idxOpt1NameProd !== -1) newRow[idxOpt1NameProd] = 'Talle';
      if (idxOpt1ValProd !== -1) newRow[idxOpt1ValProd] = shopifySize;
      if (idxPriceProd !== -1) newRow[idxPriceProd] = calculatedPrice.toString();
      if (idxCostProd !== -1) newRow[idxCostProd] = obj.wholesale.toString();
      if (idxInvTrackerProd !== -1) newRow[idxInvTrackerProd] = 'shopify';
      if (idxInvQtyProd !== -1) newRow[idxInvQtyProd] = qty.toString();

      if (isFirstVariant) {
          if (idxTitleProd !== -1) newRow[idxTitleProd] = obj.title;
          if (idxVendorProd !== -1) newRow[idxVendorProd] = vendor;
          if (idxTagsProd !== -1) newRow[idxTagsProd] = config.brand === 'converse' ? `${obj.coditm}, ${tableTag}` : obj.coditm;
          if (idxStatusProd !== -1) newRow[idxStatusProd] = 'draft';
          isFirstVariant = false;
      }

      outNewProducts.push(newRow);
    }
  }

  return Papa.unparse(outNewProducts);
}

export interface AlertMessage {
  type: 'warning' | 'danger' | 'info';
  title: string;
  message: string;
}

const convTable1: Record<string, string> = {
  '3': '34', '4': '35', '4.5': '36', '5': '36.5', '5.5': '37', '6': '37.5', '6.5': '38',
  '7': '39', '7.5': '39.5', '8': '40', '8.5': '41', '9': '41.5', '9.5': '42', '10': '43',
  '11': '44', '11.5': '45', '12': '45.5', '13': '46.5', '14': '48'
};

const convTable2: Record<string, string> = {
  '3': '35', '3.5': '36', '4': '36.5', '4.5': '37', '5': '37.5', '5.5': '38',
  '6': '39', '6.5': '39.5', '7': '40', '7.5': '41', '8': '41.5', '8.5': '42',
  '9': '42.5', '9.5': '43', '10': '44', '10.5': '44.5', '11': '45', '11.5': '46',
  '12': '46.5', '13': '48', '14': '49'
};

const convTable3: Record<string, string> = {
  '5': '35', '5.5': '36', '6': '36.5', '6.5': '37', '7.5': '38', '8': '39',
  '9': '40', '9.5': '41'
};

const convTable4: Record<string, string> = {
  '10.5': '27', '11': '28', '11.5': '28.5', '12': '29', '12.5': '30', '13': '31',
  '13.5': '31.5', '1': '32', '1.5': '33', '2.5': '34', '3': '35'
};

const convTable5: Record<string, string> = {
  '4': '20', '6': '21', '7': '22', '8': '23', '9': '24', '10': '25', '11': '26'
};



export async function processFiles(
  providerExcel: File,
  inventoryCsv: File,
  productsCsv: File,
  config: SyncConfig
): Promise<SyncResult> {
  const alerts: AlertMessage[] = [];

  // 1. Leer Excel
  const excelData = await readExcel(providerExcel, config.sheetName);
  const excelMap: Record<string, { wholesale: number, sizes: Record<string, number>, foundInShopify: boolean, title: string }> = {};
  
  if (excelData.length < 3) {
    throw new Error('El Excel no tiene suficientes filas de datos.');
  }
  
  const excelHeaders = excelData[1] as any[]; // La fila 2 tiene los talles
  const startSizeCol = 7; // Asumimos que los talles empiezan en la col 7 (0-indexed) como vimos en el log

  for (let r = 2; r < excelData.length; r++) {
    const row = excelData[r] as any[];
    if (!row) continue;
    const desc = String(row[2] || '').trim(); // DESCRIPCION
    const cod = String(row[1] || '').trim().toLowerCase(); // CODITM
    const wholesale = parseFloat(row[4] || 0); // WHOLESALE PRICE en col 4 según el log
    
    if (cod) {
      excelMap[cod] = { wholesale, sizes: {}, foundInShopify: false, title: desc };
      for (let c = startSizeCol; c < excelHeaders.length; c++) {
        const rawSize = String(excelHeaders[c] || '').trim();
        if (!rawSize || rawSize.toLowerCase().includes('total')) continue;
        
        let normalizedSizeKey = rawSize;
        if (config.brand === 'lecoq') {
           normalizedSizeKey = rawSize.replace(/^0+/, ''); // '035' -> '35'
        } else if (config.brand === 'converse') {
           const num = parseInt(rawSize, 10);
           if (!isNaN(num)) {
             normalizedSizeKey = (num / 10).toString(); // '035' -> '3.5'
           }
        }
        
        const qty = parseFloat(row[c] || 0) || 0;
        if (normalizedSizeKey) {
          excelMap[cod].sizes[normalizedSizeKey] = qty;
        }
      }
    }
  }

  // 2. Leer Inventario CSV
  const invParsed = await readCsv(inventoryCsv);
  const invData = invParsed.data as any[][];
  const invHeaders = invData[0];
  const idxHandleInv = invHeaders.indexOf('Handle');
  const idxOpt1ValInv = invHeaders.indexOf('Option1 Value');
  const idxLocationInv = invHeaders.indexOf('Location');
  const idxCurrentInv = invHeaders.indexOf('On hand (current)');
  const idxCommittedInv = invHeaders.indexOf('Committed (not editable)');

  const variantesEnCero = new Set<string>();

  for (let r = 1; r < invData.length; r++) {
    const row = invData[r];
    if (row.length < 5) continue;
    const location = String(row[idxLocationInv] || '').trim();
    if (location === 'DEPOSITO MARTINEZ') {
      const currentStock = parseFloat(row[idxCurrentInv]) || 0;
      const handle = row[idxHandleInv];
      const opt1Val = String(row[idxOpt1ValInv]).trim();
      
      if (currentStock === 0) {
        variantesEnCero.add(handle + '|' + opt1Val);
      }
    }
  }

  // 3. Leer Productos CSV para Mapear Tags y Precios Originales
  const prodParsed = await readCsv(productsCsv);
  const prodData = prodParsed.data as any[][];
  const prodHeaders = prodData[0];
  const idxHandleProd = prodHeaders.indexOf('Handle');
  const idxTagsProd = prodHeaders.indexOf('Tags');
  const idxOpt1ValProd = prodHeaders.indexOf('Option1 Value');
  const idxPriceProd = prodHeaders.indexOf('Variant Price');
  const idxCostProd = prodHeaders.indexOf('Cost per item');

  const handlesToKeep: Record<string, { coditm: string, tableId?: number }> = {};
  const coditmToHandle: Record<string, string> = {};
  const shopifyVariantCosts: Record<string, number> = {};
  
  for (let r = 1; r < prodData.length; r++) {
    const row = prodData[r];
    if (row.length < 5) continue;
    const handle = row[idxHandleProd];
    const opt1Val = String(row[idxOpt1ValProd] || '').trim();
    const cost = parseFloat(row[idxCostProd]) || 0;
    if (opt1Val) shopifyVariantCosts[handle + '|' + opt1Val] = cost;
    
    const tagsStr = String(row[idxTagsProd] || '').toLowerCase();
    
    if (tagsStr && !handlesToKeep[handle]) {
      for (const cod in excelMap) {
        if (tagsStr.includes(cod)) {
          
          if (coditmToHandle[cod] && coditmToHandle[cod] !== handle) {
            alerts.push({
              type: 'danger',
              title: 'Código de Proveedor Duplicado',
              message: `¡PELIGRO! El código "${cod.toUpperCase()}" está siendo usado por dos productos diferentes: "${coditmToHandle[cod]}" y "${handle}". Revisa tu Shopify de inmediato.`
            });
          } else {
            coditmToHandle[cod] = handle;
            excelMap[cod].foundInShopify = true;
          }

          let tableId = undefined;
          if (config.brand === 'converse') {
            if (tagsStr.includes('tabla de talle converse 1')) tableId = 1;
            else if (tagsStr.includes('tabla de talle converse 2')) tableId = 2;
            else if (tagsStr.includes('tabla de talle converse mujer')) tableId = 3;
            else if (tagsStr.includes('tabla de talle converse niño') || tagsStr.includes('tabla de talle converse nino')) tableId = 4;
            else if (tagsStr.includes('tabla de talle converse bebe')) tableId = 5;
            else {
              alerts.push({
                type: 'danger',
                title: 'Tabla de talle faltante',
                message: `El producto Converse "${handle}" no tiene la etiqueta 'TABLA DE TALLE CONVERSE 1, 2, MUJER, NIÑO o BEBE'. Deberás actualizar su inventario manualmente.`
              });
            }
          }
          handlesToKeep[handle] = { coditm: cod, tableId };
          break;
        }
      }
    }
  }



  // 4. Modificar Inventario CSV
  const outInventario: any[][] = [invHeaders];
  for (let r = 1; r < invData.length; r++) {
    const row = invData[r];
    if (row.length < 5) continue;
    const location = String(row[idxLocationInv] || '').trim();
    if (location !== 'ID (Converse - Le Coq Sportif)') continue;
    
    const handle = row[idxHandleInv];
    const mapping = handlesToKeep[handle];
    if (!mapping) continue; // No está en nuestro excel
    if (config.brand === 'converse' && !mapping.tableId) continue; // Converse sin tabla

    const shopifySizeStr = String(row[idxOpt1ValInv]).trim();
    const coditm = mapping.coditm;
    const excelObj = excelMap[coditm];

    let excelSizeKeyToLookFor: string | null = null;

    if (config.brand === 'lecoq') {
      // Shopify 36 -> Excel 37
      const shopifySizeNum = parseFloat(shopifySizeStr);
      if (!isNaN(shopifySizeNum)) {
        excelSizeKeyToLookFor = (shopifySizeNum + 1).toString();
      }
    } else if (config.brand === 'converse') {
      // Buscar en la tabla inversa: ARG -> US
      const table = mapping.tableId === 1 ? convTable1 : mapping.tableId === 2 ? convTable2 : mapping.tableId === 3 ? convTable3 : mapping.tableId === 4 ? convTable4 : convTable5;
      for (const [usSize, argSize] of Object.entries(table)) {
        if (argSize === shopifySizeStr) {
          excelSizeKeyToLookFor = usSize;
          break;
        }
      }
      if (!excelSizeKeyToLookFor) {
        alerts.push({
          type: 'warning',
          title: 'Talle no encontrado',
          message: `El talle ${shopifySizeStr} para el modelo ${handle} no se encontró en la Tabla ${mapping.tableId}.`
        });
      }
    }

    if (excelSizeKeyToLookFor) {
      const variantKey = handle + '|' + shopifySizeStr;
      const martinezIsZero = variantesEnCero.has(variantKey);
      const shopifyCost = shopifyVariantCosts[variantKey] || 0;
      const excelCost = excelObj.wholesale;
      
      const costsMatch = shopifyCost === excelCost;
      const canLoadStock = martinezIsZero || costsMatch;

      const committed = parseFloat(row[idxCommittedInv]) || 0;
      const excelQty = excelObj.sizes[excelSizeKeyToLookFor] || 0;
      const finalStock = canLoadStock ? Math.max(0, excelQty - committed) : 0;

      const newRow = [...row];
      const idxNew = invHeaders.indexOf('On hand (new)');
      newRow[idxNew] = finalStock;
      outInventario.push(newRow);
    }
  }

  // 5. Modificar Precios CSV
  const priceReviewsMap = new Map<string, PriceReview>();
  const outPrecios: any[][] = [prodHeaders];
  for (let r = 1; r < prodData.length; r++) {
    const row = [...prodData[r]];
    if (row.length < 5) continue;
    const handle = row[idxHandleProd];
    const mapping = handlesToKeep[handle];
    
    if (!mapping) continue;
    if (config.brand === 'converse' && !mapping.tableId) continue;

    const coditm = mapping.coditm;
    const opt1Val = String(row[idxOpt1ValProd] || '').trim();
    const currentPriceStr = String(row[idxPriceProd] || '').trim();
    const variantKey = handle + '|' + opt1Val;

    if (opt1Val) { // Si es fila de variante
      const wholesale = excelMap[coditm].wholesale;
      const minP = wholesale * config.marginMultiplier;
      let calculatedPrice = Math.floor(minP / 10000) * 10000 + 9900;
      if (calculatedPrice < minP) calculatedPrice += 10000;
      
      const currentPrice = parseFloat(currentPriceStr) || 0;

      if (currentPrice < calculatedPrice && currentPrice > 0) {
        if (!priceReviewsMap.has(handle)) {
          priceReviewsMap.set(handle, {
            handle,
            costoNuevo: wholesale,
            precioActual: currentPrice,
            precioSugerido: calculatedPrice
          });
        }
      }
      
      // Costo: Solo se cambia el costo en las variantes que en Martinez estaban en 0
      if (variantesEnCero.has(variantKey)) {
        row[idxCostProd] = wholesale.toString();
      }
    }
    
    outPrecios.push(row);
  }

  const missingProducts: MissingProduct[] = [];
  for (const cod in excelMap) {
    if (!excelMap[cod].foundInShopify) {
      missingProducts.push({
        coditm: cod,
        title: excelMap[cod].title || `Modelo ${cod.toUpperCase()}`,
        wholesale: excelMap[cod].wholesale,
        sizes: excelMap[cod].sizes
      });
    }
  }

  if (priceReviewsMap.size > 0) {
    alerts.push({
      type: 'warning',
      title: 'Revisiones de Precio Pendientes',
      message: `Se detectaron ${priceReviewsMap.size} modelos cuyo precio actual no alcanza el margen deseado. Puedes descargar el reporte de "Precios a Revisar" para analizarlos cómodamente.`
    });
  }

  const priceReviewsArray = Array.from(priceReviewsMap.values());
  const priceReviewsCsv = Papa.unparse(priceReviewsArray);

  return {
    pricesCsv: Papa.unparse(outPrecios),
    inventoryCsv: Papa.unparse(outInventario),
    priceReviewsCsv,
    missingProducts,
    alerts,
    prodHeaders
  };
}

function readExcel(file: File, sheetName: string): Promise<any[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[sheetName];
        if (!ws) throw new Error(`Pestaña ${sheetName} no encontrada`);
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
        resolve(json as any[][]);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function readCsv(file: File): Promise<Papa.ParseResult<unknown>> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      complete: resolve,
      error: reject
    });
  });
}

export function extractSheetNames(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        resolve(wb.SheetNames);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
