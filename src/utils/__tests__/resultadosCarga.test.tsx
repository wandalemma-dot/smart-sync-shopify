// Resultado de la carga ordenado (16-nov-2026, gax: «que se vean las unidades que realmente se cargaron
// y se pasaron de sucursal»).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultadosCarga, unidadesPasadas, unidadesSumadas } from '../../ResultadosCarga';
import type { ResultadoCarga } from '../cargaFamily';

const resultados: ResultadoCarga[] = [
  {
    codigo: '2120201', estado: 'cargada', mensaje: '…',
    detalle: {
      titulo: 'Remera Le Coq Sportif Ess Tee', costos: ['$ 9.577,54 en L, XXL'],
      sumados: [{ talle: 'L', antes: 0, suma: 3 }, { talle: 'XL', antes: 1, suma: 3 }, { talle: 'XXL', antes: null, suma: 1 }],
      pasadas: [{ talle: 'L', cantidad: 1, orden: '#211326' }, { talle: 'XXL', cantidad: 1, orden: '#210754' }],
      notas: [],
    },
  },
  {
    codigo: '2510667', estado: 'cargada', mensaje: '…',
    detalle: { titulo: 'Short Pumas', sumados: [{ talle: 'XL', antes: null, suma: 1 }], precio: { antes: 49900, nuevo: 54900 }, costos: [], pasadas: [], notas: [] },
  },
  { codigo: 'LTO0225214', estado: 'error', mensaje: 'Shopify no sumó el stock.', detalle: { titulo: 'Buzo', sumados: [], costos: [], pasadas: [], notas: ['Shopify no sumó el stock.'] } },
];

describe('Resultado de la carga', () => {
  it('cuenta solo lo que Shopify confirmó: unidades sumadas y ventas pasadas', () => {
    expect(unidadesSumadas(resultados)).toBe(8);
    expect(unidadesPasadas(resultados)).toBe(2);
  });
  it('muestra cada talle con lo que se sumó, las ventas pasadas, el precio y lo que falló', () => {
    const html = renderToStaticMarkup(<ResultadosCarga resultados={resultados} sucursal="DEPOSITO MARTINEZ" conVentas onCerrar={() => undefined} />);
    expect(html).toMatch(/<b[^>]*>8<\/b> u\. sumadas en DEPOSITO MARTINEZ/);
    expect(html).toMatch(/<b[^>]*>2<\/b> u\. de 2 ventas pasadas de iD/);
    expect(html).toMatch(/\+3.*0 → 3/);
    expect(html).toContain('alta en la sucursal');
    expect(html).toContain('#211326');
    expect(html).toMatch(/\$ 49\.900.*\$ 54\.900/);
    expect(html).toContain('Shopify no sumó el stock.');
    expect(html).toContain('1 para revisar');
  });
  it('sin ventas de iD (Family) no muestra esa columna', () => {
    const html = renderToStaticMarkup(<ResultadosCarga resultados={[resultados[1]]} sucursal="FAMILY" conVentas={false} onCerrar={() => undefined} />);
    expect(html).not.toContain('Ventas de iD pasadas');
  });
});
