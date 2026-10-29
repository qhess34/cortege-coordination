// Itinéraire piéton vers un point de mission, par un serveur compatible OSRM (profil piéton) configuré par
// ROUTING_URL. Indicatif seulement : ni l'accessibilité ni la sécurité du trajet ne sont garanties.
import type { Position } from '../geo/route.js';

export interface WalkRoute { geometry: Position[]; distance: number; duration: number }
export type WalkRouter = (from: Position, to: Position) => Promise<WalkRoute>;

export class RoutingError extends Error {}

export function osrmRouter(baseUrl: string, userAgent: string, timeoutMs = 15_000): WalkRouter {
  const base = baseUrl.replace(/\/+$/, '');
  return async (from, to) => {
    const coords = from.map((v) => v.toFixed(6)).join(',') + ';' + to.map((v) => v.toFixed(6)).join(',');
    let res: Response;
    try {
      res = await fetch(base + '/route/v1/foot/' + coords + '?overview=full&geometries=geojson', {
        headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new RoutingError('Service d’itinéraire injoignable.');
    }
    if (!res.ok) throw new RoutingError('Service d’itinéraire indisponible (HTTP ' + res.status + ').');
    const json = (await res.json().catch(() => null)) as { code?: string; routes?: { geometry: { coordinates: Position[] }; distance: number; duration: number }[] } | null;
    const r = json?.code === 'Ok' ? json.routes?.[0] : undefined;
    if (!r) throw new RoutingError('Aucun itinéraire piéton trouvé.');
    return { geometry: r.geometry.coordinates, distance: r.distance, duration: r.duration };
  };
}
