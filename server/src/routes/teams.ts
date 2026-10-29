import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import { tx, type Client } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { requireEntityAccess, requireEventRole } from '../permissions.js';
import { compactTeam } from '../services/missions.js';

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur au format #RRGGBB.');
const TeamFields = {
  name: z.string().trim().min(1).max(120),
  color: Color,
  description: z.string().max(5000),
  instructions: z.string().max(20000),
  leaderUserId: z.number().int().positive().nullable(),
  status: z.enum(['non_confirmee', 'prete', 'en_mission', 'indisponible']),
  /** Le responsable peut gérer les invitations et les membres de son équipe. */
  leaderCanInvite: z.boolean(),
};
const CreateTeam = z.object({
  name: TeamFields.name,
  color: TeamFields.color,
  description: TeamFields.description.default(''),
  instructions: TeamFields.instructions.default(''),
  leaderUserId: TeamFields.leaderUserId.default(null),
});
const UpdateTeam = z.object(TeamFields).partial().extend({ version: z.number().int() });

export const MISSION_STATUSES = ['a_preparer', 'affectee', 'en_deplacement', 'en_position', 'terminee', 'releve_necessaire', 'incident'] as const;
type MissionStatus = (typeof MISSION_STATUSES)[number];

/**
 * Transitions autorisées. Terminer une mission ne libère pas le point : la mission reste active (« terminée »)
 * jusqu'à une décision explicite (réaffectation, annulation, relève).
 */
export const TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  a_preparer: ['affectee'],
  affectee: ['a_preparer', 'en_deplacement', 'en_position'],
  en_deplacement: ['affectee', 'en_position', 'incident'],
  en_position: ['terminee', 'releve_necessaire', 'incident'],
  releve_necessaire: ['en_position', 'terminee', 'incident'],
  incident: ['en_deplacement', 'en_position', 'releve_necessaire', 'terminee'],
  terminee: ['affectee'],
};

export function publicTeam(r: Record<string, unknown>) {
  return {
    id: r.id, eventId: r.event_id, name: r.name, color: r.color, description: r.description, instructions: r.instructions,
    leaderUserId: r.leader_user_id, leaderName: r.leader_name ?? null, status: r.status, disabled: !!r.disabled_at,
    leaderCanInvite: !!r.leader_can_invite, members: r.member_count ?? 0, pendingAdmissions: r.pending_count ?? 0,
    version: r.version, missions: r.missions ?? [],
  };
}

const TEAM_SELECT = `
  SELECT t.*, u.display_name AS leader_name,
         (SELECT count(*)::int FROM team_memberships tm WHERE tm.team_id = t.id) AS member_count,
         (SELECT count(*)::int FROM admission_requests a WHERE a.team_id = t.id AND a.status = 'en_attente') AS pending_count,
         coalesce((SELECT json_agg(json_build_object('id', m.id, 'position', m.position, 'status', m.status, 'version', m.version,
                                                     'instructions', m.instructions, 'pointId', p.id, 'pointName', p.name,
                                                     'distance', p.distance_m, 'pointDeleted', p.deleted_at IS NOT NULL,
                                                     'position_lonlat', json_build_array(ST_X(p.geom), ST_Y(p.geom)))
                             ORDER BY m.position)
                     FROM missions m JOIN mission_points p ON p.id = m.mission_point_id
                    WHERE m.team_id = t.id AND m.cancelled_at IS NULL), '[]') AS missions
    FROM teams t LEFT JOIN users u ON u.id = t.leader_user_id`;

async function loadTeam(c: Client, id: number) {
  return publicTeam((await c.query(TEAM_SELECT + ' WHERE t.id = $1', [id])).rows[0]);
}

