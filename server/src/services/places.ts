// Lieux : regroupement des points d'un même carrefour. Un lieu de carrefour est créé à la validation de son premier
// accès ; les points proches se regroupent à la main (jamais d'office). Un lieu vide est supprimé.
import type { Client } from '../db.js';
import type { Position } from '../geo/route.js';

/** Nom d'un lieu à partir du nom d'un de ses points : sans la précision « (accès nord) ». */
export const placeBaseName = (pointName: string) => pointName.replace(/ \(accès [^)]*\)$/, '').slice(0, 200) || pointName.slice(0, 200);

/** Lieu du carrefour OSM `node` (créé au besoin) ; renvoie son identifiant. */
export async function junctionPlace(c: Client, eventId: number, node: number, name: string, center: Position): Promise<number> {
  const r = await c.query(
    `INSERT INTO places(event_id, name, osm_node, geom) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
     ON CONFLICT (event_id, osm_node) DO UPDATE SET osm_node = EXCLUDED.osm_node RETURNING id`,
    [eventId, name.slice(0, 200), node, center[0], center[1]],
  );
  return r.rows[0].id;
}

/** Lieux regroupés à la main : centre recalculé (barycentre des points) ; lieux sans point supprimés. */
export async function tidyPlaces(c: Client, eventId: number): Promise<void> {
  await c.query(
    `DELETE FROM places pl WHERE pl.event_id = $1
        AND NOT EXISTS (SELECT 1 FROM mission_points p WHERE p.place_id = pl.id AND p.deleted_at IS NULL)`,
    [eventId],
  );
  await c.query(
    `UPDATE places pl SET geom = c.center
       FROM (SELECT place_id, ST_Centroid(ST_Collect(geom)) AS center FROM mission_points
              WHERE deleted_at IS NULL AND place_id IS NOT NULL GROUP BY place_id) c
      WHERE c.place_id = pl.id AND pl.event_id = $1 AND pl.osm_node IS NULL`,
    [eventId],
  );
}
