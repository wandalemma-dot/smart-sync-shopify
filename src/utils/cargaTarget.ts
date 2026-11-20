// ============================================================================
// TARGET — CARGAR UNA ENTREGA EN SHOPIFY (19-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Lo que llegó (el remito) se SUMA en DEPOSITO MARTINEZ, como en iD y Distrinando.
//   · Productos que no están en Shopify (al empezar, todos): se crean con el título de la factura
//     (editable), la marca del producto como vendor, tipo por la primera palabra, SKU = código, etiquetas
//     «Target» y el código, precio = lista × 2, costo = lista − bonificación de la factura, activos y en
//     Point of Sale. Sin talles: un producto por código (la curva de colores se verá cuando llegue).
//   · Productos que ya están (con la etiqueta «Target»): se suma el stock y el costo nuevo (promedio
//     ponderado si ya había stock en Martínez). El precio no se toca salvo que no llegue a lista × 2.
//   · Un producto con ese código pero SIN la etiqueta «Target» no se toca (los códigos de Target son
//     números cortos y pueden coincidir con SKU de otra marca): se avisa.
// Ejecución, marca «una sola vez» y vista previa: las de iD/Family (cargaFamily.ts).
// ============================================================================
import { claveCodigo, type ResultadoFactura } from './controlFacturas';
import { textoCarga, type AltaFamily, type CargaFamily, type ItemCarga, type OpcionCarga, type PlanCarga, type ReposicionFamily } from './cargaFamily';
import { ajusteDe, formasCodigo, SUCURSAL_CARGA_ID, type EstadoCargaId, type ProductoId } from './cargaId';
import { costoTarget, esDeTarget, ETIQUETA_TARGET, listaX2, marcaTarget, margenTarget, precioTarget, tipoTarget, tituloTarget } from './target';

const pctTexto = (m: number) => `${Math.floor(m * 10) / 10}%`.replace('.', ',');

const NO_CARGAR: OpcionCarga = { clave: 'no', etiqueta: 'No cargar este artículo', accion: null, avisos: [] };

