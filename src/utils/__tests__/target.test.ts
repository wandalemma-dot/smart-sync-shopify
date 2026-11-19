// Target (19-nov-2026, gax): nota de pedido en PDF, factura en foto y alta de productos nuevos.
// Datos armados a mano con la forma de los documentos reales (los archivos reales no van al repositorio).
// Shopify simulado: sin escrituras reales.
import { describe, it, expect, vi } from 'vitest';
import {
  costoTarget, empresaTarget, esDeTarget, esPedidoTarget, facturaTargetDeFoto, leerPedidoTarget, marcaTarget, numeroFacturaTarget,
  listaX2, margenTarget, precioMinimo50, precioTarget, tipoTarget, tituloTarget, type FacturaFoto,
} from '../target';
import { analizarFacturas, type Factura, type Pedido, type Remito } from '../controlFacturas';
import { planCargaTarget } from '../cargaTarget';
import { ejecutarCargaFamily, precioAEscribir, type AltaFamily, type ReposicionFamily } from '../cargaFamily';
import type { EstadoCargaId, ProductoId } from '../cargaId';
import { margenPct } from '../margen';

// Como sale de pdftotext -layout (y de pdf.js agrupando por altura).
const NOTA_PDF = `
                                   Detalle de solicitud
Orden número:                             90001
Fecha de pedido:                          11/11/2026
           Producto                Foto        Cantidad       Precio unit.           Precio
  10001 - Riñonera Camping
  Alpine Skate                                     12         $5.000,00           $60.000,00
  SKU: 10001
  10002 - Mochila Urbana Discovery
  T3                                                6        $49.900,00          $299.400,00
  SKU: 10002C
  10003 - Morral Reebok                              4        $11.130,00           $44.520,00
  SKU: 10003
                                                                   Total:   $403.920,00
`.split('\n');

describe('nota de pedido de Target (PDF)', () => {
  it('lee número, fecha, artículos y cantidades', () => {
    expect(esPedidoTarget(NOTA_PDF)).toBe(true);
    const r = leerPedidoTarget(NOTA_PDF, 'nota', '2026-11-19');
    expect(r.nroProveedor).toBe('90001');
    expect(r.fechaArchivo).toBe('2026-11-11');
    expect(r.pedido.fecha).toBe('2026-11-11');
    expect(r.pedido.nombre).toBe('Target N° 90001');
    expect(r.avisos).toEqual([]);
    expect(r.pedido.lineas.map((l) => [l.codigo, l.descripcion, l.cantidad, l.precioLista])).toEqual([
      ['10001', 'Riñonera Camping Alpine Skate', 12, 5000],
      ['10002', 'Mochila Urbana Discovery T3', 6, 49900],
      ['10003', 'Morral Reebok', 4, 11130],
    ]);
    expect(r.pedido.lineas.every((l) => l.talle === '' && l.descuento === 0 && l.sku === l.codigo)).toBe(true);
  });

  it('la cantidad en su propio renglón (pdf.js la deja a otra altura) también se lee', () => {
    const r = leerPedidoTarget(['Detalle de solicitud', 'Orden número: 5', '10001 - Riñonera Camping', '12 $5.000,00 $60.000,00', 'Alpine Skate', 'SKU: 10001'], 'n', '2026-11-19');
    expect(r.pedido.lineas).toHaveLength(1);
    expect(r.pedido.lineas[0]).toMatchObject({ codigo: '10001', cantidad: 12, precioLista: 5000, descripcion: 'Riñonera Camping Alpine Skate' });
  });

  it('avisa si los artículos no suman el total impreso (falta uno)', () => {
    const corto = NOTA_PDF.filter((l) => !/10003|SKU: 10003/.test(l));
    const r = leerPedidoTarget(corto, 'n', '2026-11-19');
    expect(r.avisos.join(' ')).toMatch(/puede faltar un artículo/);
  });

  it('un PDF que no es la nota no se lee como nota', () => {
    expect(esPedidoTarget(['Factura A', 'Total $ 100'])).toBe(false);
    expect(() => leerPedidoTarget(['Detalle de solicitud'], 'n', '2026-11-19')).toThrow(/No encontré artículos/);
  });
});

