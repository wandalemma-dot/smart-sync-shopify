// Carga de una entrega de Distrinando en Shopify (13-nov-2026, gax). Casos de la factura 0039-00283124 /
// remito 0085-00206200 contra lo que había en Shopify ese día. Shopify simulado: sin escrituras reales.
import { describe, it, expect, vi } from 'vitest';
import { analizarFacturas, type Factura, type LineaPedido, type Pedido, type Remito } from '../controlFacturas';
import { planCargaDistrinando, tituloDistrinando } from '../cargaDistrinando';
import { accionesElegidas, ejecutarCargaFamily, type ReposicionFamily, type AltaFamily } from '../cargaFamily';
import type { EstadoCargaId, ProductoId, VarianteId } from '../cargaId';
import { diferenciasDeTalles, textoAvisoTalles } from '../avisoTalles';

const linea = (sku: string, descripcion: string, cantidad: number, precio = 63982.4, udm = 1): LineaPedido => ({
  sku, codigo: sku.includes('---') ? sku.split('---')[0] : sku.replace(/-[^-]*$/, ''), descripcion, talle: udm > 1 ? `Pack x${udm} (${descripcion.replace(/^.* - (M12)/, '$1')})` : descripcion.replace(/^.*(?:\s-\s|\s)((?:AR|UK)\s?)?(\d+(?:\.\d)?)$/, (_m, p, n) => `${p ? p.trim() + ' ' : ''}${n}`),
  unidadesPorUdm: udm, precioLista: precio, descuento: 40, cantidad: cantidad * udm,
});
const NOTA: Pedido = {
  id: 'T-1', nombre: 'DISTRINANDO', fecha: '2026-11-10', nroProveedor: '1001408', lineas: [
    linea('RBK110S236074-11', 'HP6074 - NANO X3 - FTWR WHITE / REEBOK RUBBER GUM-01 - 43', 15),
    linea('RBK110S236074-12', 'HP6074 - NANO X3 - FTWR WHITE / REEBOK RUBBER GUM-01 - 44', 15),
    linea('RBK110S236046-11', 'NANO X3 - CORE BLACK / SMASH ORANGE S23-R - 44', 4),
    linea('RBKLIX71-RBKGX9659-5', 'CLUB C CARDI V2 ULTPUR/ULTPUR/ULTPUR AR 36.5', 4),
    linea('RBK1100231713---M12 4/7.5 (23322)', 'NANO COURT - FUTURE CYAN/FTWR WHITE/BLACK - M12 4/7.5 (23322)', 3, 82644.095, 12),
  ],
};
// La nota usa «AR 36.5» como talle para la Club C (así la lee el lector real).
NOTA.lineas[3].talle = 'AR 36.5';
const ren = (codigo: string, cantidad: number, descripcion: string, precioUnitario = 63982.4) =>
  ({ codigo, cantidad, descripcion, precioUnitario, bonificacion: 40, total: Math.round(cantidad * precioUnitario * 60) / 100 });
const FACTURA: Factura = {
  id: 'F-0039-00283124', numero: '0039-00283124', fecha: '2026-11-10', remito: '0085-00206200', pedidoProveedor: '1001408',
  renglones: [
    ren('RBK110S236074', 30, 'HP6074 - NANO X3 - FTWR'),
    ren('RBK110S236046', 4, 'NANO X3 - CORE BLACK /'),
    ren('RBKLIX71-RBKGX9659', 4, 'CLUB C CARDI V2 · RBKGX9659 ULTPUR/ULTPUR/ULTPUR'),
    ren('RBK1100231713', 36, '4/7.5 (23322) · NANO COURT - FUTURE CYAN/FTWR WHITE/BLACK - M12', 82644.1),
  ],
  subtotal: 0, iva: 0, percepcionCaba: 0, percepcionBsAs: 0, total: 0,
};
const REMITO: Remito = {
  numero: '0085-00206200', fecha: '2026-11-10', renglones: [
    { codigo: 'RBK110S236074', cantidad: 30, talles: [{ talle: '11', cantidad: 15 }, { talle: '12', cantidad: 15 }] },
    { codigo: 'RBK110S236046', cantidad: 4, talles: [{ talle: '11', cantidad: 4 }] },
    { codigo: 'RBKLIX71-RBKGX9659', cantidad: 4, talles: [{ talle: '5', cantidad: 4 }] },
    { codigo: 'RBK1100231713', cantidad: 3, talles: [] },
  ],
};

