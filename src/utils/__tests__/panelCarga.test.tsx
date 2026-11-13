// Vista previa de la carga: en iD los artículos empiezan sin tildar (12-nov-2026, gax:
// «yo los voy seleccionando, así los voy controlando»). Family sigue con todo tildado.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrdenesQueSalen, PanelCarga } from '../../PanelCarga';
import type { PlanCarga } from '../cargaFamily';

const plan = {
  entregaId: 'F-1', locationId: 'gid://shopify/Location/9', posId: null, avisos: [], sucursal: 'DEPOSITO MARTINEZ',
  items: [{
    codigo: 'CTN0225003O', descripcion: 'Remera', unidades: 4, firma: 'f', estado: 'listo', motivo: '',
    opciones: [{ clave: 'repo:1', etiqueta: 'Sumar', avisos: [], accion: {
      tipo: 'reposicion', productoId: 'gid://shopify/Product/1', titulo: 'Remera Converse', etiquetar: false,
      lineas: [{ talle: 'M', inventoryItemId: 'gid://shopify/InventoryItem/1', actual: 1, suma: 3 }],
    } }],
  }],
} as unknown as PlanCarga;
const render = (sinTildar?: boolean) => renderToStaticMarkup(
  <PanelCarga plan={plan} ocupado={false} onConfirmar={() => undefined} onCancelar={() => undefined} sucursal="DEPOSITO MARTINEZ" explicacion="" sinTildar={sinTildar} />);

describe('vista previa de la carga: casillas', () => {
  it('iD: empiezan destildadas y no hay nada para cargar hasta tildar', () => {
    const html = render(true);
    expect(html).not.toMatch(/checked/);
    expect(html).toMatch(/Tildá cada artículo a medida que lo controlás/);
    expect(html).toMatch(/\(0 de 1\)/);
    expect(html).toMatch(/sin tildar: no se carga/);
    expect(html).toMatch(/No hay nada elegido para cargar/);
  });
  it('Family: siguen tildadas como antes', () => {
    const html = render();
    expect(html).toMatch(/checked/);
    expect(html).toMatch(/1 reposición\(es\): 3 unidades/);
  });
});

describe('vista previa de la carga: vendido en iD', () => {
  const conVenta = (movibles: number) => ({
    ...plan, items: [{ ...plan.items[0], opciones: [{ ...plan.items[0].opciones[0], modoVenta: 'separar', separarAplicado: true, movibles,
      separar: [{ talle: 'XXL', cantidad: 1, ordenes: [{ nombre: '#210855', cantidad: 1 }] }] }] }],
  }) as unknown as PlanCarga;
  const html = (p: PlanCarga) => renderToStaticMarkup(
    <PanelCarga plan={p} ocupado={false} onConfirmar={() => undefined} onCancelar={() => undefined} sucursal="DEPOSITO MARTINEZ" explicacion="" sinTildar onModoVenta={() => undefined} />);
  it('ofrece separar, cargarlo igual o pasar la venta a Martínez (aun sin tildar)', () => {
    const h = html(conVenta(1));
    expect(h).toMatch(/Vendido en iD: separá 1 u\. antes de cargar/);
    expect(h).toMatch(/Ya lo separé antes: cargarlo igual/);
    expect(h).toMatch(/Cargar y pasar la venta a Martínez/);
    expect(/<button[^>]*>Cargar y pasar la venta a Martínez/.exec(h)![0]).not.toMatch(/disabled/);
  });
  it('si la preparación está en curso en iD, el botón de pasar la venta queda deshabilitado', () => {
    expect(html(conVenta(0))).toMatch(/disabled=""[^>]*>Cargar y pasar la venta a Martínez/);
  });
});