const FOTO: FacturaFoto = {
  empresa: 'BAG COMPANY S.R.L.', numero: 'A001600004005', fecha: '2026-11-12', pedido: '211310',
  renglones: [
    { codigo: '10001', descripcion: 'Riñonera Camping Alpine Skate', unidad: 'Unidad', cantidad: 12, precioUnitario: 10000, importe: 120000 },
    { codigo: '10003', descripcion: 'Morral Reebok', unidad: 'Unidad', cantidad: 4, precioUnitario: 15900, importe: 63600 },
  ],
  subtotal: 183600, bonificacionPct: 30, bonificacion: 55080, neto: 128520, percepciones: 0, iva: 26989.2, total: 155509.2,
};

describe('factura de Target (foto)', () => {
  it('número, empresa y cuentas', () => {
    expect(numeroFacturaTarget('A000300172534')).toBe('0003-00172534');
    expect(numeroFacturaTarget('A002000005539')).toBe('0020-00005539');
    expect(numeroFacturaTarget('0016-00006036')).toBe('0016-00006036');
    expect(empresaTarget('TENDENCE S.R.L.')).toBe('TENDENCE');
    expect(empresaTarget('Zatel Adrian Ramon - TARGET')).toBe('TARGET');
    const { factura, avisos } = facturaTargetDeFoto(FOTO);
    expect(avisos).toEqual([]);
    expect(factura).toMatchObject({ numero: '0016-00004005', emisor: 'BAG COMPANY', soloNeto: true, pedidoProveedor: 'P 211310', subtotal: 128520, total: 155509.2 });
    // Cada renglón lleva la bonificación del pie; su total es el neto.
    expect(factura.renglones[0]).toMatchObject({ precioUnitario: 10000, bonificacion: 30, total: 84000 });
    expect(factura.renglones.reduce((s, r) => s + r.total, 0)).toBe(128520);
  });

  it('avisa lo que no cierra (renglón mal leído)', () => {
    const mal = { ...FOTO, renglones: [{ ...FOTO.renglones[0], importe: 12000 }, FOTO.renglones[1]] };
    const { avisos } = facturaTargetDeFoto(mal);
    expect(avisos.join(' ')).toMatch(/10001: 12 × .* la factura dice/);
  });

  it('precio contra la nota por neto: más barato no se reclama, más caro sí', () => {
    const { factura: f } = facturaTargetDeFoto(FOTO);
    const factura: Factura = { ...f, id: 'F-1' };
    const nota: Pedido = { id: 'T-1', nombre: 'Target N° 90001', fecha: '2026-11-11', lineas: leerPedidoTarget(NOTA_PDF, 'n', '2026-11-11').pedido.lineas };
    // La nota trae la riñonera a 5.000 (ya con −50%) y la factura 10.000 −30% = 7.000: más caro.
    const r = analizarFacturas([nota], [factura], {}, {}).facturas[0];
    const rin = r.renglones.find((x) => x.codigo === '10001')!;
    const mor = r.renglones.find((x) => x.codigo === '10003')!;
    expect(rin.difPrecio.length).toBeGreaterThan(0);
    // Morral: nota 11.130 y factura 15.900 −30% = 11.130: igual, sin diferencia.
    expect(mor.difPrecio).toEqual([]);
    // Con 10% de bonificación la riñonera da 9.000 > 5.000; con 60% da 4.000 < 5.000: más barato, sin reclamo.
    const barata = analizarFacturas([nota], [{ ...factura, renglones: factura.renglones.map((x) => ({ ...x, bonificacion: 60 })) }], {}, {}).facturas[0];
    expect(barata.renglones.find((x) => x.codigo === '10001')!.difPrecio).toEqual([]);
  });
});

