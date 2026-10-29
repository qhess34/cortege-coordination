// Roadbook : données de la manifestation (ou d'une équipe) mises en forme pour l'impression, et export GPX.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import type { Client } from '../db.js';
import { notFound } from '../errors.js';
import type { Suggestion } from '../geo/osm-analysis.js';
import { requireEventRole } from '../permissions.js';

const Query = z.object({ team: z.coerce.number().int().positive().optional() });

interface RoadbookPoint {
  id: number;
  name: string;
  type: string;
  description: string;
  origin: string;
  position: [number, number];
  distance: number | null;
  /** Éléments OSM utiles sur le terrain, pour un point issu d'une suggestion. */
  osm: { routeNames: string[]; branches: { name: string | null; highway: string; flow: string; motor: string }[]; uncertainties: string[] } | null;
}

const pointSelect = `
  SELECT p.id, p.name, p.type, p.description, p.origin, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.distance_m, s.data AS osm
    FROM mission_points p LEFT JOIN map_suggestions s ON s.id = p.suggestion_id`;

function toPoint(r: Record<string, unknown>): RoadbookPoint {
  const d = r.osm as Suggestion | null;
  return {
    id: r.id as number, name: r.name as string, type: r.type as string, description: r.description as string, origin: r.origin as string,
    position: [r.lon as number, r.lat as number], distance: r.distance_m as number | null,
    osm: d ? {
      routeNames: d.routeNames,
      branches: d.branches.map((b) => ({ name: b.name, highway: b.highway, flow: b.flow, motor: b.motor })),
      uncertainties: d.uncertainties,
    } : null,
  };
}

export async function loadRoadbook(c: Client, eventId: number, teamId?: number) {
  const ev = (await c.query('SELECT * FROM events WHERE id = $1', [eventId])).rows[0];
  const track = (
    await c.query(
      `SELECT t.id, t.version, t.name, t.length_m, t.closed, ST_AsGeoJSON(t.geom)::json AS geom
         FROM events e JOIN gpx_tracks t ON t.id = e.current_track_id WHERE e.id = $1`,
      [eventId],
    )
  ).rows[0];
  const waypoints = track
    ? (await c.query('SELECT name, ST_X(geom) AS lon, ST_Y(geom) AS lat, distance_m FROM route_points WHERE track_id = $1 ORDER BY distance_m NULLS LAST', [track.id])).rows
    : [];
  const teamRows = (
    await c.query(
      `SELECT t.*, u.display_name AS leader_name FROM teams t LEFT JOIN users u ON u.id = t.leader_user_id
        WHERE t.event_id = $1 AND t.disabled_at IS NULL AND ($2::bigint IS NULL OR t.id = $2) ORDER BY t.name`,
      [eventId, teamId ?? null],
    )
  ).rows;
  if (teamId && !teamRows.length) throw notFound('Équipe');
  const teams = [];
  for (const t of teamRows) {
    const missions = (
      await c.query(
        `SELECT m.position, m.status, m.instructions, x.* FROM missions m
           JOIN (${pointSelect}) x ON x.id = m.mission_point_id
          WHERE m.team_id = $1 AND m.cancelled_at IS NULL ORDER BY m.position`,
        [t.id],
      )
    ).rows;
    teams.push({
      id: t.id, name: t.name, color: t.color, description: t.description, instructions: t.instructions,
      leaderName: t.leader_name, status: t.status,
      missions: missions.map((m) => ({ order: m.position, status: m.status, instructions: m.instructions, point: toPoint(m) })),
    });
  }
  // Roadbook complet : on liste aussi les points sans équipe, pour ne rien oublier.
  const unassigned = teamId
    ? []
    : (
        await c.query(
          pointSelect + ` WHERE p.event_id = $1 AND p.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM missions m JOIN teams t ON t.id = m.team_id
                              WHERE m.mission_point_id = p.id AND m.cancelled_at IS NULL AND t.disabled_at IS NULL)
           ORDER BY p.distance_m NULLS LAST, p.id`,
          [eventId],
        )
      ).rows.map(toPoint);
  return {
    generatedAt: new Date().toISOString(),
    scope: teamId ? 'equipe' : 'manifestation',
    event: {
      id: ev.id, name: ev.name, description: ev.description, startsAt: ev.starts_at, endsAt: ev.ends_at,
      areaName: ev.area_name, status: ev.status, instructions: ev.instructions,
    },
    track: track ? {
      name: track.name, version: track.version, length: track.length_m, closed: track.closed, geometry: track.geom,
      waypoints: waypoints.map((w) => ({ name: w.name, position: [w.lon, w.lat], distance: w.distance_m })),
    } : null,
    teams,
    unassigned,
  };
}

const xml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'roadbook';

export async function roadbookRoutes(app: FastifyInstance) {
  app.get('/api/events/:id/roadbook', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const q = Query.parse(req.query);
    return loadRoadbook(app.db, eventId, q.team);
  });

  // GPX : parcours + points de mission dans l'ordre de chaque équipe, pour un téléphone ou un GPS.
  app.get('/api/events/:id/roadbook.gpx', async (req, reply) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const q = Query.parse(req.query);
    const rb = await loadRoadbook(app.db, eventId, q.team);
    const wpts: string[] = [];
    const wpt = (p: RoadbookPoint, name: string, extra: string) =>
      '  <wpt lat="' + p.position[1].toFixed(7) + '" lon="' + p.position[0].toFixed(7) + '"><name>' + xml(name) + '</name>' +
      '<desc>' + xml([p.description, extra].filter(Boolean).join(' — ')) + '</desc><type>' + xml(p.type) + '</type></wpt>';
    for (const t of rb.teams) {
      for (const m of t.missions) wpts.push(wpt(m.point, String(m.order).padStart(2, '0') + ' ' + m.point.name, 'Équipe ' + t.name));
    }
    for (const p of rb.unassigned) wpts.push(wpt(p, p.name, 'Sans équipe'));
    const trk = rb.track
      ? '  <trk><name>' + xml(rb.track.name ?? rb.event.name) + '</name>' +
        (rb.track.geometry as { coordinates: [number, number][][] }).coordinates
          .map((seg) => '<trkseg>' + seg.map(([lon, lat]) => '<trkpt lat="' + lat.toFixed(7) + '" lon="' + lon.toFixed(7) + '"/>').join('') + '</trkseg>')
          .join('') + '</trk>'
      : '';
    const title = rb.event.name + (q.team && rb.teams[0] ? ' — ' + rb.teams[0].name : '');
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="cortege-coordination" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '  <metadata><name>' + xml(title) + '</name><time>' + rb.generatedAt + '</time></metadata>\n' +
      wpts.join('\n') + (wpts.length ? '\n' : '') + trk + '\n</gpx>\n';
    reply
      .header('content-type', 'application/gpx+xml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="roadbook-' + slug(title) + '.gpx"');
    return body;
  });
}
