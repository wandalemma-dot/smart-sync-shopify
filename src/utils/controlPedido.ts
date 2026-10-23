// ============================================================================
// CONTROL DE CARGA — ¿lo facturado estaba pedido, y al mismo costo?
// ----------------------------------------------------------------------------
// El depósito ya controla remito contra factura. Acá se controla la FACTURA
// contra una o varias NOTAS DE PEDIDO:
// - Todo lo facturado tiene que haber estado pedido (no más unidades).
// - El costo facturado tiene que ser el del pedido. Si el mismo artículo está
//   en varias notas con costos distintos, manda la nota MÁS NUEVA («precio de
//   última», pedido de Wanda/gax 23-oct-2026).
// - Lo pedido y no facturado NO es error: es entrega parcial (pendiente).
// - Si la factura no trae talles para un modelo, se compara el TOTAL del
//   modelo contra lo pedido de ese modelo en todos los talles.
// Base común para todas las marcas; cada proveedor puede sumar su propio
// lector de archivos más adelante. SOLO LECTURA.
// ============================================================================
import { normalizarCodigo, normalizarTalle } from './controlRemitos';
import type { Remito } from './controlRemitos';

export interface RenglonPedido {
  codigo: string;
  descripcion: string;
  color: string;
  talle: string;
  cantidad: number;
  costo?: number;
}

export interface NotaPedido {
  nombre: string;   // archivo o número de nota
  fecha: string;    // AAAA-MM-DD ('' = sin fecha: cuenta como la más vieja)
  orden: number;    // orden de carga, desempata fechas iguales
  renglones: RenglonPedido[];
}

export type TipoPedido = 'ok' | 'excede' | 'costo' | 'noPedido';

export interface FilaPedido {
  tipo: TipoPedido;
  codigo: string;
  descripcion: string;
  color: string;
  talle: string;            // '' = comparado por modelo completo
  porModelo: boolean;
  cantFacturada: number;
  cantPedida: number;
  costoFacturado: number | null;
  costoPedido: number | null;
  excede: boolean;
  costoDistinto: boolean;
  notas: string[];          // notas de pedido donde figura
  nota?: string;
}

export interface Pendiente {
  codigo: string;
  descripcion: string;
  talle: string;
  pedido: number;
  facturado: number;
  falta: number;
  notas: string[];
}

export interface ResultadoPedido {
  filas: FilaPedido[];
  pendientes: Pendiente[];
  avisos: string[];
  totales: { facturado: number; pedido: number; pendiente: number; ok: number; excede: number; costo: number; noPedido: number };
}

const centavos = (n: number) => Math.round(n * 100);
const mismoCosto = (a: number, b: number) => Math.abs(centavos(a) - centavos(b)) <= 1;

