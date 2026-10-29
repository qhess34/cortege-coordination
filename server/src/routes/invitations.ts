// Invitations (QR code d'équipe, lien individuel), admission des participants, membres des équipes, et espace
// « moi » des participants. Les participants n'ont ni identifiant ni mot de passe : l'invitation leur ouvre une
// session sécurisée (cookie HttpOnly), limitée à leur équipe.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { SESSION_COOKIE, createSessionUntil, hashToken, revokeUserSessions } from '../auth.js';
import { audit } from '../audit.js';
import { tx, type Client } from '../db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { requireTeamManager } from '../permissions.js';

/** Durée maximale d'une session de participant. */
const MAX_SESSION_DAYS = 30;
const DEFAULT_LINK_HOURS = 72;

const newToken = () => randomBytes(24).toString('base64url');

type InvitationState = 'valide' | 'revoquee' | 'suspendue' | 'expiree' | 'utilisee' | 'complete' | 'equipe_fermee';

const STATE_TEXT: Record<Exclude<InvitationState, 'valide'>, string> = {
  revoquee: 'Cette invitation a été révoquée.',
  suspendue: 'Les admissions sont suspendues pour le moment. Réessayez plus tard ou contactez l’organisation.',
  expiree: 'Cette invitation a expiré.',
  utilisee: 'Ce lien a déjà été utilisé. Si c’était vous, ouvrez simplement l’application : votre session est conservée sur cet appareil.',
  complete: 'Le nombre maximal de personnes pour cette invitation est atteint.',
  equipe_fermee: 'Cette équipe n’accepte plus de membres.',
};

function invitationState(inv: Record<string, unknown>, teamDisabled: boolean): InvitationState {
  if (inv.revoked_at) return 'revoquee';
  if (teamDisabled) return 'equipe_fermee';
  if (inv.suspended) return 'suspendue';
  if (inv.expires_at && new Date(inv.expires_at as string) <= new Date()) return 'expiree';
  if (inv.kind === 'individuelle' && (inv.uses as number) >= 1) return 'utilisee';
  if (inv.max_uses !== null && (inv.uses as number) >= (inv.max_uses as number)) return 'complete';
  return 'valide';
}

/** Fin de session d'un participant : lendemain de la manifestation (au moins 12 h), au plus 30 jours. */
function participantSessionEnd(endsAt: string | null, startsAt: string | null): Date {
  const now = Date.now();
  const ref = endsAt ?? startsAt;
  const target = ref ? new Date(ref).getTime() + 24 * 3600_000 : now + 7 * 24 * 3600_000;
  return new Date(Math.min(Math.max(target, now + 12 * 3600_000), now + MAX_SESSION_DAYS * 24 * 3600_000));
}

function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string, until: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: app.config.cookieSecure, sameSite: 'lax', path: '/',
    maxAge: Math.max(60, Math.round((until.getTime() - Date.now()) / 1000)),
  });
}

function publicInvitation(r: Record<string, unknown>, teamDisabled = false) {
  return {
    id: r.id, teamId: r.team_id, kind: r.kind, admission: r.admission, role: r.role, label: r.label,
    maxUses: r.max_uses, uses: r.uses, expiresAt: r.expires_at, suspended: r.suspended, revokedAt: r.revoked_at,
    createdAt: r.created_at, participantId: r.participant_id ?? null,
    // QR code d'équipe : jeton réaffichable (il ne donne que le rôle de membre, avec limites). Lien individuel : jamais.
    token: r.kind === 'equipe' ? r.public_token : null,
    state: invitationState(r, teamDisabled),
  };
}

