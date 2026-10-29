// Client Overpass. Une seule requête par analyse ; délai maximal ; identification du client.
import type { OverpassResponse } from '../geo/osm-analysis.js';

export type OsmFetcher = (query: string) => Promise<OverpassResponse>;

export function overpassFetcher(url: string, userAgent: string, timeoutMs = 120_000): OsmFetcher {
  return async (query) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': userAgent },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429 || res.status === 504) {
      throw new Error('Serveur Overpass saturé (HTTP ' + res.status + ') : réessayer dans quelques minutes.');
    }
    if (!res.ok) throw new Error('Erreur Overpass HTTP ' + res.status + '.');
    const json = (await res.json()) as OverpassResponse;
    if (!Array.isArray(json.elements)) throw new Error('Réponse Overpass inattendue.');
    return json;
  };
}
