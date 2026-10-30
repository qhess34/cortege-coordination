// Suivi en arrière-plan avec l'application OwnTracks (mode HTTP, https://owntracks.org).
// Le membre configure l'application d'un clic (lien owntracks:///config?inline=…) ; elle envoie alors ses positions
// à /api/owntracks avec un identifiant de suivi propre (authentification Basic), y compris écran éteint. Les points de
// mission de l'équipe lui sont envoyés comme zones : l'entrée dans une zone vaut arrivée au point.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import { hashToken } from '../auth.js';
import { tx, type Client } from '../db.js';
import { HttpError, forbidden, notFound } from '../errors.js';
import type { Position } from '../geo/route.js';
import { eventRole, requireEventRole } from '../permissions.js';
import { autoProgress, detectArrival, isTeamMember, storePosition } from '../services/locations.js';
import { requireTeamMember } from './terrain.js';

/** Positions plus anciennes (envoyées en différé après une coupure) : ignorées pour le suivi en direct. */
const MAX_FIX_AGE_S = 600;

/** Réglages envoyés à l'application : suivi « move » (≈ 30 s ou 20 m), commandes à distance autorisées. */
const TRACKING = { monitoring: 2, locatorInterval: 30, locatorDisplacement: 20, moveModeLocatorInterval: 30 };

/** Fin de validité : le lendemain de la manifestation (ou 24 h si aucune date), 7 jours au plus. */
function expiry(endsAt: Date | null, startsAt: Date | null): Date {
  const now = Date.now();
  const end = endsAt ?? startsAt;
  const t = end ? end.getTime() + 24 * 3600_000 : now + 24 * 3600_000;
  return new Date(Math.min(Math.max(t, now + 3600_000), now + 7 * 24 * 3600_000));
}

/** Initiales affichées par l'application (champ `tid`, 2 caractères). */
const initials = (name: string) => {
  const parts = name.normalize('NFD').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  const t = (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? 'CT').slice(0, 2)).toUpperCase();
  return t.length === 2 ? t : (t + 'T').slice(0, 2);
};

interface Zone { _type: 'waypoint'; desc: string; lat: number; lon: number; rad: number; tst: number; rid: string }

/** Zones = points de mission actifs de l'équipe, et leur « version » (pour ne les renvoyer qu'en cas de changement). */
async function teamZones(c: Client, teamId: number, radius: number): Promise<{ zones: Zone[]; version: string }> {
  const r = await c.query(
    `SELECT m.id, p.name, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, extract(epoch FROM p.created_at)::bigint AS tst
       FROM missions m JOIN mission_points p ON p.id = m.mission_point_id
      WHERE m.team_id = $1 AND m.cancelled_at IS NULL AND m.status <> 'terminee' ORDER BY m.position`,
    [teamId],
  );
  const zones = r.rows.map((m): Zone => ({
    _type: 'waypoint', desc: m.name + ' #' + m.id, lat: +Number(m.lat).toFixed(6), lon: +Number(m.lon).toFixed(6), rad: radius, tst: Number(m.tst), rid: 'mission-' + m.id,
  }));
  const version = createHash('sha256').update(JSON.stringify(zones)).digest('base64url').slice(0, 16);
  return { zones, version };
}

/** Commande qui remplace les zones de l'application par celles de l'équipe. */
const setZones = (zones: Zone[]) => [
  { _type: 'cmd', action: 'clearWaypoints' },
  { _type: 'cmd', action: 'setWaypoints', waypoints: { _type: 'waypoints', waypoints: zones } },
];
/** Commande qui met l'application au repos (fin de manifestation, partage coupé, identifiant révoqué). */
const QUIET = [{ _type: 'cmd', action: 'setConfiguration', configuration: { _type: 'configuration', monitoring: -1 } }, { _type: 'cmd', action: 'clearWaypoints' }];

/** Identifiant et secret de l'en-tête « Authorization: Basic ». */
function basicAuth(req: FastifyRequest): { user: string; password: string } | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Basic ')) return null;
  const raw = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = raw.indexOf(':');
  return i < 0 ? null : { user: raw.slice(0, i), password: raw.slice(i + 1) };
}

