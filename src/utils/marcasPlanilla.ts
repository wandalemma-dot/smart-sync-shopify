// ============================================================================
// QUÉ SE PINTA EN LA PLANILLA DE UNA NOTA (12-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Para devolver la planilla de la nota de pedido con lo que llegó en verde. Se
// acumula todo lo entregado hasta esa factura (también las facturas anteriores),
// así la planilla queda bien aunque la marcada anterior no se haya subido a Trello.
// Los talles salen del remito de cada entrega; sin talles en el remito, solo si
// la factura trae justo todos los talles que faltaban (o si queda uno solo).
// Talle que llegó en parte: amarillo. Lo que no se sabe de qué talle es, se avisa
// y se marca a mano. Lo que ya estaba en verde se vuelve a pintar en verde.
// ============================================================================
import { claveCodigo, mismoTalle, type CopiaPlanilla, type LineaPedido, type Pedido, type ResultadoGeneral } from './controlFacturas';
import type { CeldaMarca } from './planillaVerde';

export interface MarcaCelda extends CeldaMarca { codigo: string; talle: string; pedido: number; llegaron: number }
export interface MarcasNota {
  pedidoId: string;
  celdas: MarcaCelda[];
  /** Celdas de cantidad pintadas: se controla que sigan teniendo un número en la planilla. */
  cantidades: string[];
  /** Lo que llegó en esta entrega, por talle. */
  estaEntrega: { codigo: string; talle: string; cantidad: number }[];
  /** Unidades que llegaron sin saber de qué talle (marcarlas a mano). */
  sinTalle: { codigo: string; unidades: number }[];
  /** Lo que sigue pendiente de la nota después de esta entrega. */
  pendiente: { codigo: string; talle: string; unidades: number }[];
  completa: boolean;
  /** Facturas incluidas (hasta esta). */
  facturas: string[];
}

export function marcasDeNota(res: ResultadoGeneral, hastaFactura: string, pedidos: Pedido[], pedidoId: string): MarcasNota {
  const porId = new Map(pedidos.map((p) => [p.id, p]));
  const marcado = new Map<LineaPedido, number>();
  const estaEntrega = new Map<string, { codigo: string; talle: string; cantidad: number }>();
  const sinTalle = new Map<string, number>();
  const facturas: string[] = [];
  const lineasDe = (p: Pedido, cod: string) => p.lineas.filter((l) => l.cantidad > 0 && claveCodigo(l.codigo) === cod);
  const hasta = res.facturas.findIndex((r) => r.factura.id === hastaFactura);
  if (hasta < 0) throw new Error('No encontré esa entrega.');

  for (const r of res.facturas.slice(0, hasta + 1)) {
    const esta = r.factura.id === hastaFactura;
    let toca = false;
    // Talles del remito de esta entrega (código → talle → unidades), compartidos entre las notas.
    const remito = new Map<string, Map<string, number>>();
    for (const x of r.remito?.renglones ?? []) {
      const cod = claveCodigo(x.codigo);
      for (const t of x.talles) {
        if (!(t.cantidad > 0)) continue;
        if (!remito.has(cod)) remito.set(cod, new Map());
        const m = remito.get(cod)!;
        m.set(t.talle, (m.get(t.talle) ?? 0) + t.cantidad);
      }
    }
    for (const reng of r.renglones) {
      const cod = claveCodigo(reng.codigo);
      const pool = remito.get(cod);
      for (const a of reng.asignaciones) {
        const p = porId.get(a.pedidoId);
        if (!p) continue;
        const propia = a.pedidoId === pedidoId;
        if (propia) toca = true;
        const ls = lineasDe(p, cod);
        let u = a.cantidad;
        const tomar = (l: LineaPedido, n: number) => {
          if (n <= 0) return;
          marcado.set(l, (marcado.get(l) ?? 0) + n);
          u -= n;
          if (propia && esta) {
            const k = `${cod}|${l.talle}`;
            const e = estaEntrega.get(k) ?? { codigo: l.codigo, talle: l.talle, cantidad: 0 };
            e.cantidad += n;
            estaEntrega.set(k, e);
          }
        };
        const libre = (l: LineaPedido) => l.cantidad - (marcado.get(l) ?? 0);
        if (pool && pool.size) {
          for (const l of ls) {
            if (u <= 0) break;
            for (const [talle, n] of pool) {
              if (u <= 0 || n <= 0 || !mismoTalle(talle, l.talle)) continue;
              const t = Math.min(n, libre(l), u);
              pool.set(talle, n - t);
              tomar(l, t);
            }
          }
        } else {
          // Sin talles en el remito: lo que todavía no estaba en verde ni marcado.
          const pend = ls.filter((l) => !((l.entregado ?? 0) >= l.cantidad) && libre(l) > 0);
          const total = pend.reduce((s, l) => s + libre(l), 0);
          if (u === total || pend.length === 1) for (const l of pend) tomar(l, Math.min(libre(l), u));
        }
        if (u > 0 && propia) sinTalle.set(cod, (sinTalle.get(cod) ?? 0) + u);
      }
    }
    if (toca) facturas.push(r.factura.numero || r.factura.id);
  }

  const p = porId.get(pedidoId);
  if (!p) throw new Error('No encontré esa nota de pedido.');
  const celdas: MarcaCelda[] = [];
  const cantidades: string[] = [];
  const pendiente: MarcasNota['pendiente'] = [];
  const verdeFinal = new Map<LineaPedido, boolean>();
  for (const l of p.lineas) {
    if (!(l.cantidad > 0)) continue;
    const llegaron = Math.min(l.cantidad, marcado.get(l) ?? 0);
    const verde = (l.entregado ?? 0) >= l.cantidad || llegaron >= l.cantidad;
    verdeFinal.set(l, verde);
    if (!verde) pendiente.push({ codigo: l.codigo, talle: l.talle, unidades: l.cantidad - llegaron });
    if (!l.celda || (!verde && !llegaron)) continue;
    celdas.push({ ref: l.celda, color: verde ? 'verde' : 'amarillo', codigo: l.codigo, talle: l.talle, pedido: l.cantidad, llegaron: verde ? l.cantidad : llegaron });
    cantidades.push(l.celda);
  }
  // El total de la fila, en verde cuando llegó la fila entera.
  const filas = new Map<string, LineaPedido[]>();
  for (const l of p.lineas) if (l.cantidad > 0 && l.celdaTotal) filas.set(l.celdaTotal, [...(filas.get(l.celdaTotal) ?? []), l]);
  for (const [ref, ls] of filas) {
    if (ls.every((l) => verdeFinal.get(l))) celdas.push({ ref, color: 'verde', codigo: ls[0].codigo, talle: 'Total', pedido: 0, llegaron: 0 });
  }
  return {
    pedidoId,
    celdas,
    cantidades,
    estaEntrega: [...estaEntrega.values()],
    sinTalle: [...sinTalle.entries()].map(([codigo, unidades]) => ({ codigo, unidades })),
    pendiente,
    completa: pendiente.length === 0,
    facturas,
  };
}

