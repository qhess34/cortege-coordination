import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { conflict } from '../errors.js';
import { placeName, placeNameQuery } from '../geo/place-name.js';
import type { Position } from '../geo/route.js';
import { requireEntityAccess, requireEventRole } from '../permissions.js';
import { compactTeam } from '../services/missions.js';
import { POINT_STATUSES, POINT_STATUS_SQL } from '../services/points.js';
import { currentTrack } from '../services/track.js';

export const POINT_TYPES = [
  'carrefour', 'rue_laterale', 'acces_vehicule_entrant', 'acces_pieton_cycle', 'voie_privee', 'verification', 'point_fixe', 'autre',
] as const;

const Lon = z.number().min(-180).max(180);
const Lat = z.number().min(-90).max(90);
const PositionSchema = z.tuple([Lon, Lat]);
const CreatePoint = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).default(''),
  type: z.enum(POINT_TYPES).default('autre'),
  position: PositionSchema,
});
const UpdatePoint = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  type: z.enum(POINT_TYPES).optional(),
  position: PositionSchema.optional(),
  /** Distance cumulée fixée à la main ; `null` pour revenir au calcul automatique. */
  distance: z.number().min(0).nullable().optional(),
});

const POINT_SELECT = `
  SELECT p.*, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, ${POINT_STATUS_SQL} AS status,
         coalesce((SELECT json_agg(json_build_object('missionId', m.id, 'teamId', t.id, 'teamName', t.name, 'color', t.color,
                                                     'position', m.position, 'status', m.status) ORDER BY t.name)
                     FROM missions m JOIN teams t ON t.id = m.team_id
                    WHERE m.mission_point_id = p.id AND m.cancelled_at IS NULL), '[]') AS missions
    FROM mission_points p`;

