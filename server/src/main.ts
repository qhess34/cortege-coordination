import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { scheduleAccountPurge } from './services/expiry.js';
import { overpassFetcher } from './services/overpass.js';
import { osrmRouter } from './services/routing.js';
import { smtpMailer } from './services/mailer.js';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const applied = await migrate(db);
const app = await buildApp({ db, config, osm: overpassFetcher(config.overpassUrls, config.userAgent),
  router: config.routingUrl ? osrmRouter(config.routingUrl, config.userAgent) : null,
  mailer: config.smtpUrl ? smtpMailer(config.smtpUrl, config.mailFrom) : null,
  logger: true,
 });
if (applied.length) app.log.info({ applied }, 'migrations appliquées');
scheduleAccountPurge(app);

// En production, le serveur distribue aussi l'interface compilée (web/dist).
if (config.webDist && existsSync(config.webDist)) {
  const root = resolve(config.webDist);
  await app.register(fastifyStatic, { root, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Route inconnue.' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: config.port, host: config.host });
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
