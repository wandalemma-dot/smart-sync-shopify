// ============================================================================
// GRUPO BLANCO (Timberland) — lectores para Control de carga
// ----------------------------------------------------------------------------
// FACTURA (PDF): un renglón por CURVA del modelo:
//   161101500010 TB0A2QKNEAC-GREYFIELD SANDAL 1 cv 6 88.947,3684 20% 426.947,37
//   Timberland / CUERO / WHITE KNIT / 35/40-1 2 3
//   Unidades = cv × Un.x Cv. Precio = de lista (sin la bonificación). No trae
//   talles: se compara el TOTAL del modelo. El PDF repite la factura
//   (Original / Duplicado…): se lee solo la primera copia.
// NOTA DE PEDIDO (Excel «TIMB»): hojas Calzados / Apparel / Accesorios, con
//   CODIGO ART, PEDIDO (en módulos), PARES X MOD o UNID X CURVA y $MAYORISTA.
//   Unidades = PEDIDO × unidades por módulo. Costo = $MAYORISTA (= el Precio
//   de la factura). En calzado el módulo son las dos curvas (…0010 y …0020)
//   y la segunda fila del par viene SIN pedido (a veces con datos de otro
//   modelo): solo cuentan las filas con PEDIDO.
// La clave es el CODIGO ART (TB…), que la factura trae antes del guion.
// ============================================================================
import { numeroAr } from './controlPedido';
import type { NotaPedido, RenglonPedido } from './controlPedido';
import type { Remito, RenglonRemito } from './controlRemitos';

// ---------- Texto del PDF, renglón por renglón ----------
interface ItemPdf { str: string; transform: number[] }

/** Junta los pedazos de texto de una página en renglones (misma altura = mismo renglón). */
export function lineasDePagina(items: ItemPdf[]): string[] {
  const out: string[] = [];
  let y: number | null = null;
  let actual: string[] = [];
  for (const it of items) {
    const yi = it.transform[5];
    if (y !== null && Math.abs(yi - y) > 2) { out.push(actual.join(' ')); actual = []; }
    if (it.str.trim()) actual.push(it.str);
    y = yi;
  }
  out.push(actual.join(' '));
  return out.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const RE_ITEM = /^(\d{10,14})\s+([A-Z0-9]+)-(.+?)\s+(\d+)\s*cv\s+(\d+)\s+([\d.]+(?:,\d+)?)\s+(\d+(?:,\d+)?)\s*%\s+([\d.]+(?:,\d+)?)$/i;

/** Factura de Grupo Blanco a partir de los renglones de cada página. */
export function facturaGrupoBlanco(paginas: string[][]): Remito {
  // Primera copia (Original); si no se ve la palabra, todas las páginas.
  const copia = (p: string[]) => p.find((l) => /^(original|duplicado|triplicado|cuadruplicado)$/i.test(l))?.toLowerCase() || '';
  const primera = paginas.map(copia).find(Boolean) || '';
  const usadas = paginas.filter((p) => copia(p) === primera);

  const renglones: RenglonRemito[] = [];
  const avisos: string[] = [];
  const bonifs = new Set<number>();
  let numero = '', fecha = '', totalCv = 0, totalUn = 0, remito = '', cvLeidos = 0;
  for (const lineas of usadas) {
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      const nro = l.match(/Factura\s+(\d{4}-\d{8})/i);
      if (nro && !numero) numero = nro[1];
      const f = l.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (f && !fecha) fecha = `${f[3]}-${f[2]}-${f[1]}`;
      const rem = l.match(/Remito:\s*(\d{4}-\d{8})/i);
      if (rem) remito = rem[1];
      const tot = l.match(/^Total:\s*(\d+)\s*cv\s+(\d+)\s*un/i);
      if (tot) { totalCv = Number(tot[1]); totalUn = Number(tot[2]); }
      const m = l.match(RE_ITEM);
      if (!m) continue;
      const [, producto, codigo, nombre, cv, porCv, precioTxt, bonifTxt, importeTxt] = m;
      const det = (lineas[i + 1] || '').split(' / ').map((s) => s.trim());
      const tieneDet = /^timberland$/i.test(det[0] || '') || det.length >= 3;
      const cantidad = Number(cv) * Number(porCv);
      const precio = numeroAr(precioTxt);
      const bonif = numeroAr(bonifTxt);
      const importe = numeroAr(importeTxt);
      const esperado = cantidad * precio * (1 - bonif / 100);
      if (Math.abs(esperado - importe) > 1) {
        avisos.push(`${codigo} (${producto}): ${cv} cv × ${porCv} × $${precioTxt} − ${bonifTxt}% no da el importe $${importeTxt}.`);
      }
      bonifs.add(bonif);
      cvLeidos += Number(cv);
      renglones.push({ codigo, descripcion: nombre.trim(), color: tieneDet ? det[2] || '' : '', talle: '', cantidad, precio_unitario: precio });
    }
  }
  if (!renglones.length) throw new Error('No encontré renglones de productos en el PDF. ¿Es una factura de Grupo Blanco?');
  if (totalCv && totalCv !== cvLeidos) avisos.push(`Leí ${cvLeidos} curvas y la factura dice ${totalCv}: puede faltar una página.`);
  return {
    proveedor: 'Grupo Blanco (Timberland)',
    tipo_comprobante: 'Factura',
    numero,
    fecha,
    cantidad_total_impresa: totalUn || undefined,
    renglones,
    observaciones: [
      totalCv ? `La factura dice ${totalCv} curvas / ${totalUn} unidades.` : '',
      remito ? `Remito ${remito}.` : '',
      `Precios de lista, antes de la bonificación (${[...bonifs].map((b) => b + '%').join(' / ')}).`,
      ...avisos,
    ].filter(Boolean).join(' '),
  };
}