// ---------------------------------------------------------------------------
// COLORES (20-nov-2026, gax: «hay productos que vienen de diferentes colores… cada color se publique como un
// producto nuevo… que al final de la carga, cuando pongamos las unidades, dé lo mismo que el total que entró»).
// Ni la factura ni el remito dicen los colores: se escriben en la vista previa. Cada color es un producto aparte
// (título + color, SKU código-COLOR, etiquetas Target, código y color) y la suma tiene que dar lo que llegó.
// ---------------------------------------------------------------------------
/** Un color escrito en la vista previa y sus unidades. */
export interface ColorTarget { color: string; cantidad: number }
const sinAcentoT = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** «azul marino» → «AZUL-MARINO» (va al SKU después del código). */
export function slugColor(color: string): string {
  return sinAcentoT(color).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/** «azul MARINO» → «Azul Marino» (va al final del título). */
export function nombreColor(color: string): string {
  return String(color ?? '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase());
}
/** SKU del producto de ese color. */
export const skuColorTarget = (codigo: string, color: string) => `${codigo}-${slugColor(color)}`;
/** El color de un producto de Target por su SKU («60028-NEGRO» → «NEGRO»); '' si no tiene color. */
export function colorDeSku(sku: string, codigo: string): string {
  const s = String(sku ?? '').trim().toUpperCase(), c = String(codigo ?? '').trim().toUpperCase();
  if (!c || !s.startsWith(c)) return '';
  const m = /^[-_. /]+([A-Z0-9][A-Z0-9-]*)$/.exec(s.slice(c.length));
  return m ? m[1] : '';
}

/** Firma de lo que llegó: la misma mercadería no se carga dos veces (también desde otra entrega). */
export function firmaTarget(fecha: string, remito: string, codigo: string, unidades: number): string {
  return `${fecha}|${codigo}|${unidades}|${String(remito || '').replace(/\|/g, '')}`;
}

function opcionReposicion(p: ProductoId | undefined, unidades: number, lista: number, bonif: number, ren: Parameters<typeof ajusteDe>[1] | undefined): OpcionCarga {
  if (!p) return { clave: 'falta', etiqueta: 'Producto que no pude leer', accion: null, bloqueo: 'No pude leer ese producto en Shopify.', avisos: [] };
  const avisos: string[] = [];
  const base = { clave: `repo:${p.id}`, etiqueta: `Sumar el stock en «${p.titulo}»`, avisos };
  if (p.variantes.length !== 1) return { ...base, accion: null, bloqueo: `«${p.titulo}» tiene ${p.variantes.length} variantes y la factura no dice de cuál: cargalo a mano.` };
  const v = p.variantes[0];
  if (!v.seguimiento || !v.inventoryItemId) return { ...base, accion: null, bloqueo: `«${p.titulo}» no lleva control de stock: cargalo a mano.` };
  const lineas = [{ talle: v.talle, inventoryItemId: v.inventoryItemId, actual: v.disponible, suma: unidades }];
  const ajuste = ren && lista > 0 ? ajusteDe(p, { ...ren, bonificacion: bonif }, lineas, { sugerido: precioTarget(lista, bonif), basico: false }) : null;
  if (ajuste) {
    // Regla de Target: el precio llega si es al menos la lista × 2, subida al 50% de margen si hace falta.
    ajuste.regla = 'x2';
    ajuste.listaX2 = listaX2(lista);
    ajuste.ok = ajuste.precioActual !== null && ajuste.precioActual >= ajuste.sugerido;
    for (const c of ajuste.conservan) if (c.motivo) avisos.push(`Ya tenía ${c.stock} en Martínez y ${c.motivo}. Conserva su costo: revisalo a mano.`);
  } else avisos.push('La factura no trae el precio de lista de este artículo: no reviso el precio ni el costo.');
  if (v.disponible === null) avisos.push(`No está dado de alta en ${SUCURSAL_CARGA_ID}; se da de alta con ${unidades}.`);
  if (p.estado !== 'ACTIVE') avisos.push(`El producto está ${p.estado === 'DRAFT' ? 'en borrador' : 'archivado'} en Shopify: se le suma igual el stock.`);
  return { ...base, accion: { tipo: 'reposicion', productoId: p.id, titulo: p.titulo, lineas, etiquetar: false, ...(ajuste ? { ajuste } : {}) } };
}

function opcionAlta(codigo: string, descripcion: string, unidades: number, lista: number, bonif: number, titulo: string, color = ''): OpcionCarga {
  const avisos: string[] = [];
  const base = { clave: 'alta', etiqueta: 'Crear el producto', avisos };
  if (!(lista > 0)) return { ...base, accion: null, bloqueo: 'La factura no trae el precio de lista: no puedo calcular precio ni costo. Corregí la factura o crealo a mano.' };
  const marca = marcaTarget(descripcion);
  if (!marca) avisos.push(`No reconozco la marca en «${descripcion}»: se crea con la marca «${ETIQUETA_TARGET}». Cambiala en Shopify si corresponde.`);
  const tipo = tipoTarget(descripcion);
  if (!tipo) avisos.push(`No conozco el tipo de producto de «${descripcion}»: revisá el título y el tipo en Shopify.`);
  return {
    ...base, accion: {
      tipo: 'alta', titulo: color ? `${titulo} ${nombreColor(color)}` : titulo, productType: tipo?.tipo ?? (descripcion.split(/\s+/)[0] || 'Accesorio'),
      etiquetas: color ? [ETIQUETA_TARGET, codigo, nombreColor(color)] : [ETIQUETA_TARGET, codigo],
      gramos: tipo?.gramos ?? 400, precio: precioTarget(lista, bonif), costo: costoTarget(lista, bonif), vendor: marca ?? ETIQUETA_TARGET,
      variantes: [{ talle: 'Default Title', sku: color ? skuColorTarget(codigo, color) : codigo, cantidad: unidades }], opcion: 'Title', lista, bonificacion: bonif,
    },
  };
}

const fmtT = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`;

/** Un producto por color: altas de los colores nuevos y reposición de los que ya están (por su SKU código-COLOR). */
function opcionColores(
  codigo: string, descripcion: string, unidades: number, lista: number, bonif: number, ren: Parameters<typeof ajusteDe>[1] | undefined,
  titulo: string, elegidos: ColorTarget[], existentes: { p: ProductoId; color: string }[], conocidos: string[],
): OpcionCarga | string {
  const filas = elegidos.map((e) => ({ color: nombreColor(e.color), slug: slugColor(e.color), cantidad: e.cantidad }));
  if (!filas.length) return 'Escribí al menos un color, o tocá «Sin colores» para cargarlo como un solo producto.';
  if (filas.some((f) => !f.slug)) return 'Escribí el nombre de cada color (o quitá la fila vacía).';
  const repetido = filas.find((f, i) => filas.findIndex((g) => g.slug === f.slug) !== i);
  if (repetido) return `El color «${repetido.color}» está dos veces: juntá las unidades en una sola fila.`;
  if (filas.some((f) => !Number.isInteger(f.cantidad) || f.cantidad < 0)) return 'Cada color tiene que tener un número entero de unidades.';
  const suma = filas.reduce((s, f) => s + f.cantidad, 0);
  if (suma !== unidades) return `Los colores suman ${suma} u. y llegaron ${unidades} u.: ${suma < unidades ? `faltan ${unidades - suma}` : `sobran ${suma - unidades}`}. Tiene que dar lo mismo que lo que entró.`;
  const avisos: string[] = [];
  const partes: { color: string; accion: AltaFamily | ReposicionFamily }[] = [];
  for (const f of filas) {
    if (!f.cantidad) continue;
    const ya = existentes.find((x) => x.color === f.slug);
    const o = ya ? opcionReposicion(ya.p, f.cantidad, lista, bonif, ren) : opcionAlta(codigo, descripcion, f.cantidad, lista, bonif, titulo, f.color);
    if (o.bloqueo || !o.accion) return `${f.color}: ${o.bloqueo ?? 'no se puede cargar.'}`;
    const accion = o.accion;
    if (accion.tipo === 'reposicion' && accion.ajuste && !accion.ajuste.ok) {
      // El precio de ese color no llega a la lista × 2 (subida al 50%): se pone el mínimo, como en las altas.
      accion.ajuste.precio = accion.ajuste.sugerido;
      avisos.push(`${f.color}: el precio ${accion.ajuste.precioActual !== null ? fmtT(accion.ajuste.precioActual) : 'actual'} no llega al mínimo de esta factura: pasa a ${fmtT(accion.ajuste.sugerido)}.`);
    }
    for (const a of o.avisos) if (!avisos.includes(`${f.color}: ${a}`)) avisos.push(`${f.color}: ${a}`);
    partes.push({ color: f.color, accion });
  }
  if (!partes.length) return 'Todos los colores están en 0: no hay nada para cargar.';
  const sinColor = existentes.filter((x) => !x.color);
  if (sinColor.length) avisos.push(`${sinColor.map((x) => `«${x.p.titulo}»`).join(', ')} (sin color en el SKU) no se toca: si es uno de estos colores, cargalo a mano.`);
  return { clave: 'colores', etiqueta: 'Un producto por color', accion: partes[0].accion, partes, tituloBase: titulo, conocidos, avisos };
}

/**
 * Vista previa de la carga de una entrega de Target. No escribe nada.
 * `cantidades`: unidades escritas a mano por código (por defecto, las del remito).
 */
export function planCargaTarget(
  r: ResultadoFactura, estado: EstadoCargaId, cargas: Record<string, CargaFamily>, cantidades: ReadonlyMap<string, number> = new Map(),
  colores: ReadonlyMap<string, ColorTarget[]> = new Map(),
): PlanCarga {
  const f = r.factura;
  const avisos: string[] = [];
  const remito = r.remito?.numero || f.remito || '';
  const enFactura = new Set(r.checklist.map((c) => claveCodigo(c.codigo)));
  const fuera = (r.remito?.renglones ?? []).filter((x) => !enFactura.has(claveCodigo(x.codigo))).map((x) => x.codigo);
  if (fuera.length) avisos.push(`En el remito y no en la factura: ${[...new Set(fuera)].join(', ')}. No se cargan desde acá: revisalo y cargalo a mano.`);
  if (r.difRemito.length) avisos.push('El remito y la factura no coinciden en algún artículo: se carga lo del remito (lo que llegó).');
  // Títulos repetidos (6 riñoneras «Camping Alpine Skate» con distinto código): se les agrega el código.
  const titulos = new Map<string, number>();
  for (const c of r.checklist) {
    const ren = f.renglones.find((x) => claveCodigo(x.codigo) === claveCodigo(c.codigo));
    const t = tituloTarget(ren?.descripcion || c.descripcion).toUpperCase();
    titulos.set(t, (titulos.get(t) ?? 0) + 1);
  }
  let repetidos = 0;
  const items = r.checklist.map((c): ItemCarga => {
    const ren = f.renglones.find((x) => claveCodigo(x.codigo) === claveCodigo(c.codigo));
    const descripcion = ren?.descripcion || c.descripcion;
    const delRemito = (r.remito?.renglones ?? []).filter((x) => claveCodigo(x.codigo) === claveCodigo(c.codigo));
    const llegaron = delRemito.length ? delRemito.reduce((s, x) => s + (Number(x.cantidad) || 0) - (Number(x.retirado) || 0), 0) : c.cantidad;
    const firma = firmaTarget(f.fecha, remito, c.codigo, llegaron);
    const escrita = cantidades.get(c.codigo);
    const unidades = escrita ?? llegaron;
    const talles = [{ talle: 'u.', cantidad: unidades, original: llegaron }];
    const base = { codigo: c.codigo, descripcion, unidades, firma, talles };
    const bloqueado = (motivo: string): ItemCarga => ({ ...base, estado: 'bloqueado', motivo, opciones: [] });
    const carga = cargas[`${f.id}|${c.codigo}`];
    if (carga) return { codigo: c.codigo, descripcion, unidades: llegaron, firma, estado: 'cargado', motivo: textoCarga(carga), opciones: [], carga };
    const otra = Object.entries(cargas).find(([k, x]) => !k.startsWith(`${f.id}|`) && x.firma === firma);
    if (otra) return bloqueado(`Esta misma mercadería (mismo día, remito, código y cantidad) ya se cargó desde otra entrega (${textoCarga(otra[1])}).`);
    if (!delRemito.length) return bloqueado('No está en el remito: si llegó, escribilo en el remito («✏️ Ver o corregir») y armá la carga de nuevo.');
    if (!(unidades > 0)) return bloqueado(escrita !== undefined ? 'Pusiste 0: no hay nada para cargar.' : 'No tiene cantidades.');
    if (!formasCodigo(c.codigo).length) return bloqueado('El código tiene caracteres que no puedo buscar en Shopify: cargalo a mano.');
    const lista = Number(ren?.precioUnitario) || 0, bonif = Number(ren?.bonificacion) || 0;
    const ids = estado.porCodigo[c.codigo.toUpperCase()] ?? [];
    const productos = ids.map((id) => estado.productos[id]).filter(Boolean);
    const deTarget = productos.filter((p) => esDeTarget(p.etiquetas));
    const ajenos = productos.filter((p) => !esDeTarget(p.etiquetas));
    let titulo = tituloTarget(descripcion);
    if ((titulos.get(titulo.toUpperCase()) ?? 0) > 1) { titulo = `${titulo} ${c.codigo}`; repetidos++; }
    // Al crear, la app vuelve a buscar el código y no crea nada si aparece otro producto: mejor avisarlo antes.
    if (!deTarget.length && ajenos.length) return bloqueado(`En Shopify ya hay ${ajenos.length === 1 ? 'un producto' : `${ajenos.length} productos`} con este código sin la etiqueta «${ETIQUETA_TARGET}» (${ajenos.map((p) => `«${p.titulo}»`).join(', ')}). Si es este mismo artículo, agregale la etiqueta «${ETIQUETA_TARGET}» y armá la carga de nuevo; si es otro, crealo a mano.`);
    // Colores (20-nov-2026, gax): cada color es un producto aparte. Los que ya están se reconocen por el SKU código-COLOR.
    const existentes = deTarget.map((p) => ({ p, color: p.variantes.length === 1 ? colorDeSku(p.variantes[0].sku, c.codigo) : '' }));
    const posibles = [...new Set(existentes.filter((x) => x.color).map((x) => nombreColor(x.color)))];
    const elegidos = colores.get(c.codigo);
    const conColores = { ...base, coloresPosibles: posibles };
    if (elegidos) {
      const filas = elegidos.map((e) => {
        const ya = existentes.find((x) => x.color && x.color === slugColor(e.color));
        return { color: e.color, cantidad: e.cantidad, sku: slugColor(e.color) ? skuColorTarget(c.codigo, e.color) : '', ...(ya ? { producto: ya.p.titulo } : {}), nuevo: !ya };
      });
      const item = { ...conColores, colores: filas, tituloBase: titulo };
      const o = opcionColores(c.codigo, descripcion, unidades, lista, bonif, ren, titulo, elegidos, existentes, productos.map((p) => p.id));
      if (typeof o === 'string') return { ...item, estado: 'bloqueado', motivo: o, opciones: [] };
      if (ajenos.length) o.avisos.push(`En Shopify hay ${ajenos.length === 1 ? 'un producto' : `${ajenos.length} productos`} con este código sin la etiqueta «${ETIQUETA_TARGET}» (${ajenos.map((p) => `«${p.titulo}»`).join(', ')}): no se toca${ajenos.length === 1 ? '' : 'n'}.`);
      if (escrita !== undefined && escrita !== llegaron) o.avisos.push(`Distinto del remito: ${llegaron} → ${escrita}.`);
      return { ...item, estado: 'listo', motivo: '', opciones: [o] };
    }
    const opciones = deTarget.length
      ? deTarget.map((p) => opcionReposicion(p, unidades, lista, bonif, ren))
      : [opcionAlta(c.codigo, descripcion, unidades, lista, bonif, titulo)];
    for (const o of opciones) {
      if (ajenos.length) o.avisos.push(`En Shopify hay ${ajenos.length === 1 ? 'un producto' : `${ajenos.length} productos`} con este código sin la etiqueta «${ETIQUETA_TARGET}» (${ajenos.map((p) => `«${p.titulo}»`).join(', ')}): no se toca${ajenos.length === 1 ? '' : 'n'}.`);
      if (escrita !== undefined && escrita !== llegaron) o.avisos.push(`Distinto del remito: ${llegaron} → ${escrita}.`);
    }
    if (opciones.length === 1) return opciones[0].bloqueo ? { ...bloqueado(opciones[0].bloqueo), coloresPosibles: posibles } : { ...conColores, estado: 'listo', motivo: '', opciones };
    return { ...conColores, estado: 'elegir', motivo: `El código está en ${opciones.length} productos de Target en Shopify: elegí en cuál sumar el stock.`, opciones: [NO_CARGAR, ...opciones] };
  });
  // El precio es la lista × 2; si con el descuento de la factura no llega al 50% de margen, se sube (gax, 19-nov-2026).
  const bonifs = [...new Set(f.renglones.map((x) => Number(x.bonificacion) || 0))];
  if (bonifs.length === 1) {
    const m = margenTarget(bonifs[0]);
    if (m !== null) avisos.push(m >= 50
      ? `Esta factura tiene ${bonifs[0]}% de descuento: con el precio a lista × 2, el margen queda en ${pctTexto(m)} (calculado sin el IVA de la venta).`
      : `Esta factura tiene ${bonifs[0]}% de descuento: con el precio a lista × 2 el margen quedaría en ${pctTexto(m)}, así que el precio se sube hasta llegar al 50% (redondeado a los $100).`);
  }
  if (repetidos) avisos.push(`${repetidos} productos nuevos tienen el mismo nombre que otro de la factura: les agregué el código al título. Si sabés el color o el modelo, escribilo en el título antes de crear.`);
  return { entregaId: f.id, locationId: estado.locationId, posId: estado.posId ?? null, items, avisos, sucursal: SUCURSAL_CARGA_ID };
}
