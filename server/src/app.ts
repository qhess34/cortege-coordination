import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { SESSION_COOKIE, loadSession, type SessionUser } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import type { OsmFetcher } from './services/overpass.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { pointRoutes } from './routes/points.js';
import { suggestionRoutes } from './routes/suggestions.js';
import { teamRoutes } from './routes/teams.js';
import { trackRoutes } from './routes/tracks.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
  interface FastifyInstance {
    db: Db;
    config: Config;
    osm: OsmFetcher;
  }
}

export interface AppDeps {
  db: Db;
  config: Config;
  osm: OsmFetcher;
  logger?: boolean;
}

/** Chemins dont l'URL ne doit jamais apparaître dans les journaux (jetons d'invitation). */
const SENSITIVE_PATH = /^\/(rejoindre|api\/invitations)\//;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger
      ? {
          serializers: {
            req: (req) => ({ method: req.method, url: SENSITIVE_PATH.test(req.url) ? '[masqué]' : req.url.split('?')[0] }),
          },
        }
      : false,
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });
  app.decorate('db', deps.db);
  app.decorate('config', deps.config);
  app.decorate('osm', deps.osm);
  app.decorateRequest('user', null);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: deps.config.maxGpxBytes, files: 1 } });
  await app.register(rateLimit, { global: false });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    if (!req.url.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');
    // Protection CSRF complémentaire au cookie SameSite : un formulaire d'un autre site ne peut pas
    // ajouter cet en-tête.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'cortege') {
      throw new HttpError(403, 'En-tête X-Requested-With manquant.');
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.user = await loadSession(app.db, token, app.config.sessionTtlHours);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'Données invalides.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: 'Fichier trop volumineux.' });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Erreur interne.' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(eventRoutes);
  await app.register(trackRoutes);
  await app.register(suggestionRoutes);
  await app.register(pointRoutes);
  await app.register(teamRoutes);
  return app;
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Connexion requise.');
  return req.user;
}

/** Paramètre d'URL numérique. */
export function idParam(req: FastifyRequest, name = 'id'): number {
  const v = Number((req.params as Record<string, string>)[name]);
  if (!Number.isSafeInteger(v) || v <= 0) throw new HttpError(404, 'Ressource introuvable.');
  return v;
}