const OwnTracksMessage = z.object({
  _type: z.string(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  acc: z.number().min(0).optional(),
  tst: z.number().int().optional(),
  batt: z.number().int().min(0).max(100).optional(),
  event: z.string().optional(),
  rid: z.string().optional(),
  desc: z.string().optional(),
}).passthrough();

export async function owntracksRoutes(app: FastifyInstance) {
  // OwnTracks peut envoyer un corps vide (suppression d'un « ami ») : le JSON vide est accepté sur ces routes.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
    const text = String(body).trim();
    if (!text) return done(null, null);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new HttpError(400, 'JSON invalide.'), undefined);
    }
  });

  // --- Côté membre : configurer OwnTracks sur son téléphone ------------------------------------------------------
  app.post('/api/terrain/equipes/:id/owntracks', async (req, reply) => {
    const u = requireUser(req);
    const teamId = idParam(req);
    const out = await tx(app.db, async (c) => {
      const access = await requireTeamMember(c, u, teamId);
      const ev = (await c.query('SELECT location_sharing, starts_at, ends_at, zone_radius_m FROM events WHERE id = $1', [access.eventId])).rows[0];
      if (!ev.location_sharing) throw new HttpError(409, 'Le partage de position n’est pas activé pour cette manifestation.');
      if (!(await isTeamMember(c, u.id, teamId))) throw forbidden();
      // Un seul identifiant actif par membre : reconfigurer révoque le précédent (ancien téléphone).
      await c.query('UPDATE trackers SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
      const id = 'ct' + randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
      const secret = randomBytes(24).toString('base64url');
      const expiresAt = expiry(ev.ends_at, ev.starts_at);
      const { zones, version } = await teamZones(c, teamId, ev.zone_radius_m);
      await c.query(
        'INSERT INTO trackers(id, secret_hash, user_id, team_id, event_id, expires_at, waypoints_version) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, hashToken(secret), u.id, teamId, access.eventId, expiresAt, version],
      );
      await audit(c, { actorId: u.id, eventId: access.eventId, entity: 'tracker', entityId: null, action: 'creation', details: { teamId, tracker: id } });
      const base = app.config.publicUrl ?? req.protocol + '://' + req.host;
      const configuration = {
        _type: 'configuration',
        mode: 3, url: base + '/api/owntracks', auth: true, username: id, password: secret,
        deviceId: 'cortege', tid: initials(u.displayName),
        ...TRACKING,
        cmd: true, remoteConfiguration: true, allowRemoteLocation: true, extendedData: true,
        waypoints: zones,
      };
      return { id, expiresAt, configuration };
    });
    reply.status(201);
    // Le lien contient le secret : il n'est renvoyé qu'ici, une seule fois, et n'est jamais journalisé.
    return {
      trackerId: out.id, expiresAt: out.expiresAt,
      link: 'owntracks:///config?inline=' + Buffer.from(JSON.stringify(out.configuration)).toString('base64'),
    };
  });

  // Arrêt d'OwnTracks par le membre : l'identifiant est révoqué et la position effacée.
  app.delete('/api/terrain/owntracks', async (req) => {
    const u = requireUser(req);
    await tx(app.db, async (c) => {
      const r = await c.query('UPDATE trackers SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING event_id', [u.id]);
      await c.query("DELETE FROM member_locations WHERE user_id = $1 AND source = 'owntracks'", [u.id]);
      if (r.rows[0]) app.live.publish(r.rows[0].event_id, 'positions');
    });
    return { ok: true };
  });

  // --- Côté organisation : identifiants de suivi actifs, révocation ----------------------------------------------
  app.get('/api/events/:id/trackers', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    if ((await requireEventRole(app.db, u, eventId, 'lecture')) !== 'organisateur') throw forbidden();
    const r = await app.db.query(
      `SELECT k.id, k.created_at, k.expires_at, k.last_seen_at, k.battery, u.display_name, t.name AS team_name, t.color
         FROM trackers k JOIN users u ON u.id = k.user_id JOIN teams t ON t.id = k.team_id
        WHERE k.event_id = $1 AND k.revoked_at IS NULL AND k.expires_at > now() ORDER BY t.name, u.display_name`,
      [eventId],
    );
    return r.rows.map((k) => ({
      id: k.id, displayName: k.display_name, teamName: k.team_name, color: k.color, createdAt: k.created_at, expiresAt: k.expires_at,
      lastSeenAt: k.last_seen_at, battery: k.battery,
    }));
  });

  app.post('/api/trackers/:id/revoke', async (req) => {
    const u = requireUser(req);
    const id = String((req.params as Record<string, string>).id);
    return tx(app.db, async (c) => {
      const k = (await c.query('SELECT * FROM trackers WHERE id = $1', [id])).rows[0];
      if (!k || (await eventRole(c, u, k.event_id)) === null) throw notFound('Identifiant de suivi');
      if ((await eventRole(c, u, k.event_id)) !== 'organisateur') throw forbidden();
      await c.query('UPDATE trackers SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1', [id]);
      await c.query("DELETE FROM member_locations WHERE user_id = $1 AND source = 'owntracks'", [k.user_id]);
      await audit(c, { actorId: u.id, eventId: k.event_id, entity: 'tracker', entityId: null, action: 'revocation', details: { tracker: id } });
      return { ok: true };
    });
  });

  // --- Réception des messages de l'application -------------------------------------------------------------------
  // Pas d'en-tête anti-CSRF ici (l'application ne l'envoie pas) : l'accès repose uniquement sur l'authentification
  // Basic de l'identifiant de suivi, jamais sur le cookie de session.
  app.post('/api/owntracks', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const auth = basicAuth(req);
    const k = auth ? (await app.db.query('SELECT * FROM trackers WHERE id = $1', [auth.user])).rows[0] : null;
    const ok = !!k && !!auth && timingSafeEqual(Buffer.from(k.secret_hash), hashToken(auth.password));
    if (!ok) {
      reply.header('www-authenticate', 'Basic realm="cortege"');
      throw new HttpError(401, 'Identifiant de suivi inconnu.');
    }
    // Identifiant révoqué ou expiré, partage coupé, membre retiré : on demande à l'application de se mettre au repos.
    const ev = (await app.db.query('SELECT location_sharing, zone_radius_m FROM events WHERE id = $1', [k.event_id])).rows[0];
    const active = !k.revoked_at && new Date(k.expires_at) > new Date() && !!ev?.location_sharing && (await isTeamMember(app.db, k.user_id, k.team_id));
    if (!active) return QUIET;

    const parsed = OwnTracksMessage.safeParse(req.body ?? {});
    const msg = parsed.success ? parsed.data : null;
    const result = await tx(app.db, async (c) => {
      await c.query('UPDATE trackers SET last_seen_at = now(), battery = coalesce($2, battery) WHERE id = $1', [k.id, msg?.batt ?? null]);
      let moved = false;
      let progressed = false;
      if (msg && (msg._type === 'location' || msg._type === 'transition') && msg.lat !== undefined && msg.lon !== undefined) {
        const position: Position = [msg.lon, msg.lat];
        const fresh = msg.tst === undefined || Date.now() / 1000 - msg.tst <= MAX_FIX_AGE_S;
        if (fresh) {
          await storePosition(c, { userId: k.user_id, eventId: k.event_id, teamId: k.team_id, position, accuracy: msg.acc ?? null, source: 'owntracks', battery: msg.batt ?? null });
          moved = true;
          // Entrée dans la zone d'un point (« transition ») ou position assez proche : arrivée au point.
          const zone = msg._type === 'transition' && msg.event === 'enter' ? /^mission-(\d+)$/.exec(msg.rid ?? '') ?? /#(\d+)$/.exec(msg.desc ?? '') : null;
          await detectArrival(c, {
            userId: k.user_id, eventId: k.event_id, teamId: k.team_id, position, accuracy: msg.acc ?? null, zoneMissionId: zone ? Number(zone[1]) : null,
          });
          progressed = await autoProgress(c, { eventId: k.event_id, teamId: k.team_id });
        }
      }
      // Zones à jour ? Sinon elles sont renvoyées dans la réponse.
      const { zones, version } = await teamZones(c, k.team_id, ev.zone_radius_m);
      if (version !== k.waypoints_version) {
        await c.query('UPDATE trackers SET waypoints_version = $2 WHERE id = $1', [k.id, version]);
        return { moved, progressed, reply: setZones(zones) };
      }
      return { moved, progressed, reply: [] };
    });
    if (result.moved) app.live.publish(k.event_id, 'positions');
    if (result.progressed) app.live.publish(k.event_id);
    return result.reply;
  });
}
