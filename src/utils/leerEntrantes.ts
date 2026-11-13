// Lee lo que está por entrar de iD (notas de las listas de pendientes de Trello).
// Lo usan «Armado de pedido iD» y «Reposición» (13-nov-2026, gax). SOLO LECTURA de Trello;
// solo actualiza en la base dónde está cada tarjeta, como al abrir Control de entregas.
import { entrantesPorTalle, excelSinLeer, type DatosEntrantes, type Entrante } from './entrantesId';
import { estadosTarjetas, listasDePendientes, type EstadoTarjeta, type ListaTrello } from './listasTrello';
import { apiControl } from './entregasUi';

/** Fecha de hoy en Argentina. */
const hoyAr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
interface TarjetaTrello { id: string; nombre: string; idLista?: string; lista?: string; adjuntos: { id: string }[] }
export interface Entrantes { mapa: Map<string, Entrante>; notas: number; avisos: string[] }

/**
 * Lo que ya está pedido a iD y no llegó, según las notas de las listas de pendientes de Trello
 * (13-nov-2026, gax). Lee la base de Control de entregas y, si puede, dónde está hoy cada tarjeta.
 * Nunca corta el armado: si algo falla, avisa.
 */
export async function leerEntrantes(): Promise<Entrantes> {
  const avisos: string[] = [];
  const d = await apiControl(undefined, 'id') as Partial<DatosEntrantes> & { listasTrello?: string[]; trelloVistos?: Record<string, unknown> };
  const datos: DatosEntrantes = {
    pedidos: d.pedidos || [], facturas: d.facturas || [], asignaciones: d.asignaciones || {}, remitos: d.remitos || {}, tarjetasTrello: d.tarjetasTrello || {},
  };
  try {
    const r = await fetch('/api/trello?accion=tarjetas', { cache: 'no-store' });
    const t = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(t.sinTrello ? 'Trello no está conectado' : t.error || `Error ${r.status}`);
    const tarjetas = (t.tarjetas || []) as TarjetaTrello[];
    const deLista = listasDePendientes((t.listas || []) as ListaTrello[], d.listasTrello || []);
    if (!deLista.length) throw new Error('no encontré las listas de pedidos pendientes');
    const pendientes = new Set(deLista.map((l) => l.id));
    const cambios: Record<string, EstadoTarjeta> = estadosTarjetas(datos.pedidos, tarjetas, pendientes, datos.tarjetasTrello, hoyAr());
    datos.tarjetasTrello = { ...datos.tarjetasTrello, ...cambios };
    if (Object.keys(cambios).length) apiControl({ proveedor: 'id', accion: 'guardarTarjetas', tarjetas: cambios }).catch(() => undefined);
    const sinLeer = excelSinLeer(tarjetas, pendientes, datos.pedidos, d.trelloVistos || {});
    if (sinLeer.length) avisos.push(`Hay Excel en Trello que la app todavía no leyó (${sinLeer.map((x) => `«${x.tarjeta}»`).join(', ')}): lo que tengan no se ve en «Entrantes». Abrí «Carga y control de entregas» → iD → «Buscar notas nuevas en Trello» y volvé a consultar.`);
  } catch (e) {
    avisos.push(`Trello: ${(e as Error)?.message || 'no respondió'}. «Entrantes» usa las notas ya cargadas, con las listas tal como estaban la última vez.`);
  }
  const mapa = entrantesPorTalle(datos, hoyAr());
  const notas = new Set([...mapa.values()].flatMap((e) => e.notas.map((n) => n.pedidoId))).size;
  return { mapa, notas, avisos };
}