describe('alta de productos de Target', () => {
  it('marca, tipo, título, precio y costo', () => {
    expect(marcaTarget('Riñonera Camping Alpine Skate')).toBe('Alpine Skate');
    expect(marcaTarget('Gorro NBA Lakers')).toBe('NBA');
    expect(marcaTarget('Mochila sin marca')).toBeNull();
    expect(tipoTarget('Rinonera Camping')).toEqual({ tipo: 'Riñonera', gramos: 300 });
    expect(tipoTarget('Baston Trecking Discovery')?.tipo).toBe('Bastón de Trekking');
    expect(tipoTarget('Cosa rara')).toBeNull();
    expect(tituloTarget('Baston  Trecking Discovery')).toBe('Bastón Trekking Discovery');
    expect(precioTarget(49900)).toBe(120800); // sin descuento: costo 49.900 × 2,42 = 120.758 → 120.800
    expect(precioTarget(49900, 30)).toBe(99800); // con 30% la lista × 2 ya deja más del 50%
    expect(precioTarget(49900, 10)).toBe(108700); // costo 44.910 × 2,42 = 108.682,20 → 108.700
    expect(listaX2(49900)).toBe(99800);
    expect(costoTarget(49900, 10)).toBe(44910);
    expect(costoTarget(15900, 30)).toBe(11130);
    expect(esDeTarget(['target', '10001'])).toBe(true);
    expect(esDeTarget(['10001'])).toBe(false);
  });

  it('el margen de lista × 2 lo decide el descuento de la factura (sin IVA de la venta)', () => {
    const r1 = (m: number | null) => Math.round((m ?? NaN) * 10) / 10;
    expect(r1(margenTarget(50))).toBe(69.8);
    expect(r1(margenTarget(30))).toBe(57.7);
    expect(r1(margenTarget(10))).toBe(45.6);
    expect(r1(margenTarget(0))).toBe(39.5);
  });

  it('si la lista × 2 no llega al 50% de margen, el precio se sube hasta llegar (a los $100, para arriba)', () => {
    // 50% justo: costo × 2,42 exacto no se redondea de más.
    expect(precioMinimo50(5000)).toBe(12100);
    expect(precioMinimo50(7020)).toBe(17000); // 16.988,40 → 17.000
    expect(precioMinimo50(0)).toBe(0);
    for (const [lista, bonif] of [[7900, 10], [26900, 10], [2700, 10], [15900, 30], [7500, 50], [10000, 0]]) {
      const precio = precioTarget(lista, bonif);
      expect(precio).toBeGreaterThanOrEqual(listaX2(lista));
      expect(margenPct(precio, costoTarget(lista, bonif))!).toBeGreaterThanOrEqual(50);
      expect(precio % 100 === 0 || precio === listaX2(lista)).toBe(true);
    }
    // Factura del 10%: lista 7.900 → costo 7.110 → mínimo 17.300 (la lista × 2 daba 15.800 y 45,5%).
    expect(precioTarget(7900, 10)).toBe(17300);
  });
});

// ---------------------------------------------------------------------------
// Vista previa de la carga
// ---------------------------------------------------------------------------
const facturaCarga = (): Factura => ({ ...facturaTargetDeFoto(FOTO).factura, id: 'F-bag-company-0016-00004005', remito: '0016-00006035' });
const REMITO: Remito = { numero: '0016-00006035', fecha: '2026-11-12', renglones: [
  { codigo: '10001', cantidad: 12, talles: [] }, { codigo: '10003', cantidad: 4, talles: [] },
] };
const resultado = () => analizarFacturas([], [facturaCarga()], {}, { 'F-bag-company-0016-00004005': REMITO }).facturas[0];
const vacio = (): EstadoCargaId => ({ locationId: 'gid://shopify/Location/martinez', posId: 'gid://shopify/Publication/pos', porCodigo: {}, productos: {} });
const producto = (id: string, etiquetas: string[], precio: number, disponible: number, costo: number | null): ProductoId => ({
  id: `gid://shopify/Product/${id}`, titulo: `Producto ${id}`, vendor: 'Reebok', estado: 'ACTIVE', etiquetas, opciones: ['Title'],
  variantes: [{ id: `gid://shopify/ProductVariant/${id}`, talle: 'TU', sku: id, inventoryItemId: `gid://shopify/InventoryItem/${id}`, seguimiento: true, disponible, precio, costo }],
});