let n = 0;
const vari = (talle: string, sku: string, disponible: number | null = 0, costo: number | null = 38389.44, precio = 119999): VarianteId =>
  ({ id: `gid://shopify/ProductVariant/${++n}`, talle, sku, inventoryItemId: `gid://shopify/InventoryItem/${n}`, seguimiento: true, disponible, precio, costo });
const prod = (id: string, titulo: string, etiquetas: string[], variantes: VarianteId[]): ProductoId =>
  ({ id: `gid://shopify/Product/${id}`, titulo, vendor: 'Reebok', estado: 'ACTIVE', etiquetas, variantes, opciones: ['Talle'] });

function estado(): EstadoCargaId {
  const p74 = prod('74', 'Zapatillas Reebok Nano X3 Blanco', ['RBK110S236074', 'TABLA DE TALLE REEBOK SIN IDENTIFICAR'],
    [vari('42', 'RBK110S236074-10.5'), vari('43', '4066749645052', 2, 30000), vari('44', '4066749645083'), vari('45.5', 'RBK110S236074-13')]);
  const p46 = prod('46', 'Zapatillas Reebok Nano X3 Negro', ['RBK110S236046', 'TABLA DE TALLE REEBOK 2'], [vari('43', '4066749652807')]);
  const pCardi = prod('cardi', 'Zapatillas Reebok Club C Cardi', ['TABLA DE TALLE REEBOK MUJER', 'RBKLIX71-RBKGX9659'],
    [vari('36.5', 'RBKLIX71-RBKGX9659-5'), vari('37.5', 'RBKLIX71-RBKGX9659-5.5'), vari('38', 'RBKLIX71-RBKGX9659-6')]);
  return {
    locationId: 'gid://shopify/Location/martinez', posId: 'gid://shopify/Publication/pos',
    porCodigo: { RBK110S236074: [p74.id], RBK110S236046: [p46.id], 'RBKLIX71-RBKGX9659': [pCardi.id], RBK1100231713: [] },
    productos: { [p74.id]: p74, [p46.id]: p46, [pCardi.id]: pCardi },
  };
}
const resultado = () => analizarFacturas([NOTA], [FACTURA], {}, { [FACTURA.id]: REMITO }).facturas[0];
const item = (plan: ReturnType<typeof planCargaDistrinando>, codigo: string) => plan.items.find((i) => i.codigo === codigo)!;

