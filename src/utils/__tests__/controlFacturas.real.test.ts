// Prueba optativa con archivos reales (no van al repo):
// FACTURAS_PEDIDO=ruta.xlsx FACTURAS_PDF=ruta.pdf npx vitest run controlFacturas.real
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { leerFacturaDistrinando, leerPedidoExcel } from '../lectoresFacturas';
import { analizarFacturas } from '../controlFacturas';

const PED = process.env.FACTURAS_PEDIDO;
const PDF = process.env.FACTURAS_PDF;

describe.skipIf(!PED || !PDF)('factura y pedido reales de DISTRINANDO', () => {
  it('lee la factura y la cruza con el pedido', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(PDF!)) }).promise;
    const paginas = [];
    for (let i = 1; i <= pdf.numPages; i++) paginas.push((await (await pdf.getPage(i)).getTextContent()).items as any);
    const { factura, avisos } = leerFacturaDistrinando(paginas, 'f1');
    const wb = XLSX.read(fs.readFileSync(PED!));
    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
    const { pedido } = leerPedidoExcel(filas, 'p1', 'pedido', '2026-11-05');
    const r = analizarFacturas([pedido], [factura]);
    console.log(JSON.stringify({ factura: { ...factura, renglones: factura.renglones.map((x) => `${x.codigo} ${x.cantidad} ${x.precioUnitario} ${x.total}`) }, avisos, motivos: r.facturas[0].motivos, aritmetica: r.facturas[0].aritmetica, checklist: r.facturas[0].checklist.slice(0, 4) }, null, 1));
    expect(factura.renglones.length).toBeGreaterThan(0);
  });
});
