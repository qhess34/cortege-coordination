// Membres d'équipe (comptes créés par un administrateur) : leurs équipes, leur profil, et la gestion des membres
// d'une équipe par l'organisation (ou par ses responsables, si l'organisation le permet).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import { tx, type Db } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { requireEventRole, requireTeamManager } from '../permissions.js';
import { createLoginLink, publicBase } from './login-links.js';

/** Missions actives d'une équipe, dans l'ordre, telles que les voit un membre. */
async function teamMissions(db: Db, teamId: number) {
  const r = await db.query(
    `SELECT m.position, m.status, m.instructions, p.name, p.type, p.description, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.distance_m
       FROM missions m JOIN mission_points p ON p.id = m.mission_point_id
      WHERE m.team_id = $1 AND m.cancelled_at IS NULL ORDER BY m.position`,
    [teamId],
  );
  return r.rows.map((m) => ({
    order: m.position, status: m.status, instructions: m.instructions,
    point: { name: m.name, type: m.type, description: m.description, position: [m.lon, m.lat], distance: m.distance_m },
  }));
}

/** Nom affiché : « Prénom Nom », sinon le nom déjà connu. */
/** Téléphone facultatif : espaces, points, tirets et parenthèses retirés ; « + » initial accepté. */
export const Phone = z.string().trim().transform((s) => s.replace(/[\s.()-]/g, ''))
  .pipe(z.string().regex(/^\+?[0-9]{6,20}$/, 'Numéro de téléphone invalide.'))
  .nullable()
  .transform((s) => s || null);
export const PhoneInput = z.union([z.literal('').transform(() => null), Phone]);

export const fullName = (first: string, last: string, fallback: string) => [first, last].map((x) => x.trim()).filter(Boolean).join(' ') || fallback;