export function publicPoint(r: Record<string, unknown>) {
  return {
    id: r.id, eventId: r.event_id, origin: r.origin, suggestionId: r.suggestion_id, name: r.name, description: r.description,
    type: r.type, position: [r.lon, r.lat], distance: r.distance_m, distanceLocked: r.distance_locked, status: r.status,
    missions: r.missions, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function pointRoutes(app: FastifyInstance) {
  // Nom proposé pour un nouveau point : rue la plus proche ou croisement, d'après OSM. Simple aide à la saisie :
  // si Overpass ne répond pas, on renvoie un nom vide plutôt qu'une erreur.
  app.get('/api/events/:id/nom-de-lieu', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'organisation');
    const q = z.object({ lon: z.coerce.number().min(-180).max(180), lat: z.coerce.number().min(-90).max(90) }).parse(req.query);
    const p: Position = [q.lon, q.lat];
    try {
      return placeName(await app.osm(placeNameQuery(p)), p);
    } catch (e) {
      req.log.warn({ err: e }, 'nom de lieu indisponible');
      return { name: null, streets: [], unavailable: true };
    }
  });

  app.get('/api/events/:id/points', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const q = z
      .object({ q: z.string().max(100).optional(), status: z.enum(POINT_STATUSES).optional(), type: z.enum(POINT_TYPES).optional(), origin: z.enum(['suggestion', 'manuel', 'import']).optional() })
      .parse(req.query);
    const r = await app.db.query(
      `SELECT * FROM (${POINT_SELECT} WHERE p.event_id = $1 AND p.deleted_at IS NULL) x
        WHERE ($2::text IS NULL OR x.name ILIKE '%' || $2 || '%' OR x.description ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR x.status = $3) AND ($4::text IS NULL OR x.type = $4) AND ($5::text IS NULL OR x.origin = $5)
        ORDER BY x.distance_m NULLS LAST, x.id`,
      [eventId, q.q?.replace(/[%_\\]/g, '\\$&') ?? null, q.status ?? null, q.type ?? null, q.origin ?? null],
    );
    return r.rows.map(publicPoint);
  });

  app.post('/api/events/:id/points', async (req, reply) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    const b = CreatePoint.parse(req.body);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, eventId, 'organisation');
      const track = await currentTrack(c, eventId);
      const distance = track?.route.locate(b.position as Position)?.distance ?? null;
      const r = await c.query(
        `INSERT INTO mission_points(event_id, origin, name, description, type, geom, distance_m, created_by)
         VALUES ($1, 'manuel', $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8) RETURNING id`,
        [eventId, b.name, b.description, b.type, b.position[0], b.position[1], distance, u.id],
      );
      const id = r.rows[0].id;
      await audit(c, { actorId: u.id, eventId, entity: 'mission_point', entityId: id, action: 'creation', details: { origin: 'manuel', name: b.name, position: b.position } });
      const p = (await c.query(POINT_SELECT + ' WHERE p.id = $1', [id])).rows[0];
      // Statut seulement : la réponse part après la validation de la transaction.
      reply.status(201);
      return publicPoint(p);
    });
  });

  app.get('/api/points/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    await requireEntityAccess(app.db, u, 'mission_points', id, 'lecture');
    const r = await app.db.query(POINT_SELECT + ' WHERE p.id = $1 AND p.deleted_at IS NULL', [id]);
    if (!r.rowCount) throw conflict('Ce point a été supprimé.');
    return publicPoint(r.rows[0]);
  });

  app.patch('/api/points/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = UpdatePoint.parse(req.body);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'mission_points', id, 'organisation');
      const cur = (await c.query('SELECT *, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM mission_points WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (cur.deleted_at) throw conflict('Ce point a été supprimé.');
      if (cur.version !== b.version) {
        const now = (await c.query(POINT_SELECT + ' WHERE p.id = $1', [id])).rows[0];
        throw conflict('Le point a été modifié entre-temps.', { current: publicPoint(now) });
      }
      const position = (b.position ?? [cur.lon, cur.lat]) as Position;
      let distance: number | null = cur.distance_m;
      let locked: boolean = cur.distance_locked;
      if (b.distance !== undefined && b.distance !== null) {
        distance = b.distance;
        locked = true;
      } else if (b.distance === null || (b.position && !locked)) {
        const track = await currentTrack(c, eventId);
        distance = track?.route.locate(position)?.distance ?? null;
        locked = false;
      }
      await c.query(
        `UPDATE mission_points SET name = coalesce($2, name), description = coalesce($3, description), type = coalesce($4, type),
                geom = ST_SetSRID(ST_MakePoint($5, $6), 4326), distance_m = $7, distance_locked = $8,
                version = version + 1, updated_at = now()
          WHERE id = $1`,
        [id, b.name ?? null, b.description ?? null, b.type ?? null, position[0], position[1], distance, locked],
      );
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (b.name !== undefined && b.name !== cur.name) { before.name = cur.name; after.name = b.name; }
      if (b.type !== undefined && b.type !== cur.type) { before.type = cur.type; after.type = b.type; }
      if (b.description !== undefined && b.description !== cur.description) after.description = 'modifiée';
      if (b.position) { before.position = [cur.lon, cur.lat]; after.position = position; }
      if (distance !== cur.distance_m) { before.distance = cur.distance_m; after.distance = distance; }
      await audit(c, { actorId: u.id, eventId, entity: 'mission_point', entityId: id, action: b.position ? 'deplacement' : 'modification', details: { before, after } });
      return publicPoint((await c.query(POINT_SELECT + ' WHERE p.id = $1', [id])).rows[0]);
    });
  });

  // Suppression : si le point est lié à des missions, la première requête renvoie les conséquences et
  // il faut confirmer (`?confirm=1`). Le point est conservé en suppression logique pour l'historique.
  app.delete('/api/points/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const confirm = ['1', 'true'].includes(String((req.query as Record<string, string>).confirm));
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'mission_points', id, 'organisation');
      const p = (await c.query('SELECT * FROM mission_points WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (p.deleted_at) throw conflict('Ce point a déjà été supprimé.');
      const missions = (
        await c.query(
          'SELECT m.id, m.status, m.position, t.id AS team_id, t.name AS team FROM missions m JOIN teams t ON t.id = m.team_id WHERE m.mission_point_id = $1 AND m.cancelled_at IS NULL ORDER BY t.name',
          [id],
        )
      ).rows;
      const consequences = {
        missions: missions.map((m) => ({ id: m.id, team: m.team, status: m.status, position: m.position })),
        suggestion: p.suggestion_id ? { id: p.suggestion_id, effect: 'La suggestion d\'origine sera marquée écartée et ne réapparaîtra pas.' } : null,
      };
      if (missions.length && !confirm) {
        throw conflict(
          'Ce point est affecté à ' + missions.length + ' mission(s). Confirmez pour annuler ces missions et supprimer le point.',
          consequences,
        );
      }
      for (const m of missions) {
        await c.query("UPDATE missions SET status = 'annulee', cancelled_at = now(), updated_at = now(), version = version + 1 WHERE id = $1", [m.id]);
        await audit(c, { actorId: u.id, eventId, entity: 'mission', entityId: m.id, action: 'annulation', details: { reason: 'point supprimé', pointId: id, previousStatus: m.status } });
      }
      for (const teamId of new Set(missions.map((m) => m.team_id as number))) await compactTeam(c, teamId);
      await c.query('UPDATE mission_points SET deleted_at = now(), version = version + 1 WHERE id = $1', [id]);
      if (p.suggestion_id) {
        await c.query("UPDATE map_suggestions SET status = 'ecartee', dismissed_reason = 'Point de mission supprimé', decided_at = now(), decided_by = $2 WHERE id = $1", [p.suggestion_id, u.id]);
      }
      await audit(c, { actorId: u.id, eventId, entity: 'mission_point', entityId: id, action: 'suppression', details: { name: p.name, ...consequences } });
      return { ok: true, ...consequences };
    });
  });

  app.get('/api/points/:id/history', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    await requireEntityAccess(app.db, u, 'mission_points', id, 'lecture');
    const r = await app.db.query(
      `SELECT a.id, a.at, a.entity, a.entity_id, a.action, a.details, u.display_name AS actor
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        WHERE (a.entity = 'mission_point' AND a.entity_id = $1)
           OR (a.entity = 'mission' AND a.entity_id IN (SELECT id FROM missions WHERE mission_point_id = $1))
        ORDER BY a.at DESC, a.id DESC`,
      [id],
    );
    return r.rows.map((x) => ({ id: x.id, at: x.at, entity: x.entity, entityId: x.entity_id, action: x.action, details: x.details, actor: x.actor }));
  });
}
