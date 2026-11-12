// AVISO DE CAMBIO DE PRECIO (12-nov-2026, gax: «un botón de enviar aviso de cambio de precio,
// que copie a Wanda»). Cuando la carga de iD cambia el precio de venta de un producto, la app
// arma el mail con lo que cambió. La app NO envía mails: abre Gmail (o el programa de correo)
// con todo escrito y la persona lo manda. Las direcciones se guardan en la base (cf:config),
// nunca en el código: el repositorio es público.
import type { AltaFamily, ReposicionFamily, ResultadoCarga } from './cargaFamily';

export interface MailsAviso { para: string[]; copia: string[] }
export interface CambioPrecio {
  codigo: string;
  titulo: string;
  /** Precio común anterior; null si los talles tenían precios distintos (van en `precios`). */
  antes: number | null;
  precios: number[];
  nuevo: number;
  /** No se sabe si Shopify lo guardó: hay que revisarlo. */
  dudoso: boolean;
}

/** Los productos cuyo precio de venta se cambió en esta carga (según lo que devolvió Shopify). */
export function cambiosDePrecio(
  acciones: { codigo: string; accion: AltaFamily | ReposicionFamily }[], resultados: ResultadoCarga[],
): CambioPrecio[] {
  const estado = new Map(resultados.map((r) => [r.codigo, r.estado]));
  const out: CambioPrecio[] = [];
  for (const { codigo, accion } of acciones) {
    if (accion.tipo !== 'reposicion' || accion.ajuste?.precio === undefined) continue;
    const e = estado.get(codigo);
    if (e !== 'cargada' && e !== 'parcial' && e !== 'dudosa') continue;
    const a = accion.ajuste;
    if (a.precioActual !== null && a.precio === a.precioActual) continue;
    out.push({ codigo, titulo: accion.titulo, antes: a.precioActual, precios: [...a.precios], nuevo: a.precio!, dudoso: e === 'dudosa' });
  }
  return out;
}

/** $ 109.900 (los precios de venta van sin centavos salvo que los tengan). */
export function pesos(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [ent, dec] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}$ ${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec === '00' ? '' : `,${dec}`}`;
}

const MAX_CUERPO = 1600;

/** Asunto y texto del mail. */
export function textoAvisoPrecio(cambios: CambioPrecio[], ctx: { proveedor: string; factura?: string; remito?: string; fecha?: string }): { asunto: string; cuerpo: string } {
  const doc = [ctx.factura ? `factura ${ctx.factura}` : '', ctx.remito ? `remito ${ctx.remito}` : ''].filter(Boolean).join(', ');
  const asunto = `Cambio de precio — ${ctx.proveedor}${ctx.factura ? ` factura ${ctx.factura}` : ''} (${cambios.length} producto${cambios.length === 1 ? '' : 's'})`;
  const lineas = cambios.map((c) => {
    const antes = c.antes !== null ? pesos(c.antes) : `precios distintos (${c.precios.map(pesos).join(' / ')})`;
    return `• ${c.codigo} — ${c.titulo}: ${antes} → ${pesos(c.nuevo)} (toda la curva)${c.dudoso ? ' — REVISAR en Shopify si quedó' : ''}`;
  });
  const cabeza = [
    'Hola,', '',
    `Al cargar en Shopify la entrega de ${ctx.proveedor}${doc ? ` (${doc})` : ''}${ctx.fecha ? ` el ${ctx.fecha}` : ''} se cambió el precio de venta de:`, '',
  ];
  const pie = ['', 'Motivo: con el costo nuevo de la factura el margen no llegaba al 50%.', 'Hay que actualizar las etiquetas de precio en el local.'];
  // Los enlaces de mail tienen un largo máximo: si la lista es muy larga, se corta con aviso.
  const usadas: string[] = [];
  let largo = [...cabeza, ...pie].join('\n').length;
  for (const l of lineas) {
    if (largo + l.length + 1 > MAX_CUERPO) break;
    usadas.push(l); largo += l.length + 1;
  }
  const resto = lineas.length - usadas.length;
  if (resto) usadas.push(`… y ${resto} producto${resto === 1 ? '' : 's'} más (ver la app, Control de entregas).`);
  return { asunto, cuerpo: [...cabeza, ...usadas, ...pie].join('\n') };
}

/** Enlace para escribirlo en Gmail y enlace mailto para el programa de correo. */
export function enlacesMail(m: MailsAviso, asunto: string, cuerpo: string): { gmail: string; mailto: string } {
  const q = (o: Record<string, string>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const para = m.para.join(','), copia = m.copia.join(',');
  return {
    gmail: `https://mail.google.com/mail/?${q({ view: 'cm', fs: '1', to: para, cc: copia, su: asunto, body: cuerpo })}`,
    mailto: `mailto:${para}?${q({ cc: copia, subject: asunto, body: cuerpo.replace(/\n/g, '\r\n') })}`,
  };
}