export async function memberRoutes(app: FastifyInstance) {
  // --- Le membre : ses équipes ------------------------------------------------------------------------------------
  app.get('/api/moi/equipes', async (req) => {
    const u = requireUser(req);
    const r = await app.db.query(
      `SELECT t.id, t.name, t.color, t.kind, t.disabled_at, e.id AS event_id, e.name AS event_name, e.starts_at, e.ends_at, e.status,
              CASE WHEN t.leader_user_id = $1 THEN 'responsable' ELSE m.role END AS role
         FROM teams t JOIN events e ON e.id = t.event_id
         LEFT JOIN team_memberships m ON m.team_id = t.id AND m.user_id = $1
        WHERE m.user_id IS NOT NULL OR t.leader_user_id = $1
        ORDER BY coalesce(e.starts_at, e.created_at) DESC, t.name`,
      [u.id],
    );
    return r.rows.map((t) => ({
      id: t.id, name: t.name, color: t.color, kind: t.kind, role: t.role, closed: !!t.disabled_at,
      event: { id: t.event_id, name: t.event_name, startsAt: t.starts_at, endsAt: t.ends_at, status: t.status },
    }));
  });

  // --- Profil (tout compte) ---------------------------------------------------------------------------------------
  app.get('/api/moi/profil', async (req) => {
    const u = requireUser(req);
    const r = (await app.db.query('SELECT first_name, last_name, email, phone, display_name, login, expires_at FROM users WHERE id = $1', [u.id])).rows[0];
    return { firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone, displayName: r.display_name, login: r.login, expiresAt: r.expires_at };
  });

  app.patch('/api/moi/profil', async (req) => {
    const u = requireUser(req);
    const b = z.object({
      firstName: z.string().trim().max(80),
      lastName: z.string().trim().max(80),
      email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(200).nullable(),
      phone: PhoneInput.optional(),
    }).parse(req.body);
    return tx(app.db, async (c) => {
      const cur = (await c.query('SELECT display_name FROM users WHERE id = $1', [u.id])).rows[0];
      const display = fullName(b.firstName, b.lastName, cur.display_name).slice(0, 120);
      const phone = (await c.query(
        'UPDATE users SET first_name = $2, last_name = $3, email = $4, display_name = $5, phone = CASE WHEN $6::boolean THEN $7 ELSE phone END WHERE id = $1 RETURNING phone',
        [u.id, b.firstName, b.lastName, b.email, display, b.phone !== undefined, b.phone ?? null],
      ).catch((e: { code?: string }) => { if (e.code === '23505') throw conflict('Cette adresse e-mail est déjà utilisée par un autre compte.'); throw e; })).rows[0].phone;
      await audit(c, { actorId: u.id, eventId: null, entity: 'user', entityId: u.id, action: 'profil', details: { emailChanged: true, phoneChanged: b.phone !== undefined } });
      return { firstName: b.firstName, lastName: b.lastName, email: b.email, phone, displayName: display };
    });
  });

  // Équipes dont un compte (organisateur, responsable…) fait partie dans une manifestation (onglet « Mon équipe »).
  app.get('/api/events/:id/mes-equipes', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const ev = (await app.db.query('SELECT id, name, starts_at, ends_at, instructions, status FROM events WHERE id = $1', [eventId])).rows[0];
    const rows = (await app.db.query(
      `SELECT t.id, t.name, t.color, t.instructions, t.disabled_at, l.display_name AS leader_name,
              CASE WHEN t.leader_user_id = $2 THEN 'responsable' ELSE m.role END AS role
         FROM teams t LEFT JOIN team_memberships m ON m.team_id = t.id AND m.user_id = $2
         LEFT JOIN users l ON l.id = t.leader_user_id
        WHERE t.event_id = $1 AND (m.user_id IS NOT NULL OR t.leader_user_id = $2)
        ORDER BY t.name`,
      [eventId, u.id],
    )).rows;
    const teams = [];
    for (const t of rows) {
      teams.push({
        id: t.id, name: t.name, color: t.color, instructions: t.instructions, role: t.role, leaderName: t.leader_name,
        closed: !!t.disabled_at, missions: await teamMissions(app.db, t.id),
      });
    }
    return { event: { id: ev.id, name: ev.name, startsAt: ev.starts_at, endsAt: ev.ends_at, instructions: ev.instructions, status: ev.status }, teams };
  });

  // --- Organisation : membres d'une équipe ------------------------------------------------------------------------
  app.get('/api/teams/:id/members', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    await requireTeamManager(app.db, u, teamId);
    const r = await app.db.query(
      `SELECT u.id, u.display_name, u.global_role, u.email, u.phone, u.disabled_at, u.expires_at, m.role, m.joined_at,
              (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
         FROM team_memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 ORDER BY m.role DESC, u.display_name`,
      [teamId],
    );
    return r.rows.map((x) => ({
      id: x.id, displayName: x.display_name, globalRole: x.global_role, hasEmail: !!x.email, phone: x.phone ?? null, role: x.role, joinedAt: x.joined_at,
      lastSeen: x.last_seen, disabled: !!x.disabled_at, expiresAt: x.expires_at,
    }));
  });

  // Comptes que l'on peut ajouter : membres d'équipe (comptes « membre »), et comptes ayant accès à la manifestation.
  app.get('/api/teams/:id/candidats', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const { eventId } = await requireTeamManager(app.db, u, teamId);
    const q = z.object({ q: z.string().trim().max(60).default('') }).parse(req.query);
    const like = '%' + q.q.replace(/[%_\\]/g, '\\$&') + '%';
    const r = await app.db.query(
      `SELECT u.id, u.display_name, u.global_role, u.login,
              (SELECT string_agg(t.name, ', ') FROM team_memberships tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = u.id AND t.event_id = $2) AS other_teams
         FROM users u
        WHERE u.disabled_at IS NULL AND (u.expires_at IS NULL OR u.expires_at > now())
          AND (u.global_role = 'membre' OR EXISTS (SELECT 1 FROM event_memberships e WHERE e.event_id = $2 AND e.user_id = u.id))
          AND NOT EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = $1 AND tm.user_id = u.id)
          AND (u.display_name ILIKE $3 OR coalesce(u.login, '') ILIKE $3 OR coalesce(u.email, '') ILIKE $3)
        ORDER BY u.display_name LIMIT 30`,
      [teamId, eventId, like],
    );
    return r.rows.map((x) => ({ id: x.id, displayName: x.display_name, globalRole: x.global_role, otherTeams: x.other_teams }));
  });

  app.post('/api/teams/:id/members', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const b = z.object({ userId: z.number().int().positive(), role: z.enum(['membre', 'responsable']).default('membre') }).parse(req.body);
    return tx(app.db, async (c) => {
      const { eventId, asOrganizer } = await requireTeamManager(c, u, teamId);
      // Seule l'organisation désigne des responsables.
      if (b.role === 'responsable' && !asOrganizer) throw forbidden();
      const target = (await c.query(
        `SELECT u.global_role, EXISTS (SELECT 1 FROM event_memberships e WHERE e.event_id = $2 AND e.user_id = u.id) AS has_access
           FROM users u WHERE u.id = $1 AND u.disabled_at IS NULL AND (u.expires_at IS NULL OR u.expires_at > now())`,
        [b.userId, eventId],
      )).rows[0];
      if (!target) throw notFound('Compte');
      if (target.global_role !== 'membre' && !target.has_access) throw badRequest("Ce compte n'a pas accès à la manifestation.");
      await c.query(
        'INSERT INTO team_memberships(team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role',
        [teamId, b.userId, b.role],
      );
      await audit(c, { actorId: u.id, eventId, entity: 'team_membership', entityId: b.userId, action: 'ajout', details: { teamId, role: b.role } });
      return { ok: true };
    });
  });

  app.delete('/api/teams/:id/members/:userId', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const userId = idParam(req, 'userId');
    return tx(app.db, async (c) => {
      const { eventId } = await requireTeamManager(c, u, teamId);
      if (userId === u.id) throw conflict('Vous ne pouvez pas vous retirer vous-même.');
      const r = await c.query('DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
      if (!r.rowCount) throw notFound('Membre');
      // Le membre perd aussitôt l'accès à l'équipe ; sa position partagée et son suivi OwnTracks sont effacés.
      await c.query('DELETE FROM member_locations WHERE user_id = $1 AND team_id = $2', [userId, teamId]);
      await c.query('UPDATE trackers SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1 AND team_id = $2', [userId, teamId]);
      await audit(c, { actorId: u.id, eventId, entity: 'team_membership', entityId: userId, action: 'retrait', details: { teamId } });
      return { ok: true };
    });
  });

  // Lien de connexion pour un membre de l'équipe (nouveau téléphone, accès perdu), à lui transmettre.
  app.post('/api/teams/:id/members/:userId/lien', async (req, reply) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const userId = idParam(req, 'userId');
    const { eventId } = await requireTeamManager(app.db, u, teamId);
    const m = (await app.db.query(
      `SELECT x.global_role FROM team_memberships tm JOIN users x ON x.id = tm.user_id
        WHERE tm.team_id = $1 AND tm.user_id = $2 AND x.disabled_at IS NULL AND (x.expires_at IS NULL OR x.expires_at > now())`,
      [teamId, userId],
    )).rows[0];
    if (!m) throw notFound('Membre');
    // Les comptes d'organisation gèrent leurs propres accès (mot de passe, administrateur).
    if (m.global_role !== 'membre') throw forbidden();
    const link = await createLoginLink(app.db, userId, 'equipe', u.id);
    await audit(app.db, { actorId: u.id, eventId, entity: 'user', entityId: userId, action: 'lien_connexion', details: { kind: 'equipe', teamId } });
    reply.status(201);
    return { ...link, url: publicBase(app, req) + link.path };
  });
}
