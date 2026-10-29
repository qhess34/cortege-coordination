// Lecture et validation d'un fichier GPX. Produit des segments GeoJSON et la liste des anomalies détectées.
import { DOMParser } from '@xmldom/xmldom';
import { gpx as gpxToGeoJson } from '@tmcw/togeojson';
import { Route, haversine, type Position } from './route.js';

export interface Waypoint {
  name: string | null;
  position: Position;
  /** Distance cumulée projetée sur le parcours (m), null si trop loin du tracé. */
  distance: number | null;
}

export interface ParsedGpx {
  name: string | null;
  segments: Position[][];
  waypoints: Waypoint[];
  length: number;
  closed: boolean;
  warnings: string[];
}

export class GpxError extends Error {}

/** Distance (m) sous laquelle départ et arrivée sont considérés comme confondus (boucle). */
const LOOP_TOLERANCE = 50;
/** Saut entre deux points consécutifs au-delà duquel on soupçonne une erreur GPS (m). */
const JUMP_WARNING = 300;
/** Écart entre deux segments au-delà duquel on les signale comme disjoints (m). */
const GAP_WARNING = 30;
const WAYPOINT_TOLERANCE = 100;

function validPosition(c: unknown): c is Position {
  return (
    Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' &&
    Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
    c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90
  );
}

export function parseGpx(xml: string): ParsedGpx {
  const errors: string[] = [];
  let doc;
  try {
    doc = new DOMParser({
      onError: (level: string, msg: string) => {
        if (level !== 'warning') errors.push(msg);
      },
    }).parseFromString(xml, 'application/xml');
  } catch (e) {
    throw new GpxError('Fichier XML invalide : ' + (e instanceof Error ? e.message : String(e)));
  }
  if (errors.length) throw new GpxError('Fichier XML invalide : ' + errors[0]);
  const root = doc.documentElement;
  if (!root || root.localName !== 'gpx') throw new GpxError("Le fichier n'est pas un GPX (élément racine <gpx> absent).");

  const fc = gpxToGeoJson(doc as unknown as Document);
  const warnings: string[] = [];
  const segments: Position[][] = [];
  const rawWaypoints: { name: string | null; position: Position }[] = [];
  let name: string | null = null;
  let invalid = 0;
  let duplicates = 0;

  const addLine = (coords: unknown[]) => {
    const seg: Position[] = [];
    for (const c of coords) {
      if (!validPosition(c)) { invalid++; continue; }
      const p: Position = [c[0], c[1]];
      const prev = seg[seg.length - 1];
      if (prev && prev[0] === p[0] && prev[1] === p[1]) { duplicates++; continue; }
      seg.push(p);
    }
    if (seg.length >= 2) segments.push(seg);
    else if (coords.length) warnings.push('Un segment de moins de deux points a été ignoré.');
  };

  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') addLine(g.coordinates);
    else if (g.type === 'MultiLineString') g.coordinates.forEach(addLine);
    else if (g.type === 'Point') {
      if (validPosition(g.coordinates)) {
        const n = f.properties?.name;
        rawWaypoints.push({ name: typeof n === 'string' ? n : null, position: [g.coordinates[0], g.coordinates[1]] });
      } else invalid++;
      continue;
    }
    if (!name && typeof f.properties?.name === 'string') name = f.properties.name;
  }

  if (!segments.length) throw new GpxError('Aucune trace exploitable (élément <trk> ou <rte> avec au moins deux points).');
  if (invalid) warnings.push(invalid + ' point(s) aux coordonnées invalides ont été ignorés.');
  if (duplicates) warnings.push(duplicates + ' point(s) dupliqués consécutifs ont été retirés.');

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    for (let i = 1; i < seg.length; i++) {
      const d = haversine(seg[i - 1]!, seg[i]!);
      if (d > JUMP_WARNING) {
        warnings.push(
          'Saut de ' + Math.round(d) + ' m entre deux points consécutifs (segment ' + (s + 1) + ', point ' + (i + 1) +
            ') : géométrie à vérifier.',
        );
      }
    }
    if (s > 0) {
      const prevSeg = segments[s - 1]!;
      const gap = haversine(prevSeg[prevSeg.length - 1]!, seg[0]!);
      if (gap > GAP_WARNING) {
        warnings.push(
          'Segments disjoints : ' + Math.round(gap) + ' m entre la fin du segment ' + s + ' et le début du segment ' +
            (s + 1) + '. La distance cumulée ne compte pas cet écart.',
        );
      }
    }
  }

  const route = new Route(segments);
  const first = segments[0]![0]!;
  const lastSeg = segments[segments.length - 1]!;
  const closed = haversine(first, lastSeg[lastSeg.length - 1]!) <= LOOP_TOLERANCE;

  const waypoints = rawWaypoints.map((w) => {
    const pr = route.locate(w.position);
    return { ...w, distance: pr && pr.offset <= WAYPOINT_TOLERANCE ? pr.distance : null };
  });
  const far = waypoints.filter((w) => w.distance === null).length;
  if (far) warnings.push(far + ' point(s) de passage sont à plus de ' + WAYPOINT_TOLERANCE + ' m du tracé.');

  return { name, segments, waypoints, length: route.length, closed, warnings };
}
