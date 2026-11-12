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
