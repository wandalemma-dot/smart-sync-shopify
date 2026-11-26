// Reef (26-nov-2026): la solapa usa la misma pantalla que Ullua, con la lista de precios arriba.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ControlFamily from '../../ControlFamily';

describe('pantalla de Reef', () => {
  it('pide la lista de precios y el remito; sin textos de IVA ni factura', () => {
    const html = renderToStaticMarkup(<ControlFamily prov="reef" />);
    expect(html).toMatch(/Nueva entrega de Reef/);
    expect(html).toMatch(/Lista de precios: todavía no está cargada/);
    expect(html).toMatch(/Subir lista de precios \(Excel\)/);
    expect(html).toMatch(/Remito \(foto o PDF\)/);
    expect(html).toMatch(/PMV − 15%/);
    expect(html).not.toMatch(/1,21|o factura/);
  });
  it('Ullua sigue igual', () => {
    const html = renderToStaticMarkup(<ControlFamily prov="ullua" />);
    expect(html).toMatch(/Remito o factura \(foto o PDF\)/);
    expect(html).not.toMatch(/Lista de precios/);
  });
});
