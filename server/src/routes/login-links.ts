// Connexion des comptes par lien (« lien magique »). Trois façons de l'obtenir :
//  - « Connecter un autre appareil » : un compte connecté affiche un QR code (10 min) à scanner avec son téléphone ;
//  - un administrateur crée un lien pour un compte (72 h) et le transmet lui-même ;
//  - lien envoyé par e-mail depuis la page de connexion (15 min), si un serveur SMTP est configuré.
// Usage unique ; seul le hash du jeton est stocké ; l'adresse /connexion/<jeton> est masquée dans les journaux.
// La consommation se fait par POST (bouton « Se connecter ») : un logiciel qui pré-ouvre les liens d'un e-mail ne la
// déclenche pas.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { SESSION_COOKIE, createSession, createSessionUntil, hashToken } from '../auth.js';
import { audit } from '../audit.js';
import { tx, type Client } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { requireAdmin } from '../permissions.js';

const MINUTES = { appareil: 10, admin: 72 * 60, email: 15, equipe: 72 * 60 } as const;
export type LinkKind = keyof typeof MINUTES;
/** Session d'un membre ouverte par lien : 30 jours au plus, sans dépasser l'expiration du compte. */
const MEMBER_SESSION_DAYS = 30;

/** Crée un lien de connexion à usage unique ; seul le hash du jeton est stocké. */
export async function createLoginLink(c: Client, userId: number, kind: LinkKind, createdBy: number | null) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + MINUTES[kind] * 60_000);
  await c.query('INSERT INTO login_links(token_hash, user_id, kind, created_by, expires_at) VALUES ($1, $2, $3, $4, $5)', [hashToken(token), userId, kind, createdBy, expiresAt]);
  return { path: '/connexion/' + token, expiresAt };
}

/** Adresse publique du site (PUBLIC_URL, sinon déduite de la requête). */
export const publicBase = (app: FastifyInstance, req: FastifyRequest) => app.config.publicUrl ?? req.protocol + '://' + req.host;

/** Envois d'e-mails récents par adresse (en mémoire) : un lien toutes les 2 minutes au plus. */
const lastMail = new Map<string, number>();

