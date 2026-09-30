// ============================================================================
// CONTROL DE REMITOS — comparar el remito con lo que se cargó en Shopify
// ----------------------------------------------------------------------------
// ⚠ LO QUE CUIDA ESTE ARCHIVO:
//   1) Que un talle cargado distinto al del remito se detecte como «talle
//      cambiado» (el error típico al cargar a mano) y no como dos cosas sueltas.
//   2) Que las VENTAS no se cuenten como cargas (bajan el stock, pero no son
//      un error de quien carga).
//   3) Que lo cargado sea el NETO de la persona: cargó 3 y corrigió −1 → 2.
//   4) Que nunca se adivine: si un artículo puede ser de dos productos, queda
//      sin asociar y se avisa.
//   5) Remito REAL: Fabrique 0003-00008299 (22-09-2026), 79 renglones, 87 u.
//
// ⚠ SI UN CAMBIO HACE FALLAR ESTE ARCHIVO, EL CAMBIO ESTÁ MAL.
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  normalizarTalle, normalizarCodigo, talleDeVariante, netoPorVariante, compararRemito,
  chequeosRemito, filasAMovimientos, consultaHistorial, sumarDias, personasDe,
} from '../controlRemitos';
import type { Movimiento, VarianteInfo, Remito } from '../controlRemitos';
import fabrique from './remitoFabrique.json';

const remitoReal = fabrique as Remito;

let n = 0;
function variante(productTitle: string, talle: string, extra: Partial<VarianteInfo> = {}): VarianteInfo {
  n++;
  return {
    id: `gid://shopify/ProductVariant/${n}`, sku: `SKU${n}`, barcode: '', talle: normalizarTalle(talle), talleOriginal: talle,
    opciones: [talle], productId: `gid://shopify/Product/${productTitle}`, productTitle, vendor: 'Fabrique', tags: [], ...extra,
  };
}
function mov(v: VarianteInfo, cambio: number, extra: Partial<Movimiento> = {}): Movimiento {
  return {
    variantId: v.id, sku: v.sku, variantTitle: '', persona: 'Miguel Galván', app: '', motivo: 'Corrección',
    sucursal: 'Depósito', estado: 'Available', dia: '2026-09-23', cambio, ...extra,
  };
}

describe('normalización', () => {
  it('talles de letras y números', () => {
    expect(normalizarTalle('XXL')).toBe('2XL');
    expect(normalizarTalle('2XL')).toBe('2XL');
    expect(normalizarTalle('XXXL')).toBe('3XL');
    expect(normalizarTalle(' m ')).toBe('M');
    expect(normalizarTalle('38.0')).toBe('38');
    expect(normalizarTalle('7,5')).toBe('7.5');
    expect(normalizarTalle('Único')).toBe('');
    expect(normalizarTalle('')).toBe('');
  });
  it('código: la O y el 0 se confunden en el papel', () => {
    expect(normalizarCodigo('O570707')).toBe(normalizarCodigo('0570707'));
    expect(normalizarCodigo('q51-bs 410')).toBe('Q51BS410');
  });
  it('talle de la variante sale de la opción Talle, Size o del título', () => {
    expect(talleDeVariante([{ name: 'Color', value: 'Negro' }, { name: 'Talle', value: 'XL' }], 'Negro / XL')).toBe('XL');
    expect(talleDeVariante([{ name: 'Size', value: 'M' }], 'M')).toBe('M');
    expect(talleDeVariante([{ name: 'Title', value: 'Default Title' }], 'Default Title')).toBe('');
    expect(talleDeVariante([{ name: 'Color', value: 'Negro' }], 'Negro')).toBe('');
  });
});

describe('movimientos → lo que cargó cada uno', () => {
  const v = variante('Remera Kronos Negro', 'M');
  it('suma neto (cargó 3, corrigió −1) y NO cuenta ventas', () => {
    const c = netoPorVariante([
      mov(v, 3), mov(v, -1),
      mov(v, -1, { motivo: 'Order created', persona: '' }),
      mov(v, -1, { motivo: 'Pedido', persona: 'Caja' }),
    ]);
    expect(c.get(v.id)!.cantidad).toBe(2);
    expect(c.get(v.id)!.personas).toEqual({ 'Miguel Galván': 2 });
  });
  it('solo cuenta stock disponible (no comprometido)', () => {
    const c = netoPorVariante([mov(v, 2), mov(v, 5, { estado: 'Committed' })]);
    expect(c.get(v.id)!.cantidad).toBe(2);
  });
  it('se puede filtrar por persona', () => {
    const c = netoPorVariante([mov(v, 2), mov(v, 4, { persona: 'Otra' })], new Set(['Miguel Galván']));
    expect(c.get(v.id)!.cantidad).toBe(2);
    expect(personasDe([mov(v, 2), mov(v, 4, { persona: 'Otra' })]).map((p) => p.nombre)).toEqual(['Otra', 'Miguel Galván']);
  });
});

