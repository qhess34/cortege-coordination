// Enregistrement non destructif d'une analyse OSM : on ajoute, on signale, on ne supprime ni ne réinitialise rien.
import type { PoolClient } from 'pg';
import type { Suggestion } from '../geo/osm-analysis.js';
import { haversine, type Position } from '../geo/route.js';

/** Rayon (m) pour reconnaître une suggestion dont le nœud OSM a changé d'identifiant. */
const MATCH_RADIUS = 15;
/** Rayon (m) pour signaler un doublon possible avec un point opérationnel existant. */
const DUPLICATE_RADIUS = 20;

export interface MergeReport {
  added: { id: number; stableKey: string; type: string; duplicateOfPoint: { id: number; name: string } | null }[];
  alreadyPresent: { id: number; stableKey: string; status: string }[];
  /** Suggestions connues dont les données OSM ont changé : présentées séparément, non appliquées. */
  modified: { id: number; stableKey: string; status: string; changes: string[] }[];
  ignoredDismissed: { id: number; stableKey: string }[];
  /** Suggestions connues absentes de cette analyse (conservées). */
  missing: { id: number; stableKey: string; status: string; hasPoint: boolean }[];
}

interface Existing {
  id: number;
  stable_key: string;
  status: string;
  type: string;
  lon: number;
  lat: number;
  data: Suggestion;
  has_point: boolean;
}

const wayIds = (s: Suggestion) => new Set(s.branches.map((b) => b.wayId));

function differences(before: Suggestion, after: Suggestion): string[] {
  const out: string[] = [];
  if (before.type !== after.type) out.push('Type : ' + before.type + ' → ' + after.type + '.');
  const b = before.branches.map((x) => x.wayId + ':' + x.flow + ':' + x.motor).sort().join(',');
  const a = after.branches.map((x) => x.wayId + ':' + x.flow + ':' + x.motor).sort().join(',');
  if (a !== b) out.push('Voies raccordées, sens ou accès modifiés dans OSM.');
  if (haversine(before.position, after.position) > 5) out.push('Position déplacée de ' + Math.round(haversine(before.position, after.position)) + ' m.');
  return out;
}

export async function mergeSuggestions(c: PoolClient, eventId: number, analysisId: number, found: Suggestion[]): Promise<MergeReport> {
  const report: MergeReport = { added: [], alreadyPresent: [], modified: [], ignoredDismissed: [], missing: [] };
  const existing = (
    await c.query<Existing>(
      `SELECT s.id, s.stable_key, s.status, s.type, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, s.data,
              EXISTS (SELECT 1 FROM mission_points p WHERE p.suggestion_id = s.id AND p.deleted_at IS NULL) AS has_point
         FROM map_suggestions s WHERE s.event_id = $1 FOR UPDATE`,
      [eventId],
    )
  ).rows;
  const byKey = new Map(existing.map((e) => [e.stable_key, e]));
  const points = (
    await c.query('SELECT id, name, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM mission_points WHERE event_id = $1 AND deleted_at IS NULL', [eventId])
  ).rows as { id: number; name: string; lon: number; lat: number }[];
  const seen = new Set<number>();
  const keysThisRun = new Set<string>();

  for (const s of found) {
    if (keysThisRun.has(s.stableKey)) continue;
    keysThisRun.add(s.stableKey);
    // 1. Même clé stable ; 2. à défaut, même voie raccordée à proximité (nœud OSM renuméroté).
    let match = byKey.get(s.stableKey);
    if (!match) {
      const ways = wayIds(s);
      match = existing.find(
        (e) => !seen.has(e.id) && haversine([e.lon, e.lat], s.position) <= MATCH_RADIUS && e.data.branches.some((b) => ways.has(b.wayId)),
      );
    }
    if (match) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      await c.query('UPDATE map_suggestions SET last_seen_analysis_id = $2 WHERE id = $1', [match.id, analysisId]);
      if (match.status === 'ecartee') {
        report.ignoredDismissed.push({ id: match.id, stableKey: match.stable_key });
        continue;
      }
      const changes = differences(match.data, s);
      if (changes.length) {
        await c.query('UPDATE map_suggestions SET pending_data = $2 WHERE id = $1', [match.id, JSON.stringify(s)]);
        report.modified.push({ id: match.id, stableKey: match.stable_key, status: match.status, changes });
      } else {
        report.alreadyPresent.push({ id: match.id, stableKey: match.stable_key, status: match.status });
      }
      continue;
    }
    const dup = points.find((p) => haversine([p.lon, p.lat], s.position as Position) <= DUPLICATE_RADIUS) ?? null;
    const r = await c.query(
      `INSERT INTO map_suggestions(event_id, stable_key, type, pertinence, geom, distance_m, data, first_analysis_id, last_seen_analysis_id)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, $9) RETURNING id`,
      [eventId, s.stableKey, s.type, s.pertinence, s.position[0], s.position[1], s.distance, JSON.stringify(s), analysisId],
    );
    report.added.push({ id: r.rows[0].id, stableKey: s.stableKey, type: s.type, duplicateOfPoint: dup ? { id: dup.id, name: dup.name } : null });
  }

  for (const e of existing) {
    if (!seen.has(e.id) && e.status !== 'ecartee') {
      report.missing.push({ id: e.id, stableKey: e.stable_key, status: e.status, hasPoint: e.has_point });
    }
  }
  return report;
}
