// Separar por colores lo ya cargado: todos los artículos abiertos a la vez (24-nov-2026, gax: «lo mejor es desplegar todos
// los productos… es muy tedioso cerrar uno, después abrir otro, cerrar otro»).
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SepararColores } from '../../SepararColores';

const articulos = ['15182', '15183', '15184'].map((codigo) => ({ codigo, descripcion: 'Riñonera Camping Alpine Skate' }));

describe('separar colores: todos abiertos', () => {
  it('cerrado: solo el título, sin leer Shopify', () => {
    const gql = vi.fn();
    const html = renderToStaticMarkup(<SepararColores articulos={articulos} gql={gql} />);
    expect(html).toMatch(/Algo vino en varios colores/);
    expect(html).not.toMatch(/15182/);
    expect(gql).not.toHaveBeenCalled();
  });
  it('abierto: muestra todos los artículos juntos y un solo botón para separar todos', () => {
    const html = renderToStaticMarkup(<SepararColores articulos={articulos} gql={vi.fn()} abiertoInicial />);
    for (const a of articulos) expect(html).toContain(`🎨 ${a.codigo}`);
    expect(html).not.toMatch(/>Cerrar</);
    expect(html).toMatch(/Están todos los artículos abiertos/);
    expect(html).toMatch(/Separar por colores los 0 completos/);
  });
  it('sin artículos no muestra nada', () => {
    expect(renderToStaticMarkup(<SepararColores articulos={[]} gql={vi.fn()} abiertoInicial />)).toBe('');
  });
});