async function checkLeader(c: Client, eventId: number, userId: number | null | undefined) {
  if (userId === null || userId === undefined) return;
  const r = await c.query('SELECT 1 FROM event_memberships WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
  if (!r.rowCount) throw badRequest("Le responsable doit avoir accès à l'événement.");
}

export async function teamRoutes(app: FastifyInstance) {
  app.get('/api/events/:id/teams', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const r = await app.db.query(TEAM_SELECT + ' WHERE t.event_id = $1 ORDER BY t.disabled_at NULLS FIRST, t.name', [eventId]);
    return r.rows.map(publicTeam);
  });

  app.post('/api/events/:id/teams', async (req, reply) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    const b = CreateTeam.parse(req.body);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, eventId, 'organisation');
      await checkLeader(c, eventId, b.leaderUserId);
      try {
        const r = await c.query(
          'INSERT INTO teams(event_id, name, color, description, instructions, leader_user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [eventId, b.name, b.color, b.description, b.instructions, b.leaderUserId],
        );
        await audit(c, { actorId: u.id, eventId, entity: 'team', entityId: r.rows[0].id, action: 'creation', details: { name: b.name } });
        // Statut seulement : la réponse part après la validation de la transaction.
        reply.status(201);
        return await loadTeam(c, r.rows[0].id);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw conflict('Une équipe porte déjà ce nom.');
        throw e;
      }
    });
  });

  app.patch('/api/teams/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = UpdateTeam.parse(req.body);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'teams', id, 'organisation');
      const cur = (await c.query('SELECT * FROM teams WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (cur.version !== b.version) throw conflict("L'équipe a été modifiée entre-temps.", { current: await loadTeam(c, id) });
      await checkLeader(c, eventId, b.leaderUserId);
      await c.query(
        `UPDATE teams SET name = coalesce($2, name), color = coalesce($3, color), description = coalesce($4, description),
                instructions = coalesce($5, instructions),
                leader_user_id = CASE WHEN $6::boolean THEN $7::bigint ELSE leader_user_id END,
                status = coalesce($8, status), leader_can_invite = coalesce($9, leader_can_invite), version = version + 1
          WHERE id = $1`,
        [id, b.name ?? null, b.color ?? null, b.description ?? null, b.instructions ?? null, b.leaderUserId !== undefined, b.leaderUserId ?? null, b.status ?? null, b.leaderCanInvite ?? null],
      );
      await audit(c, { actorId: u.id, eventId, entity: 'team', entityId: id, action: 'modification', details: { ...b, version: undefined } });
      return loadTeam(c, id);
    });
  });

  // Désactivation : l'équipe et ses missions sont conservées ; ses points apparaissent comme non affectés.
  app.post('/api/teams/:id/disable', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ disabled: z.boolean() }).parse(req.body);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'teams', id, 'organisation');
      await c.query('UPDATE teams SET disabled_at = CASE WHEN $2 THEN coalesce(disabled_at, now()) ELSE NULL END, version = version + 1 WHERE id = $1', [id, b.disabled]);
      await audit(c, { actorId: u.id, eventId, entity: 'team', entityId: id, action: b.disabled ? 'desactivation' : 'reactivation' });
      return loadTeam(c, id);
    });
  });

  // Affecter un point à l'équipe (à la fin de sa liste, ou à un rang donné).
  app.post('/api/teams/:id/missions', async (req, reply) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const b = z.object({ pointId: z.number().int().positive(), position: z.number().int().min(1).optional(), instructions: z.string().max(5000).default('') }).parse(req.body);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'teams', teamId, 'organisation');
      const team = (await c.query('SELECT disabled_at FROM teams WHERE id = $1 FOR UPDATE', [teamId])).rows[0];
      if (team.disabled_at) throw conflict('Équipe désactivée.');
      const p = (await c.query('SELECT event_id, deleted_at FROM mission_points WHERE id = $1', [b.pointId])).rows[0];
      if (!p || p.event_id !== eventId || p.deleted_at) throw notFound('Point');
      const dup = await c.query('SELECT 1 FROM missions WHERE team_id = $1 AND mission_point_id = $2 AND cancelled_at IS NULL', [teamId, b.pointId]);
      if (dup.rowCount) throw conflict('Ce point est déjà dans la liste de cette équipe.');
      const count = (await c.query('SELECT count(*)::int AS n FROM missions WHERE team_id = $1 AND cancelled_at IS NULL', [teamId])).rows[0].n;
      const position = Math.min(b.position ?? count + 1, count + 1);
      // Décale les missions suivantes (en deux temps pour respecter l'unicité du rang).
      await c.query('UPDATE missions SET position = position + 1000000 WHERE team_id = $1 AND cancelled_at IS NULL AND position >= $2', [teamId, position]);
      await c.query('UPDATE missions SET position = position - 999999 WHERE team_id = $1 AND cancelled_at IS NULL AND position >= 1000000', [teamId]);
      const r = await c.query(
        "INSERT INTO missions(event_id, team_id, mission_point_id, position, status, instructions) VALUES ($1, $2, $3, $4, 'affectee', $5) RETURNING id",
        [eventId, teamId, b.pointId, position, b.instructions],
      );
      await audit(c, { actorId: u.id, eventId, entity: 'mission', entityId: r.rows[0].id, action: 'affectation', details: { teamId, pointId: b.pointId, position } });
      // Statut seulement : la réponse part après la validation de la transaction.
      reply.status(201);
      return await loadTeam(c, teamId);
    });
  });

  // Réordonner : la liste complète des missions actives de l'équipe, dans le nouvel ordre.
  app.put('/api/teams/:id/missions/order', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const b = z.object({ missionIds: z.array(z.number().int().positive()).max(1000) }).parse(req.body);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'teams', teamId, 'organisation');
      await c.query('SELECT 1 FROM teams WHERE id = $1 FOR UPDATE', [teamId]);
      const cur = (await c.query('SELECT id FROM missions WHERE team_id = $1 AND cancelled_at IS NULL', [teamId])).rows.map((r) => r.id as number);
      const same = cur.length === b.missionIds.length && new Set(b.missionIds).size === cur.length && cur.every((id) => b.missionIds.includes(id));
      if (!same) throw conflict("La liste ne correspond pas aux missions actuelles de l'équipe : rechargez.");
      for (let i = 0; i < b.missionIds.length; i++) {
        await c.query('UPDATE missions SET position = $2, updated_at = now() WHERE id = $1', [b.missionIds[i], 1000000 + i + 1]);
      }
      await c.query('UPDATE missions SET position = position - 1000000 WHERE team_id = $1 AND cancelled_at IS NULL', [teamId]);
      await audit(c, { actorId: u.id, eventId, entity: 'team', entityId: teamId, action: 'reordonnancement', details: { missionIds: b.missionIds } });
      return loadTeam(c, teamId);
    });
  });

  // Réaffecter une mission à une autre équipe (le statut repart à « affectée »).
  app.post('/api/missions/:id/reassign', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ teamId: z.number().int().positive(), version: z.number().int() }).parse(req.body);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'missions', id, 'organisation');
      const m = (await c.query('SELECT * FROM missions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (m.cancelled_at) throw conflict('Mission annulée.');
      if (m.version !== b.version) throw conflict('La mission a été modifiée entre-temps.');
      const t = (await c.query('SELECT event_id, disabled_at FROM teams WHERE id = $1 FOR UPDATE', [b.teamId])).rows[0];
      if (!t || t.event_id !== eventId) throw notFound('Équipe');
      if (t.disabled_at) throw conflict('Équipe désactivée.');
      if (b.teamId === m.team_id) return loadTeam(c, b.teamId);
      const dup = await c.query('SELECT 1 FROM missions WHERE team_id = $1 AND mission_point_id = $2 AND cancelled_at IS NULL', [b.teamId, m.mission_point_id]);
      if (dup.rowCount) throw conflict("Ce point est déjà dans la liste de l'équipe cible.");
      const n = (await c.query('SELECT count(*)::int AS n FROM missions WHERE team_id = $1 AND cancelled_at IS NULL', [b.teamId])).rows[0].n;
      await c.query("UPDATE missions SET team_id = $2, position = $3, status = 'affectee', version = version + 1, updated_at = now() WHERE id = $1", [id, b.teamId, n + 1]);
      await compactTeam(c, m.team_id);
      await audit(c, { actorId: u.id, eventId, entity: 'mission', entityId: id, action: 'reaffectation', details: { fromTeamId: m.team_id, toTeamId: b.teamId, previousStatus: m.status } });
      return loadTeam(c, b.teamId);
    });
  });

  // Changer le statut d'une mission, selon les transitions autorisées.
  app.post('/api/missions/:id/status', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ status: z.enum(MISSION_STATUSES), version: z.number().int() }).parse(req.body);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'missions', id, 'organisation');
      const m = (await c.query('SELECT * FROM missions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (m.cancelled_at) throw conflict('Mission annulée.');
      if (m.version !== b.version) throw conflict('La mission a été modifiée entre-temps.', { status: m.status, version: m.version });
      const allowed = TRANSITIONS[m.status as MissionStatus] ?? [];
      if (!allowed.includes(b.status)) {
        throw conflict('Passage de « ' + m.status + ' » à « ' + b.status + ' » non autorisé.', { allowed });
      }
      const r = await c.query(
        'UPDATE missions SET status = $2, version = version + 1, updated_at = now(), status_changed_at = now(), status_changed_by = $3 WHERE id = $1 RETURNING status, version',
        [id, b.status, u.id],
      );
      await audit(c, { actorId: u.id, eventId, entity: 'mission', entityId: id, action: 'statut', details: { from: m.status, to: b.status } });
      return { id, status: r.rows[0].status, version: r.rows[0].version };
    });
  });

  // Retirer un point de la liste d'une équipe (la mission est annulée et conservée dans l'historique).
  app.delete('/api/missions/:id', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'missions', id, 'organisation');
      const m = (await c.query('SELECT * FROM missions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (m.cancelled_at) throw conflict('Mission déjà annulée.');
      await c.query("UPDATE missions SET status = 'annulee', cancelled_at = now(), version = version + 1, updated_at = now() WHERE id = $1", [id]);
      await compactTeam(c, m.team_id);
      await audit(c, { actorId: u.id, eventId, entity: 'mission', entityId: id, action: 'annulation', details: { previousStatus: m.status } });
      return loadTeam(c, m.team_id);
    });
  });
}
