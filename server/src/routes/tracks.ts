// Import du parcours GPX. Un remplacement crée une nouvelle version, ne supprime aucun point, et doit être
// confirmé lorsqu'il éloigne des points ou des suggestions existants du nouveau tracé.
import type { FastifyInstance } from 'fastify';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import { tx, type Client } from '../db.js';
import { badRequest, conflict } from '../errors.js';
import { GpxError, parseGpx, type ParsedGpx } from '../geo/gpx.js';
import { Route, type Position } from '../geo/route.js';
import { requireEventRole } from '../permissions.js';

/** Un point à plus de cette distance du nouveau tracé est signalé (m). */
const IMPACT_OFFSET = 50;
/** Un point dont la distance cumulée change de plus que cela est signalé (m). */
const IMPACT_SHIFT = 100;

export interface ImpactItem {
  kind: 'point' | 'suggestion';
  id: number;
  name: string;
  missions: number;
  oldDistance: number | null;
  newDistance: number | null;
  offset: number | null;
  reason: string;
}

async function computeImpact(c: Client, eventId: number, route: Route): Promise<ImpactItem[]> {
  const rows = (
    await c.query(
      `SELECT 'point' AS kind, p.id, p.name, p.distance_m, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat,
              (SELECT count(*)::int FROM missions m WHERE m.mission_point_id = p.id AND m.cancelled_at IS NULL) AS missions
         FROM mission_points p WHERE p.event_id = $1 AND p.deleted_at IS NULL
       UNION ALL
       SELECT 'suggestion', s.id, coalesce(s.data->'routeNames'->>0, s.stable_key), s.distance_m, ST_X(s.geom), ST_Y(s.geom), 0
         FROM map_suggestions s WHERE s.event_id = $1 AND s.status = 'a_examiner'`,
      [eventId],
    )
  ).rows;
  const out: ImpactItem[] = [];
  for (const r of rows) {
    const pr = route.locate([r.lon, r.lat]);
    const offset = pr ? pr.offset : null;
    const newDistance = pr ? pr.distance : null;
    let reason: string | null = null;
    if (offset === null || offset > IMPACT_OFFSET) reason = 'À ' + Math.round(offset ?? 0) + ' m du nouveau tracé.';
    else if (r.distance_m !== null && newDistance !== null && Math.abs(newDistance - r.distance_m) > IMPACT_SHIFT) {
      reason = 'Distance cumulée modifiée de ' + Math.round(newDistance - r.distance_m) + ' m.';
    }
    if (reason) {
      out.push({ kind: r.kind, id: r.id, name: r.name, missions: r.missions, oldDistance: r.distance_m, newDistance, offset, reason });
    }
  }
  return out;
}

function summary(g: ParsedGpx) {
  return { name: g.name, length: g.length, closed: g.closed, segments: g.segments.length, waypoints: g.waypoints.length, warnings: g.warnings };
}

