// Types de SOS d'une manifestation : liste configurable par l'organisation, servie à la vue terrain.
// Les SOS eux-mêmes (signalements) sont gérés avec le reste du jour J dans routes/terrain.ts.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import { tx, type Client } from '../db.js';
import { notFound } from '../errors.js';
import { requireEventRole } from '../permissions.js';

/** Types de SOS proposés par défaut à la création d'une manifestation (modifiables ensuite). */
export const SOS_DEFAULT_TYPES = ['Besoin de renforts', 'Besoin de secours', 'Agression', 'Problème / blocage'];

/** Crée les types de SOS par défaut d'une nouvelle manifestation. */
export async function seedSosTypes(c: Client, eventId: number): Promise<void> {
  await c.query(
    `INSERT INTO sos_types(event_id, label, position)
       SELECT $1, label, ordinality FROM unnest($2::text[]) WITH ORDINALITY AS t(label, ordinality)`,
    [eventId, SOS_DEFAULT_TYPES],
  );
}

const labelField = z.string().trim().min(1, 'Nom obligatoire.').max(60, '60 caractères au plus.');
const typeIdParam = (req: { params: unknown }) => {
  const id = Number((req.params as { typeId?: string }).typeId);
  if (!Number.isInteger(id) || id < 1) throw notFound('Type de SOS');
  return id;
};

export async function sosRoutes(app: FastifyInstance) {
  // Types de SOS actifs, dans l'ordre d'affichage.
  app.get('/api/events/:id/sos-types', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const r = await app.db.query(
      'SELECT id, label, position FROM sos_types WHERE event_id = $1 AND archived_at IS NULL ORDER BY position, id',
      [eventId],
    );
    return r.rows.map((t) => ({ id: t.id, label: t.label, position: t.position }));
  });

  // Ajouter un type.
  app.post('/api/events/:id/sos-types', async (req, reply) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    const b = z.object({ label: labelField }).parse(req.body);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, eventId, 'organisation');
      const pos = (await c.query('SELECT coalesce(max(position), 0) + 1 AS p FROM sos_types WHERE event_id = $1 AND archived_at IS NULL', [eventId])).rows[0].p;
      const r = await c.query('INSERT INTO sos_types(event_id, label, position) VALUES ($1, $2, $3) RETURNING id', [eventId, b.label, pos]);
      await audit(c, { actorId: u.id, eventId, entity: 'sos_type', entityId: r.rows[0].id, action: 'ajout', details: { label: b.label } });
      reply.status(201);
      return { id: r.rows[0].id, label: b.label, position: pos };
    });
  });

  // Renommer ou déplacer un type.
  app.patch('/api/events/:id/sos-types/:typeId', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    const typeId = typeIdParam(req);
    const b = z.object({ label: labelField.optional(), position: z.number().int().min(1).optional() }).parse(req.body);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, eventId, 'organisation');
      const t = (await c.query('SELECT label, position FROM sos_types WHERE id = $1 AND event_id = $2 AND archived_at IS NULL FOR UPDATE', [typeId, eventId])).rows[0];
      if (!t) throw notFound('Type de SOS');
      const newLabel = b.label ?? t.label;
      const newPos = b.position ?? t.position;
      await c.query('UPDATE sos_types SET label = $2, position = $3 WHERE id = $1', [typeId, newLabel, newPos]);
      await audit(c, { actorId: u.id, eventId, entity: 'sos_type', entityId: typeId, action: 'modification', details: { label: newLabel } });
      return { id: typeId, label: newLabel, position: newPos };
    });
  });

  // Retirer un type (archivage : les SOS déjà signalés gardent leur libellé).
  app.delete('/api/events/:id/sos-types/:typeId', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    const typeId = typeIdParam(req);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, eventId, 'organisation');
      const r = await c.query('UPDATE sos_types SET archived_at = now() WHERE id = $1 AND event_id = $2 AND archived_at IS NULL RETURNING label', [typeId, eventId]);
      if (!r.rowCount) throw notFound('Type de SOS');
      await audit(c, { actorId: u.id, eventId, entity: 'sos_type', entityId: typeId, action: 'retrait', details: { label: r.rows[0].label } });
      return { ok: true };
    });
  });
}
