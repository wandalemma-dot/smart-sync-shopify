// ============================================================================
// DISTRINANDO (REEBOK) — CARGAR UNA ENTREGA EN SHOPIFY (13-nov-2026, pedido de gax)
// ----------------------------------------------------------------------------
// Lo que llegó (el remito) se SUMA en DEPOSITO MARTINEZ, como en iD. Reglas de gax:
//   · Talle: el remito trae US. Se ubica por el SKU del proveedor (código-US), si no por el AR
//     que el proveedor informa en la nota y, si no, por la tabla de talle que se elige para el
//     modelo (talleDistrinando.ts). Una tabla que contradice lo que informa el proveedor no se
//     puede elegir. La tabla elegida va a las etiquetas («TABLA DE TALLE REEBOK HOMBRE»).
//     Producto sin tabla de talle con nombre: se avisa para asociarle una.
//   · Packs «M12 4/7.5 (23322)»: US 4, 5, 6, 7 y 7.5 con 2, 3, 3, 2 y 2 pares por caja, por la
//     cantidad de cajas. Las cantidades se pueden corregir antes de cargar.
//   · Precio: regla de Reebok (Mayorista × 1,8755 al 999 más cercano). Costo: el de la factura
//     (lista − bonificación), con promedio ponderado si el talle ya tenía stock en Martínez.
//     Mismo control de margen que iD (menos de 50% obliga a poner precio a toda la curva).
//   · El SKU de lo que ya existe no se toca. Talles que faltan: se crean con el SKU del proveedor,
//     el precio de la curva y el costo de la factura. Productos que no existen: se crean (gax:
//     «para todos los productos nuevos está bien»), con la tabla elegida en el desplegable.
//   · Solo Reebok calzado por ahora. Kappa, Crocs y ropa: a mano.
// Ejecución, marca «una sola vez» y vista previa: las de iD/Family (cargaFamily.ts).
// ============================================================================
import { claveCodigo, type FilaChecklist, type LineaPedido, type Pedido, type ResultadoFactura } from './controlFacturas';
import { textoCarga, type AltaFamily, type CargaFamily, type ItemCarga, type LineaReposicion, type OpcionCarga, type PlanCarga, type TablaItem } from './cargaFamily';
import { ajusteDe, etiquetaDelCodigo, formasCodigo, SUCURSAL_CARGA_ID, type EstadoCargaId, type ProductoId } from './cargaId';
import { precioReebokCalzado, REEBOK_TABLAS, tituloReebokCalzado } from './reebokCalzado';
import { niceTitle, redondear2 } from './syncLogic';
import {
  arDeNotas, curvaPack, esTalleUS, etiquetasDeTabla, etiquetaTabla, mismoTalle, paresConocidos, skuProveedor, tablaDeEtiquetas, tablaReebok,
  tablasDelModelo, talleUS, ubicarTalleDistrinando, usDelSku, type VarianteTalle,
} from './talleDistrinando';

export const VENDOR_REEBOK = 'Reebok';
const GRAMOS_CALZADO = 900;
const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();

/** Tabla elegida por código ('' = ninguna). Cantidades escritas a mano: código → «US 11» → unidades. */
export type TablasCarga = ReadonlyMap<string, string>;
export type CantidadesDis = ReadonlyMap<string, Readonly<Record<string, number>>>;

const etiquetaUS = (us: string) => `US ${us}`;

/** Firma de lo que llegó (la del remito, no la escrita a mano): la misma mercadería no se carga dos veces. */
export function firmaDistrinando(fecha: string, remito: string, codigo: string, llegan: { us: string; cantidad: number }[], pares: number): string {
  const talles = llegan.filter((t) => t.cantidad > 0).map((t) => `${t.us}:${t.cantidad}`).sort().join(',');
  return `${fecha}|${codigo}|${pares}|${talles}|${String(remito || '').replace(/\|/g, '')}`;
}