function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Número de un Excel o texto argentino: 1.234,56 · 1234.56 · $ 1.234 */
export function numeroAr(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

// ---------- Nota de pedido desde un Excel genérico ----------
// Encabezados por nombre: Código (o Artículo/SKU) y/o Descripción, Cantidad,
// y opcionalmente Talle, Color y Costo/Precio. Sin talle = pedido por modelo.
export function notaDesdeFilas(filas: unknown[][], nombre: string, orden = 0): NotaPedido {
  const esCant = (x: string) => /^(cantidad|cant|unidades|pedido|cant pedida|cantidad pedida)$/.test(x);
  const iEnc = filas.findIndex((f) => {
    const c = (f || []).map(norm);
    return c.some(esCant) && c.some((x) => /^(codigo|cod|sku|articulo|codigo articulo|modelo|descripcion|producto)$/.test(x));
  });
  if (iEnc < 0) throw new Error(`${nombre}: no encontré la fila de encabezados (tiene que tener «Código» o «Descripción», y «Cantidad»).`);
  const enc = filas[iEnc].map(norm);
  const col = (re: RegExp) => enc.findIndex((x) => re.test(x));
  const cCant = enc.findIndex(esCant);
  const cTalle = col(/^talles?$/);
  const cColor = col(/^colou?r$/);
  let cCod = col(/^(codigo|cod|sku|codigo articulo|cod articulo|modelo)$/);
  let cDesc = col(/^(descripcion|detalle|producto|nombre)$/);
  const cArt = col(/^articulo$/);
  if (cCod < 0 && cArt >= 0) cCod = cArt;
  else if (cDesc < 0 && cArt >= 0 && cArt !== cCod) cDesc = cArt;
  const cCosto = col(/^(costo|costo unit|costo unitario|precio|precio unit|precio unitario|p unit)$/);

  const txt = (f: unknown[], c: number) => (c >= 0 && f[c] != null ? String(f[c]).trim() : '');
  const renglones: RenglonPedido[] = [];
  for (const f of filas.slice(iEnc + 1)) {
    if (!f) continue;
    const codigo = txt(f, cCod);
    const descripcion = txt(f, cDesc);
    if (!codigo && !descripcion) continue;
    if (/^total/i.test(codigo) || /^total/i.test(descripcion)) continue;
    const cantidad = numeroAr(f[cCant]);
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    const talle = txt(f, cTalle);
    const costo = cCosto >= 0 ? numeroAr(f[cCosto]) : NaN;
    renglones.push({
      codigo, descripcion, color: txt(f, cColor), talle: talle === '—' ? '' : talle, cantidad,
      costo: Number.isFinite(costo) && costo > 0 ? costo : undefined,
    });
  }
  if (!renglones.length) throw new Error(`${nombre}: no tiene renglones con cantidad.`);

  const arriba = filas.slice(0, iEnc).map((f) => (f || []).map((x) => String(x ?? '')).join(' ')).join(' ');
  let fecha = '';
  const f2 = arriba.match(/(\d{4})-(\d{2})-(\d{2})/);
  const f1 = arriba.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (f2) fecha = f2[0];
  else if (f1) fecha = `${f1[3].length === 2 ? '20' + f1[3] : f1[3]}-${f1[2].padStart(2, '0')}-${f1[1].padStart(2, '0')}`;
  return { nombre, fecha, orden, renglones };
}

// ---------- Comparación ----------
interface Acum { cantidad: number; descripcion: string; color: string; notas: Set<string> }

const claveCodigo = (r: { codigo: string; descripcion: string }) =>
  normalizarCodigo(r.codigo) || 'D:' + norm(r.descripcion);

export function compararConPedido(factura: Remito, notasIn: NotaPedido[]): ResultadoPedido {
  const avisos: string[] = [];
  // De la más vieja a la más nueva: la última que escribe un costo, gana.
  const notas = [...notasIn].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.orden - b.orden);

  const pedTalle = new Map<string, Acum>();               // cod|talle
  const pedModelo = new Map<string, Acum>();              // cod
  const costoTalle = new Map<string, number>();           // cod|talle → costo de la nota más nueva
  const costoUltimaNotaModelo = new Map<string, Set<number>>(); // cod → costos en la nota más nueva que lo trae
  const costosVistos = new Map<string, Set<number>>();    // cod|talle → todos los costos (para avisar)
  const sinTallePedido = new Set<string>();

  for (const n of notas) {
    const costosDeEstaNota = new Map<string, Set<number>>();
    for (const r of n.renglones) {
      const c = claveCodigo(r);
      const t = normalizarTalle(r.talle);
      if (!t) sinTallePedido.add(c);
      const k = `${c}|${t}`;
      for (const [m, key] of [[pedTalle, k], [pedModelo, c]] as const) {
        const a = m.get(key) || { cantidad: 0, descripcion: r.descripcion, color: r.color, notas: new Set<string>() };
        a.cantidad += r.cantidad;
        a.notas.add(n.nombre);
        if (!a.descripcion) a.descripcion = r.descripcion;
        m.set(key, a);
      }
      if (r.costo != null) {
        costoTalle.set(k, r.costo);
        if (!costosVistos.has(k)) costosVistos.set(k, new Set());
        costosVistos.get(k)!.add(centavos(r.costo));
        if (!costosDeEstaNota.has(c)) costosDeEstaNota.set(c, new Set());
        costosDeEstaNota.get(c)!.add(r.costo);
      }
    }
    for (const [c, s] of costosDeEstaNota) costoUltimaNotaModelo.set(c, s);
  }
  const cambiosDeCosto = [...costosVistos.values()].filter((s) => s.size > 1).length;
  if (cambiosDeCosto) avisos.push(`${cambiosDeCosto} artículo(s) figuran en varias notas con costos distintos: se toma el de la nota más nueva.`);

  // Factura agrupada. Un modelo sin talle en algún renglón (o pedido sin talle) se compara entero.
  const factPorCodigo = new Map<string, typeof factura.renglones>();
  for (const r of factura.renglones) {
    if (!(Number(r.cantidad) > 0)) continue;
    const c = claveCodigo(r);
    if (!factPorCodigo.has(c)) factPorCodigo.set(c, []);
    factPorCodigo.get(c)!.push(r);
  }

  const filas: FilaPedido[] = [];
  const facturadoTalle = new Map<string, number>();
  const facturadoModelo = new Map<string, number>();
  const modelosPorTotal = new Set<string>();

  for (const [c, rs] of factPorCodigo) {
    const porModelo = rs.some((r) => !normalizarTalle(r.talle)) || sinTallePedido.has(c);
    if (porModelo) modelosPorTotal.add(c);
    const grupos = new Map<string, typeof rs>();
    for (const r of rs) {
      const t = porModelo ? '' : normalizarTalle(r.talle);
      if (!grupos.has(t)) grupos.set(t, []);
      grupos.get(t)!.push(r);
    }
    for (const [t, g] of grupos) {
      const cant = g.reduce((s, r) => s + Number(r.cantidad), 0);
      facturadoModelo.set(c, (facturadoModelo.get(c) || 0) + cant);
      if (!porModelo) facturadoTalle.set(`${c}|${t}`, cant);
      const ped = porModelo ? pedModelo.get(c) : pedTalle.get(`${c}|${t}`);
      const precios = [...new Set(g.map((r) => Number(r.precio_unitario)).filter((p) => p > 0))];
      const costoFacturado = precios.length ? precios[0] : null;
      const base: FilaPedido = {
        tipo: 'ok', codigo: g[0].codigo, descripcion: g[0].descripcion || ped?.descripcion || '', color: g[0].color || '',
        talle: porModelo ? '' : g[0].talle, porModelo, cantFacturada: cant, cantPedida: ped?.cantidad || 0,
        costoFacturado, costoPedido: null, excede: false, costoDistinto: false, notas: ped ? [...ped.notas] : [],
      };
      if (!ped) {
        const otro = !porModelo && pedModelo.get(c);
        filas.push({ ...base, tipo: 'noPedido', nota: otro ? 'Ese modelo sí está pedido, pero en otros talles.' : undefined });
        continue;
      }
      base.excede = cant > ped.cantidad;
      const notasTxt: string[] = [];
      if (precios.length > 1) notasTxt.push(`La factura trae ${precios.length} precios distintos para este artículo.`);
      // Costo de referencia: el del talle en la nota más nueva; por modelo, los de la nota más nueva.
      const refs = porModelo ? [...(costoUltimaNotaModelo.get(c) || [])] : (costoTalle.has(`${c}|${t}`) ? [costoTalle.get(`${c}|${t}`)!] : []);
      if (refs.length) {
        base.costoPedido = refs.length === 1 ? refs[0] : null;
        if (costoFacturado == null) notasTxt.push('La factura no trae precio: no se pudo controlar el costo.');
        else {
          base.costoDistinto = precios.some((p) => !refs.some((r) => mismoCosto(p, r)));
          if (refs.length > 1) {
            notasTxt.push(`En la nota más nueva este modelo tiene varios costos (${refs.map((r) => '$' + r.toLocaleString('es-AR')).join(' / ')}).`);
            if (!base.costoDistinto) base.costoPedido = precios.length === 1 ? precios[0] : null;
          }
        }
      } else notasTxt.push('La nota de pedido no trae costo: no se pudo controlar.');
      if (porModelo) notasTxt.unshift('Comparado por modelo completo (sin talles).');
      base.tipo = base.excede ? 'excede' : base.costoDistinto ? 'costo' : 'ok';
      if (notasTxt.length) base.nota = notasTxt.join(' ');
      filas.push(base);
    }
  }

  // Pendientes de entrega (pedido sin facturar). Informativo, no es error.
  const pendientes: Pendiente[] = [];
  for (const [c, a] of pedModelo) {
    if (modelosPorTotal.has(c) || sinTallePedido.has(c)) {
      const fac = facturadoModelo.get(c) || 0;
      if (a.cantidad > fac) pendientes.push({ codigo: c.startsWith('D:') ? '' : c, descripcion: a.descripcion, talle: '', pedido: a.cantidad, facturado: fac, falta: a.cantidad - fac, notas: [...a.notas] });
      continue;
    }
    for (const [k, p] of pedTalle) {
      if (!k.startsWith(c + '|')) continue;
      const fac = facturadoTalle.get(k) || 0;
      if (p.cantidad > fac) pendientes.push({ codigo: c.startsWith('D:') ? '' : c, descripcion: p.descripcion, talle: k.slice(c.length + 1), pedido: p.cantidad, facturado: fac, falta: p.cantidad - fac, notas: [...p.notas] });
    }
  }

  const orden: Record<TipoPedido, number> = { noPedido: 0, excede: 1, costo: 2, ok: 3 };
  filas.sort((a, b) => orden[a.tipo] - orden[b.tipo]);
  const cuenta = (t: TipoPedido) => filas.filter((f) => f.tipo === t).length;
  return {
    filas, pendientes, avisos,
    totales: {
      facturado: filas.reduce((s, f) => s + f.cantFacturada, 0),
      pedido: [...pedModelo.values()].reduce((s, a) => s + a.cantidad, 0),
      pendiente: pendientes.reduce((s, p) => s + p.falta, 0),
      ok: cuenta('ok'), excede: cuenta('excede'), costo: cuenta('costo'), noPedido: cuenta('noPedido'),
    },
  };
}
