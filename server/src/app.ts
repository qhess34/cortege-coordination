import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { SESSION_COOKIE, loadSession, type SessionUser } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { LiveHub, runWithTracking } from './services/live.js';
import type { OsmFetcher } from './services/overpass.js';
import type { WalkRouter } from './services/routing.js';
import type { Mailer } from './services/mailer.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { invitationRoutes } from './routes/invitations.js';
import { loginLinkRoutes } from './routes/login-links.js';
import { owntracksRoutes } from './routes/owntracks.js';
import { pointRoutes } from './routes/points.js';
import { roadbookRoutes } from './routes/roadbook.js';
import { suggestionRoutes } from './routes/suggestions.js';
import { teamRoutes } from './routes/teams.js';
import { terrainRoutes } from './routes/terrain.js';
import { trackRoutes } from './routes/tracks.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    /** Manifestations modifiées par la requête (signal temps réel). */
    touched: Set<number> | null;
  }
  interface FastifyInstance {
    db: Db;
    config: Config;
    osm: OsmFetcher;
    router: WalkRouter | null;
    mailer: Mailer | null;
    live: LiveHub;
  }
}

export interface AppDeps {
  db: Db;
  config: Config;
  osm: OsmFetcher;
  /** Itinéraires piétons (facultatif : sans lui, l'application propose un lien vers une carte externe). */
  router?: WalkRouter | null;
  /** Envoi d'e-mails (liens de connexion), facultatif. */
  mailer?: Mailer | null;
  logger?: boolean;
  /** Flux de journal (tests : vérifier qu'aucun jeton n'y apparaît). */
  logStream?: NodeJS.WritableStream;
}

/** Chemins dont l'URL ne doit jamais apparaître dans les journaux (jetons d'invitation). */
const SENSITIVE_PATH = /^\/(rejoindre|api\/rejoindre|connexion|api\/auth\/lien)\//;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger || deps.logStream
      ? {
          ...(deps.logStream ? { stream: deps.logStream } : {}),
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
  app.decorate('router', deps.router ?? null);
  app.decorate('mailer', deps.mailer ?? null);
  app.decorate('live', new LiveHub());
  app.decorateRequest('user', null);
  app.decorateRequest('touched', null);
  app.addHook('onClose', async () => app.live.close());

  // Suit les manifestations modifiées pendant la requête ; le signal part après l'envoi de la réponse, c'est-à-dire
  // après la validation de la transaction.
  app.addHook('onRequest', (req, _reply, done) => {
    req.touched = runWithTracking(done);
  });
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode < 400) for (const id of req.touched ?? []) app.live.publish(id);
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: deps.config.maxGpxBytes, files: 1 } });
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    // Les serveurs de tuiles OSM refusent (403) les requêtes sans Referer : on n'envoie que l'origine du site
    // aux tiers. Les pages dont l'URL porte un jeton (invitations) n'envoient aucun Referer.
    reply.header('referrer-policy', SENSITIVE_PATH.test(req.url) ? 'no-referrer' : 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'DENY');
    if (!req.url.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');
    // Protection CSRF complémentaire au cookie SameSite : un formulaire d'un autre site ne peut pas
    // ajouter cet en-tête.
    // /api/owntracks : application mobile authentifiée par identifiant de suivi (Basic), sans cookie ni en-tête CSRF.
    const owntracks = req.url.split('?')[0] === '/api/owntracks';
    if (!owntracks && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'cortege') {
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
  await app.register(roadbookRoutes);
  await app.register(invitationRoutes);
  await app.register(terrainRoutes);
  await app.register(owntracksRoutes);
  await app.register(loginLinkRoutes);
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
