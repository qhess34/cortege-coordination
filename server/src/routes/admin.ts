// Gestion des comptes, réservée aux administrateurs.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { hashPassword, revokeUserSessions } from '../auth.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { fullName } from './members.js';
import { createLoginLink, publicBase } from './login-links.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { requireAdmin } from '../permissions.js';

const Role = z.enum(['admin', 'organisateur', 'membre', 'aucun']);
const Login = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,64}$/, 'Identifiant : 3 à 64 caractères a-z, 0-9, . _ -');
const Email = z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(200);
const Name = z.string().trim().max(80);
/** Date d'expiration facultative : le compte est supprimé automatiquement passé cette date. */
const Expiry = z.iso.datetime({ offset: true }).nullable();
const CreateUser = z.object({
  globalRole: Role.default('membre'),
  firstName: Name.default(''),
  lastName: Name.default(''),
  /** Nom affiché si prénom et nom sont vides (ex. « Pharmacie de la gare »). */
  displayName: z.string().trim().max(120).default(''),
  email: Email.nullable().default(null),
  login: Login.nullable().default(null),
  password: z.string().min(12, 'Mot de passe : 12 caractères minimum.').max(200).nullable().default(null),
  expiresAt: Expiry.default(null),
}).superRefine((b, ctx) => {
  // Un membre se connecte par lien ; les comptes d'organisation ont un identifiant et un mot de passe.
  if (b.globalRole !== 'membre' && (!b.login || !b.password)) ctx.addIssue({ code: 'custom', path: ['login'], message: 'Identifiant et mot de passe obligatoires pour un compte d’organisation.' });
  if (!fullName(b.firstName, b.lastName, b.displayName)) ctx.addIssue({ code: 'custom', path: ['firstName'], message: 'Indiquez au moins un prénom ou un nom.' });
});
const UpdateUser = z.object({
  firstName: Name.optional(),
  lastName: Name.optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(12).max(200).optional(),
  globalRole: Role.optional(),
  disabled: z.boolean().optional(),
  /** Adresse e-mail (liens de connexion) ; null pour l'effacer. */
  email: Email.nullable().optional(),
  expiresAt: Expiry.optional(),
});

const publicUser = (r: Record<string, unknown>) => ({
  id: r.id, login: r.login, displayName: r.display_name, firstName: r.first_name, lastName: r.last_name, globalRole: r.global_role,
  disabledAt: r.disabled_at, createdAt: r.created_at, email: r.email ?? null, expiresAt: r.expires_at ?? null,
});

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', async (req) => {
    requireAdmin(requireUser(req));
    const r = await app.db.query("SELECT * FROM users ORDER BY (global_role = 'membre'), display_name");
    return r.rows.map(publicUser);
  });

  app.post('/api/admin/users', async (req, reply) => {
    const me = requireUser(req);
    requireAdmin(me);
    const b = CreateUser.parse(req.body);
    const member = b.globalRole === 'membre';
    const hash = !member && b.password ? await hashPassword(b.password) : null;
    const display = fullName(b.firstName, b.lastName, b.displayName).slice(0, 120);
    return tx(app.db, async (c) => {
      const r = await c.query(
        `INSERT INTO users(login, display_name, first_name, last_name, password_hash, global_role, created_by, email, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [b.login, display, b.firstName, b.lastName, hash, b.globalRole, me.id, b.email, b.expiresAt],
      ).catch((e: { code?: string }) => { if (e.code === '23505') throw conflict('Cet identifiant ou cette adresse e-mail existe déjà.'); throw e; });
      const user = r.rows[0];
      await audit(c, { actorId: me.id, eventId: null, entity: 'user', entityId: user.id, action: 'creation', details: { globalRole: b.globalRole, expiresAt: b.expiresAt } });
      // Membre : lien d'activation (connexion sans mot de passe) à lui transmettre.
      const link = member ? await createLoginLink(c, user.id, 'admin', me.id) : null;
      reply.status(201);
      return { ...publicUser(user), activation: link ? { ...link, url: publicBase(app, req) + link.path } : null };
    });
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const me = requireUser(req);
    requireAdmin(me);
    const id = idParam(req);
    const b = UpdateUser.parse(req.body);
    return tx(app.db, async (c) => {
      const cur = (await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw notFound('Compte');
      if (id === me.id && (b.disabled || (b.globalRole && b.globalRole !== 'admin') || b.expiresAt)) {
        throw conflict('Un administrateur ne peut pas se désactiver, se donner une expiration ni se retirer ses propres droits.');
      }
      if (b.globalRole && b.globalRole !== 'membre' && !cur.login) throw conflict('Donnez d’abord un identifiant à ce compte (comptes d’organisation).');
      const first = b.firstName ?? cur.first_name;
      const last = b.lastName ?? cur.last_name;
      const display = (b.firstName !== undefined || b.lastName !== undefined ? fullName(first, last, cur.display_name) : b.displayName ?? cur.display_name).slice(0, 120);
      const hash = b.password ? await hashPassword(b.password) : null;
      const r = await c.query(
        `UPDATE users SET display_name = $2, first_name = $3, last_name = $4, password_hash = coalesce($5, password_hash),
                global_role = coalesce($6, global_role),
                disabled_at = CASE WHEN $7::boolean IS NULL THEN disabled_at WHEN $7 THEN coalesce(disabled_at, now()) ELSE NULL END,
                email = CASE WHEN $8::boolean THEN $9 ELSE email END,
                expires_at = CASE WHEN $10::boolean THEN $11::timestamptz ELSE expires_at END
          WHERE id = $1 RETURNING *`,
        [id, display, first, last, hash, b.globalRole ?? null, b.disabled ?? null, b.email !== undefined, b.email ?? null, b.expiresAt !== undefined, b.expiresAt ?? null],
      ).catch((e: { code?: string }) => { if (e.code === '23505') throw conflict('Cette adresse e-mail est déjà utilisée.'); throw e; });
      // Désactivation ou changement de mot de passe : sessions et liens de connexion révoqués immédiatement.
      if (b.disabled || b.password) {
        await revokeUserSessions(c, id);
        await c.query('UPDATE login_links SET used_at = coalesce(used_at, now()) WHERE user_id = $1', [id]);
      }
      // Un compte devenu « membre » perd l'accès à l'organisation des manifestations.
      if (b.globalRole === 'membre') await c.query('DELETE FROM event_memberships WHERE user_id = $1', [id]);
      await audit(c, {
        actorId: me.id, eventId: null, entity: 'user', entityId: id, action: 'modification',
        details: { globalRole: b.globalRole, disabled: b.disabled, passwordChanged: !!b.password, emailChanged: b.email !== undefined, expiresAt: b.expiresAt },
      });
      return publicUser(r.rows[0]);
    });
  });

  // Suppression immédiate d'un compte (sinon automatique à sa date d'expiration).
  app.delete('/api/admin/users/:id', async (req) => {
    const me = requireUser(req);
    requireAdmin(me);
    const id = idParam(req);
    if (id === me.id) throw conflict('Vous ne pouvez pas supprimer votre propre compte.');
    return tx(app.db, async (c) => {
      const r = await c.query('DELETE FROM users WHERE id = $1 RETURNING global_role', [id]);
      if (!r.rowCount) throw notFound('Compte');
      await audit(c, { actorId: me.id, eventId: null, entity: 'user', entityId: id, action: 'suppression', details: { globalRole: r.rows[0].global_role } });
      return { ok: true };
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
        WHERE global_role <> 'membre' AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND (login ILIKE $1 OR display_name ILIKE $1)
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