export async function loginLinkRoutes(app: FastifyInstance) {
  const create = (userId: number, kind: LinkKind, createdBy: number | null) => createLoginLink(app.db, userId, kind, createdBy);
  const base = (req: FastifyRequest) => publicBase(app, req);

  // Ce que la page de connexion peut proposer.
  app.get('/api/auth/options', async () => ({ emailLinks: !!app.mailer }));

  // Compte connecté : lien pour connecter un autre appareil (QR code).
  app.post('/api/auth/liens', async (req, reply) => {
    const u = requireUser(req);
    const link = await create(u.id, 'appareil', u.id);
    await audit(app.db, { actorId: u.id, eventId: null, entity: 'user', entityId: u.id, action: 'lien_connexion', details: { kind: 'appareil' } });
    reply.status(201);
    return { ...link, url: base(req) + link.path };
  });

  // Administrateur : lien de connexion pour un compte (à transmettre par un canal sûr).
  app.post('/api/admin/users/:id/lien', async (req, reply) => {
    const me = requireUser(req);
    requireAdmin(me);
    const id = idParam(req);
    const u = (await app.db.query('SELECT id, disabled_at, expires_at FROM users WHERE id = $1', [id])).rows[0];
    if (!u) throw notFound('Compte');
    if (u.disabled_at || (u.expires_at && new Date(u.expires_at) < new Date())) throw new HttpError(409, 'Ce compte est désactivé ou expiré.');
    const link = await create(id, 'admin', me.id);
    await audit(app.db, { actorId: me.id, eventId: null, entity: 'user', entityId: id, action: 'lien_connexion', details: { kind: 'admin' } });
    reply.status(201);
    return { ...link, url: base(req) + link.path };
  });

  // Page de connexion : recevoir un lien par e-mail. Réponse identique que l'adresse existe ou non.
  app.post('/api/auth/lien-email', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    if (!app.mailer) throw new HttpError(501, 'L’envoi d’e-mails n’est pas configuré sur ce serveur.');
    const b = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).parse(req.body);
    const done = { ok: true, message: 'Si un compte correspond à cette adresse, un lien de connexion vient d’y être envoyé (valable 15 minutes).' };
    const last = lastMail.get(b.email);
    if (last && Date.now() - last < 120_000) return done;
    const u = (await app.db.query("SELECT id, display_name FROM users WHERE lower(email) = $1 AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at > now())", [b.email])).rows[0];
    if (!u) return done;
    lastMail.set(b.email, Date.now());
    if (lastMail.size > 10000) for (const [k, v] of lastMail) if (Date.now() - v > 120_000) lastMail.delete(k);
    const link = await create(u.id, 'email', null);
    try {
      await app.mailer(b.email, 'Votre lien de connexion',
        'Bonjour ' + u.display_name + ',\n\nPour vous connecter à la coordination de cortège, ouvrez ce lien (valable 15 minutes, utilisable une seule fois) :\n\n' +
        base(req) + link.path + '\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.\n');
    } catch (e) {
      req.log.error({ err: (e as Error).message }, 'envoi du lien de connexion impossible');
      throw new HttpError(502, 'L’e-mail n’a pas pu être envoyé. Réessayez plus tard.');
    }
    await audit(app.db, { actorId: null, eventId: null, entity: 'user', entityId: u.id, action: 'lien_connexion', details: { kind: 'email' } });
    return done;
  });

  const linkLimit = { config: { rateLimit: { max: app.config.linkRateLimit, timeWindow: '1 minute' } } };
  const state = (l: Record<string, unknown> | undefined) =>
    !l ? 'inconnu' : l.used_at ? 'utilise' : new Date(l.expires_at as string) < new Date() ? 'expire'
      : l.disabled_at || (l.account_expires_at && new Date(l.account_expires_at as string) < new Date()) ? 'desactive' : 'valide';
  const MESSAGES: Record<string, string> = {
    inconnu: 'Lien de connexion inconnu.',
    utilise: 'Ce lien a déjà servi. Demandez-en un nouveau.',
    expire: 'Ce lien a expiré. Demandez-en un nouveau.',
    desactive: 'Ce compte est désactivé ou expiré.',
  };

  // Aperçu du lien (sans connexion).
  app.get('/api/auth/lien/:token', linkLimit, async (req) => {
    const token = String((req.params as Record<string, string>).token);
    const l = (await app.db.query(
      'SELECT k.*, u.display_name, u.disabled_at, u.expires_at AS account_expires_at FROM login_links k JOIN users u ON u.id = k.user_id WHERE k.token_hash = $1', [hashToken(token)],
    )).rows[0];
    const s = state(l);
    if (s === 'inconnu') throw notFound('Lien de connexion');
    return { state: s, displayName: l.display_name, message: s === 'valide' ? null : MESSAGES[s] };
  });

  // Connexion : le lien est consommé et une session est ouverte sur cet appareil.
  app.post('/api/auth/lien/:token', linkLimit, async (req, reply) => {
    const token = String((req.params as Record<string, string>).token);
    const who = await tx(app.db, async (c) => {
      const l = (await c.query(
        'SELECT k.*, u.disabled_at, u.expires_at AS account_expires_at, u.global_role FROM login_links k JOIN users u ON u.id = k.user_id WHERE k.token_hash = $1 FOR UPDATE OF k', [hashToken(token)],
      )).rows[0];
      const s = state(l);
      if (s === 'inconnu') throw notFound('Lien de connexion');
      if (s !== 'valide') throw new HttpError(410, MESSAGES[s]!, { state: s });
      await c.query('UPDATE login_links SET used_at = now() WHERE id = $1', [l.id]);
      await audit(c, { actorId: l.user_id, eventId: null, entity: 'user', entityId: l.user_id, action: 'connexion', details: { lien: l.kind } });
      return { userId: l.user_id as number, member: l.global_role === 'membre', accountExpires: l.account_expires_at as string | null };
    });
    // Membre : il reste connecté sur ce téléphone plusieurs jours (il n'a pas de mot de passe).
    let until = new Date(Date.now() + app.config.sessionTtlHours * 3600_000);
    if (who.member) {
      until = new Date(Date.now() + MEMBER_SESSION_DAYS * 86_400_000);
      if (who.accountExpires && new Date(who.accountExpires) < until) until = new Date(who.accountExpires);
    }
    const session = who.member
      ? await createSessionUntil(app.db, who.userId, until, req.headers['user-agent'])
      : await createSession(app.db, who.userId, app.config.sessionTtlHours, req.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, session, {
      httpOnly: true, secure: app.config.cookieSecure, sameSite: 'lax', path: '/', maxAge: Math.max(60, Math.round((until.getTime() - Date.now()) / 1000)),
    });
    return { ok: true };
  });
}

/** Pour les tests : oublie les envois récents. */
export function resetMailThrottle() {
  lastMail.clear();
}
