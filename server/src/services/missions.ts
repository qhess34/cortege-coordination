import type { Client } from '../db.js';

/** Renumérote les missions actives d'une équipe 1, 2, 3… sans heurter l'index d'unicité (team_id, position). */
export async function compactTeam(c: Client, teamId: number): Promise<void> {
  await c.query(
    `UPDATE missions m SET position = s.rn + 1000000
       FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS rn FROM missions WHERE team_id = $1 AND cancelled_at IS NULL) s
      WHERE m.id = s.id`,
    [teamId],
  );
  await c.query('UPDATE missions SET position = position - 1000000 WHERE team_id = $1 AND cancelled_at IS NULL', [teamId]);
}
