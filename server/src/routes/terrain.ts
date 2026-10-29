// Lot 3 : coordination le jour J. Vue de mission des membres, statuts posés depuis le terrain, incidents,
// messages, progression déclarée du cortège, tableau de bord, itinéraire piéton et signal temps réel.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import type { SessionUser } from '../auth.js';
import { tx, type Client } from '../db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { simplify, type Position } from '../geo/route.js';
import { eventRole, requireEventRole } from '../permissions.js';
import { RoutingError } from '../services/routing.js';
import { currentTrack } from '../services/track.js';
import { TRANSITIONS } from './teams.js';

type MissionStatus = keyof typeof TRANSITIONS;

/**
 * Statuts qu'un membre peut poser lui-même depuis le terrain. Revenir en arrière (« à préparer », réaffecter
 * une mission terminée) reste une décision de l'organisation ; « incident » passe par un signalement.
 */
export const MEMBER_TRANSITIONS: Partial<Record<MissionStatus, MissionStatus[]>> = {
  affectee: ['en_deplacement', 'en_position'],
  en_deplacement: ['en_position'],
  en_position: ['terminee', 'releve_necessaire'],
  releve_necessaire: ['en_position', 'terminee'],
  incident: ['en_deplacement', 'en_position', 'terminee'],
};

const INCIDENT_CATEGORIES = ['aide', 'securite', 'sante', 'circulation', 'materiel', 'autre'] as const;
const Lon = z.number().min(-180).max(180);
const Lat = z.number().min(-90).max(90);

export interface TeamAccess { eventId: number; role: 'membre' | 'responsable'; asOrganizer: boolean }

/**
 * Accès « terrain » à une équipe : ses membres (participants ou comptes), son responsable, et les organisateurs
 * de la manifestation. Une équipe invisible répond 404.
 */
export async function requireTeamMember(c: Client, user: SessionUser, teamId: number): Promise<TeamAccess> {
  const t = (await c.query('SELECT event_id, leader_user_id FROM teams WHERE id = $1', [teamId])).rows[0];
  if (!t) throw notFound('Équipe');
  const m = (await c.query('SELECT role FROM team_memberships WHERE team_id = $1 AND user_id = $2', [teamId, user.id])).rows[0];
  const organizer = (await eventRole(c, user, t.event_id)) === 'organisateur';
  if (t.leader_user_id === user.id || m?.role === 'responsable') return { eventId: t.event_id, role: 'responsable', asOrganizer: organizer };
  if (m) return { eventId: t.event_id, role: 'membre', asOrganizer: organizer };
  if (organizer) return { eventId: t.event_id, role: 'responsable', asOrganizer: true };
  throw notFound('Équipe');
}

/** Peut déclarer la progression du cortège : organisateur, ou responsable d'une équipe de la manifestation. */
async function canDeclareProgress(c: Client, user: SessionUser, eventId: number): Promise<boolean> {
  if ((await eventRole(c, user, eventId)) === 'organisateur') return true;
  const r = await c.query(
    `SELECT 1 FROM teams t LEFT JOIN team_memberships m ON m.team_id = t.id AND m.user_id = $2
      WHERE t.event_id = $1 AND t.disabled_at IS NULL AND (t.leader_user_id = $2 OR m.role = 'responsable') LIMIT 1`,
    [eventId, user.id],
  );
  return !!r.rowCount;
}

const publicIncident = (r: Record<string, unknown>) => ({
  id: r.id, teamId: r.team_id, teamName: r.team_name ?? null, missionId: r.mission_id, pointName: r.point_name ?? null,
  category: r.category, priority: r.priority, status: r.status, description: r.description,
  position: r.lon === null || r.lon === undefined ? null : [r.lon, r.lat],
  reporterName: r.reporter_name ?? null, handledByName: r.handler_name ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at, resolvedAt: r.resolved_at, version: r.version,
});
const INCIDENT_SELECT = `
  SELECT i.*, ST_X(i.geom) AS lon, ST_Y(i.geom) AS lat, t.name AS team_name, p.name AS point_name,
         rep.display_name AS reporter_name, h.display_name AS handler_name
    FROM incidents i LEFT JOIN teams t ON t.id = i.team_id
    LEFT JOIN missions m ON m.id = i.mission_id LEFT JOIN mission_points p ON p.id = m.mission_point_id
    LEFT JOIN users rep ON rep.id = i.reporter_id LEFT JOIN users h ON h.id = i.handled_by`;

