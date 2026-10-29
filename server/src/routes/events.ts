import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { requireCanCreateEvent, requireEventRole } from '../permissions.js';
import { POINT_STATUS_SQL } from '../services/points.js';

const Status = z.enum(['preparation', 'pret', 'en_cours', 'termine', 'archive']);
const EventFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  areaName: z.string().max(200),
  instructions: z.string().max(20000),
};
const CreateEvent = z.object({
  ...EventFields,
  description: EventFields.description.default(''),
  startsAt: EventFields.startsAt.default(null),
  endsAt: EventFields.endsAt.default(null),
  areaName: EventFields.areaName.default(''),
  instructions: EventFields.instructions.default(''),
});
const UpdateEvent = z.object({ ...EventFields, status: Status }).partial().extend({ version: z.number().int() });
const AddMember = z.object({ userId: z.number().int().positive(), role: z.enum(['organisateur', 'responsable', 'membre']) });

export function publicEvent(r: Record<string, unknown>) {
  return {
    id: r.id, name: r.name, description: r.description, startsAt: r.starts_at, endsAt: r.ends_at, areaName: r.area_name,
    status: r.status, instructions: r.instructions, currentTrackId: r.current_track_id, version: r.version,
    createdAt: r.created_at, updatedAt: r.updated_at, ...(r.role ? { role: r.role } : {}),
  };
}

