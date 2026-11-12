// Planilla de nota de pedido de iD armada a mano para las pruebas (como INDU-19-10, sin datos reales):
// fila 1 con el N° y la fecha, fila 2 encabezados, una fila por artículo con talles en columnas.
// Las celdas de `verdes` llevan relleno 92D050 (el verde del depósito). Lleva una «foto» para
// comprobar que el resto del archivo no cambia. `prefijo` = 'x:' como algunas planillas de iD.
import { strToU8, zipSync } from 'fflate';

export const FOTO = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8]);

const col = (c: number) => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function planillaFalsa(filas: (string | number | null)[][], opts: { verdes?: string[]; prefijo?: string; oculta?: boolean } = {}): Uint8Array {
  const p = opts.prefijo ?? '';
  const ns = p ? ` xmlns:${p.slice(0, -1)}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` : ' xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const verdes = new Set(opts.verdes ?? []);
  const filasXml = filas.map((f, r) => `<${p}row r="${r + 1}">${f.map((v, c) => {
    const ref = `${col(c)}${r + 1}`;
    const s = verdes.has(ref) ? ' s="1"' : r === 1 ? ' s="2"' : '';
    if (v === null || v === undefined) return verdes.has(ref) ? `<${p}c r="${ref}"${s}/>` : '';
    return typeof v === 'number' ? `<${p}c r="${ref}"${s}><${p}v>${v}</${p}v></${p}c>`
      : `<${p}c r="${ref}"${s} t="inlineStr"><${p}is><${p}t>${esc(v)}</${p}t></${p}is></${p}c>`;
  }).join('')}</${p}row>`).join('');
  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}worksheet${ns}><${p}sheetData>${filasXml}</${p}sheetData></${p}worksheet>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}styleSheet${ns}>`
    + `<${p}fonts count="2"><${p}font><${p}sz val="11"/></${p}font><${p}font><${p}b/><${p}sz val="11"/></${p}font></${p}fonts>`
    + `<${p}fills count="3"><${p}fill><${p}patternFill patternType="none"/></${p}fill><${p}fill><${p}patternFill patternType="gray125"/></${p}fill>`
    + `<${p}fill><${p}patternFill patternType="solid"><${p}fgColor rgb="FF92D050"/><${p}bgColor indexed="64"/></${p}patternFill></${p}fill></${p}fills>`
    + `<${p}borders count="1"><${p}border/></${p}borders><${p}cellStyleXfs count="1"><${p}xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></${p}cellStyleXfs>`
    + `<${p}cellXfs count="3"><${p}xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<${p}xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>`
    + `<${p}xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><${p}alignment horizontal="center"/></${p}xf></${p}cellXfs></${p}styleSheet>`;
  const hojas = opts.oculta
    ? `<${p}sheet name="Vieja" sheetId="1" state="hidden" r:id="rId9"/><${p}sheet name="Pedido" sheetId="2" r:id="rId1"/>`
    : `<${p}sheet name="Pedido" sheetId="1" r:id="rId1"/>`;
  const libro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}workbook${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><${p}sheets>${hojas}</${p}sheets></${p}workbook>`;
  const vieja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}worksheet${ns}><${p}sheetData/></${p}worksheet>`;
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + (opts.oculta ? '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet9.xml"/>' : '')
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + (opts.oculta ? '<Override PartName="/xl/worksheets/sheet9.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : '')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
  const raiz = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(tipos), '_rels/.rels': strToU8(raiz), 'xl/workbook.xml': strToU8(libro),
    'xl/_rels/workbook.xml.rels': strToU8(rels), 'xl/styles.xml': strToU8(estilos), 'xl/worksheets/sheet1.xml': strToU8(hoja),
    ...(opts.oculta ? { 'xl/worksheets/sheet9.xml': strToU8(vieja) } : {}),
    'xl/media/image1.png': FOTO,
  });
}

/** La nota 1522 de ejemplo (inventada, con la forma de la real): calzado y ropa, la ropa en verde. */
export const NOTA_1522 = [
  [null, 'Pedido N° 00001522', '2059 — ELEVE SAS', '19/10/2026'],
  ['Imagen', 'Código', 'Descripción', 'Color', '037', '038', '040', '043', '044', 'L', 'XL', 'Total', 'Precio unit.', 'Subtotal', 'Bonif. %'],
  [null, 'LAO0126018', 'CARC CHALECO PUFFER 2026', '88', null, null, null, null, null, 1, null, 1, 90855.615, 90855.615, 10],
  [null, 'LFN9924069', 'BREAKPOINT CLASSIC', '1', null, null, null, 2, 2, null, null, 4, 48074.8663, 192299.4652, 10],
  [null, 'LFO0125210', 'R1100', '1', 1, 1, 2, null, null, null, null, 4, 48074.8663, 192299.4652, 10],
  [null, 'LTN0226066', 'PUMAS CAMISETA ENTR FAN 2026 1', '7', null, null, null, null, null, null, 1, 1, 48074.8663, 48074.8663, 10],
  [null, null, 'TOTAL', null, 1, 1, 2, 2, 2, 1, 1, 10, null, 523529.4117, null],
] as (string | number | null)[][];
/** Como la marcó el depósito: la ropa (talle y total) en verde, las zapatillas pendientes. */
export const VERDES_1522 = ['J3', 'L3', 'K6', 'L6'];
