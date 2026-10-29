// Gestion des comptes, réservée aux administrateurs.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { hashPassword, revokeUserSessions } from '../auth.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { requireAdmin } from '../permissions.js';

const Role = z.enum(['admin', 'organisateur', 'aucun']);
const CreateUser = z.object({
  login: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,64}$/, 'Identifiant : 3 à 64 caractères a-z, 0-9, . _ -'),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12, 'Mot de passe : 12 caractères minimum.').max(200),
  globalRole: Role.default('aucun'),
});
const UpdateUser = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(12).max(200).optional(),
  globalRole: Role.optional(),
  disabled: z.boolean().optional(),
});

const publicUser = (r: Record<string, unknown>) => ({
  id: r.id, login: r.login, displayName: r.display_name, globalRole: r.global_role, disabledAt: r.disabled_at, createdAt: r.created_at,
});

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', async (req) => {
    requireAdmin(requireUser(req));
    const r = await app.db.query("SELECT * FROM users WHERE account_type = 'compte' ORDER BY login");
    return r.rows.map(publicUser);
  });

  app.post('/api/admin/users', async (req, reply) => {
    const me = requireUser(req);
    requireAdmin(me);
    const b = CreateUser.parse(req.body);
    const hash = await hashPassword(b.password);
    try {
      const r = await app.db.query(
        'INSERT INTO users(login, display_name, password_hash, global_role, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [b.login, b.displayName, hash, b.globalRole, me.id],
      );
      await audit(app.db, { actorId: me.id, eventId: null, entity: 'user', entityId: r.rows[0].id, action: 'creation', details: { login: b.login, globalRole: b.globalRole } });
      return reply.status(201).send(publicUser(r.rows[0]));
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('Cet identifiant existe déjà.');
      throw e;
    }
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const me = requireUser(req);
    requireAdmin(me);
    const id = idParam(req);
    const b = UpdateUser.parse(req.body);
    return tx(app.db, async (c) => {
      const cur = (await c.query("SELECT * FROM users WHERE id = $1 AND account_type = 'compte' FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound('Compte');
      if (id === me.id && (b.disabled || (b.globalRole && b.globalRole !== 'admin'))) {
        throw conflict('Un administrateur ne peut pas se désactiver ni se retirer ses propres droits.');
      }
      const hash = b.password ? await hashPassword(b.password) : null;
      const r = await c.query(
        `UPDATE users SET display_name = coalesce($2, display_name), password_hash = coalesce($3, password_hash),
                global_role = coalesce($4, global_role),
                disabled_at = CASE WHEN $5::boolean IS NULL THEN disabled_at WHEN $5 THEN coalesce(disabled_at, now()) ELSE NULL END
          WHERE id = $1 RETURNING *`,
        [id, b.displayName ?? null, hash, b.globalRole ?? null, b.disabled ?? null],
      );
      // Désactivation ou changement de mot de passe : les sessions ouvertes sont révoquées immédiatement.
      if (b.disabled || b.password) await revokeUserSessions(c, id);
      await audit(c, {
        actorId: me.id, eventId: null, entity: 'user', entityId: id, action: 'modification',
        details: { displayName: b.displayName, globalRole: b.globalRole, disabled: b.disabled, passwordChanged: !!b.password },
      });
      return publicUser(r.rows[0]);
    });
  });

  // Annuaire des comptes actifs, pour qu'un organisateur donne accès à sa manifestation à un compte existant.
  // Il ne permet ni de créer ni de modifier un compte.
  app.get('/api/annuaire', async (req) => {
    const me = requireUser(req);
    if (me.globalRole !== 'admin' && me.globalRole !== 'organisateur') throw forbidden();
    const q = z.object({ q: z.string().trim().max(60).default('') }).parse(req.query);
    const like = '%' + q.q.replace(/[%_\\]/g, '\\$&') + '%';
    const r = await app.db.query(
      `SELECT id, login, display_name FROM users
        WHERE account_type = 'compte' AND disabled_at IS NULL AND (login ILIKE $1 OR display_name ILIKE $1)
        ORDER BY display_name LIMIT 50`,
      [like],
    );
    return r.rows.map((x) => ({ id: x.id, login: x.login, displayName: x.display_name }));
  });

  app.post('/api/admin/users/:id/revoke-sessions', async (req) => {
    const me = requireUser(req);
    requireAdmin(me);
    const id = idParam(req);
    const n = await revokeUserSessions(app.db, id);
    await audit(app.db, { actorId: me.id, eventId: null, entity: 'user', entityId: id, action: 'revocation_sessions', details: { count: n } });
    return { revoked: n };
  });
}
