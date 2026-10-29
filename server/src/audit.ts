import type { Client } from './db.js';

/** Journal des modifications importantes. Ne jamais y mettre de secret (mot de passe, jeton, lien). */
export async function audit(
  c: Client,
  entry: { actorId: number | null; eventId: number | null; entity: string; entityId: number | null; action: string; details?: unknown },
): Promise<void> {
  await c.query(
    'INSERT INTO audit_logs(actor_id, event_id, entity, entity_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)',
    [entry.actorId, entry.eventId, entry.entity, entry.entityId, entry.action, JSON.stringify(entry.details ?? {})],
  );
}