/** Nombre comercial de un modelo nuevo: «Zapatillas Reebok Nano Court Negro Gris», sin talle ni curva del pack. */
export function tituloDistrinando(descripcion: string): string {
  const d = String(descripcion ?? '')
    .replace(/^\d[^·]*·\s*/, '') // factura de pack: «5/7,5 (3441) · NANO COURT …»
    .replace(/\s*-?\s*M\d{1,2}U?\s+\d.*$/i, '') // «- M12U 5/7,5 (3441)»
    .replace(/\s*(?:-\s*)?(?:AR|UK|US)?\s*-?\s*\d{1,2}(?:[.,]\d)?\s*$/i, '')
    .replace(/\bREEBOK\b/gi, '')
    .replace(/[-\s/]+$/, '').trim();
  return niceTitle(tituloReebokCalzado(`Zapatillas Reebok ${d}`));
}

interface Llega { us: string; cantidad: number; original: number; /** Talle de Shopify escrito a mano. */ destino?: string }
/** Talle de Shopify escrito a mano: código → «US 11» → AR. */
export type DestinosDis = ReadonlyMap<string, Readonly<Record<string, string>>>;
/** Un talle de calzado de Shopify escrito a mano: «44», «38.5», «38,5». */
export const leerDestino = (s: string) => { const t = String(s ?? '').trim().replace(',', '.'); return /^\d{2}(\.5)?$/.test(t) && Number(t) >= 15 && Number(t) <= 55 ? String(Number(t)) : null; };

/** Dónde entra un US: lo escrito a mano manda; si no, SKU del proveedor, nota y tabla. */
function ubicar(codigo: string, l: Llega, variantes: VarianteTalle[], pedidos: Pedido[], tabla: ReturnType<typeof tablaReebok>): ReturnType<typeof ubicarTalleDistrinando> {
  if (!l.destino) return ubicarTalleDistrinando({ codigo, talle: l.us, variantes, pedidos, tabla });
  const sku = skuProveedor(codigo, l.us);
  const vs = variantes.filter((v) => mismoTalle(v.talle, l.destino!));
  if (vs.length > 1) return { error: `hay dos variantes del talle ${l.destino}` };
  if (!vs.length) {
    const conSku = variantes.find((v) => norm(v.sku) === sku);
    if (conSku) return { error: `el SKU ${sku} ya está en el talle ${conSku.talle}: para pasarlo al ${l.destino} corregí ese talle en Shopify` };
    return { error: `no existe el talle ${l.destino}`, falta: { talle: l.destino, skuProveedor: sku, fuente: 'manual' } };
  }
  const otro = usDelSku(vs[0].sku, codigo);
  const avisos = [`US ${l.us} → talle ${vs[0].talle}: lo elegiste a mano${otro && otro !== talleUS(l.us) ? ` (ojo: ese talle tiene el SKU del US ${otro})` : ''}.`];
  return { varianteId: vs[0].id, talle: vs[0].talle, fuente: 'manual', skuProveedor: sku, avisos };
}