describe('comparar remito contra lo cargado', () => {
  const remito: Remito = {
    proveedor: 'Fabrique SRL', numero: '1', fecha: '2026-09-22',
    renglones: [
      { codigo: 'P52SA210', descripcion: 'Remera Kronos', color: 'Negro', talle: 'M', cantidad: 1 },
      { codigo: 'P52SA210', descripcion: 'Remera Kronos', color: 'Negro', talle: 'L', cantidad: 1 },
      { codigo: 'P52SA210', descripcion: 'Remera Kronos', color: 'Negro', talle: 'XXL', cantidad: 1 },
      { codigo: 'O570712', descripcion: 'Sweater Lust', color: 'P. Gris', talle: 'S', cantidad: 1 },
      { codigo: 'O570707', descripcion: 'Sweater Lust', color: 'P. Negro', talle: 'XL', cantidad: 2 },
      { codigo: 'O570707', descripcion: 'Sweater Lust', color: 'P. Negro', talle: 'M', cantidad: 2 },
      { codigo: 'P70P210', descripcion: 'Gorra Pop LX', color: 'Negro', talle: '', cantidad: 1 },
      { codigo: 'R52VG10', descripcion: 'Remera Vincent Van Gogh', color: 'Negro', talle: 'S', cantidad: 1 },
    ],
  };
  // Kronos: el código está en el SKU. M bien, L cargado como XL (talle cambiado), XXL→2XL bien.
  const kM = variante('Remera Kronos Negro', 'M', { sku: 'P52SA210-M' });
  const kXL = variante('Remera Kronos Negro', 'XL', { sku: 'P52SA210-XL' });
  const k2XL = variante('Remera Kronos Negro', '2XL', { sku: 'P52SA210-2XL' });
  // Sweater Lust: dos productos con el mismo nombre, se distinguen por color.
  const gS = variante('Sweater Lust Gris', 'S');
  const nXL = variante('Sweater Lust Negro', 'XL');
  const nM = variante('Sweater Lust Negro', 'M');
  const nL = variante('Sweater Lust Negro', 'L'); // no está en el remito
  const gorra = variante('Gorra Pop LX Negro', 'Default Title');
  // Van Gogh: no se cargó. Otra carga del período, de otro proveedor:
  const otra = variante('Zapatilla Converse Chuck', '40');

  const variantes = [kM, kXL, k2XL, gS, nXL, nM, nL, gorra, otra];
  const cargas = netoPorVariante([
    mov(kM, 1), mov(kXL, 1), mov(k2XL, 1),
    mov(gS, 1),
    mov(nXL, 1),            // cargó 1 de 2
    mov(nM, 2),
    mov(nL, 1),             // talle que el remito no trae
    mov(gorra, 1),
    mov(otra, 3, { persona: 'Wanda' }),
  ]);
  const r = compararRemito(remito, variantes, cargas);
  const buscar = (desc: string, talle: string) =>
    r.filas.find((f) => f.descripcion === desc && (f.talleRemito === talle || (!f.talleRemito && f.talleCargado === talle)));

  it('lo que coincide', () => {
    expect(buscar('Remera Kronos', 'M')!.tipo).toBe('ok');
    expect(buscar('Remera Kronos', 'XXL')!.tipo).toBe('ok'); // XXL = 2XL
    expect(buscar('Sweater Lust', 'M')!.tipo).toBe('ok');
    expect(buscar('Gorra Pop LX', '')!.tipo).toBe('ok');     // sin talle
  });
  it('talle cambiado: remito L, se cargó XL', () => {
    const f = buscar('Remera Kronos', 'L')!;
    expect(f.tipo).toBe('talle');
    expect(f.talleCargado).toBe('XL');
    expect(f.personas).toEqual({ 'Miguel Galván': 1 });
  });
  it('distingue Sweater Lust gris y negro por el color', () => {
    const gris = r.modelos.find((m) => m.codigo === 'O570712')!;
    const negro = r.modelos.find((m) => m.codigo === 'O570707')!;
    expect(gris.producto).toBe('Sweater Lust Gris');
    expect(negro.producto).toBe('Sweater Lust Negro');
  });
  it('cantidad distinta y talle de más', () => {
    const xl = r.filas.find((f) => f.codigo === 'O570707' && f.talleRemito === 'XL')!;
    expect(xl.tipo).toBe('diferencia');
    expect([xl.cantRemito, xl.cantCargada]).toEqual([2, 1]);
    const l = r.filas.find((f) => f.codigo === 'O570707' && f.tipo === 'extra')!;
    expect(l.talleCargado).toBe('L');
  });
  it('lo que está en el remito y no se cargó', () => {
    expect(buscar('Remera Vincent Van Gogh', 'S')!.tipo).toBe('falta');
  });
  it('las cargas de otros productos van aparte (no son errores de este remito)', () => {
    expect(r.otrasCargas.map((f) => f.producto)).toEqual(['Zapatilla Converse Chuck']);
    expect(r.porPersona).toEqual({ 'Miguel Galván': 9 }); // 1+1+1 Kronos, 1 gris, 1+2+1 negro, 1 gorra
  });
  it('nunca adivina: dos productos iguales sin forma de distinguirlos → sin asociar', () => {
    const a = variante('Remera Básica', 'M');
    const b = variante('Remera Básica Premium', 'M');
    const rem: Remito = { proveedor: 'x', numero: '1', fecha: '2026-09-22',
      renglones: [{ codigo: 'ZZ1', descripcion: 'Remera Básica', color: '', talle: 'M', cantidad: 1 }] };
    const res = compararRemito(rem, [a, b], netoPorVariante([mov(a, 1), mov(b, 1)]));
    expect(res.modelos[0].productId).toBeNull();
    expect(res.filas[0].tipo).toBe('falta');
    expect(res.filas[0].nota).toMatch(/No pude decidir/);
  });
});

