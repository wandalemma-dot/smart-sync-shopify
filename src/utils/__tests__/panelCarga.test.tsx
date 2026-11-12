// Vista previa de la carga: en iD los artículos empiezan sin tildar (12-nov-2026, gax:
// «yo los voy seleccionando, así los voy controlando»). Family sigue con todo tildado.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelCarga } from '../../PanelCarga';
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
