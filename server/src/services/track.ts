import { Route, type Position } from '../geo/route.js';
import type { Client } from '../db.js';

export interface CurrentTrack { id: number; version: number; route: Route }

/** Parcours actuel de l'événement, ou null s'il n'a pas encore été importé. */
export async function currentTrack(c: Client, eventId: number): Promise<CurrentTrack | null> {
  const r = await c.query(
    `SELECT t.id, t.version, ST_AsGeoJSON(t.geom)::json AS geom
       FROM events e JOIN gpx_tracks t ON t.id = e.current_track_id WHERE e.id = $1`,
    [eventId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, version: row.version, route: new Route(row.geom.coordinates as Position[][]) };
}