export async function eventRoutes(app: FastifyInstance) {
  // Seuls les événements auxquels le compte a accès sont listés.
  app.get('/api/events', async (req) => {
    const u = requireUser(req);
    // Un participant voit son équipe par /api/moi, pas la liste des manifestations.
    if (u.accountType === 'participant') return [];
    const r = u.globalRole === 'admin'
      ? await app.db.query("SELECT e.*, 'organisateur' AS role FROM events e ORDER BY coalesce(starts_at, created_at) DESC")
      : await app.db.query(
          'SELECT e.*, m.role FROM events e JOIN event_memberships m ON m.event_id = e.id AND m.user_id = $1 ORDER BY coalesce(starts_at, e.created_at) DESC',
          [u.id],
        );
    return r.rows.map(publicEvent);
  });

  app.post('/api/events', async (req, reply) => {
    const u = requireUser(req);
    requireCanCreateEvent(u);
    const b = CreateEvent.parse(req.body);
    const ev = await tx(app.db, async (c) => {
      const r = await c.query(
        `INSERT INTO events(name, description, starts_at, ends_at, area_name, instructions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [b.name, b.description, b.startsAt, b.endsAt, b.areaName, b.instructions, u.id],
      );
      const e = r.rows[0];
      await c.query("INSERT INTO event_memberships(event_id, user_id, role) VALUES ($1, $2, 'organisateur')", [e.id, u.id]);
      await audit(c, { actorId: u.id, eventId: e.id, entity: 'event', entityId: e.id, action: 'creation', details: { name: b.name } });
      return e;
    });
    return reply.status(201).send(publicEvent({ ...ev, role: 'organisateur' }));
  });

  app.get('/api/events/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const role = await requireEventRole(app.db, u, id, 'lecture');
    const r = await app.db.query('SELECT * FROM events WHERE id = $1', [id]);
    return publicEvent({ ...r.rows[0], role });
  });

  app.patch('/api/events/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = UpdateEvent.parse(req.body);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, id, 'organisation');
      const cur = (await c.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (cur.version !== b.version) throw conflict("L'événement a été modifié entre-temps : rechargez-le.", { current: publicEvent(cur) });
      const r = await c.query(
        `UPDATE events SET name = coalesce($2, name), description = coalesce($3, description),
                starts_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE starts_at END,
                ends_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE ends_at END,
                area_name = coalesce($8, area_name), instructions = coalesce($9, instructions), status = coalesce($10, status),
                version = version + 1, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, b.name ?? null, b.description ?? null, b.startsAt !== undefined, b.startsAt ?? null, b.endsAt !== undefined, b.endsAt ?? null,
          b.areaName ?? null, b.instructions ?? null, b.status ?? null],
      );
      const changes = Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'version' && k !== 'instructions' && k !== 'description'));
      await audit(c, { actorId: u.id, eventId: id, entity: 'event', entityId: id, action: 'modification', details: changes });
      return publicEvent(r.rows[0]);
    });
  });

  // Suppression définitive d'une manifestation et de toutes ses données (parcours, suggestions, points, équipes,
  // missions, historique). Réservée à ses organisateurs ; il faut retaper son nom ; refusée pendant l'événement.
  app.delete('/api/events/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ confirmName: z.string() }).parse(req.body ?? {});
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, id, 'organisation');
      const ev = (await c.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (b.confirmName.trim() !== ev.name.trim()) throw badRequest('Le nom saisi ne correspond pas à celui de la manifestation.');
      if (ev.status === 'en_cours') throw conflict('Manifestation en cours : changez d’abord son statut pour la supprimer.');
      const counts = (
        await c.query(
          `SELECT (SELECT count(*) FROM mission_points WHERE event_id = $1)::int AS points,
                  (SELECT count(*) FROM teams WHERE event_id = $1)::int AS teams,
                  (SELECT count(*) FROM missions WHERE event_id = $1)::int AS missions,
                  (SELECT count(*) FROM gpx_tracks WHERE event_id = $1)::int AS tracks`,
          [id],
        )
      ).rows[0];
      // Ordre imposé par les clés étrangères « RESTRICT » entre les données de l'événement.
      await c.query('DELETE FROM missions WHERE event_id = $1', [id]);
      await c.query('DELETE FROM mission_points WHERE event_id = $1', [id]);
      await c.query('DELETE FROM map_suggestions WHERE event_id = $1', [id]);
      await c.query('DELETE FROM osm_analyses WHERE event_id = $1', [id]);
      await c.query('UPDATE events SET current_track_id = NULL WHERE id = $1', [id]);
      await c.query('DELETE FROM gpx_tracks WHERE event_id = $1', [id]);
      await c.query('DELETE FROM teams WHERE event_id = $1', [id]);
      await c.query('DELETE FROM events WHERE id = $1', [id]);
      // L'historique de l'événement disparaît avec lui ; seule une trace de la suppression est conservée.
      await audit(c, { actorId: u.id, eventId: null, entity: 'event', entityId: id, action: 'suppression', details: { name: ev.name, ...counts } });
      return { ok: true };
    });
  });

  app.get('/api/events/:id/summary', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    await requireEventRole(app.db, u, id, 'lecture');
    const [sugg, points, teams, missions, track, analysis] = await Promise.all([
      app.db.query('SELECT status, count(*)::int AS n FROM map_suggestions WHERE event_id = $1 GROUP BY status', [id]),
      app.db.query(`SELECT ${POINT_STATUS_SQL} AS status, count(*)::int AS n FROM mission_points p WHERE event_id = $1 AND deleted_at IS NULL GROUP BY 1`, [id]),
      app.db.query('SELECT count(*) FILTER (WHERE disabled_at IS NULL)::int AS active, count(*)::int AS total FROM teams WHERE event_id = $1', [id]),
      app.db.query('SELECT status, count(*)::int AS n FROM missions WHERE event_id = $1 AND cancelled_at IS NULL GROUP BY status', [id]),
      app.db.query('SELECT t.id, t.version, t.length_m, t.closed, t.warnings FROM events e JOIN gpx_tracks t ON t.id = e.current_track_id WHERE e.id = $1', [id]),
      app.db.query('SELECT id, created_at, osm_timestamp, track_id, options FROM osm_analyses WHERE event_id = $1 ORDER BY id DESC LIMIT 1', [id]),
    ]);
    const unassigned = await app.db.query(
      `SELECT p.id, p.name, p.distance_m FROM mission_points p WHERE p.event_id = $1 AND p.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM missions m JOIN teams t ON t.id = m.team_id
                          WHERE m.mission_point_id = p.id AND m.cancelled_at IS NULL AND t.disabled_at IS NULL)
       ORDER BY p.distance_m NULLS LAST, p.id`,
      [id],
    );
    const toMap = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const t = track.rows[0];
    const a = analysis.rows[0];
    return {
      suggestions: toMap(sugg.rows),
      points: toMap(points.rows),
      teams: teams.rows[0],
      missions: toMap(missions.rows),
      unassignedPoints: unassigned.rows.map((r) => ({ id: r.id, name: r.name, distance: r.distance_m })),
      track: t ? { id: t.id, version: t.version, length: t.length_m, closed: t.closed, warnings: t.warnings } : null,
      lastAnalysis: a ? { id: a.id, at: a.created_at, osmTimestamp: a.osm_timestamp, options: a.options, outdated: !t || a.track_id !== t.id } : null,
    };
  });

  app.get('/api/events/:id/members', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    await requireEventRole(app.db, u, id, 'lecture');
    const r = await app.db.query(
      `SELECT u.id, u.login, u.display_name, m.role FROM event_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.event_id = $1 AND u.account_type = 'compte' ORDER BY u.display_name`,
      [id],
    );
    return r.rows.map((x) => ({ id: x.id, login: x.login, displayName: x.display_name, role: x.role }));
  });

  // Donne accès à un compte existant (créé par un administrateur). Ne crée jamais de compte.
  app.put('/api/events/:id/members', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = AddMember.parse(req.body);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, id, 'organisation');
      // Les participants invités n'obtiennent jamais d'accès à la manifestation entière.
      const target = await c.query("SELECT id FROM users WHERE id = $1 AND disabled_at IS NULL AND account_type = 'compte'", [b.userId]);
      if (!target.rowCount) throw notFound('Compte');
      await c.query(
        'INSERT INTO event_memberships(event_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (event_id, user_id) DO UPDATE SET role = EXCLUDED.role',
        [id, b.userId, b.role],
      );
      await audit(c, { actorId: u.id, eventId: id, entity: 'event_membership', entityId: b.userId, action: 'attribution', details: { role: b.role } });
      return { ok: true };
    });
  });

  app.delete('/api/events/:id/members/:userId', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const userId = idParam(req, 'userId');
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, id, 'organisation');
      if (userId === u.id) throw conflict('Vous ne pouvez pas retirer votre propre accès.');
      await c.query('DELETE FROM event_memberships WHERE event_id = $1 AND user_id = $2', [id, userId]);
      await audit(c, { actorId: u.id, eventId: id, entity: 'event_membership', entityId: userId, action: 'retrait' });
      return { ok: true };
    });
  });

  app.get('/api/events/:id/history', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    await requireEventRole(app.db, u, id, 'organisation');
    const q = z.object({ entity: z.string().max(40).optional(), entityId: z.coerce.number().int().optional() }).parse(req.query);
    const r = await app.db.query(
      `SELECT a.id, a.at, a.entity, a.entity_id, a.action, a.details, u.display_name AS actor
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.event_id = $1 AND ($2::text IS NULL OR a.entity = $2) AND ($3::bigint IS NULL OR a.entity_id = $3)
        ORDER BY a.at DESC, a.id DESC LIMIT 500`,
      [id, q.entity ?? null, q.entityId ?? null],
    );
    return r.rows.map((x) => ({ id: x.id, at: x.at, entity: x.entity, entityId: x.entity_id, action: x.action, details: x.details, actor: x.actor }));
  });
}
