// TARJETA DE TRELLO DE UNA ENTREGA DE FAMILY (16-nov-2026, gax: «que cree la tarjeta de Trello y la mande a
// finalizada con remito y planilla»). Family no tiene nota de pedido en Trello: al cargar la entrega, la app
// crea la tarjeta en «FINALIZADO» y le adjunta el remito y la planilla. Acá solo se arman los textos.
import { fechaCorta } from './avisoAdmin';
import type { ResultadoFamily } from './controlFamily';

const MAX_DESCRIPCION = 3800;

/** «Family - Remito 0001-00002716 - 11/11/26» (sin número de remito: «Family - Entrega 11/11/26»). */
export function nombreTarjetaFamily(r: ResultadoFamily): string {
  const remito = r.remito?.numero?.trim();
  return `Family - ${remito ? `Remito ${remito}` : 'Entrega'} - ${fechaCorta(r.entrega.fecha)}`;
}

/** Qué llegó (de la planilla de entrega) y cuándo se cargó. Se corta con aviso si es muy larga. */
export function descripcionTarjetaFamily(r: ResultadoFamily, sucursal: string, hoy: string): string {
  const u = r.entrega.renglones.reduce((s, x) => s + x.cantidad, 0);
  const cabeza = [
    `Entrega de Family del ${fechaCorta(r.entrega.fecha)}${r.remito?.numero ? `, remito ${r.remito.numero}` : ''}: ${r.entrega.renglones.length} artículos, ${u} u.`,
    `Cargada en Shopify (${sucursal}) el ${fechaCorta(hoy)}. Tarjeta creada por la app.`,
    '',
  ];
  const lineas = r.entrega.renglones.map((x) => {
    const talles = x.talles.filter((t) => t.cantidad > 0).map((t) => `${t.talle} ×${t.cantidad}`).join(', ');
    return `- ${x.codigo} ${x.descripcion}: ${x.cantidad} u.${talles ? ` (${talles})` : ''}`;
  });
  const usadas: string[] = [];
  let largo = cabeza.join('\n').length;
  for (const l of lineas) {
    if (largo + l.length + 1 > MAX_DESCRIPCION) break;
    usadas.push(l); largo += l.length + 1;
  }
  if (usadas.length < lineas.length) usadas.push(`… y ${lineas.length - usadas.length} artículo(s) más.`);
  return [...cabeza, ...usadas].join('\n');
}
