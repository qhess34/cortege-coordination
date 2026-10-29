// Nom d'un lieu à partir des voies OSM voisines : « Rue A » ou, à un croisement, « Rue A × Rue B ».
import type { OsmNode, OsmWay, OverpassResponse } from './osm-analysis.js';
import { haversine, projectOnSegment, type Position } from './route.js';

/** Distance maximale (m) pour attribuer le point à une rue. */
export const STREET_RADIUS = 30;
/** Distance maximale (m) entre le point et le nœud commun pour parler de croisement. */
export const CROSSING_RADIUS = 25;

const PATHS = new Set(['footway', 'cycleway', 'path', 'steps', 'bridleway', 'corridor']);

export interface PlaceName { name: string | null; streets: string[] }

/** Nom affiché d'une voie : `name`, sinon sa référence (D 906…). */
const label = (w: OsmWay) => w.tags?.name ?? w.tags?.ref ?? null;

export function placeName(osm: OverpassResponse, p: Position): PlaceName {
  const nodes = new Map<number, Position>();
  for (const e of osm.elements) if (e.type === 'node') nodes.set(e.id, [(e as OsmNode).lon, (e as OsmNode).lat]);
  const all = osm.elements.filter((e): e is OsmWay => e.type === 'way' && !!e.tags?.highway && !!label(e));
  const dist = (w: OsmWay) => {
    let best = Infinity;
    for (let i = 1; i < w.nodes.length; i++) {
      const a = nodes.get(w.nodes[i - 1]!);
      const b = nodes.get(w.nodes[i]!);
      if (a && b) best = Math.min(best, projectOnSegment(p, a, b).offset);
    }
    return best;
  };
  // Les chemins piétons ou cyclables (passerelles, allées) ne nomment le lieu qu'en l'absence de rue proche.
  const roads = all.filter((w) => !PATHS.has(w.tags!.highway!) && dist(w) <= STREET_RADIUS);
  const ways = roads.length ? roads : all;

  // Distance du point à chaque voie nommée, et rue la plus proche par nom.
  const byName = new Map<string, { distance: number; nodes: Set<number> }>();
  for (const w of ways) {
    const best = dist(w);
    const name = label(w)!;
    const cur = byName.get(name) ?? { distance: Infinity, nodes: new Set<number>() };
    cur.distance = Math.min(cur.distance, best);
    for (const n of w.nodes) cur.nodes.add(n);
    byName.set(name, cur);
  }
  const near = [...byName.entries()].filter(([, v]) => v.distance <= STREET_RADIUS).sort((a, b) => a[1].distance - b[1].distance);
  if (!near.length) return { name: null, streets: [] };

  // Croisement : une autre rue partage avec la plus proche un nœud situé près du point.
  const [first, info] = near[0]!;
  for (const [other, o] of near.slice(1)) {
    const shared = [...o.nodes].some((n) => info.nodes.has(n) && nodes.has(n) && haversine(p, nodes.get(n)!) <= CROSSING_RADIUS);
    if (shared) return { name: first + ' × ' + other, streets: [first, other] };
  }
  return { name: first, streets: [first] };
}

/** Requête Overpass : voies nommées autour du point. */
export function placeNameQuery(p: Position, radius = STREET_RADIUS + 10): string {
  return `[out:json][timeout:15];way(around:${radius},${p[1]},${p[0]})[highway][~"^(name|ref)$"~"."];(._;>;);out body;`;
}