describe('remito real Fabrique 0003-00008299', () => {
  it('79 renglones y 87 unidades: los chequeos no avisan nada', () => {
    expect(remitoReal.renglones.length).toBe(79);
    expect(remitoReal.renglones.reduce((s, x) => s + x.cantidad, 0)).toBe(87);
    expect(chequeosRemito(remitoReal)).toEqual([]);
  });
  it('avisa si falta un renglón o no cuadra la cantidad', () => {
    const corto = { ...remitoReal, renglones: remitoReal.renglones.slice(1) };
    expect(chequeosRemito(corto).length).toBe(2);
  });
  it('si todo se cargó bien, todo da OK', () => {
    // Simulamos una carga perfecta: una variante por modelo+talle.
    const vs: VarianteInfo[] = [];
    const movs: Movimiento[] = [];
    const vistos = new Map<string, VarianteInfo>();
    for (const r of remitoReal.renglones) {
      const titulo = `${r.descripcion} ${r.color.replace('P. ', '')}`;
      const k = titulo + '|' + r.talle;
      let v = vistos.get(k);
      if (!v) { v = variante(titulo, r.talle || 'Default Title', { sku: `${r.codigo}-${r.talle}` }); vistos.set(k, v); vs.push(v); }
      movs.push(mov(v, r.cantidad));
    }
    const res = compararRemito(remitoReal, vs, netoPorVariante(movs));
    expect(res.totales.falta + res.totales.talle + res.totales.diferencia + res.totales.extra).toBe(0);
    expect(res.totales.unidadesRemito).toBe(87);
    expect(res.totales.unidadesCargadas).toBe(87);
  });
});

describe('Shopify', () => {
  it('la consulta pide el historial agrupado por variante, persona y día', () => {
    const q = consultaHistorial('2026-09-22', '2026-09-29');
    expect(q).toMatch(/FROM inventory_adjustment_history/);
    expect(q).toMatch(/staff_member_name/);
    expect(q).toMatch(/SINCE 2026-09-22 UNTIL 2026-09-29/);
  });
  it('lee filas como objetos o como arreglos, y arma el id completo', () => {
    const cols = [{ name: 'product_variant_id' }, { name: 'staff_member_name' }, { name: 'inventory_adjustment_change' }, { name: 'day' }];
    const a = filasAMovimientos(cols, [{ product_variant_id: 123, staff_member_name: 'Miguel Galván', inventory_adjustment_change: '2', day: '2026-09-23T00:00:00' }]);
    const b = filasAMovimientos(cols, [[123, 'Miguel Galván', 2, '2026-09-23']]);
    expect(a[0]).toMatchObject({ variantId: 'gid://shopify/ProductVariant/123', persona: 'Miguel Galván', cambio: 2, dia: '2026-09-23' });
    expect(b[0]).toMatchObject(a[0]);
  });
  it('sumar días', () => {
    expect(sumarDias('2026-09-28', 7)).toBe('2026-10-05');
  });
});
