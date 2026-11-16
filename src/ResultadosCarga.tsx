// RESULTADO DE LA CARGA EN SHOPIFY, ORDENADO (16-nov-2026, gax: «que quede visualmente más ordenado,
// que se vean las unidades que realmente se cargaron y se pasaron de sucursal»).
// Una fila por artículo: lo que Shopify confirmó por talle, las ventas de iD que quedaron en Martínez,
// el precio y el costo que se cambiaron. Lo que no salió bien va debajo de su fila.
import { Fragment } from 'react';
import type { ResultadoCarga, TalleSumado } from './utils/cargaFamily';
import { pesos } from './utils/avisoPrecio';

const ESTADO: Record<ResultadoCarga['estado'], { texto: string; color: string }> = {
  cargada: { texto: 'Cargado', color: '#4ade80' },
  parcial: { texto: 'En parte', color: '#fbbf24' },
  dudosa: { texto: 'Revisar', color: '#fbbf24' },
  error: { texto: 'No se cargó', color: '#f87171' },
  saltado: { texto: 'Ya estaba', color: '#94a3b8' },
};

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, fontSize: '0.78rem', opacity: 0.75, borderBottom: '1px solid rgba(255,255,255,0.15)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 8px', verticalAlign: 'top', borderTop: '1px solid rgba(255,255,255,0.07)' };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 };

/** «L 0 → 3», «XL alta», «45 nuevo». */
function textoTalle(t: TalleSumado): string {
  if (t.antes !== null) return `${t.antes} → ${t.antes + t.suma}`;
  return t.nuevo ? 'talle nuevo' : 'alta en la sucursal';
}

export function unidadesSumadas(rs: ResultadoCarga[]): number {
  return rs.reduce((s, r) => s + (r.detalle?.sumados ?? []).reduce((a, t) => a + t.suma, 0), 0);
}
export function unidadesPasadas(rs: ResultadoCarga[]): number {
  return rs.reduce((s, r) => s + (r.detalle?.pasadas ?? []).reduce((a, v) => a + v.cantidad, 0), 0);
}

export function ResultadosCarga({ resultados, sucursal, conVentas, onCerrar }: {
  resultados: ResultadoCarga[]; sucursal: string; conVentas: boolean; onCerrar: () => void;
}) {
  const sumadas = unidadesSumadas(resultados);
  const pasadas = unidadesPasadas(resultados);
  const ventas = resultados.reduce((s, r) => s + (r.detalle?.pasadas.length ?? 0), 0);
  const conProblema = resultados.filter((r) => r.estado !== 'cargada').length;
  const mostrarVentas = conVentas || pasadas > 0;
  const columnas = mostrarVentas ? 6 : 5;
  return (
    <div style={{ margin: '6px 0 14px', padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, fontSize: '0.98rem' }}>Carga en Shopify terminada</div>
          <div style={{ fontSize: '0.86rem', marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span><b style={{ fontSize: '1.05rem' }}>{sumadas}</b> u. sumadas en {sucursal}</span>
            {mostrarVentas && <span><b style={{ fontSize: '1.05rem' }}>{pasadas}</b> u. de {ventas} venta{ventas === 1 ? '' : 's'} pasada{ventas === 1 ? '' : 's'} de iD a {sucursal}</span>}
            <span>{resultados.length} artículo{resultados.length === 1 ? '' : 's'}{conProblema ? <span style={{ color: '#fbbf24' }}> · {conProblema} para revisar</span> : ''}</span>
          </div>
        </div>
        <button onClick={onCerrar} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: 'inherit', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontSize: '0.8rem' }}>cerrar</button>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', minWidth: 640 }}>
          <thead>
            <tr>
              <th style={th}>Artículo</th>
              <th style={th}>Cargado en {sucursal}</th>
              <th style={{ ...th, textAlign: 'right' }}>U.</th>
              {mostrarVentas && <th style={th}>Ventas de iD pasadas</th>}
              <th style={th}>Precio y costo</th>
              <th style={th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {resultados.map((r, i) => {
              const d = r.detalle;
              const e = ESTADO[r.estado];
              const u = (d?.sumados ?? []).reduce((a, t) => a + t.suma, 0);
              const notas = d ? d.notas.filter(Boolean) : [r.mensaje];
              return (
                <Fragment key={`${r.codigo}-${i}`}>
                  <tr>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{r.codigo}</div>
                      {d?.titulo && <div style={{ fontSize: '0.78rem', opacity: 0.7 }}>{d.titulo}</div>}
                    </td>
                    <td style={td}>
                      {d?.sumados.length ? d.sumados.map((t, k) => (
                        <div key={k} style={{ whiteSpace: 'nowrap' }}>
                          <b style={{ display: 'inline-block', minWidth: 34 }}>{t.talle}</b>
                          <span style={{ color: '#4ade80', fontWeight: 600 }}>+{t.suma}</span>
                          <span style={{ opacity: 0.6, fontSize: '0.78rem' }}> ({textoTalle(t)})</span>
                        </div>
                      )) : <span style={{ opacity: 0.5 }}>—</span>}
                    </td>
                    <td style={num}>{u || <span style={{ opacity: 0.5 }}>0</span>}</td>
                    {mostrarVentas && <td style={td}>
                      {d?.pasadas.length ? d.pasadas.map((v, k) => (
                        <div key={k} style={{ whiteSpace: 'nowrap' }}>
                          <b style={{ display: 'inline-block', minWidth: 34 }}>{v.talle}</b>×{v.cantidad} <span style={{ opacity: 0.75 }}>{v.orden}</span>
                        </div>
                      )) : <span style={{ opacity: 0.5 }}>—</span>}
                    </td>}
                    <td style={td}>
                      {d?.precio && <div>Precio {d.precio.antes !== null ? <>{pesos(d.precio.antes)} → </> : null}<b>{pesos(d.precio.nuevo)}</b></div>}
                      {d?.costos.map((c, k) => <div key={k} style={{ opacity: 0.85 }}>Costo {c}</div>)}
                      {!d?.precio && !d?.costos.length && <span style={{ opacity: 0.5 }}>sin cambios</span>}
                    </td>
                    <td style={{ ...td, color: e.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{e.texto}</td>
                  </tr>
                  {notas.length > 0 && <tr>
                    <td colSpan={columnas} style={{ padding: '0 8px 8px 20px', fontSize: '0.78rem', color: r.estado === 'cargada' ? 'rgba(255,255,255,0.65)' : e.color }}>
                      {notas.map((n, k) => <div key={k}>{n}</div>)}
                    </td>
                  </tr>}
                </Fragment>
              );
            })}
            <tr>
              <td style={{ ...td, fontWeight: 700, borderTop: '1px solid rgba(255,255,255,0.2)' }}>Total</td>
              <td style={{ ...td, borderTop: '1px solid rgba(255,255,255,0.2)' }} />
              <td style={{ ...num, borderTop: '1px solid rgba(255,255,255,0.2)' }}>{sumadas}</td>
              {mostrarVentas && <td style={{ ...td, fontWeight: 700, borderTop: '1px solid rgba(255,255,255,0.2)' }}>{pasadas} u.</td>}
              <td colSpan={2} style={{ ...td, borderTop: '1px solid rgba(255,255,255,0.2)' }} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
