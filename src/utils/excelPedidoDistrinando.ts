import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { ArchivoDistrinando, FilaDistrinando } from './pedidoDistrinando';

/** Solo modifica Pedido y las cachés dependientes. Conserva el resto del ZIP. */
export function generarExcelDistrinando(p: ArchivoDistrinando, filas: FilaDistrinando[]): Uint8Array {
  const zip = unzipSync(p.original), wb = XLSX.read(p.original, { type: 'array', cellFormula: true, cellStyles: true });
  const usados = new Map<string, number>();
  for (const f of filas) if (f.elegido?.archivoId === p.id && f.pedir) {
    const a = p.articulos.find(a => a.id === f.elegido!.id);
    if (!a || !Number.isInteger(f.pedir) || f.pedir < 0) throw new Error('Fila de pedido inválida. Volvé a analizar.');
    const n = (usados.get(a.id) || 0) + f.pedir;
    if (n > a.disponible) throw new Error(`El pedido de ${a.sku} supera la disponibilidad.`);
    usados.set(a.id, n);
  }
  for (const h of p.hojas) {
    let xml = strFromU8(zip[h.path]);
    const prefix = xml.match(/<([\w.-]+:)worksheet\b/)?.[1] || '';
    const valores = new Map(h.limpiar.map(c => [c, 0]));
    for (const a of p.articulos) if (a.hoja === h.nombre && usados.has(a.id)) valores.set(a.celda, usados.get(a.id)!);
    const encontradas = new Set<string>();
    xml = xml.replace(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g, (whole, attrs: string) => {
      const ref = attrs.match(/\br="([^"]+)"/)?.[1];
      if (!ref || !valores.has(ref)) return whole;
      encontradas.add(ref);
      return `<${prefix}c${attrs.replace(/\s+t="[^"]*"/g, '')}><${prefix}v>${valores.get(ref)}</${prefix}v></${prefix}c>`;
    });
    for (const [ref, qty] of valores) if (!encontradas.has(ref) && qty > 0) {
      const row = ref.match(/\d+$/)![0];
      const re = new RegExp(`(<${prefix}row\\b[^>]*\\br="${row}"[^>]*>)([\\s\\S]*?)(</${prefix}row>)`);
      if (!re.test(xml)) throw new Error(`No se encontró ${h.nombre}!${ref}.`);
      xml = xml.replace(re, (_m, start, body, end) => {
        const nuevo = `<${prefix}c r="${ref}"><${prefix}v>${qty}</${prefix}v></${prefix}c>`;
        const posicion = [...body.matchAll(/<(?:[\w.-]+:)?c\b[^>]*\br="([A-Z]+\d+)"/g)]
          .find(m => XLSX.utils.decode_cell(m[1]).c > XLSX.utils.decode_cell(ref).c)?.index;
        // Insertar sin reconstruir la fila: conserva atributos y otros elementos.
        return start + (posicion == null ? body + nuevo : body.slice(0, posicion) + nuevo + body.slice(posicion)) + end;
      });
    }
    const ws = wb.Sheets[h.nombre];
    const refs = (f: string) => {
      const result: string[] = [];
      for (const m of f.replace(/\$/g, '').matchAll(/\b[A-Z]+\d+(?::[A-Z]+\d+)?\b/gi)) {
        const r = XLSX.utils.decode_range(m[0].toUpperCase());
        if ((r.e.r-r.s.r+1)*(r.e.c-r.s.c+1)>100000) throw new Error('Rango de fórmula demasiado grande.');
        for (let row=r.s.r; row<=r.e.r; row++) for(let col=r.s.c;col<=r.e.c;col++) result.push(XLSX.utils.encode_cell({r:row,c:col}));
      }
      return result;
    };
    const depende = (ref: string, seen = new Set<string>()): boolean => {
      if (valores.has(ref)) return true;
      if (seen.has(ref)) return false;
      const f = ws[ref]?.f;
      return !!f && refs(f).some(r => depende(r, new Set(seen).add(ref)));
    };
    const value = (ref: string, seen = new Set<string>()): number => {
      if (valores.has(ref)) return valores.get(ref)!;
      if (seen.has(ref)) throw new Error('Fórmula circular.');
      const c = ws[ref];
      if (!c?.f || !depende(ref)) { if (c?.t === 'e') throw new Error('Fórmula con error.'); return Number(c?.v) || 0; }
      const f = c.f.replace(/\$/g, '').toUpperCase().trim(), visited = new Set(seen).add(ref);
      const subtotal = f.match(/^SUBTOTAL\((9|109),(.+)\)$/);
      if (/^SUM\(.+\)$/.test(f) || subtotal) {
        const args = subtotal ? subtotal[2] : f.slice(4, -1);
        if (!/^[A-Z0-9:,]+$/.test(args)) throw new Error('Fórmula no compatible.');
        // Si hay filtros activos, Excel debe calcular qué filas están visibles.
        if (subtotal && /<(?:[\w.-]+:)?filterColumn\b/.test(xml)) throw new Error('Subtotal filtrado: recalcular en Excel.');
        return refs(args).reduce((sum,r) => sum + (subtotal?.[1] === '109' && ws['!rows']?.[XLSX.utils.decode_cell(r).r]?.hidden ? 0 : value(r, visited)), 0);
      }
      const m = f.match(/^([A-Z]+\d+|\d+(?:\.\d+)?)([*/+-])([A-Z]+\d+|\d+(?:\.\d+)?)$/);
      if (!m) throw new Error('Fórmula no compatible.');
      const v = (s:string) => /^[A-Z]/.test(s) ? value(s, visited) : Number(s);
      const a=v(m[1]), b=v(m[3]);
      const n=m[2]==='*'?a*b:m[2]==='/'?a/b:m[2]==='+'?a+b:a-b;
      if (!Number.isFinite(n)) throw new Error('Resultado de fórmula inválido.');
      return n;
    };
    xml = xml.replace(/<(?:[\w.-]+:)?c\b([^>]*?[^/])>([\s\S]*?)<\/(?:[\w.-]+:)?c>/g, (whole, attrs: string, body: string) => {
      const ref=attrs.match(/\br="([^"]+)"/)?.[1];
      if (!ref || !ws[ref]?.f || !depende(ref)) return whole;
      const clean=body.replace(/<(?:[\w.-]+:)?v\b[^>]*(?:\/>|>[^<]*<\/(?:[\w.-]+:)?v>)/g, '');
      let v='';
      try { v=`<${prefix}v>${value(ref)}</${prefix}v>`; } catch { /* Quitar caché vieja, Excel recalcula al abrir. */ }
      return `<${prefix}c${attrs.replace(/\s+t="[^"]*"/g,'')}>${clean}${v}</${prefix}c>`;
    });
    zip[h.path]=strToU8(xml);
  }
  let book=strFromU8(zip['xl/workbook.xml']);
  const prefix=book.match(/<([\w.-]+:)workbook\b/)?.[1] || '';
  const calc=/<(?:[\w.-]+:)?calcPr\b[^>]*(?:\/>|>[\s\S]*?<\/(?:[\w.-]+:)?calcPr>)/g;
  const nuevo=`<${prefix}calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`;
  if (calc.test(book)) book=book.replace(calc,nuevo);
  else book=book.replace(`</${prefix}workbook>`,`${nuevo}</${prefix}workbook>`);
  zip['xl/workbook.xml']=strToU8(book);
  return zipSync(zip);
}

export function generarZipDistrinando(archivos: ArchivoDistrinando[], filas: FilaDistrinando[]): Uint8Array {
  const out: Record<string, Uint8Array> = {};
  archivos.forEach((p,i) => {
    if (filas.some(f => f.elegido?.archivoId===p.id && f.pedir>0)) {
      out[`${i+1}_Pedido_${p.nombre.replace(/[\\/:*?"<>|]/g,'_')}`]=generarExcelDistrinando(p,filas);
    }
  });
  if (!Object.keys(out).length) throw new Error('No hay cantidades para descargar.');
  return zipSync(out);
}