/** El US de cada talle del checklist (el remito, con los talles ya pasados al de la nota) y los packs por su curva. */
function tallesQueLlegan(c: FilaChecklist, notas: LineaPedido[], pares: number, porUdmFactura: number, descripcion: string):
  { llegan: Llega[]; avisos: string[] } | { error: string } {
  const pack = notas.find((l) => (l.unidadesPorUdm || 1) > 1);
  const esPack = !!pack || (c.talles ?? []).some((t) => /^PACK/i.test(t.talle)) || (!c.talles && porUdmFactura > 1);
  if (esPack) {
    const texto = pack?.talle || pack?.descripcion || descripcion;
    const curva = curvaPack(texto) ?? curvaPack(descripcion);
    if (!curva) return { error: `es un pack y no entiendo su curva («${texto}»): cargalo a mano.` };
    const porCaja = curva.reduce((s, x) => s + x.porCaja, 0);
    const porUdm = pack?.unidadesPorUdm || porUdmFactura || porCaja;
    const avisos: string[] = [];
    if (porUdm !== porCaja) avisos.push(`La curva suma ${porCaja} pares y el pack es de ${porUdm}: revisá las cantidades.`);
    const cajas = pares / porUdm;
    if (!Number.isInteger(cajas) || cajas <= 0) {
      avisos.push(`Llegaron ${pares} pares y no son cajas enteras de ${porUdm}: escribí cuántos pares llegaron de cada talle.`);
      return { llegan: curva.map((x) => ({ us: talleUS(x.us), cantidad: 0, original: 0 })), avisos };
    }
    avisos.push(`Pack: ${cajas} caja${cajas > 1 ? 's' : ''} de la curva ${curva.map((x) => `US ${x.us}×${x.porCaja}`).join(' ')}. Corregí los números si alguna caja vino distinta.`);
    return { llegan: curva.map((x) => ({ us: talleUS(x.us), cantidad: x.porCaja * cajas, original: x.porCaja * cajas })), avisos };
  }
  if (!c.talles) return { error: 'No sé qué talles llegaron: escribí el remito con los talles («✏️ Ver o corregir») y armá la carga de nuevo.' };
  const out = new Map<string, Llega>();
  const problemas: string[] = [];
  for (const t of c.talles) {
    // ajustarRemito pasa el US del remito al talle de la nota («AR 43», «UK 10»): se vuelve al US por el SKU de la nota.
    const deNota = [...new Set(notas.filter((l) => (l.unidadesPorUdm || 1) <= 1 && norm(l.talle) === norm(t.talle)).map((l) => usDelSku(l.sku, l.codigo)).filter(Boolean))];
    let us: string | null = null;
    if (deNota.length === 1) us = deNota[0]!;
    else if (deNota.length > 1) { problemas.push(`el talle ${t.talle} de la nota es de dos US (${deNota.join(' y ')})`); continue; }
    else if (esTalleUS(t.talle)) us = talleUS(t.talle);
    else { problemas.push(`no sé qué US es el talle ${t.talle}`); continue; }
    const ya = out.get(us);
    if (ya) { ya.cantidad += t.cantidad; ya.original += t.cantidad; } else out.set(us, { us, cantidad: t.cantidad, original: t.cantidad });
  }
  if (problemas.length) return { error: `${problemas.join('; ')}. Corregí el remito y armá la carga de nuevo.` };
  return { llegan: [...out.values()], avisos: [] };
}

const esReebok = (vendor: string) => /REEBOK/i.test(vendor);
const NO_CARGAR: OpcionCarga = { clave: 'no', etiqueta: 'No cargar este artículo', accion: null, avisos: [] };

/** Las opciones de tabla de talle del modelo y la que viene elegida. */
function tablaDelItem(codigo: string, pedidos: Pedido[], productos: ProductoId[], llegan: Llega[], elegida: string | undefined): { tabla: TablaItem; avisos: string[] } {
  const variantes: VarianteTalle[] = productos.flatMap((p) => p.variantes);
  const pares = paresConocidos(codigo, pedidos, variantes);
  // Talles que solo se ubican con la tabla: sin SKU del proveedor en Shopify y sin AR en la nota.
  const necesarios = llegan.filter((l) => !l.destino && !variantes.some((v) => norm(v.sku) === skuProveedor(codigo, l.us)) && !arDeNotas(pedidos, skuProveedor(codigo, l.us), l.us).ar).map((l) => l.us);
  const posibles = tablasDelModelo(pares, necesarios);
  const actuales = productos.map((p) => tablaDeEtiquetas(p.etiquetas));
  const actual = productos.length === 1 ? actuales[0] : null;
  const avisos: string[] = [];
  const ok = (n: string) => posibles.some((x) => x.nombre === n && !x.bloqueo);
  // Viene elegida solo la que ya tiene el producto: una tabla nueva la elige la usuaria (gax).
  const porDefecto = actual && ok(actual) ? actual : '';
  const valida = elegida !== undefined && (elegida === '' || ok(elegida));
  const final = valida ? elegida! : porDefecto;
  if (actual && !ok(actual)) {
    const motivo = posibles.find((x) => x.nombre === actual)?.bloqueo ?? '';
    avisos.push(`La etiqueta dice TABLA DE TALLE REEBOK ${actual}, pero sus talles no siguen esa tabla (${motivo}). No la cambio: revisá qué tabla ve el cliente en la web.`);
  }
  if (productos.length === 1 && !actual) {
    const tiene = etiquetasDeTabla(productos[0].etiquetas);
    avisos.push(`Este producto no tiene tabla de talle${tiene.length ? ` con nombre (tiene ${tiene.join(', ')})` : ''}${posibles.some((x) => !x.bloqueo) ? ': elegí una abajo y se la agrego al cargar.' : `, y ninguna de las tablas coincide con los AR que informa el proveedor (${posibles.map((x) => `${x.nombre}: ${x.bloqueo}`).join(' · ')}). Los talles van por el SKU y la nota.`}`);
  }
  const opciones = [
    { clave: '', etiqueta: necesarios.length ? 'Elegí la tabla de talle…' : actual ? `Dejar la que tiene (${actual})` : 'Sin tabla (los talles van por el SKU y la nota)' },
    ...posibles.map((x) => ({ clave: x.nombre, etiqueta: `TABLA DE TALLE REEBOK ${x.nombre}`, ...(x.bloqueo ? { bloqueo: x.bloqueo } : {}) })),
  ];
  return { tabla: { elegida: final, opciones, actual, hace: necesarios.length > 0, avisos }, avisos };
}