const publicMessage = (r: Record<string, unknown>) => ({
  id: r.id, teamId: r.team_id, teamName: r.team_name ?? null, body: r.body, urgent: r.urgent, createdAt: r.created_at,
  authorId: r.author_id, authorName: r.author_name ?? 'Organisation', fromOrganisation: !!r.from_organisation,
  read: r.read === undefined ? undefined : !!r.read,
  reads: r.reads === undefined ? undefined : Number(r.reads), recipients: r.recipients === undefined ? undefined : Number(r.recipients),
});

async function latestProgress(c: Client, eventId: number) {
  const r = await c.query(
    `SELECT g.distance_m, g.note, g.created_at, u.display_name FROM event_progress g LEFT JOIN users u ON u.id = g.author_id
      WHERE g.event_id = $1 ORDER BY g.created_at DESC, g.id DESC LIMIT 1`,
    [eventId],
  );
  const g = r.rows[0];
  return g ? { distance: g.distance_m, note: g.note, at: g.created_at, authorName: g.display_name } : null;
}

export async function terrainRoutes(app: FastifyInstance) {
  // --- Vue de mission d'une équipe --------------------------------------------------------------------------------
  app.get('/api/terrain/equipes/:id', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const access = await requireTeamMember(app.db, u, teamId);
    const { eventId } = access;
    const [ev, team, missions, messages, incidents, track, progress] = await Promise.all([
      app.db.query('SELECT id, name, starts_at, ends_at, instructions, status FROM events WHERE id = $1', [eventId]),
      app.db.query(
        `SELECT t.id, t.name, t.color, t.instructions, t.disabled_at, l.display_name AS leader_name
           FROM teams t LEFT JOIN users l ON l.id = t.leader_user_id WHERE t.id = $1`,
        [teamId],
      ),
      app.db.query(
        `SELECT m.id, m.version, m.position, m.status, m.instructions, m.status_changed_at, p.name, p.type, p.description,
                ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.distance_m
           FROM missions m JOIN mission_points p ON p.id = m.mission_point_id
          WHERE m.team_id = $1 AND m.cancelled_at IS NULL ORDER BY m.position`,
        [teamId],
      ),
      app.db.query(
        `SELECT g.*, a.display_name AS author_name, (a.id IS NULL OR a.account_type = 'compte' AND NOT EXISTS (
                  SELECT 1 FROM team_memberships tm WHERE tm.team_id = $1 AND tm.user_id = a.id)) AS from_organisation,
                EXISTS (SELECT 1 FROM message_receipts r WHERE r.message_id = g.id AND r.user_id = $3) OR g.author_id = $3 AS read
           FROM messages g LEFT JOIN users a ON a.id = g.author_id
          WHERE g.event_id = $2 AND (g.team_id = $1 OR g.team_id IS NULL)
          ORDER BY g.created_at DESC, g.id DESC LIMIT 50`,
        [teamId, eventId, u.id],
      ),
      app.db.query(INCIDENT_SELECT + ` WHERE i.team_id = $1 AND (i.status <> 'resolu' OR i.resolved_at > now() - interval '2 hours')
                                       ORDER BY i.created_at DESC LIMIT 30`, [teamId]),
      currentTrack(app.db, eventId),
      latestProgress(app.db, eventId),
    ]);
    const e = ev.rows[0];
    const t = team.rows[0];
    return {
      me: { id: u.id, displayName: u.displayName, role: access.role, organizer: access.asOrganizer },
      event: { id: e.id, name: e.name, startsAt: e.starts_at, endsAt: e.ends_at, instructions: e.instructions, status: e.status },
      team: { id: t.id, name: t.name, color: t.color, instructions: t.instructions, leaderName: t.leader_name, closed: !!t.disabled_at },
      missions: missions.rows.map((m) => ({
        id: m.id, version: m.version, order: m.position, status: m.status, instructions: m.instructions, statusChangedAt: m.status_changed_at,
        point: { name: m.name, type: m.type, description: m.description, position: [m.lon, m.lat], distance: m.distance_m },
      })),
      messages: messages.rows.map(publicMessage),
      incidents: incidents.rows.map(publicIncident),
      // Parcours simplifié (affichage sur téléphone).
      track: track ? track.route.segments.map((s) => simplify(s, 8)) : [],
      progress,
      canDeclareProgress: await canDeclareProgress(app.db, u, eventId),
      routing: !!app.router,
    };
  });

  // Statut posé depuis le terrain par un membre de l'équipe.
  app.post('/api/terrain/missions/:id/statut', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ status: z.string(), version: z.number().int() }).parse(req.body);
    return tx(app.db, async (c) => {
      const m = (await c.query('SELECT * FROM missions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!m) throw notFound('Mission');
      const access = await requireTeamMember(c, u, m.team_id);
      if (m.cancelled_at) throw conflict('Cette mission a été retirée par l’organisation.');
      if (m.version !== b.version) {
        throw conflict('La mission a été modifiée entre-temps (statut actuel : ' + m.status + ').', { status: m.status, version: m.version });
      }
      const allowed = (access.asOrganizer ? TRANSITIONS : MEMBER_TRANSITIONS)[m.status as MissionStatus] ?? [];
      if (!(allowed as string[]).includes(b.status)) throw conflict('Ce changement de statut n’est pas possible depuis le terrain.', { allowed });
      const r = await c.query(
        `UPDATE missions SET status = $2, version = version + 1, updated_at = now(), status_changed_at = now(), status_changed_by = $3
          WHERE id = $1 RETURNING status, version, status_changed_at`,
        [id, b.status, u.id],
      );
      await audit(c, { actorId: u.id, eventId: access.eventId, entity: 'mission', entityId: id, action: 'statut', details: { from: m.status, to: b.status, terrain: true } });
      return { id, status: r.rows[0].status, version: r.rows[0].version, statusChangedAt: r.rows[0].status_changed_at };
    });
  });

  // --- Incidents -------------------------------------------------------------------------------------------------
  const NewIncident = z.object({
    category: z.enum(INCIDENT_CATEGORIES),
    priority: z.enum(['normale', 'haute']).optional(),
    description: z.string().trim().max(2000).default(''),
    missionId: z.number().int().positive().nullable().optional(),
    position: z.tuple([Lon, Lat]).nullable().optional(),
  });

  app.post('/api/terrain/equipes/:id/incidents', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const b = NewIncident.parse(req.body);
    return tx(app.db, async (c) => {
      const { eventId } = await requireTeamMember(c, u, teamId);
      let mission: Record<string, unknown> | undefined;
      if (b.missionId) {
        mission = (await c.query('SELECT * FROM missions WHERE id = $1 AND team_id = $2 AND cancelled_at IS NULL FOR UPDATE', [b.missionId, teamId])).rows[0];
        if (!mission) throw badRequest('Mission inconnue pour cette équipe.');
      }
      const priority = b.priority ?? (b.category === 'aide' || b.category === 'sante' || b.category === 'securite' ? 'haute' : 'normale');
      const r = await c.query(
        `INSERT INTO incidents(event_id, team_id, mission_id, reporter_id, category, priority, description, geom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($8, $9), 4326) END)
         RETURNING id`,
        [eventId, teamId, b.missionId ?? null, u.id, b.category, priority, b.description, b.position?.[0] ?? null, b.position?.[1] ?? null],
      );
      // La mission concernée passe en « incident » si son statut le permet.
      if (mission && (TRANSITIONS[mission.status as MissionStatus] ?? []).includes('incident')) {
        await c.query(
          "UPDATE missions SET status = 'incident', version = version + 1, updated_at = now(), status_changed_at = now(), status_changed_by = $2 WHERE id = $1",
          [mission.id, u.id],
        );
      }
      await audit(c, { actorId: u.id, eventId, entity: 'incident', entityId: r.rows[0].id, action: 'signalement', details: { teamId, category: b.category, priority } });
      reply.status(201);
      return publicIncident((await c.query(INCIDENT_SELECT + ' WHERE i.id = $1', [r.rows[0].id])).rows[0]);
    });
  });

  app.get('/api/events/:id/incidents', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const r = await app.db.query(INCIDENT_SELECT + " WHERE i.event_id = $1 ORDER BY (i.status = 'resolu'), (i.priority = 'haute') DESC, i.created_at DESC LIMIT 200", [eventId]);
    return r.rows.map(publicIncident);
  });

  // Suivi d'un incident : organisation, ou responsable de l'équipe concernée.
  app.patch('/api/incidents/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ status: z.enum(['ouvert', 'pris_en_charge', 'resolu']), version: z.number().int() }).parse(req.body);
    return tx(app.db, async (c) => {
      const i = (await c.query('SELECT * FROM incidents WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!i) throw notFound('Incident');
      const organizer = (await eventRole(c, u, i.event_id)) === 'organisateur';
      if (!organizer) {
        const access = i.team_id ? await requireTeamMember(c, u, i.team_id).catch(() => null) : null;
        if (!access) {
          if ((await eventRole(c, u, i.event_id)) === null) throw notFound('Incident');
          throw forbidden();
        }
        if (access.role !== 'responsable') throw forbidden();
      }
      if (i.version !== b.version) throw conflict('L’incident a été modifié entre-temps.', { status: i.status, version: i.version });
      await c.query(
        `UPDATE incidents SET status = $2, version = version + 1, updated_at = now(),
                handled_by = CASE WHEN $2 = 'pris_en_charge' THEN $3 ELSE handled_by END,
                resolved_at = CASE WHEN $2 = 'resolu' THEN now() ELSE NULL END
          WHERE id = $1`,
        [id, b.status, u.id],
      );
      await audit(c, { actorId: u.id, eventId: i.event_id, entity: 'incident', entityId: id, action: 'suivi', details: { from: i.status, to: b.status } });
      return publicIncident((await c.query(INCIDENT_SELECT + ' WHERE i.id = $1', [id])).rows[0]);
    });
  });

  // --- Messages --------------------------------------------------------------------------------------------------
  const Body = z.string().trim().min(1, 'Message vide.').max(2000);

  // Message d'un membre (ou de l'organisation) dans le fil de l'équipe.
  app.post('/api/terrain/equipes/:id/messages', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const b = z.object({ body: Body, urgent: z.boolean().default(false) }).parse(req.body);
    return tx(app.db, async (c) => {
      const { eventId } = await requireTeamMember(c, u, teamId);
      const r = await c.query('INSERT INTO messages(event_id, team_id, author_id, body, urgent) VALUES ($1, $2, $3, $4, $5) RETURNING *', [eventId, teamId, u.id, b.body, b.urgent]);
      await audit(c, { actorId: u.id, eventId, entity: 'message', entityId: r.rows[0].id, action: 'envoi', details: { teamId } });
      reply.status(201);
      return publicMessage({ ...r.rows[0], author_name: u.displayName });
    });
  });

  // Message de l'organisation : à une équipe, ou à tous (teamId null).
  app.post('/api/events/:id/messages', async (req, reply) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    const b = z.object({ body: Body, teamId: z.number().int().positive().nullable().default(null), urgent: z.boolean().default(false) }).parse(req.body);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, eventId, 'organisation');
      if (b.teamId && !(await c.query('SELECT 1 FROM teams WHERE id = $1 AND event_id = $2', [b.teamId, eventId])).rowCount) throw badRequest('Équipe inconnue.');
      const r = await c.query('INSERT INTO messages(event_id, team_id, author_id, body, urgent) VALUES ($1, $2, $3, $4, $5) RETURNING *', [eventId, b.teamId, u.id, b.body, b.urgent]);
      await audit(c, { actorId: u.id, eventId, entity: 'message', entityId: r.rows[0].id, action: 'envoi', details: { teamId: b.teamId, urgent: b.urgent } });
      reply.status(201);
      return publicMessage({ ...r.rows[0], author_name: u.displayName, from_organisation: true });
    });
  });

  // Fil complet côté organisation, avec le nombre de lectures (membres de l'équipe, ou de toutes les équipes).
  app.get('/api/events/:id/messages', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const r = await app.db.query(
      `SELECT g.*, t.name AS team_name, a.display_name AS author_name,
              (a.id IS NULL OR a.account_type = 'compte' AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = g.team_id AND tm.user_id = a.id)) AS from_organisation,
              (SELECT count(*) FROM message_receipts r WHERE r.message_id = g.id) AS reads,
              (SELECT count(DISTINCT tm.user_id) FROM team_memberships tm JOIN teams t2 ON t2.id = tm.team_id
                WHERE t2.event_id = g.event_id AND (g.team_id IS NULL OR tm.team_id = g.team_id) AND tm.user_id IS DISTINCT FROM g.author_id) AS recipients
         FROM messages g LEFT JOIN teams t ON t.id = g.team_id LEFT JOIN users a ON a.id = g.author_id
        WHERE g.event_id = $1 ORDER BY g.created_at DESC, g.id DESC LIMIT 200`,
      [eventId],
    );
    return r.rows.map(publicMessage);
  });

  // Accusé de lecture (idempotent).
  app.post('/api/messages/:id/lu', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const g = (await app.db.query('SELECT event_id, team_id FROM messages WHERE id = $1', [id])).rows[0];
    if (!g) throw notFound('Message');
    if (g.team_id) await requireTeamMember(app.db, u, g.team_id).catch(() => { throw notFound('Message'); });
    else if (u.accountType === 'participant' ? u.eventId !== g.event_id : (await eventRole(app.db, u, g.event_id)) === null) throw notFound('Message');
    await app.db.query('INSERT INTO message_receipts(message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, u.id]);
    app.live.publish(g.event_id);
    return { ok: true };
  });

  // --- Progression déclarée du cortège ---------------------------------------------------------------------------
  app.post('/api/events/:id/progression', async (req, reply) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    const b = z.object({ distance: z.number().min(0).max(1_000_000), note: z.string().trim().max(300).default('') }).parse(req.body);
    return tx(app.db, async (c) => {
      if (!(await canDeclareProgress(c, u, eventId))) {
        if ((await eventRole(c, u, eventId)) === null && u.eventId !== eventId) throw notFound('Événement');
        throw forbidden();
      }
      const track = await currentTrack(c, eventId);
      if (track && b.distance > track.route.length + 50) throw badRequest('Distance au-delà de la fin du parcours.');
      await c.query('INSERT INTO event_progress(event_id, distance_m, note, author_id) VALUES ($1, $2, $3, $4)', [eventId, b.distance, b.note, u.id]);
      await audit(c, { actorId: u.id, eventId, entity: 'event_progress', entityId: null, action: 'declaration', details: { distance: b.distance } });
      reply.status(201);
      return latestProgress(c, eventId);
    });
  });

  // --- Tableau de bord partagé de l'organisation ----------------------------------------------------------------
  app.get('/api/events/:id/tableau', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const [teams, missions, presence, incidents, progress, history] = await Promise.all([
      app.db.query('SELECT id, name, color, disabled_at FROM teams WHERE event_id = $1 ORDER BY name', [eventId]),
      app.db.query(
        `SELECT m.id, m.team_id, m.version, m.position, m.status, m.status_changed_at, p.name, p.distance_m, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat,
                cb.display_name AS changed_by
           FROM missions m JOIN mission_points p ON p.id = m.mission_point_id LEFT JOIN users cb ON cb.id = m.status_changed_by
          WHERE m.event_id = $1 AND m.cancelled_at IS NULL ORDER BY m.team_id, m.position`,
        [eventId],
      ),
      // Présence approximative : dernière activité des membres (aucune position).
      app.db.query(
        `SELECT tm.team_id, count(*) AS members,
                count(*) FILTER (WHERE s.last_seen > now() - interval '5 minutes') AS active
           FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
           LEFT JOIN LATERAL (SELECT max(last_seen_at) AS last_seen FROM sessions WHERE user_id = tm.user_id AND revoked_at IS NULL) s ON true
          WHERE t.event_id = $1 GROUP BY tm.team_id`,
        [eventId],
      ),
      app.db.query(INCIDENT_SELECT + " WHERE i.event_id = $1 AND i.status <> 'resolu' ORDER BY (i.priority = 'haute') DESC, i.created_at", [eventId]),
      latestProgress(app.db, eventId),
      app.db.query(
        `SELECT g.distance_m, g.note, g.created_at, u.display_name FROM event_progress g LEFT JOIN users u ON u.id = g.author_id
          WHERE g.event_id = $1 ORDER BY g.created_at DESC, g.id DESC LIMIT 10`,
        [eventId],
      ),
    ]);
    const pres = new Map(presence.rows.map((p) => [p.team_id, p]));
    return {
      teams: teams.rows.map((t) => ({
        id: t.id, name: t.name, color: t.color, disabled: !!t.disabled_at,
        members: Number(pres.get(t.id)?.members ?? 0), active: Number(pres.get(t.id)?.active ?? 0),
        missions: missions.rows.filter((m) => m.team_id === t.id).map((m) => ({
          id: m.id, version: m.version, order: m.position, status: m.status, statusChangedAt: m.status_changed_at, changedBy: m.changed_by,
          pointName: m.name, distance: m.distance_m, position: [m.lon, m.lat],
        })),
      })),
      incidents: incidents.rows.map(publicIncident),
      progress,
      progressHistory: history.rows.map((g) => ({ distance: g.distance_m, note: g.note, at: g.created_at, authorName: g.display_name })),
      canDeclareProgress: await canDeclareProgress(app.db, u, eventId),
      live: app.live.count(eventId),
    };
  });

  // --- Itinéraire piéton ------------------------------------------------------------------------------------------
  // La position de départ n'est ni conservée ni journalisée (les journaux ne gardent pas la query string).
  app.get('/api/terrain/itineraire', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    requireUser(req);
    const q = z.object({ from: z.string(), to: z.string() }).parse(req.query);
    const pos = (s: string): Position => {
      const [lon, lat] = s.split(',').map(Number);
      return z.tuple([Lon, Lat]).parse([lon, lat]) as Position;
    };
    if (!app.router) throw new HttpError(501, 'Aucun service d’itinéraire n’est configuré sur ce serveur.');
    try {
      return await app.router(pos(q.from), pos(q.to));
    } catch (e) {
      if (e instanceof RoutingError) throw new HttpError(502, e.message);
      throw e;
    }
  });

  // --- Signal temps réel ------------------------------------------------------------------------------------------
  // /api/direct?event=<id> : l'écran reçoit {type:'maj'} à chaque modification de la manifestation, puis recharge.
  app.get('/api/direct', { websocket: true }, async (socket, req) => {
    const u = req.user;
    const eventId = Number((req.query as Record<string, string>).event);
    const allowed = !!u && Number.isSafeInteger(eventId) && (
      u.accountType === 'participant' ? u.eventId === eventId : (await eventRole(app.db, u, eventId)) !== null
    );
    if (!allowed) {
      socket.close(4404, 'introuvable');
      return;
    }
    const unsubscribe = app.live.subscribe(eventId, { send: (d) => socket.send(d) });
    const ping = setInterval(() => socket.ping(), 25_000);
    socket.on('close', () => { clearInterval(ping); unsubscribe(); });
    socket.on('message', () => undefined);
    socket.send(JSON.stringify({ type: 'connecte' }));
  });
}