describe('carga de una entrega de Target', () => {
  it('lo que no está en Shopify se crea: lista × 2, lista − bonificación, marca y etiqueta Target, sin talles', () => {
    const plan = planCargaTarget(resultado(), vacio(), {});
    expect(plan.items.map((i) => i.estado)).toEqual(['listo', 'listo']);
    const a = plan.items[0].opciones[0].accion as AltaFamily;
    expect(a).toMatchObject({
      tipo: 'alta', titulo: 'Riñonera Camping Alpine Skate', vendor: 'Alpine Skate', productType: 'Riñonera', etiquetas: ['Target', '10001'],
      precio: 20000, costo: 7000, opcion: 'Title', variantes: [{ talle: 'Default Title', sku: '10001', cantidad: 12 }],
      lista: 10000, bonificacion: 30,
    });
    expect(plan.avisos.join(' ')).toMatch(/30% de descuento: con el precio a lista × 2, el margen queda en 57,6%/);
    expect((plan.items[1].opciones[0].accion as AltaFamily).vendor).toBe('Reebok');
  });

  it('factura con 10% de descuento: el alta y el mínimo de la reposición suben al 50%', () => {
    const f = facturaCarga();
    const f10 = { ...f, renglones: f.renglones.map((x) => ({ ...x, bonificacion: 10 })) };
    const r = analizarFacturas([], [f10], {}, { 'F-bag-company-0016-00004005': REMITO }).facturas[0];
    const plan = planCargaTarget(r, vacio(), {});
    const a = plan.items[0].opciones[0].accion as AltaFamily;
    // lista 10.000 − 10% = 9.000; × 2,42 = 21.780 → 21.800 (la lista × 2 daba 20.000 y 45,5%).
    expect(a).toMatchObject({ precio: 21800, costo: 9000, lista: 10000, bonificacion: 10 });
    expect(plan.avisos.join(' ')).toMatch(/10% de descuento: con el precio a lista × 2 el margen quedaría en 45,5%, así que el precio se sube hasta llegar al 50%/);
    const e = vacio();
    const p = producto('10001', ['Target', '10001'], 20000, 0, 9000);
    e.porCodigo = { '10001': [p.id] };
    e.productos = { [p.id]: p };
    const aj = (planCargaTarget(r, e, {}).items[0].opciones[0].accion as ReposicionFamily).ajuste!;
    expect(aj).toMatchObject({ regla: 'x2', sugerido: 21800, listaX2: 20000, ok: false });
    expect(precioAEscribir(aj, 21000)).toBeNaN();
    expect(precioAEscribir(aj, 21800)).toBe(21800);
  });

  it('la cantidad se puede escribir a mano (se avisa que no es la del remito)', () => {
    const plan = planCargaTarget(resultado(), vacio(), {}, new Map([['10001', 10]]));
    const a = plan.items[0].opciones[0].accion as AltaFamily;
    expect(a.variantes[0].cantidad).toBe(10);
    expect(plan.items[0].opciones[0].avisos.join(' ')).toMatch(/Distinto del remito: 12 → 10/);
  });

  it('con la etiqueta Target suma stock; el precio tiene que llegar a lista × 2', () => {
    const e = vacio();
    const p = producto('10001', ['Target', '10001'], 18000, 0, 7000);
    e.porCodigo = { '10001': [p.id] };
    e.productos = { [p.id]: p };
    const plan = planCargaTarget(resultado(), e, {});
    const rep = plan.items[0].opciones[0].accion as ReposicionFamily;
    expect(rep.tipo).toBe('reposicion');
    expect(rep.lineas).toEqual([{ talle: 'TU', inventoryItemId: 'gid://shopify/InventoryItem/10001', actual: 0, suma: 12 }]);
    const aj = rep.ajuste!;
    expect(aj).toMatchObject({ regla: 'x2', sugerido: 20000, ok: false, costoNuevo: 7000 });
    // 18.000 no llega a 20.000: hay que poner un precio; menos de 20.000 no se acepta.
    expect(precioAEscribir(aj)).toBeNaN();
    expect(precioAEscribir(aj, 19999)).toBeNaN();
    expect(precioAEscribir(aj, 20000)).toBe(20000);
    // Con 20.000 o más ya está bien: no se toca.
    p.variantes[0].precio = 21000;
    const ok = (planCargaTarget(resultado(), e, {}).items[0].opciones[0].accion as ReposicionFamily).ajuste!;
    expect(ok.ok).toBe(true);
    expect(precioAEscribir(ok)).toBeNull();
  });

  it('un producto con el mismo código pero sin la etiqueta Target no se toca', () => {
    const e = vacio();
    const p = producto('10001', ['10001'], 18000, 3, 5000);
    e.porCodigo = { '10001': [p.id] };
    e.productos = { [p.id]: p };
    const it0 = planCargaTarget(resultado(), e, {}).items[0];
    expect(it0.estado).toBe('bloqueado');
    expect(it0.motivo).toMatch(/sin la etiqueta «Target»/);
  });

  it('títulos repetidos en la misma factura llevan el código', () => {
    const f = facturaCarga();
    f.renglones = [f.renglones[0], { ...f.renglones[0], codigo: '10009' }];
    const remito: Remito = { ...REMITO, renglones: [{ codigo: '10001', cantidad: 12, talles: [] }, { codigo: '10009', cantidad: 12, talles: [] }] };
    const r = analizarFacturas([], [f], {}, { [f.id]: remito }).facturas[0];
    const plan = planCargaTarget(r, vacio(), {});
    expect(plan.items.map((i) => (i.opciones[0].accion as AltaFamily).titulo)).toEqual(['Riñonera Camping Alpine Skate 10001', 'Riñonera Camping Alpine Skate 10009']);
    expect(plan.avisos.join(' ')).toMatch(/mismo nombre/);
  });

  it('lo que no está en el remito no se carga', () => {
    const r = analizarFacturas([], [facturaCarga()], {}, { 'F-bag-company-0016-00004005': { ...REMITO, renglones: [REMITO.renglones[0]] } }).facturas[0];
    const plan = planCargaTarget(r, vacio(), {});
    expect(plan.items.find((i) => i.codigo === '10003')!.estado).toBe('bloqueado');
  });

  it('al crear: producto sin talles (Title / Default Title), activo, con la marca y en Point of Sale', async () => {
    const plan = planCargaTarget(resultado(), vacio(), {});
    const llamadas: { q: string; v: Record<string, unknown> }[] = [];
    const gql = vi.fn(async (q: string, v: Record<string, unknown> = {}) => {
      llamadas.push({ q, v });
      if (q.includes('productSet')) return { productSet: { product: { id: 'gid://shopify/Product/nuevo' }, userErrors: [] } };
      if (q.includes('publishablePublish')) return { publishablePublish: { userErrors: [] } };
      if (q.includes('productVariants')) return { productVariants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
      throw new Error('inesperada');
    });
    const res = await ejecutarCargaFamily(plan, { 10001: { clave: 'alta' } }, { gql: gql as never, reservar: async () => ({ ok: true }), terminar: async () => {}, liberar: async () => {}, clave: () => 'k' });
    expect(res.find((x) => x.codigo === '10001')?.estado).toBe('cargada');
    const input = llamadas.find((l) => l.q.includes('productSet'))!.v.input as Record<string, unknown>;
    expect(input).toMatchObject({
      title: 'Riñonera Camping Alpine Skate', vendor: 'Alpine Skate', status: 'ACTIVE', tags: ['Target', '10001'],
      productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    });
    expect((input.variants as Record<string, unknown>[])[0]).toMatchObject({
      optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: '20000',
      inventoryItem: { sku: '10001', cost: '7000', tracked: true },
      inventoryQuantities: [{ locationId: 'gid://shopify/Location/martinez', name: 'available', quantity: 12 }],
    });
    expect(llamadas.some((l) => l.q.includes('publishablePublish'))).toBe(true);
  });
});