describe('carga de Distrinando', () => {
  it('Nano X3: el US del remito va al AR de la nota (43 y 44), aunque la variante tenga el EAN', () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA]);
    const it74 = item(plan, 'RBK110S236074');
    expect(it74.estado).toBe('listo');
    expect(it74.talles?.map((t) => `${t.talle}:${t.cantidad}`)).toEqual(['US 11:15', 'US 12:15']);
    const a = it74.opciones[0].accion as ReposicionFamily;
    expect(a.lineas.map((l) => `${l.talle}:${l.actual}+${l.suma}`)).toEqual(['43:2+15', '44:0+15']);
    expect(a.crear).toBeUndefined();
    // Precio Reebok y costo de la factura: el 43 ya tenía 2 a 30.000 → promedio.
    expect(a.ajuste).toMatchObject({ costoNuevo: 38389.44, precioActual: 119999, ok: true, sugerido: 119999 });
    expect(a.ajuste!.ponderados).toEqual([expect.objectContaining({ talle: '43', stock: 2, suma: 15, costo: 37402.45 })]);
    // No tiene tabla con nombre: avisa. Ninguna sirve (US 11 = 43 no es Hombre).
    expect(it74.tabla?.avisos.join(' ')).toMatch(/no tiene tabla de talle/);
    expect(it74.tabla?.opciones.find((o) => o.clave === '1')?.bloqueo).toMatch(/no coincide con Shopify: US 10.5 = 42, la tabla dice 43.5/);
    expect(a.etiquetas).toBeUndefined();
  });

  it('Nano X3 Negro: el 44 no existe y se crea con el SKU del proveedor, el precio de la curva y su etiqueta', () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA]);
    const a = item(plan, 'RBK110S236046').opciones[0].accion as ReposicionFamily;
    expect(a.lineas).toEqual([]);
    expect(a.crear).toEqual([{ talle: '44', sku: 'RBK110S236046-11', suma: 4 }]);
    expect(a.etiquetas).toEqual(['RBK110S236046-11']);
  });

  it('Club C Cardi: va por el SKU del proveedor y avisa que la etiqueta MUJER no coincide con sus talles', () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA]);
    const it = item(plan, 'RBKLIX71-RBKGX9659');
    const a = it.opciones[0].accion as ReposicionFamily;
    expect(a.lineas.map((l) => `${l.talle}:${l.suma}`)).toEqual(['36.5:4']);
    expect(it.tabla?.avisos.join(' ')).toMatch(/etiqueta dice TABLA DE TALLE REEBOK MUJER.*US 5 = 36.5, la tabla dice 34.5/);
    expect(it.tabla?.elegida).toBe('');
    expect(a.etiquetas).toBeUndefined();
  });

  it('pack nuevo: arma la curva por caja, pide la tabla y crea el producto con ella', () => {
    const r = resultado();
    let it = item(planCargaDistrinando(r, estado(), {}, [NOTA]), 'RBK1100231713');
    expect(it.talles?.map((t) => `${t.talle}:${t.cantidad}`)).toEqual(['US 4:6', 'US 5:9', 'US 6:9', 'US 7:6', 'US 7.5:6']);
    expect(it.estado).toBe('bloqueado');
    expect(it.motivo).toMatch(/Elegí la tabla de talle/);
    expect(it.tabla?.opciones.find((o) => o.clave === 'MUJER')?.bloqueo).toMatch(/no tiene el US 4/);
    const plan = planCargaDistrinando(r, estado(), {}, [NOTA], new Map([['RBK1100231713', '1']]), new Map([['RBK1100231713', { 'US 7.5': 5 }]]));
    it = item(plan, 'RBK1100231713');
    expect(it.estado).toBe('listo');
    const a = it.opciones[0].accion as AltaFamily;
    expect(a).toMatchObject({ tipo: 'alta', vendor: 'Reebok', precio: 154999, costo: 49586.46, productType: 'Zapatillas', tabla: { nombre: '1' } });
    expect(a.titulo).toBe(tituloDistrinando('NANO COURT - FUTURE CYAN/FTWR WHITE/BLACK - M12 4/7.5 (23322)'));
    expect(a.titulo).not.toMatch(/M12|23322/);
    expect(a.variantes.map((v) => `${v.talle}:${v.cantidad}:${v.sku}`)).toEqual([
      '35:6:RBK1100231713-4', '36:9:RBK1100231713-5', '37:9:RBK1100231713-6', '38.5:6:RBK1100231713-7', '39:5:RBK1100231713-7.5']);
    expect(a.etiquetas).toEqual(expect.arrayContaining(['RBK1100231713', 'RBK1100231713-4', 'TABLA DE TALLE REEBOK 1']));
    expect(it.opciones[0].avisos.join(' ')).toMatch(/US 7.5 6→5/);
  });

  it('una tabla que contradice la nota no se puede elegir aunque venga pedida', () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA], new Map([['RBK110S236074', '1']]));
    const it = item(plan, 'RBK110S236074');
    expect(it.tabla?.elegida).toBe('');
    expect((it.opciones[0].accion as ReposicionFamily).etiquetas).toBeUndefined();
  });

  it('elegir una tabla que coincide reemplaza la etiqueta vieja («REEBOK 2»)', () => {
    // US 11 = 44 en la nota coincide con Hombre: se puede elegir y reemplaza «TABLA DE TALLE REEBOK 2».
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA], new Map([['RBK110S236046', '1']]));
    const a = item(plan, 'RBK110S236046').opciones[0].accion as ReposicionFamily;
    expect(a.etiquetas).toEqual(['TABLA DE TALLE REEBOK 1', 'RBK110S236046-11']);
    expect(a.quitarEtiquetas).toEqual(['TABLA DE TALLE REEBOK 2']);
  });

  it('el talle de Shopify se puede escribir a mano (gax: «que se puedan poner los talles en donde realmente entraron»)', () => {
    const r = resultado();
    let it = item(planCargaDistrinando(r, estado(), {}, [NOTA]), 'RBKLIX71-RBKGX9659');
    expect(it.talles).toEqual([expect.objectContaining({ talle: 'US 5', destino: '36.5' })]);
    // Entró en el 38: va ahí aunque el SKU diga otra cosa, y se avisa.
    it = item(planCargaDistrinando(r, estado(), {}, [NOTA], new Map(), new Map(), new Map([['RBKLIX71-RBKGX9659', { 'US 5': '38' }]])), 'RBKLIX71-RBKGX9659');
    expect(it.talles).toEqual([expect.objectContaining({ talle: 'US 5', destino: '38', destinoManual: true })]);
    const a = it.opciones[0].accion as ReposicionFamily;
    expect(a.lineas.map((l) => `${l.talle}:${l.suma}`)).toEqual(['38:4']);
    expect(it.opciones[0].avisos.join(' ')).toMatch(/lo elegiste a mano \(ojo: ese talle tiene el SKU del US 6\)/);
    // A un talle que no existe, con el SKU del proveedor ya puesto en otro talle: no lo crea duplicado.
    it = item(planCargaDistrinando(r, estado(), {}, [NOTA], new Map(), new Map(), new Map([['RBKLIX71-RBKGX9659', { 'US 5': '40' }]])), 'RBKLIX71-RBKGX9659');
    expect(it.estado).toBe('bloqueado');
    expect(it.motivo).toMatch(/el SKU RBKLIX71-RBKGX9659-5 ya está en el talle 36.5/);
    // En un pack nuevo, escribir los talles a mano reemplaza la tabla.
    const pack = { 'US 4': '35', 'US 5': '36', 'US 6': '37', 'US 7': '38', 'US 7.5': '38.5' };
    it = item(planCargaDistrinando(r, estado(), {}, [NOTA], new Map(), new Map(), new Map([['RBK1100231713', pack]])), 'RBK1100231713');
    expect(it.estado).toBe('listo');
    expect((it.opciones[0].accion as AltaFamily).variantes.map((v) => v.talle)).toEqual(['35', '36', '37', '38', '38.5']);
    expect((it.opciones[0].accion as AltaFamily).tabla).toBeUndefined();
  });

  it('el talle escrito a mano cuenta al revisar la tabla (gax: «le pongo el 44 y ahí sí coincide con la tabla 2»)', () => {
    const r = resultado();
    // La nota dice US 11 = 44 y la tabla 2 dice 43: avisa.
    let it = item(planCargaDistrinando(r, estado(), {}, [NOTA]), 'RBK110S236046');
    expect(it.tabla?.avisos.join(' ')).toMatch(/etiqueta dice TABLA DE TALLE REEBOK 2.*US 11 = 44, la tabla dice 43/);
    // Escribe el 43: ahora coincide con la tabla 2, deja de avisar y la tabla 1 queda bloqueada por lo escrito.
    it = item(planCargaDistrinando(r, estado(), {}, [NOTA], new Map(), new Map(), new Map([['RBK110S236046', { 'US 11': '43' }]])), 'RBK110S236046');
    expect(it.tabla?.avisos ?? []).toEqual([]);
    expect(it.tabla?.elegida).toBe('2');
    expect(it.tabla?.opciones.find((o) => o.clave === '1')?.bloqueo).toMatch(/no coincide con el talle que escribiste a mano: US 11 = 43/);
    const a = it.opciones[0].accion as ReposicionFamily;
    expect(a.lineas.map((l) => `${l.talle}:${l.suma}`)).toEqual(['43:4']);
    expect(a.quitarEtiquetas ?? []).toEqual([]);
  });

  it('un talle que no está en el remito se agrega (gax: «me entró en otro talle, en 13 americano») y sale en el mail', () => {
    const r = resultado();
    const sinCambios = planCargaDistrinando(r, estado(), {}, [NOTA]);
    const plan = planCargaDistrinando(r, estado(), {}, [NOTA], new Map(), new Map([['RBK110S236074', { 'US 12': 14, 'US 13': 1, 'US ZZ': 3 }]]));
    const it74 = item(plan, 'RBK110S236074');
    expect(it74.estado).toBe('listo');
    expect(it74.talles?.map((t) => `${t.talle}:${t.cantidad}/${t.original}`)).toEqual(['US 11:15/15', 'US 12:14/15', 'US 13:1/0']);
    expect(it74.talles?.[2]).toMatchObject({ destino: '45.5', sku: 'RBK110S236074-13' });
    // Al lado de cada talle, el SKU que tiene hoy en Shopify (el 43 tiene el EAN).
    expect(it74.talles?.[0]).toMatchObject({ destino: '43', sku: '4066749645052' });
    const a = it74.opciones[0].accion as ReposicionFamily;
    expect(a.lineas.map((l) => `${l.talle}:${l.suma}`)).toEqual(['43:15', '44:14', '45.5:1']);
    expect(it74.opciones[0].avisos.join(' ')).toMatch(/US 12 15→14 · US 13 \+1 \(no está en el remito\)/);
    // La marca «una sola vez» sigue siendo la del remito.
    expect(it74.firma).toBe(item(sinCambios, 'RBK110S236074').firma);
    // El mail del final: solo lo cargado y distinto del remito.
    const difs = diferenciasDeTalles(plan.items, [{ codigo: 'RBK110S236074', estado: 'cargada', mensaje: '' }, { codigo: 'RBK110S236046', estado: 'cargada', mensaje: '' }], { RBK110S236074: 38389.44 });
    expect(difs).toHaveLength(1);
    const { asunto, cuerpo } = textoAvisoTalles(difs, { proveedor: 'Distrinando', factura: '0039-00283124', remito: '0085-00206200', fecha: '13/11/2026' });
    expect(asunto).toBe('Diferencia de talles — Distrinando remito 0085-00206200');
    expect(cuerpo).toMatch(/Según el remito: US 12 ×15\. Llegó: US 12 ×14, US 13 ×1\./);
    expect(cuerpo).toMatch(/Misma cantidad de pares: mismo modelo y mismo precio, el importe se compensa/);
    // Si faltan pares, dice cuántos y cuánto es.
    const falta = textoAvisoTalles([{ ...difs[0], talles: [{ talle: 'US 12', remito: 15, llego: 14 }] }], { proveedor: 'Distrinando' }).cuerpo;
    expect(falta).toMatch(/Falta 1 par \(\$ 38\.389,44 neto a precio de factura\)/);
    // Sin cargar (error o sin tildar) no entra al mail.
    expect(diferenciasDeTalles(plan.items, [{ codigo: 'RBK110S236074', estado: 'error', mensaje: '' }], {})).toEqual([]);
  });

  it('ejecución: etiquetas, stock y talle nuevo; relee el producto antes de crear', async () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA], new Map([['RBK110S236046', '1']]));
    const llamadas: string[] = [];
    const gql = vi.fn(async (q: string, v?: Record<string, unknown>) => {
      const nombre = /(?:mutation|query)\s+(\w+)/.exec(q)?.[1] ?? '?';
      llamadas.push(nombre);
      if (nombre === 'EtiquetarFamily') return { tagsAdd: { node: { id: v!.id }, userErrors: [] } };
      if (nombre === 'QuitarTabla') return { tagsRemove: { node: { id: v!.id }, userErrors: [] } };
      if (nombre === 'TallesCarga') return { product: { id: v!.id, options: [{ name: 'Talle', values: ['43'] }], variants: { nodes: [{ title: '43', sku: '4066749652807' }] } } };
      if (nombre === 'CrearTallesCarga') {
        expect(v!.variants).toEqual([{ optionValues: [{ optionName: 'Talle', name: '44' }], price: '119999', inventoryItem: { sku: 'RBK110S236046-11', cost: '38389.44', tracked: true }, inventoryQuantities: [{ locationId: 'gid://shopify/Location/martinez', availableQuantity: 4 }] }]);
        return { productVariantsBulkCreate: { productVariants: [{ id: 'nuevo' }], userErrors: [] } };
      }
      if (nombre === 'OrdenarTallesCarga') return { productOptionsReorder: { userErrors: [] } };
      throw new Error(`inesperada ${nombre}`);
    });
    const soloEste = { 'RBK110S236046': { clave: item(plan, 'RBK110S236046').opciones[0].clave } };
    const otros = Object.fromEntries(plan.items.filter((i) => i.codigo !== 'RBK110S236046' && i.opciones.length).map((i) => [i.codigo, { clave: 'no' }]));
    const res = await ejecutarCargaFamily(plan, { ...otros, ...soloEste }, {
      gql, reservar: async () => ({ ok: true }), terminar: async () => {}, liberar: async () => {}, clave: () => 'k',
      antes: async () => ({ estado: 'ok', mensaje: '' }),
    });
    expect(res).toEqual([expect.objectContaining({ codigo: 'RBK110S236046', estado: 'cargada' })]);
    expect(res[0].mensaje).toMatch(/44 nuevo con 4/);
    expect(llamadas).toEqual(['EtiquetarFamily', 'QuitarTabla', 'TallesCarga', 'CrearTallesCarga', 'OrdenarTallesCarga']);
  });

  it('el SKU se puede escribir o escanear (gax: «que yo pueda escanear uno nuevo»); si es un EAN, también va como código de barras', () => {
    const r = resultado();
    const skus = new Map<string, Record<string, string>>([['RBK110S236074', { 'US 12': '4066749999999' }], ['RBK110S236046', { 'US 11': 'ESCANEADO-44' }]]);
    const plan = planCargaDistrinando(r, estado(), {}, [NOTA], new Map(), new Map(), new Map(), skus);
    const it74 = item(plan, 'RBK110S236074');
    expect(it74.talles?.[1]).toMatchObject({ talle: 'US 12', sku: '4066749999999', skuManual: true });
    expect(it74.talles?.[0].skuManual).toBeUndefined();
    const a = it74.opciones[0].accion as ReposicionFamily;
    expect(a.cambiarSku).toEqual([expect.objectContaining({ talle: '44', antes: '4066749645083', sku: '4066749999999', barcode: '4066749999999' })]);
    expect(it74.opciones[0].avisos.join(' ')).toMatch(/Talle 44: el SKU pasa de 4066749645083 a 4066749999999 \(también como código de barras\)/);
    // Talle nuevo: lleva el escaneado; en etiquetas sigue el SKU del proveedor. No es EAN: sin código de barras.
    const b = item(plan, 'RBK110S236046').opciones[0].accion as ReposicionFamily;
    expect(b.crear).toEqual([{ talle: '44', sku: 'RBK110S236046-11', suma: 4, skuShopify: 'ESCANEADO-44' }]);
    expect(b.etiquetas).toEqual(['RBK110S236046-11']);
    // El SKU de otro talle del producto no se puede usar.
    const choca = planCargaDistrinando(r, estado(), {}, [NOTA], new Map(), new Map(), new Map(), new Map([['RBK110S236074', { 'US 12': '4066749645052' }]]));
    expect(item(choca, 'RBK110S236074').motivo).toMatch(/el SKU 4066749645052 ya lo tiene el talle 43/);
    // Igual al que tiene: no cambia nada.
    const igual = planCargaDistrinando(r, estado(), {}, [NOTA], new Map(), new Map(), new Map(), new Map([['RBK110S236074', { 'US 12': '4066749645083' }]]));
    expect((item(igual, 'RBK110S236074').opciones[0].accion as ReposicionFamily).cambiarSku).toBeUndefined();
  });

  it('un talle agregado queda en su lugar (gax: «que el 11 quede arriba del 12»)', () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA], new Map(), new Map([['RBK110S236074', { 'US 10.5': 1 }]]));
    expect(item(plan, 'RBK110S236074').talles?.map((t) => t.talle)).toEqual(['US 10.5', 'US 11', 'US 12']);
  });

  it('un artículo que se saca de la carga (no llegó) va al mail', () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA]);
    const difs = diferenciasDeTalles(plan.items, [], { RBK110S236046: 38389.44 }, new Set(['RBK110S236046']));
    expect(difs).toEqual([expect.objectContaining({ codigo: 'RBK110S236046', noLlego: true, talles: [{ talle: 'US 11', remito: 4, llego: 0 }] })]);
    const { cuerpo } = textoAvisoTalles(difs, { proveedor: 'Distrinando', remito: '0085-00206200' });
    expect(cuerpo).toMatch(/Según el remito: US 11 ×4\. No llegó\./);
    expect(cuerpo).toMatch(/Faltan 4 pares \(\$ 153\.557,76 neto a precio de factura\)/);
  });

  it('ejecución: el SKU escaneado se cambia después de sumar el stock, con su código de barras', async () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA], new Map(), new Map(), new Map(), new Map([['RBK110S236074', { 'US 12': '4066749999999' }]]));
    const llamadas: string[] = [];
    const gql = vi.fn(async (q: string, v?: Record<string, unknown>) => {
      const nombre = /(?:mutation|query)\s+(\w+)/.exec(q)?.[1] ?? '?';
      llamadas.push(nombre);
      if (nombre === 'SumarFamily') return { inventorySetQuantities: { inventoryAdjustmentGroup: { id: 'g' }, userErrors: [] } };
      if (nombre === 'CambiarSkuCarga') {
        expect(v!.variants).toEqual([{ id: expect.stringMatching(/ProductVariant/), inventoryItem: { sku: '4066749999999' }, barcode: '4066749999999' }]);
        return { productVariantsBulkUpdate: { productVariants: [{ id: 'x' }], userErrors: [] } };
      }
      throw new Error(`inesperada ${nombre}`);
    });
    const elegidas = Object.fromEntries(plan.items.filter((i) => i.opciones.length).map((i) => [i.codigo, { clave: i.codigo === 'RBK110S236074' ? i.opciones[0].clave : 'no' }]));
    const res = await ejecutarCargaFamily(plan, elegidas, {
      gql, reservar: async () => ({ ok: true }), terminar: async () => {}, liberar: async () => {}, clave: () => 'k', antes: async () => ({ estado: 'ok', mensaje: '' }),
    });
    expect(res[0].estado).toBe('cargada');
    expect(res[0].mensaje).toMatch(/SKU cambiado: 44 4066749645083 → 4066749999999 \(también código de barras\)/);
    expect(llamadas).toEqual(['SumarFamily', 'CambiarSkuCarga']);
  });

  it('si el talle apareció mientras tanto, no lo crea', async () => {
    const plan = planCargaDistrinando(resultado(), estado(), {}, [NOTA]);
    const gql = vi.fn(async (q: string, v?: Record<string, unknown>) => {
      if (/TallesCarga\(/.test(q) && /query/.test(q)) return { product: { id: v!.id, options: [{ name: 'Talle' }], variants: { nodes: [{ title: '43', sku: 'x' }, { title: '44', sku: 'y' }] } } };
      if (/tagsAdd/.test(q)) return { tagsAdd: { node: { id: 'p' }, userErrors: [] } };
      throw new Error('no debería escribir');
    });
    const elegidas = Object.fromEntries(plan.items.filter((i) => i.opciones.length).map((i) => [i.codigo, { clave: i.codigo === 'RBK110S236046' ? i.opciones[0].clave : 'no' }]));
    expect(accionesElegidas(plan, elegidas)).toHaveLength(1);
    const res = await ejecutarCargaFamily(plan, elegidas, { gql, reservar: async () => ({ ok: true }), terminar: async () => {}, liberar: async () => {}, clave: () => 'k' });
    expect(res[0].estado).toBe('error');
    expect(res[0].mensaje).toMatch(/ya existe 44/);
  });
});