export async function trackRoutes(app: FastifyInstance) {
  app.post('/api/events/:id/tracks', async (req, reply) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'organisation');
    const q = req.query as Record<string, string | undefined>;
    const preview = q.preview === '1' || q.preview === 'true';
    const confirm = q.confirm === '1' || q.confirm === 'true';

    const file = await req.file();
    if (!file) throw badRequest('Fichier GPX manquant (champ « file »).');
    const buf = await file.toBuffer();
    const filename = (file.filename || 'parcours.gpx').slice(0, 200);
    let g: ParsedGpx;
    try {
      g = parseGpx(buf.toString('utf8'));
    } catch (e) {
      if (e instanceof GpxError) throw badRequest(e.message);
      throw e;
    }
    const route = new Route(g.segments);

    return tx(app.db, async (c) => {
      // Verrou sur l'événement : deux imports simultanés ne peuvent pas obtenir le même numéro de version.
      const ev = (await c.query('SELECT current_track_id FROM events WHERE id = $1 FOR UPDATE', [eventId])).rows[0];
      const impact = ev.current_track_id ? await computeImpact(c, eventId, route) : [];
      if (preview) return { preview: true, track: summary(g), impact };
      if (impact.length && !confirm) {
        throw conflict(
          'Le nouveau parcours éloigne ' + impact.length + ' point(s) ou suggestion(s) du tracé. Confirmez le remplacement : aucun point ne sera supprimé.',
          { track: summary(g), impact },
        );
      }
      const version = (await c.query('SELECT coalesce(max(version), 0) + 1 AS v FROM gpx_tracks WHERE event_id = $1', [eventId])).rows[0].v;
      const geom = { type: 'MultiLineString', coordinates: g.segments };
      const t = (
        await c.query(
          `INSERT INTO gpx_tracks(event_id, version, name, filename, geom, length_m, closed, warnings, created_by)
           VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6, $7, $8, $9) RETURNING id`,
          [eventId, version, g.name, filename, JSON.stringify(geom), g.length, g.closed, JSON.stringify(g.warnings), u.id],
        )
      ).rows[0];
      for (const w of g.waypoints) {
        await c.query('INSERT INTO route_points(track_id, name, geom, distance_m) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)', [
          t.id, w.name, w.position[0], w.position[1], w.distance,
        ]);
      }
      await c.query('UPDATE events SET current_track_id = $2, updated_at = now() WHERE id = $1', [eventId, t.id]);

      // Recalcul des distances cumulées sur le nouveau tracé (sauf distances fixées à la main). Rien n'est supprimé.
      const pts = (await c.query('SELECT id, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM mission_points WHERE event_id = $1 AND deleted_at IS NULL AND NOT distance_locked', [eventId])).rows;
      for (const p of pts) {
        await c.query('UPDATE mission_points SET distance_m = $2 WHERE id = $1', [p.id, route.locate([p.lon, p.lat] as Position)?.distance ?? null]);
      }
      const sugg = (await c.query('SELECT id, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM map_suggestions WHERE event_id = $1', [eventId])).rows;
      for (const s of sugg) {
        await c.query('UPDATE map_suggestions SET distance_m = $2 WHERE id = $1', [s.id, route.locate([s.lon, s.lat] as Position)?.distance ?? null]);
      }
      await audit(c, {
        actorId: u.id, eventId, entity: 'gpx_track', entityId: t.id, action: ev.current_track_id ? 'remplacement' : 'import',
        details: { version, filename, length: Math.round(g.length), previousTrackId: ev.current_track_id, impacted: impact.map((i) => [i.kind, i.id]) },
      });
      return reply.status(201).send({ id: t.id, version, track: summary(g), impact });
    });
  });

  app.get('/api/events/:id/track', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const r = await app.db.query(
      `SELECT t.id, t.version, t.name, t.filename, t.length_m, t.closed, t.warnings, t.created_at, ST_AsGeoJSON(t.geom)::json AS geom
         FROM events e JOIN gpx_tracks t ON t.id = e.current_track_id WHERE e.id = $1`,
      [eventId],
    );
    const t = r.rows[0];
    if (!t) return { track: null };
    const wp = await app.db.query('SELECT id, name, ST_X(geom) AS lon, ST_Y(geom) AS lat, distance_m FROM route_points WHERE track_id = $1 ORDER BY distance_m NULLS LAST', [t.id]);
    return {
      track: {
        id: t.id, version: t.version, name: t.name, filename: t.filename, length: t.length_m, closed: t.closed,
        warnings: t.warnings, createdAt: t.created_at, geometry: t.geom,
      },
      waypoints: wp.rows.map((w) => ({ id: w.id, name: w.name, position: [w.lon, w.lat], distance: w.distance_m })),
    };
  });

  app.get('/api/events/:id/tracks', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const r = await app.db.query(
      'SELECT id, version, name, filename, length_m, closed, created_at FROM gpx_tracks WHERE event_id = $1 ORDER BY version DESC',
      [eventId],
    );
    return r.rows.map((t) => ({ id: t.id, version: t.version, name: t.name, filename: t.filename, length: t.length_m, closed: t.closed, createdAt: t.created_at }));
  });
}