/** Ajoute un compte ou un participant à l'équipe (et lui donne accès à l'événement). */
async function addToTeam(c: Client, eventId: number, teamId: number, userId: number, role: 'membre' | 'responsable', invitationId: number | null) {
  await c.query(
    `INSERT INTO event_memberships(event_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO NOTHING`,
    [eventId, userId, role],
  );
  await c.query(
    `INSERT INTO team_memberships(team_id, user_id, role, invitation_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [teamId, userId, role, invitationId],
  );
}

/** Retire l'accès d'un participant immédiatement : sessions révoquées, compte désactivé. */
async function cutParticipant(c: Client, userId: number) {
  await revokeUserSessions(c, userId);
  await c.query("UPDATE users SET disabled_at = coalesce(disabled_at, now()) WHERE id = $1 AND account_type = 'participant'", [userId]);
  await c.query('DELETE FROM event_memberships WHERE user_id = $1', [userId]);
}

const CreateInvitation = z.object({
  kind: z.enum(['equipe', 'individuelle']),
  admission: z.enum(['immediate', 'validation']).default('immediate'),
  role: z.enum(['membre', 'responsable']).default('membre'),
  label: z.string().trim().max(120).default(''),
  maxUses: z.number().int().min(1).max(10000).nullable().optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

export async function invitationRoutes(app: FastifyInstance) {
  // --- Côté participant : ouvrir une invitation, la valider -------------------------------------------------------
  const joinLimit = { config: { rateLimit: { max: app.config.joinRateLimit, timeWindow: '1 minute' } } };

  app.get('/api/rejoindre/:token', joinLimit, async (req) => {
    const token = String((req.params as Record<string, string>).token);
    const r = await app.db.query(
      `SELECT i.*, t.name AS team_name, t.color, t.disabled_at AS team_disabled, e.name AS event_name, e.starts_at, u.display_name AS participant_name
         FROM invitations i JOIN teams t ON t.id = i.team_id JOIN events e ON e.id = i.event_id
         LEFT JOIN users u ON u.id = i.participant_id
        WHERE i.token_hash = $1`,
      [hashToken(token)],
    );
    const inv = r.rows[0];
    if (!inv) throw notFound('Invitation');
    const state = invitationState(inv, !!inv.team_disabled);
    return {
      event: { name: inv.event_name, startsAt: inv.starts_at },
      team: { name: inv.team_name, color: inv.color },
      kind: inv.kind, admission: inv.admission, role: inv.role,
      recovery: inv.participant_id ? { name: inv.participant_name } : null,
      state, message: state === 'valide' ? null : STATE_TEXT[state],
    };
  });

  app.post('/api/rejoindre/:token', joinLimit, async (req, reply) => {
    const token = String((req.params as Record<string, string>).token);
    const b = z.object({ pseudonym: z.string().trim().min(1, 'Indiquez un nom ou un pseudonyme.').max(60).optional() }).parse(req.body ?? {});
    const out = await tx(app.db, async (c) => {
      const inv = (await c.query('SELECT * FROM invitations WHERE token_hash = $1 FOR UPDATE', [hashToken(token)])).rows[0];
      if (!inv) throw notFound('Invitation');
      const team = (await c.query('SELECT name, disabled_at FROM teams WHERE id = $1', [inv.team_id])).rows[0];
      const ev = (await c.query('SELECT starts_at, ends_at FROM events WHERE id = $1', [inv.event_id])).rows[0];
      const state = invitationState(inv, !!team.disabled_at);
      if (state !== 'valide') throw new HttpError(410, STATE_TEXT[state], { state });
      await c.query('UPDATE invitations SET uses = uses + 1 WHERE id = $1', [inv.id]);

      let userId: number;
      let status: 'admis' | 'en_attente';
      if (inv.participant_id) {
        // Récupération d'accès : le participant existant retrouve son équipe sur un nouvel appareil.
        const p = (await c.query('SELECT id, disabled_at FROM users WHERE id = $1', [inv.participant_id])).rows[0];
        if (!p || p.disabled_at) throw new HttpError(410, 'Cet accès a été retiré.', { state: 'revoquee' });
        await revokeUserSessions(c, p.id);
        userId = p.id;
        status = 'admis';
      } else {
        if (!b.pseudonym) throw badRequest('Indiquez un nom ou un pseudonyme.');
        userId = (
          await c.query(
            "INSERT INTO users(display_name, account_type, event_id) VALUES ($1, 'participant', $2) RETURNING id",
            [b.pseudonym, inv.event_id],
          )
        ).rows[0].id;
        if (inv.admission === 'immediate') {
          await addToTeam(c, inv.event_id, inv.team_id, userId, inv.role, inv.id);
          status = 'admis';
        } else {
          await c.query('INSERT INTO admission_requests(event_id, team_id, invitation_id, user_id, role) VALUES ($1, $2, $3, $4, $5)', [
            inv.event_id, inv.team_id, inv.id, userId, inv.role,
          ]);
          status = 'en_attente';
        }
      }
      // Jamais le jeton dans le journal : seulement l'identifiant de l'invitation.
      await audit(c, {
        actorId: userId, eventId: inv.event_id, entity: 'invitation', entityId: inv.id,
        action: inv.participant_id ? 'recuperation_acces' : status === 'admis' ? 'admission' : 'demande_admission',
        details: { teamId: inv.team_id, kind: inv.kind },
      });
      const until = participantSessionEnd(ev.ends_at, ev.starts_at);
      const sessionToken = await createSessionUntil(c, userId, until, req.headers['user-agent']);
      return { status, eventId: inv.event_id, teamId: inv.team_id, teamName: team.name, sessionToken, until };
    });
    setSessionCookie(app, reply, out.sessionToken, out.until);
    return { status: out.status, eventId: out.eventId, teamId: out.teamId, teamName: out.teamName };
  });

  // Espace du participant : son équipe et ses missions, rien d'autre.
  app.get('/api/moi', async (req) => {
    const u = requireUser(req);
    if (u.accountType !== 'participant') throw new HttpError(404, 'Réservé aux participants.');
    const ev = (await app.db.query('SELECT id, name, starts_at, ends_at, instructions, status FROM events WHERE id = $1', [u.eventId])).rows[0];
    const tm = (
      await app.db.query(
        `SELECT t.id, t.name, t.color, t.instructions, t.disabled_at, m.role, l.display_name AS leader_name
           FROM team_memberships m JOIN teams t ON t.id = m.team_id LEFT JOIN users l ON l.id = t.leader_user_id
          WHERE m.user_id = $1 ORDER BY m.joined_at LIMIT 1`,
        [u.id],
      )
    ).rows[0];
    const pending = (await app.db.query("SELECT t.name FROM admission_requests a JOIN teams t ON t.id = a.team_id WHERE a.user_id = $1 AND a.status = 'en_attente'", [u.id])).rows[0];
    let missions: unknown[] = [];
    if (tm) {
      missions = (
        await app.db.query(
          `SELECT m.position, m.status, m.instructions, p.name, p.type, p.description, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.distance_m
             FROM missions m JOIN mission_points p ON p.id = m.mission_point_id
            WHERE m.team_id = $1 AND m.cancelled_at IS NULL ORDER BY m.position`,
          [tm.id],
        )
      ).rows.map((m) => ({
        order: m.position, status: m.status, instructions: m.instructions,
        point: { name: m.name, type: m.type, description: m.description, position: [m.lon, m.lat], distance: m.distance_m },
      }));
    }
    return {
      participant: { id: u.id, displayName: u.displayName },
      event: { id: ev.id, name: ev.name, startsAt: ev.starts_at, endsAt: ev.ends_at, instructions: ev.instructions, status: ev.status },
      team: tm ? { id: tm.id, name: tm.name, color: tm.color, instructions: tm.instructions, role: tm.role, leaderName: tm.leader_name, closed: !!tm.disabled_at } : null,
      pendingTeam: pending ? pending.name : null,
      missions,
    };
  });

  // --- Côté organisation : invitations d'une équipe -----------------------------------------------------------------
  app.get('/api/teams/:id/invitations', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    await requireTeamManager(app.db, u, teamId);
    const disabled = !!(await app.db.query('SELECT disabled_at FROM teams WHERE id = $1', [teamId])).rows[0].disabled_at;
    const r = await app.db.query('SELECT * FROM invitations WHERE team_id = $1 ORDER BY created_at DESC', [teamId]);
    return r.rows.map((x) => publicInvitation(x, disabled));
  });

  app.post('/api/teams/:id/invitations', async (req, reply) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const b = CreateInvitation.parse(req.body);
    return tx(app.db, async (c) => {
      const { eventId, asOrganizer } = await requireTeamManager(c, u, teamId);
      // QR code d'équipe : toujours le rôle de membre. Seuls les organisateurs invitent des responsables.
      if (b.kind === 'equipe' && b.role !== 'membre') throw badRequest('Un QR code d’équipe ne donne que le rôle de membre.');
      if (b.role === 'responsable' && !asOrganizer) throw forbidden();
      const token = newToken();
      const expiresAt = b.expiresAt ?? (b.kind === 'individuelle' ? new Date(Date.now() + DEFAULT_LINK_HOURS * 3600_000).toISOString() : null);
      const maxUses = b.kind === 'individuelle' ? 1 : b.maxUses ?? null;
      const r = await c.query(
        `INSERT INTO invitations(event_id, team_id, kind, token_hash, public_token, admission, role, label, max_uses, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [eventId, teamId, b.kind, hashToken(token), b.kind === 'equipe' ? token : null, b.admission, b.role, b.label, maxUses, expiresAt, u.id],
      );
      await audit(c, {
        actorId: u.id, eventId, entity: 'invitation', entityId: r.rows[0].id, action: 'creation',
        details: { teamId, kind: b.kind, admission: b.admission, role: b.role, maxUses, expiresAt },
      });
      // Le jeton d'un lien individuel n'est renvoyé qu'ici, une seule fois.
      // Statut seulement : la réponse part après la validation de la transaction.
      reply.status(201);
      return { ...publicInvitation(r.rows[0]), token, path: '/rejoindre/' + token };
    });
  });

  const invitationAction = (action: 'revocation' | 'suspension' | 'reprise') =>
    async (req: FastifyRequest) => {
      const u = requireUser(req);
      const id = idParam(req);
      return tx(app.db, async (c) => {
        const inv = (await c.query('SELECT * FROM invitations WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!inv) throw notFound('Invitation');
        const { eventId } = await requireTeamManager(c, u, inv.team_id);
        const r = await c.query(
          action === 'revocation'
            ? 'UPDATE invitations SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 RETURNING *'
            : 'UPDATE invitations SET suspended = $2 WHERE id = $1 RETURNING *',
          action === 'revocation' ? [id] : [id, action === 'suspension'],
        );
        await audit(c, { actorId: u.id, eventId, entity: 'invitation', entityId: id, action });
        return publicInvitation(r.rows[0]);
      });
    };
  app.post('/api/invitations/:id/revoke', invitationAction('revocation'));
  app.post('/api/invitations/:id/suspend', invitationAction('suspension'));
  app.post('/api/invitations/:id/resume', invitationAction('reprise'));

  // --- Admissions en attente ---------------------------------------------------------------------------------------
  app.get('/api/teams/:id/admissions', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    await requireTeamManager(app.db, u, teamId);
    const r = await app.db.query(
      `SELECT a.id, a.created_at, a.role, u.display_name FROM admission_requests a JOIN users u ON u.id = a.user_id
        WHERE a.team_id = $1 AND a.status = 'en_attente' ORDER BY a.created_at`,
      [teamId],
    );
    return r.rows.map((x) => ({ id: x.id, displayName: x.display_name, role: x.role, createdAt: x.created_at }));
  });

  app.post('/api/admissions/:id/decide', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ accept: z.boolean() }).parse(req.body);
    return tx(app.db, async (c) => {
      const a = (await c.query('SELECT * FROM admission_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!a) throw notFound('Demande');
      const { eventId } = await requireTeamManager(c, u, a.team_id);
      if (a.status !== 'en_attente') throw conflict('Demande déjà traitée.');
      if (b.accept) await addToTeam(c, eventId, a.team_id, a.user_id, a.role, a.invitation_id);
      else await cutParticipant(c, a.user_id);
      await c.query('UPDATE admission_requests SET status = $2, decided_at = now(), decided_by = $3 WHERE id = $1', [id, b.accept ? 'acceptee' : 'refusee', u.id]);
      await audit(c, { actorId: u.id, eventId, entity: 'admission', entityId: id, action: b.accept ? 'acceptation' : 'refus', details: { userId: a.user_id, teamId: a.team_id } });
      return { ok: true };
    });
  });

  // --- Membres d'une équipe ----------------------------------------------------------------------------------------
  app.get('/api/teams/:id/members', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    await requireTeamManager(app.db, u, teamId);
    const r = await app.db.query(
      `SELECT u.id, u.display_name, u.account_type, u.disabled_at, m.role, m.joined_at,
              (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
         FROM team_memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 ORDER BY m.role DESC, u.display_name`,
      [teamId],
    );
    return r.rows.map((x) => ({
      id: x.id, displayName: x.display_name, accountType: x.account_type, role: x.role, joinedAt: x.joined_at,
      lastSeen: x.last_seen, disabled: !!x.disabled_at,
    }));
  });

  // Ajouter un compte administré existant (déjà autorisé sur l'événement) à l'équipe.
  app.post('/api/teams/:id/members', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const b = z.object({ userId: z.number().int().positive(), role: z.enum(['membre', 'responsable']).default('membre') }).parse(req.body);
    return tx(app.db, async (c) => {
      const { eventId, asOrganizer } = await requireTeamManager(c, u, teamId);
      if (!asOrganizer) throw forbidden();
      const ok = await c.query(
        "SELECT 1 FROM event_memberships m JOIN users x ON x.id = m.user_id WHERE m.event_id = $1 AND m.user_id = $2 AND x.account_type = 'compte' AND x.disabled_at IS NULL",
        [eventId, b.userId],
      );
      if (!ok.rowCount) throw badRequest("Ce compte n'a pas accès à la manifestation.");
      await c.query(
        'INSERT INTO team_memberships(team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role',
        [teamId, b.userId, b.role],
      );
      await audit(c, { actorId: u.id, eventId, entity: 'team_membership', entityId: b.userId, action: 'ajout', details: { teamId, role: b.role } });
      return { ok: true };
    });
  });

  // Retirer un membre : pour un participant, l'accès est coupé immédiatement (sessions révoquées).
  app.delete('/api/teams/:id/members/:userId', async (req) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const userId = idParam(req, 'userId');
    return tx(app.db, async (c) => {
      const { eventId } = await requireTeamManager(c, u, teamId);
      const m = (await c.query('SELECT x.account_type FROM team_memberships tm JOIN users x ON x.id = tm.user_id WHERE tm.team_id = $1 AND tm.user_id = $2', [teamId, userId])).rows[0];
      if (!m) throw notFound('Membre');
      if (userId === u.id) throw conflict('Vous ne pouvez pas vous retirer vous-même.');
      await c.query('DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
      if (m.account_type === 'participant') await cutParticipant(c, userId);
      await audit(c, { actorId: u.id, eventId, entity: 'team_membership', entityId: userId, action: 'retrait', details: { teamId } });
      return { ok: true };
    });
  });

  // Récupération d'accès d'un participant (nouveau téléphone, session perdue) : lien individuel à usage unique.
  app.post('/api/teams/:id/members/:userId/recovery', async (req, reply) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const userId = idParam(req, 'userId');
    return tx(app.db, async (c) => {
      const { eventId } = await requireTeamManager(c, u, teamId);
      const m = (await c.query("SELECT 1 FROM team_memberships tm JOIN users x ON x.id = tm.user_id WHERE tm.team_id = $1 AND tm.user_id = $2 AND x.account_type = 'participant' AND x.disabled_at IS NULL", [teamId, userId])).rowCount;
      if (!m) throw notFound('Participant');
      const token = newToken();
      const r = await c.query(
        `INSERT INTO invitations(event_id, team_id, kind, token_hash, admission, role, label, max_uses, expires_at, participant_id, created_by)
         VALUES ($1, $2, 'individuelle', $3, 'immediate', 'membre', 'Récupération d’accès', 1, now() + interval '24 hours', $4, $5) RETURNING *`,
        [eventId, teamId, hashToken(token), userId, u.id],
      );
      await audit(c, { actorId: u.id, eventId, entity: 'invitation', entityId: r.rows[0].id, action: 'creation_recuperation', details: { teamId, participantId: userId } });
      // Statut seulement : la réponse part après la validation de la transaction.
      reply.status(201);
      return { ...publicInvitation(r.rows[0]), token, path: '/rejoindre/' + token };
    });
  });
}