describe('órdenes de iD que ya pueden salir', () => {
  it('separa las que salen de las que esperan más de iD', () => {
    const h = renderToStaticMarkup(<OrdenesQueSalen ordenes={[
      { orden: '#210952', puede: true, pasa: true, llega: ['Remera Retro M (pasa a Martínez)'], faltan: [] },
      { orden: '#210837', puede: false, pasa: false, llega: ['Remera Patch S'], faltan: ['Remera Le Coq S'] },
    ]} />);
    expect(h).toMatch(/Ya pueden salir \(1\)/);
    expect(h).toMatch(/#210952<\/strong> \(se prepara desde Martínez\)/);
    expect(h).toMatch(/Todavía no pueden salir \(1\)/);
    expect(h).toMatch(/falta de iD: Remera Le Coq S/);
    expect(renderToStaticMarkup(<OrdenesQueSalen ordenes={[]} />)).toBe('');
  });
});

describe('vista previa de la carga: cantidades a mano (gax, 12-nov-2026)', () => {
  const conTalles = { ...plan, items: [{ ...plan.items[0], talles: [{ talle: 'M', cantidad: 2, original: 1 }, { talle: 'L', cantidad: 3, original: 3 }] }] } as unknown as PlanCarga;
  const html = (onCantidad?: () => void) => renderToStaticMarkup(
    <PanelCarga plan={conTalles} ocupado={false} onConfirmar={() => undefined} onCancelar={() => undefined} sucursal="DEPOSITO MARTINEZ" explicacion="" sinTildar onCantidad={onCantidad} />);
  it('muestra un casillero por talle con lo que vino, y marca lo cambiado', () => {
    const h = html(() => undefined);
    expect(h).toMatch(/Llegó para cargar/);
    expect(h).toMatch(/aria-label="Cantidad talle M"[^>]*value="2"|value="2"[^>]*aria-label="Cantidad talle M"/);
    expect(h).toMatch(/\(remito 1\)/);
    expect(h).not.toMatch(/\(remito 3\)/);
  });
  it('sin la función (Family) no se puede escribir', () => {
    expect(html()).not.toMatch(/Llegó para cargar/);
  });
});

describe('vista previa de la carga: Distrinando (13-nov-2026)', () => {
  const dis = {
    ...plan, items: [{
      ...plan.items[0], codigo: 'RBK1100231713', estado: 'bloqueado', motivo: 'Elegí la tabla de talle: hay talles que el proveedor no informa en la nota.', opciones: [],
      talles: [{ talle: 'US 4', cantidad: 6, original: 6, destino: '' }, { talle: 'US 5', cantidad: 9, original: 9, destino: '36', destinoManual: true, nuevo: true, sku: 'RBK1100231713-5' }],
      tabla: {
        elegida: '', actual: null, hace: true, avisos: ['Este producto no tiene tabla de talle: elegí una abajo y se la agrego al cargar.'],
        opciones: [{ clave: '', etiqueta: 'Elegí la tabla de talle…' }, { clave: '1', etiqueta: 'TABLA DE TALLE REEBOK 1' }, { clave: 'MUJER', etiqueta: 'TABLA DE TALLE REEBOK MUJER', bloqueo: 'no tiene el US 4' }],
      },
    }],
  } as unknown as PlanCarga;
  const html = renderToStaticMarkup(<PanelCarga plan={dis} ocupado={false} onConfirmar={() => undefined} onCancelar={() => undefined} sucursal="DEPOSITO MARTINEZ" explicacion=""
    sinTildar onCantidad={() => undefined} onTabla={() => undefined} onDestino={() => undefined} />);
  it('muestra el desplegable de tabla, con las que no coinciden deshabilitadas, y el aviso', () => {
    expect(html).toMatch(/Tabla de talle/);
    expect(html).toMatch(/<option value="MUJER" disabled="">TABLA DE TALLE REEBOK MUJER \(no coincide\)/);
    expect(html).toMatch(/no tiene tabla de talle/);
    expect(html).toMatch(/No se pueden elegir: MUJER \(no tiene el US 4\)/);
  });
  it('al lado de cada talle, el talle de Shopify donde entra (editable)', () => {
    expect(html).toMatch(/aria-label="Talle de Shopify para US 5"[^>]*value="36"/);
    expect(html).toMatch(/\(a mano\)/);
    expect(html).toMatch(/aria-label="Talle de Shopify para US 4"[^>]*value=""/);
  });
  it('al lado del talle se ve el SKU (el que tiene o el que va a llevar)', () => {
    expect(html).toMatch(/>RBK1100231713-5<\/span>/);
    expect(html).toMatch(/se crea/);
  });
  it('los talles van en filas: uno por renglón, con pares, talle de Shopify, SKU y stock de Martínez (gax, 13-nov)', () => {
    const repo = {
      ...dis, items: [{
        ...dis.items[0], estado: 'listo', motivo: '', tabla: undefined,
        talles: [{ talle: 'US 11', cantidad: 10, original: 10, destino: '44', sku: '4066749645052' }, { talle: 'US 12', cantidad: 6, original: 6, destino: '46', sku: 'RBK1100033511-12', nuevo: true }],
        opciones: [{ clave: 'repo:1', etiqueta: 'Sumar', avisos: [], accion: {
          tipo: 'reposicion', productoId: 'gid://shopify/Product/1', titulo: 'Zapatillas Reebok Nano X3', etiquetar: false,
          lineas: [{ talle: '44', inventoryItemId: 'gid://shopify/InventoryItem/1', actual: 1, suma: 10 }],
          crear: [{ talle: '46', sku: 'RBK1100033511-12', suma: 6 }],
        } }],
      }],
    } as unknown as PlanCarga;
    const h = renderToStaticMarkup(<PanelCarga plan={repo} ocupado={false} onConfirmar={() => undefined} onCancelar={() => undefined} sucursal="DEPOSITO MARTINEZ" explicacion=""
      onCantidad={() => undefined} onTabla={() => undefined} onDestino={() => undefined} />);
    expect(h.match(/<tr>/g)?.length).toBe(3);
    expect(h).toMatch(/Stock en Martínez/);
    expect(h).toMatch(/<strong>US 11<\/strong><\/td>.*?1 → 11<\/td>/);
    expect(h).toMatch(/<strong>US 12<\/strong><\/td>.*?talle nuevo con <!-- -->6<\/td>|<strong>US 12<\/strong><\/td>.*?talle nuevo con 6<\/td>/);
    expect(h).toMatch(/Se suma en «Zapatillas Reebok Nano X3»\./);
    expect(h).not.toMatch(/🔁|✏️|🆕|✅ Margen/);
    expect(h).toMatch(/＋ Agregar talle/);
  });
  it('el SKU se puede escribir o escanear, el talle agregado se puede quitar y el artículo sacarse de la carga', () => {
    const conExtra = { ...dis, items: [{ ...dis.items[0], talles: [...(dis.items[0].talles ?? []), { talle: 'US 6', cantidad: 1, original: 0, destino: '37', sku: '4066700000000', skuManual: true }] }] } as unknown as PlanCarga;
    const h = renderToStaticMarkup(<PanelCarga plan={conExtra} ocupado={false} onConfirmar={() => undefined} onCancelar={() => undefined} sucursal="DEPOSITO MARTINEZ" explicacion=""
      sinTildar onCantidad={() => undefined} onTabla={() => undefined} onDestino={() => undefined} onSku={() => undefined} onQuitarTalle={() => undefined} onQuitar={() => undefined} />);
    expect(h).toMatch(/aria-label="SKU de US 5"[^>]*value="RBK1100231713-5"|value="RBK1100231713-5"[^>]*aria-label="SKU de US 5"/);
    expect(h).toMatch(/\(nuevo SKU\)/);
    expect(h.match(/>Quitar<\/button>/g)).toHaveLength(1);
    expect(h).toMatch(/Sacar de la carga \(no llegó\)/);
    const sacado = renderToStaticMarkup(<PanelCarga plan={{ ...conExtra, quitados: [dis.items[0].codigo] } as PlanCarga} ocupado={false} onConfirmar={() => undefined} onCancelar={() => undefined}
      sucursal="DEPOSITO MARTINEZ" explicacion="" sinTildar onCantidad={() => undefined} onDestino={() => undefined} onQuitar={() => undefined} onMailSolo={() => undefined} />);
    expect(sacado).toMatch(/sacado de la carga: no llegó/);
    expect(sacado).toMatch(/Volver a agregarlo/);
    expect(sacado).toMatch(/Armar el mail de lo que no llegó/);
    expect(sacado).not.toMatch(/Talle que llegó/);
  });
  it('se puede agregar un talle que no está en el remito', () => {
    expect(html).toMatch(/＋ Agregar talle/);
  });
  it('un talle corrido muestra cómo se llama hoy y la lista de talles que se renombran (gax: «el SKU manténelo»)', () => {
    const corrido = {
      ...dis, items: [{
        ...dis.items[0], estado: 'listo', motivo: '', tabla: undefined,
        talles: [{ talle: 'US 11', cantidad: 2, original: 2, destino: '43', destinoManual: true, renombra: '44', sku: 'RBK110S232647-11' }],
        opciones: [{ clave: 'repo:1', etiqueta: 'Sumar', avisos: [], accion: {
          tipo: 'reposicion', productoId: 'gid://shopify/Product/1', titulo: 'Zapatillas Reebok Nano Classic', etiquetar: false,
          lineas: [{ talle: '43', inventoryItemId: 'gid://shopify/InventoryItem/1', actual: 1, suma: 2 }],
          renombrar: [{ id: 'v1', talle: '44', nuevo: '43', sku: 'RBK110S232647-11' }, { id: 'v3', talle: '46.5', nuevo: '45', sku: 'RBK110S232647-12.5' }],
        } }],
      }],
    } as unknown as PlanCarga;
    const h = renderToStaticMarkup(<PanelCarga plan={corrido} ocupado={false} onConfirmar={() => undefined} onCancelar={() => undefined} sucursal="DEPOSITO MARTINEZ" explicacion=""
      onCantidad={() => undefined} onTabla={() => undefined} onDestino={() => undefined} />);
    expect(h).toMatch(/\(hoy 44\)/);
    expect(h).toMatch(/1 → 3<\/td>/);
    expect(h).toMatch(/Talles que se renombran en Shopify \(mismo SKU y stock\): 44 → 43 \(RBK110S232647-11\) · 46.5 → 45 \(RBK110S232647-12.5\)/);
  });
});
