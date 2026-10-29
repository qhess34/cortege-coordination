// Recherche de la photo Panoramax la plus proche d'un point (API STAC de Panoramax).
import { haversine } from '../../server/src/geo/route';
import type { Position } from './types';

export const PANORAMAX_API = (import.meta.env.VITE_PANORAMAX_URL as string | undefined) || 'https://api.panoramax.xyz/api';
/** Rayon de recherche autour du clic (m). */
export const SEARCH_RADIUS = 50;

export interface NearestPicture {
  id: string;
  sequence: string | null;
  position: Position;
  /** Distance entre le clic et la photo (m). */
  distance: number;
  datetime: string | null;
}

interface StacFeature {
  id: string;
  collection?: string;
  geometry?: { type: string; coordinates: number[] };
  properties?: { datetime?: string };
}

/** Choisit la photo la plus proche parmi les résultats d'une recherche STAC. */
export function nearestPicture(features: StacFeature[], at: Position, radius = SEARCH_RADIUS): NearestPicture | null {
  let best: NearestPicture | null = null;
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (f.geometry?.type !== 'Point' || !c || c.length < 2) continue;
    const position: Position = [c[0]!, c[1]!];
    const distance = haversine(at, position);
    if (distance > radius || (best && distance >= best.distance)) continue;
    best = { id: f.id, sequence: f.collection ?? null, position, distance, datetime: f.properties?.datetime ?? null };
  }
  return best;
}

/** Interroge Panoramax dans une emprise carrée de ±radius mètres autour du point. */
export async function findNearestPicture(at: Position, signal?: AbortSignal): Promise<NearestPicture | null> {
  const dLat = SEARCH_RADIUS / 111195;
  const dLon = dLat / Math.cos((at[1] * Math.PI) / 180);
  const bbox = [at[0] - dLon, at[1] - dLat, at[0] + dLon, at[1] + dLat].map((v) => v.toFixed(7)).join(',');
  const res = await fetch(PANORAMAX_API + '/search?bbox=' + bbox + '&limit=100', { signal });
  if (!res.ok) throw new Error('Panoramax a répondu ' + res.status + '.');
  const json = (await res.json()) as { features?: StacFeature[] };
  return nearestPicture(json.features ?? [], at);
}

export const exploreUrl = (picId: string) => 'https://explore.panoramax.fr/#focus=pic&pic=' + encodeURIComponent(picId);