// ---------- Nota de pedido (Excel de temporada) ----------
function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9$]+/g, ' ').trim();
}

export interface HojaExcel { nombre: string; filas: unknown[][] }

export function notaGrupoBlanco(hojas: HojaExcel[], nombre: string, orden = 0): { nota: NotaPedido; avisos: string[] } {
  const renglones: RenglonPedido[] = [];
  const avisos: string[] = [];
  let hojasLeidas = 0;
  for (const h of hojas) {
    const iEnc = h.filas.findIndex((f) => {
      const c = (f || []).map(norm);
      return c.includes('CODIGO ART') && c.includes('PEDIDO');
    });
    if (iEnc < 0) continue;
    hojasLeidas++;
    const enc = h.filas[iEnc].map(norm);
    const col = (re: RegExp) => enc.findIndex((x) => re.test(x));
    const cCod = col(/^CODIGO ART$/), cPed = col(/^PEDIDO$/), cDesc = col(/^DESCRIPCION$/), cColor = col(/^COLOR$/);
    const cMod = col(/^(PARES X MOD|UNID X CURVA|UNID X MOD|PARES X CURVA|PACK X|UNID X PACK)$/);
    const cCosto = col(/^\$ ?MAYORISTA$/);
    const cTot = col(/^TOTAL (PARES|UNIDADES)$/);
    if (cMod < 0) { avisos.push(`Hoja «${h.nombre}»: no encontré cuántas unidades trae cada módulo (PARES X MOD / UNID X CURVA).`); continue; }
    for (let i = iEnc + 1; i < h.filas.length; i++) {
      const f = h.filas[i] || [];
      const pedido = numeroAr(f[cPed]);
      const codigo = String(f[cCod] ?? '').trim();
      if (!codigo || !Number.isFinite(pedido) || pedido <= 0) continue;
      const porMod = numeroAr(f[cMod]);
      if (!(porMod > 0)) { avisos.push(`Hoja «${h.nombre}», fila ${i + 1} (${codigo}): pedido ${pedido} sin unidades por módulo; no se cuenta.`); continue; }
      const cantidad = pedido * porMod;
      const tot = cTot >= 0 ? numeroAr(f[cTot]) : NaN;
      if (Number.isFinite(tot) && tot > 0 && tot !== cantidad) avisos.push(`Hoja «${h.nombre}», fila ${i + 1} (${codigo}): ${pedido} × ${porMod} = ${cantidad}, pero el total dice ${tot}. Se toma ${cantidad}.`);
      const costo = cCosto >= 0 ? numeroAr(f[cCosto]) : NaN;
      renglones.push({
        codigo, descripcion: String(f[cDesc] ?? '').trim(), color: String(f[cColor] ?? '').trim(), talle: '', cantidad,
        costo: Number.isFinite(costo) && costo > 0 ? costo : undefined,
      });
    }
  }
  if (!hojasLeidas) throw new Error(`${nombre}: no parece una nota de pedido de Grupo Blanco (falta «CODIGO ART» y «PEDIDO»).`);
  if (!renglones.length) throw new Error(`${nombre}: no tiene artículos con pedido.`);
  return { nota: { nombre, fecha: '', orden, renglones }, avisos };
}