/** Sumar lo que llegó en un producto que ya existe (crea los talles que faltan). */
function opcionReposicion(codigo: string, p: ProductoId | undefined, llegan: Llega[], pedidos: Pedido[], tabla: string, lista: number, bonif: number, ren: Parameters<typeof ajusteDe>[1] | undefined): OpcionCarga {
  if (!p) return { clave: 'falta', etiqueta: 'Producto que no pude leer', accion: null, bloqueo: 'No pude leer ese producto en Shopify.', avisos: [] };
  const avisos: string[] = [];
  const base = { clave: `repo:${p.id}`, etiqueta: `Sumar el stock en «${p.titulo}»`, avisos };
  if (!esReebok(p.vendor)) return { ...base, accion: null, bloqueo: `«${p.titulo}» es de ${p.vendor || 'otra marca'}: por ahora la carga de Distrinando es solo Reebok. Cargalo a mano.` };
  const t = tabla ? tablaReebok(tabla) : null;
  const lineas: LineaReposicion[] = [];
  const crear: { talle: string; sku: string; suma: number }[] = [];
  const problemas: string[] = [];
  for (const l of llegan) {
    if (!(l.cantidad > 0)) continue;
    const u = ubicar(codigo, l, p.variantes, pedidos, t);
    if ('error' in u) {
      if (!u.falta) { problemas.push(`US ${l.us}: ${u.error}`); continue; }
      if (crear.some((c) => mismoTalle(c.talle, u.falta!.talle))) { problemas.push(`US ${l.us}: dos US van al talle ${u.falta.talle}`); continue; }
      crear.push({ talle: u.falta.talle, sku: u.falta.skuProveedor, suma: l.cantidad });
      continue;
    }
    avisos.push(...u.avisos);
    const v = p.variantes.find((x) => x.id === u.varianteId)!;
    if (!v.seguimiento || !v.inventoryItemId) { problemas.push(`el talle ${v.talle} no lleva control de stock`); continue; }
    const ya = lineas.find((x) => x.inventoryItemId === v.inventoryItemId);
    if (ya) { problemas.push(`US ${l.us}: el talle ${v.talle} ya recibe otro US`); continue; }
    lineas.push({ talle: v.talle, inventoryItemId: v.inventoryItemId, actual: v.disponible, suma: l.cantidad });
  }
  if (crear.length && (p.opciones?.length ?? 1) !== 1) problemas.push(`hay que crear el talle ${crear.map((c) => c.talle).join(', ')} y el producto tiene más de una opción: crealo a mano`);
  if (crear.length && p.variantes.length + crear.length > 100) problemas.push('el producto llegaría a más de 100 talles');
  if (problemas.length) return { ...base, accion: null, bloqueo: `En «${p.titulo}»: ${problemas.join('; ')}. Corregilo en Shopify (o el remito) y armá la carga de nuevo.` };
  if (!lineas.length && !crear.length) return { ...base, accion: null, bloqueo: 'No hay unidades para cargar.' };
  const ajuste = ren && lista > 0 ? ajusteDe(p, ren, lineas, { sugerido: precioReebokCalzado(lista), basico: false }) : null;
  if (crear.length && !ajuste) return { ...base, accion: null, bloqueo: 'La factura no trae el precio de lista: no puedo poner precio ni costo a los talles nuevos. Cargalo a mano.' };
  if (!ajuste) avisos.push('La factura no trae el precio de lista de este artículo: no reviso el margen ni el costo.');
  else for (const c of ajuste.conservan) if (c.motivo) avisos.push(`Talle ${c.talle}: ya tenía ${c.stock} en Martínez y ${c.motivo}. Conserva su costo: revisalo a mano.`);
  for (const l of lineas) if (l.actual === null) avisos.push(`Talle ${l.talle}: no está dado de alta en ${SUCURSAL_CARGA_ID}; se da de alta con ${l.suma}.`);
  if (crear.length) avisos.push(`Se crea${crear.length > 1 ? 'n' : ''} el talle ${crear.map((c) => `${c.talle} (SKU ${c.sku})`).join(', ')} con el precio de la curva y costo ${ajuste ? redondear2(lista * (1 - bonif / 100)) : ''}.`);
  if (p.estado !== 'ACTIVE') avisos.push(`El producto está ${p.estado === 'DRAFT' ? 'en borrador' : 'archivado'} en Shopify: se le suma igual el stock.`);
  // Etiquetas: el código del proveedor, la tabla elegida y el SKU del proveedor de los talles nuevos.
  const etiquetas: string[] = [];
  if (!etiquetaDelCodigo(p.etiquetas, codigo)) etiquetas.push(codigo);
  const quitar: string[] = [];
  if (tabla && tablaDeEtiquetas(p.etiquetas) !== tabla) {
    etiquetas.push(etiquetaTabla(tabla));
    quitar.push(...etiquetasDeTabla(p.etiquetas));
  }
  for (const c of crear) if (!p.etiquetas.some((x) => norm(x) === norm(c.sku))) etiquetas.push(c.sku);
  return {
    ...base, accion: {
      tipo: 'reposicion', productoId: p.id, titulo: p.titulo, lineas, etiquetar: false, ...(ajuste ? { ajuste } : {}),
      ...(crear.length ? { crear } : {}), ...(etiquetas.length ? { etiquetas } : {}), ...(quitar.length ? { quitarEtiquetas: quitar } : {}),
    },
  };
}

