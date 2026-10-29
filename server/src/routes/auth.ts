// Connexion des comptes administrés. Il n'existe volontairement aucune route d'inscription.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../app.js';
import { SESSION_COOKIE, createSession, revokeSession, verifyPassword } from '../auth.js';
import { audit } from '../audit.js';
import { HttpError } from '../errors.js';

const LoginBody = z.object({ login: z.string().trim().toLowerCase().min(1).max(64), password: z.string().min(1).max(200) });

/** Tentatives échouées par identifiant (en mémoire : suffisant pour une instance unique). */
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const f = failures.get(body.login);
    if (f && f.count >= MAX_FAILURES && f.until > Date.now()) {
      throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
    }
    const r = await app.db.query('SELECT id, password_hash, disabled_at FROM users WHERE login = $1', [body.login]);
    const u = r.rows[0];
    const ok = await verifyPassword(body.password, u?.password_hash ?? null);
    if (!u || !ok || u.disabled_at) {
      // Purge des entrées expirées pour que des identifiants inventés ne remplissent pas la mémoire.
      if (failures.size > 10000) for (const [k, v] of failures) if (v.until <= Date.now()) failures.delete(k);
      const prev = failures.get(body.login);
      const cur = prev && prev.until > Date.now() ? prev : { count: 0, until: 0 };
      failures.set(body.login, { count: cur.count + 1, until: Date.now() + LOCK_MS });
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
    }
    failures.delete(body.login);
    const token = await createSession(app.db, u.id, app.config.sessionTtlHours, req.headers['user-agent']);
    await audit(app.db, { actorId: u.id, eventId: null, entity: 'user', entityId: u.id, action: 'connexion' });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: app.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: app.config.sessionTtlHours * 3600,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) await revokeSession(app.db, req.user.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const u = requireUser(req);
    return { id: u.id, login: u.login, displayName: u.displayName, globalRole: u.globalRole };
  });
}

/** Pour les tests : remet à zéro les compteurs de tentatives. */
export function resetLoginFailures() {
  failures.clear();
}