/**
 * Agrega a una nota ya cargada lo que trae otra copia de su planilla: las celdas (si la nota se
 * cargó antes de guardarlas) y lo pintado en verde. Lo que ya estaba en verde no se borra aunque la
 * copia nueva no lo tenga (alguien pudo subir una copia vieja). Devuelve null si no cambia nada.
 */
export function fusionarPlanilla<T extends Pedido>(nota: T, leidas: LineaPedido[], copia?: CopiaPlanilla, lector?: number): T | null {
  const clave = (l: LineaPedido) => `${claveCodigo(l.sku)}|${l.cantidad}`;
  const porSku = new Map<string, LineaPedido>();
  for (const l of leidas) if (!porSku.has(clave(l))) porSku.set(clave(l), l);
  let cambio = false;
  const lineas = nota.lineas.map((l) => {
    const x = porSku.get(clave(l));
    if (!x) return l;
    const n = { ...l };
    if (!n.celda && x.celda) { n.celda = x.celda; cambio = true; }
    if (!n.celdaTotal && x.celdaTotal) { n.celdaTotal = x.celdaTotal; cambio = true; }
    if ((x.entregado ?? 0) > (n.entregado ?? 0)) {
      n.entregado = x.entregado;
      n.entregadoDesde = n.entregadoDesde && x.entregadoDesde && n.entregadoDesde < x.entregadoDesde ? n.entregadoDesde : x.entregadoDesde;
      cambio = true;
    }
    return n;
  });
  const copias = [...(nota.copias ?? [])];
  if (copia && !copias.some((c) => c.adjunto === copia.adjunto)) {
    copias.push(copia);
    copias.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
    cambio = true;
  }
  if (lector && (nota.lector ?? 0) < lector) cambio = true;
  if (!cambio) return null;
  return { ...nota, lineas, copias: copias.slice(-30), ...(lector && (nota.lector ?? 0) < lector ? { lector } : {}) };
}