/** Crear el producto (no existe en Shopify). */
function opcionAlta(codigo: string, llegan: Llega[], pedidos: Pedido[], tabla: string, lista: number, bonif: number, descripcion: string): OpcionCarga {
  const avisos: string[] = [];
  const base = { clave: 'alta', etiqueta: 'Crear el producto', avisos };
  if (!/^RBK/i.test(codigo)) return { ...base, accion: null, bloqueo: 'No está en Shopify y no es Reebok: por ahora se crea desde Sincronización.' };
  if (!(lista > 0)) return { ...base, accion: null, bloqueo: 'La factura no trae el precio de lista: no puedo calcular precio ni costo. Crealo desde Sincronización.' };
  const t = tabla ? tablaReebok(tabla) : null;
  const variantes: AltaFamily['variantes'] = [];
  const problemas: string[] = [];
  for (const l of llegan) {
    if (!(l.cantidad > 0)) continue;
    const u = ubicar(codigo, l, [], pedidos, t);
    if ('error' in u && !u.falta) { problemas.push(`US ${l.us}: ${u.error}`); continue; }
    const f = 'falta' in u ? u.falta! : null;
    if (!f) continue;
    if (variantes.some((v) => mismoTalle(v.talle, f.talle))) { problemas.push(`dos US van al talle ${f.talle}`); continue; }
    variantes.push({ talle: f.talle, sku: f.skuProveedor, cantidad: l.cantidad });
  }
  if (problemas.length) return { ...base, accion: null, bloqueo: `${problemas.join('; ')}.` };
  if (!variantes.length) return { ...base, accion: null, bloqueo: 'No hay unidades para cargar.' };
  variantes.sort((a, b) => Number(a.talle) - Number(b.talle));
  const costo = redondear2(lista * (1 - bonif / 100));
  const precio = precioReebokCalzado(lista);
  const etiquetas = [codigo, ...variantes.map((v) => v.sku), ...(tabla ? [etiquetaTabla(tabla)] : [])];
  if (!tabla) avisos.push('Se crea sin tabla de talle (los AR salen de la nota del proveedor). Si querés, elegí una arriba.');
  return {
    ...base, accion: {
      tipo: 'alta', titulo: tituloDistrinando(descripcion), productType: 'Zapatillas', etiquetas, gramos: GRAMOS_CALZADO, precio, costo, variantes, vendor: VENDOR_REEBOK,
      ...(tabla ? { tabla: { nombre: tabla, json: REEBOK_TABLAS[tabla] } } : {}),
    },
  };
}

