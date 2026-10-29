// Construction de petits réseaux OSM synthétiques en mètres autour d'une origine (Paris).
import type { OsmElement, OverpassResponse, Tags } from '../../src/geo/osm-analysis.js';
import type { Position } from '../../src/geo/route.js';

export const ORIGIN: Position = [2.35, 48.85];
const M_PER_DEG_LAT = 111194.9;

/** Position à x mètres à l'est et y mètres au nord de l'origine. */
export function at(x: number, y: number): Position {
  const lat = ORIGIN[1] + y / M_PER_DEG_LAT;
  const lon = ORIGIN[0] + x / (M_PER_DEG_LAT * Math.cos((ORIGIN[1] * Math.PI) / 180));
  return [lon, lat];
}

export class OsmBuilder {
  private elements: OsmElement[] = [];
  private nextId = 1000;

  node(id: number, x: number, y: number, tags?: Tags): number {
    const [lon, lat] = at(x, y);
    this.elements.push({ type: 'node', id, lat, lon, tags });
    return id;
  }

  way(id: number, nodes: number[], tags: Tags): number {
    this.elements.push({ type: 'way', id, nodes, tags });
    return id;
  }

  restriction(via: number, from: number, to: number, restriction: string): number {
    const id = this.nextId++;
    this.elements.push({
      type: 'relation',
      id,
      members: [
        { type: 'way', ref: from, role: 'from' },
        { type: 'node', ref: via, role: 'via' },
        { type: 'way', ref: to, role: 'to' },
      ],
      tags: { type: 'restriction', restriction },
    });
    return id;
  }

  build(): OverpassResponse {
    return { osm3s: { timestamp_osm_base: '2026-10-01T00:00:00Z' }, elements: this.elements };
  }
}

/** GPX minimal à partir de positions en mètres. */
export function gpxFrom(points: [number, number][][], name = 'Parcours test', waypoints: { name: string; x: number; y: number }[] = []): string {
  const trk = points
    .map((seg) => '<trkseg>' + seg.map(([x, y]) => {
      const [lon, lat] = at(x, y);
      return '<trkpt lat="' + lat.toFixed(7) + '" lon="' + lon.toFixed(7) + '"/>';
    }).join('') + '</trkseg>')
    .join('');
  const wpt = waypoints.map((w) => {
    const [lon, lat] = at(w.x, w.y);
    return '<wpt lat="' + lat.toFixed(7) + '" lon="' + lon.toFixed(7) + '"><name>' + w.name + '</name></wpt>';
  }).join('');
  return '<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">' + wpt +
    '<trk><name>' + name + '</name>' + trk + '</trk></gpx>';
}

/**
 * Réseau de référence : le parcours suit la rue A d'ouest en est sur 500 m.
 *  x=50  : sentier piéton (way 7)                         → acces_pieton_cycle
 *  x=100 : rue B traversante, double sens, + restriction  → carrefour
 *  x=200 : rue C, sens unique s'éloignant du parcours     → rue_laterale
 *  x=250 : voie 6 croisant sans nœud commun, sans pont    → verification
 *  x=300 : rue D, sens unique arrivant sur le parcours    → acces_vehicule_entrant
 *  x=350 : avenue 5 sur un pont (sans nœud commun)        → ignorée (croisement dénivelé)
 *  x=450 : voie de service privée                         → voie_privee
 */
export function referenceNetwork(): OverpassResponse {
  const b = new OsmBuilder();
  const xs = [0, 50, 100, 200, 300, 400, 450, 500];
  xs.forEach((x, i) => b.node(i + 1, x, 0)); // nœuds 1..8 de la rue A
  b.way(1, [1, 2, 3, 4, 5, 6, 7, 8], { highway: 'residential', name: 'Rue A' });
  b.node(20, 100, -100); b.node(21, 100, 100);
  b.way(2, [20, 3, 21], { highway: 'residential', name: 'Rue B' });
  b.restriction(3, 2, 1, 'no_left_turn');
  b.node(30, 200, 120);
  b.way(3, [4, 30], { highway: 'residential', name: 'Rue C', oneway: 'yes' });
  b.node(40, 300, 120);
  b.way(4, [40, 5], { highway: 'residential', name: 'Rue D', oneway: 'yes' });
  b.node(50, 350, -100); b.node(51, 350, 100);
  b.way(5, [50, 51], { highway: 'primary', name: 'Avenue du Pont', bridge: 'yes', layer: '1' });
  b.node(60, 250, -80); b.node(61, 250, 80);
  b.way(6, [60, 61], { highway: 'unclassified' });
  b.node(70, 50, -60);
  b.way(7, [2, 70], { highway: 'footway' });
  b.node(80, 450, 80);
  b.way(8, [7, 80], { highway: 'service', access: 'private' });
  return b.build();
}
