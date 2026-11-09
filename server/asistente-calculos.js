// Cuentas exactas que el asistente NO hace de cabeza: comparar documentos y
// costo ponderado. Funciones puras, cubiertas por asistente.test.js.

export const redondear2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const centavos = n => Math.round(n * 100);
const norm = v => String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
// «A12975C-055» y «a12975c - 055» son el mismo código; la O y el 0 no se tocan acá.
const normCodigo = v => norm(v).replace(/\s*-\s*/g, '-');
// «5,5», «5.5» y «055» (US × 10 de iD) no se igualan solos: cada talle se compara como viene.
const normTalle = v => norm(v).replace(',', '.');

function numero(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.replace(/[$\s]/g, '');
  // 1.234,56 (formato AR) o 1234.56
  const t = /,\d{1,4}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return Number(t);
}

function agrupar(doc, porTalle) {
  const mapa = new Map();
  const avisos = [];
  for (const [i, r] of (doc.renglones || []).entries()) {
    const codigo = normCodigo(r.codigo);
    const cantidad = numero(r.cantidad);
    if (!codigo || !Number.isFinite(cantidad)) { avisos.push(`${doc.nombre}: renglón ${i + 1} sin código o cantidad válida.`); continue; }
    const talle = porTalle ? normTalle(r.talle) : '';
    const clave = `${codigo}|${talle}`;
    const costo = r.costo_unitario == null || r.costo_unitario === '' ? null : numero(r.costo_unitario);
    const previo = mapa.get(clave) || { codigo, talle, cantidad: 0, costos: new Set(), descripcion: r.descripcion || '' };
    previo.cantidad += cantidad;
    if (costo != null && Number.isFinite(costo)) previo.costos.add(centavos(costo));
    mapa.set(clave, previo);
  }
  return { mapa, avisos };
}

/**
 * Compara dos documentos renglón por renglón (código + talle). Si alguno de
 * los dos no trae talles, se compara el total por código.
 */
export function compararDocumentos(a, b) {
  if (!a || !b || !Array.isArray(a.renglones) || !Array.isArray(b.renglones)) throw new Error('Faltan los renglones de los dos documentos.');
  const conTalle = d => d.renglones.length > 0 && d.renglones.every(r => String(r.talle ?? '').trim() !== '');
  const porTalle = conTalle(a) && conTalle(b);
  const A = agrupar(a, porTalle), B = agrupar(b, porTalle);
  const claves = [...new Set([...A.mapa.keys(), ...B.mapa.keys()])].sort();
  const filas = claves.map(clave => {
    const x = A.mapa.get(clave), y = B.mapa.get(clave);
    const base = x || y;
    const fila = { codigo: base.codigo, talle: base.talle || null, descripcion: base.descripcion,
      [a.nombre]: x ? x.cantidad : 0, [b.nombre]: y ? y.cantidad : 0 };
    const costoX = x && x.costos.size === 1 ? [...x.costos][0] : null;
    const costoY = y && y.costos.size === 1 ? [...y.costos][0] : null;
    if (x && x.costos.size > 1) fila.aviso = `${a.nombre} trae costos distintos para el mismo artículo.`;
    if (y && y.costos.size > 1) fila.aviso = `${b.nombre} trae costos distintos para el mismo artículo.`;
    if (costoX != null) fila[`costo ${a.nombre}`] = costoX / 100;
    if (costoY != null) fila[`costo ${b.nombre}`] = costoY / 100;
    if (!x) fila.estado = `solo en ${b.nombre}`;
    else if (!y) fila.estado = `solo en ${a.nombre}`;
    else if (x.cantidad !== y.cantidad) fila.estado = 'cantidad distinta';
    else if (costoX != null && costoY != null && costoX !== costoY) fila.estado = 'costo distinto';
    else fila.estado = 'coincide';
    if (x && y) fila.diferencia = redondear2(y.cantidad - x.cantidad);
    return fila;
  });
  const total = d => redondear2(d.renglones.reduce((s, r) => s + (Number.isFinite(numero(r.cantidad)) ? numero(r.cantidad) : 0), 0));
  const totales = { [a.nombre]: total(a), [b.nombre]: total(b) };
  const avisos = [...A.avisos, ...B.avisos];
  for (const d of [a, b]) {
    if (d.total_impreso != null && numero(d.total_impreso) !== totales[d.nombre]) {
      avisos.push(`${d.nombre}: la suma leída (${totales[d.nombre]}) no coincide con el total impreso (${d.total_impreso}). Revisá la lectura antes de confiar en la comparación.`);
    }
  }
  const todoCoincide = filas.every(f => f.estado === 'coincide' && !f.aviso) && avisos.length === 0;
  if (!porTalle) avisos.push('Al menos un documento no trae talles: se comparó el total por código.');
  const resumen = {};
  for (const f of filas) resumen[f.estado] = (resumen[f.estado] || 0) + 1;
  return { todo_coincide: todoCoincide, resumen, totales, avisos, filas };
}

/** Costo promedio ponderado al recibir mercadería. Solo stock propio. */
export function costoPonderado({ stock_actual, costo_actual, unidades_nuevas, costo_nuevo }) {
  const s = numero(stock_actual), c = numero(costo_actual), u = numero(unidades_nuevas), n = numero(costo_nuevo);
  if (!Number.isFinite(u) || u <= 0 || !Number.isFinite(n) || n < 0) throw new Error('Unidades nuevas y costo nuevo tienen que ser números válidos.');
  const avisos = [];
  const stock = Number.isFinite(s) ? s : 0;
  if (stock < 0) avisos.push('El stock actual es negativo: se tomó como 0 para el promedio.');
  if (stock > 0 && (!Number.isFinite(c) || c <= 0)) {
    return { costo_ponderado: null, avisos: ['El costo actual es cero o desconocido: no se puede promediar. Revisalo o usá el costo de la factura.'] };
  }
  const base = Math.max(stock, 0);
  const total = base + u;
  const costo = base === 0 ? n : (base * c + u * n) / total;
  return { costo_ponderado: redondear2(costo), unidades_totales: total, costo_actual: base ? c : null, costo_nuevo: n, avisos };
}