/**
 * Vista previa de la carga de una entrega de Distrinando. No escribe nada.
 * `pedidos`: todas las notas de Distrinando (dan el AR que informa el proveedor y la curva de los packs).
 */
export function planCargaDistrinando(r: ResultadoFactura, estado: EstadoCargaId, cargas: Record<string, CargaFamily>, pedidos: Pedido[],
  tablas: TablasCarga = new Map(), cantidades: CantidadesDis = new Map(), destinos: DestinosDis = new Map()): PlanCarga {
  const f = r.factura;
  const avisos: string[] = [];
  const remito = r.remito?.numero || f.remito || '';
  const enFactura = new Set(r.checklist.map((c) => claveCodigo(c.codigo)));
  const fuera = (r.remito?.renglones ?? []).filter((x) => !enFactura.has(claveCodigo(x.codigo))).map((x) => x.codigo);
  if (fuera.length) avisos.push(`En el remito y no en la factura: ${[...new Set(fuera)].join(', ')}. No se cargan desde acá: revisalo y cargalo a mano.`);
  if (r.difRemito.length) avisos.push('El remito y la factura no coinciden en algún artículo: se carga lo del remito (lo que llegó).');
  const items = r.checklist.map((c): ItemCarga => {
    const ren = f.renglones.find((x) => claveCodigo(x.codigo) === claveCodigo(c.codigo));
    const descripcion = ren?.descripcion || c.descripcion;
    const notas = pedidos.flatMap((p) => p.lineas).filter((l) => claveCodigo(l.codigo) === claveCodigo(c.codigo));
    const delRemito = (r.remito?.renglones ?? []).filter((x) => claveCodigo(x.codigo) === claveCodigo(c.codigo));
    const pares = delRemito.length ? delRemito.reduce((s, x) => s + (Number(x.cantidad) || 0) - (Number(x.retirado) || 0), 0) : c.cantidad;
    const porUdmFactura = Number(/\bM(\d{1,2})U?\s+\d/.exec(descripcion)?.[1] || 0);
    const llegada = tallesQueLlegan(c, notas, pares, porUdmFactura, descripcion);
    const firmaBase = 'error' in llegada ? firmaDistrinando(f.fecha, remito, c.codigo, [], pares) : firmaDistrinando(f.fecha, remito, c.codigo, llegada.llegan.map((l) => ({ us: l.us, cantidad: l.original })), pares);
    const unidadesBase = 'error' in llegada ? pares : llegada.llegan.reduce((s, l) => s + l.cantidad, 0);
    const bloqueado = (motivo: string, extra: Partial<ItemCarga> = {}): ItemCarga => ({ codigo: c.codigo, descripcion, unidades: unidadesBase, firma: firmaBase, estado: 'bloqueado', motivo, opciones: [], ...extra });
    const carga = cargas[`${f.id}|${c.codigo}`];
    if (carga) return { codigo: c.codigo, descripcion, unidades: unidadesBase, firma: firmaBase, estado: 'cargado', motivo: textoCarga(carga), opciones: [], carga };
    const otra = Object.entries(cargas).find(([k, x]) => !k.startsWith(`${f.id}|`) && x.firma === firmaBase);
    if (otra) return bloqueado(`Esta misma mercadería (mismo día, remito, código y talles) ya se cargó desde otra entrega (${textoCarga(otra[1])}).`);
    if ('error' in llegada) return bloqueado(llegada.error);
    // Cantidades escritas a mano (por US).
    const escritas = cantidades.get(c.codigo) ?? {};
    const aMano = destinos.get(c.codigo) ?? {};
    // Talles agregados a mano que no están en el remito (13-nov-2026, gax: «me entró en otro talle, en 13 americano»).
    const agregados: Llega[] = Object.keys(escritas)
      .filter((k) => /^US /.test(k) && esTalleUS(k.slice(3)) && !llegada.llegan.some((l) => etiquetaUS(l.us) === etiquetaUS(talleUS(k.slice(3)))))
      .map((k) => ({ us: talleUS(k.slice(3)), cantidad: 0, original: 0 }))
      .filter((l, i, xs) => xs.findIndex((x) => x.us === l.us) === i);
    const llegan = [...llegada.llegan, ...agregados].map((l) => {
      const x = escritas[etiquetaUS(l.us)] !== undefined ? { ...l, cantidad: escritas[etiquetaUS(l.us)] } : { ...l };
      const d = aMano[etiquetaUS(l.us)] ? leerDestino(aMano[etiquetaUS(l.us)]) : null;
      return d ? { ...x, destino: d } : x;
    });
    const unidades = llegan.reduce((s, l) => s + l.cantidad, 0);
    const cambiadas = llegan.filter((l) => l.cantidad !== l.original);
    const base = { codigo: c.codigo, descripcion, unidades, firma: firmaBase, talles: llegan.map((l) => ({ talle: etiquetaUS(l.us), cantidad: l.cantidad, original: l.original })) };
    const noUS = llegan.filter((l) => !esTalleUS(l.us));
    if (noUS.length) return { ...base, estado: 'bloqueado', motivo: `Talle ${noUS.map((l) => l.us).join(', ')}: por ahora la carga de Distrinando es solo calzado Reebok. Cargalo a mano.`, opciones: [] };
    if (!unidades) return { ...base, estado: 'bloqueado', motivo: cambiadas.length ? 'Pusiste 0 en todos los talles: no hay nada para cargar.' : 'Escribí cuántos pares llegaron de cada talle.', opciones: [] };
    if (!formasCodigo(c.codigo).length) return { ...base, estado: 'bloqueado', motivo: 'El código tiene caracteres que no puedo buscar en Shopify: cargalo a mano.', opciones: [] };
    const ids = estado.porCodigo[c.codigo.toUpperCase()] ?? [];
    const productos = ids.map((id) => estado.productos[id]).filter(Boolean);
    const { tabla } = tablaDelItem(c.codigo, pedidos, productos, llegan, tablas.get(c.codigo));
    // En qué talle de Shopify entra cada US (del primer producto; si no existe, el que se crearía).
    const tElegida = tabla.elegida ? tablaReebok(tabla.elegida) : null;
    const talles = llegan.map((l) => {
      const u = ubicar(c.codigo, l, productos[0]?.variantes ?? [], pedidos, tElegida);
      const destino = 'error' in u ? u.falta?.talle ?? '' : u.talle;
      return { talle: etiquetaUS(l.us), cantidad: l.cantidad, original: l.original, destino, ...(l.destino ? { destinoManual: true } : {}), ...('error' in u && u.falta ? { nuevo: true } : {}) };
    });
    const lista = Number(ren?.precioUnitario) || 0, bonif = Number(ren?.bonificacion) || 0;
    const opciones = ids.length
      ? ids.map((id) => opcionReposicion(c.codigo, estado.productos[id], llegan, pedidos, tabla.elegida, lista, bonif, ren))
      : [opcionAlta(c.codigo, llegan, pedidos, tabla.elegida, lista, bonif, notas.find((l) => (l.unidadesPorUdm || 1) <= 1)?.descripcion || notas[0]?.descripcion || descripcion)];
    for (const o of opciones) {
      if (llegada.avisos.length) o.avisos.push(...llegada.avisos);
      if (cambiadas.length) o.avisos.push(`Distinto del remito: ${cambiadas.map((l) => (l.original ? `US ${l.us} ${l.original}→${l.cantidad}` : `US ${l.us} +${l.cantidad} (no está en el remito)`)).join(' · ')}. Al terminar te armo el mail para avisar.`);
    }
    const conTabla = { ...base, talles, tabla };
    if (tabla.hace && !tabla.elegida) return { ...conTabla, estado: 'bloqueado', motivo: 'Elegí la tabla de talle: hay talles que el proveedor no informa en la nota.', opciones: [] };
    if (opciones.length === 1) return opciones[0].bloqueo ? { ...conTabla, estado: 'bloqueado', motivo: opciones[0].bloqueo, opciones: [] } : { ...conTabla, estado: 'listo', motivo: '', opciones };
    return { ...conTabla, estado: 'elegir', motivo: `El código está en ${ids.length} productos de Shopify: elegí en cuál sumar el stock.`, opciones: [NO_CARGAR, ...opciones] };
  });
  return { entregaId: f.id, locationId: estado.locationId, posId: estado.posId ?? null, items, avisos, sucursal: SUCURSAL_CARGA_ID };
}
