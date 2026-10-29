// Suppression automatique des comptes arrivés à leur date d'expiration (fixée par un administrateur).
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import { tx } from '../db.js';

/** Supprime les comptes expirés ; renvoie leur nombre. Les données liées suivent les règles de la base (cascade). */
export async function purgeExpiredAccounts(app: FastifyInstance): Promise<number> {
  return tx(app.db, async (c) => {
    const r = await c.query("DELETE FROM users WHERE expires_at IS NOT NULL AND expires_at <= now() AND global_role <> 'admin' RETURNING id, global_role");
    for (const u of r.rows) {
      await audit(c, { actorId: null, eventId: null, entity: 'user', entityId: u.id, action: 'suppression_automatique', details: { globalRole: u.global_role } });
    }
    return r.rowCount ?? 0;
  });
}

/** Vérifie au démarrage puis toutes les heures. */
export function scheduleAccountPurge(app: FastifyInstance, everyMs = 3600_000): void {
  const run = () => purgeExpiredAccounts(app).then((n) => { if (n) app.log.info({ n }, 'comptes expirés supprimés'); }, (e) => app.log.error(e));
  void run();
  const t = setInterval(run, everyMs);
  t.unref();
  app.addHook('onClose', async () => clearInterval(t));
}
