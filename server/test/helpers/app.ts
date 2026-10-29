// Application de test sur une vraie base PostGIS (TEST_DATABASE_URL), réinitialisée à chaque fichier.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth.js';
import type { Config } from '../../src/config.js';
import { createPool, type Db } from '../../src/db.js';
import type { OverpassResponse } from '../../src/geo/osm-analysis.js';
import { migrate } from '../../src/migrate.js';
import { resetLoginFailures } from '../../src/routes/auth.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://cortege:cortege@localhost:5432/cortege_test';

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  /** Réponse Overpass renvoyée par le faux client ; modifiable entre deux analyses. */
  osm: { data: OverpassResponse; queries: string[]; fail: Error | null; respond: ((query: string, n: number) => OverpassResponse) | null };
  close: () => Promise<void>;
}

export async function setup(): Promise<TestContext> {
  const db = createPool(TEST_DB);
  await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  resetLoginFailures();
  const config: Config = {
    port: 0, host: '127.0.0.1', databaseUrl: TEST_DB, cookieSecure: false, sessionTtlHours: 12,
    overpassUrls: ['http://overpass.test'], userAgent: 'test', maxGpxBytes: 1024 * 1024, webDist: null,
  };
  const osm: TestContext['osm'] = { data: { elements: [] }, queries: [], fail: null, respond: null };
  const app = await buildApp({
    db,
    config,
    osm: async (q) => {
      osm.queries.push(q);
      if (osm.fail) throw osm.fail;
      return structuredClone(osm.respond ? osm.respond(q, osm.queries.length) : osm.data);
    },
  });
  return { app, db, osm, close: async () => { await app.close(); await db.end(); } };
}

export async function createUser(db: Db, login: string, globalRole: 'admin' | 'organisateur' | 'aucun', password = 'mot-de-passe-solide'): Promise<number> {
  const r = await db.query('INSERT INTO users(login, display_name, password_hash, global_role) VALUES ($1, $1, $2, $3) RETURNING id', [
    login, await hashPassword(password), globalRole,
  ]);
  return r.rows[0].id;
}

/** Client HTTP de test qui conserve le cookie de session. */
export class Agent {
  cookie: string | null = null;
  constructor(private app: FastifyInstance) {}

  async login(login: string, password = 'mot-de-passe-solide'): Promise<LightMyRequestResponse> {
    const res = await this.request('POST', '/api/auth/login', { login, password });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) this.cookie = raw.split(';')[0]!;
    return res;
  }

  request(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) {
    return this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { 'x-requested-with': 'cortege', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body?: unknown) => this.request('POST', url, body ?? {});
  patch = (url: string, body: unknown) => this.request('PATCH', url, body);
  put = (url: string, body: unknown) => this.request('PUT', url, body);
  delete = (url: string) => this.request('DELETE', url);

  /** Envoi d'un fichier GPX en multipart. */
  upload(url: string, content: string, filename = 'parcours.gpx') {
    const boundary = '----cortege' + Math.random().toString(16).slice(2);
    const payload =
      '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: application/gpx+xml\r\n\r\n' +
      content + '\r\n--' + boundary + '--\r\n';
    return this.app.inject({
      method: 'POST',
      url,
      payload,
      headers: {
        'content-type': 'multipart/form-data; boundary=' + boundary,
        'x-requested-with': 'cortege',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
    });
  }
}
