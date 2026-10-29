// Positions partagées et arrivée automatique au point, communes au partage par le navigateur et à OwnTracks.
import { audit } from '../audit.js';
import type { Client } from '../db.js';
import type { Position } from '../geo/route.js';

/** Distance (m) au point de mission en deçà de laquelle l'arrivée est enregistrée automatiquement. */
export const ARRIVAL_RADIUS = 30;
/** Précision GPS minimale (m) pour l'arrivée automatique. */
export const ARRIVAL_MAX_ACCURACY = 50;
/** Une position plus ancienne n'est plus affichée. */
export const POSITION_MAX_AGE = '10 minutes';

export interface Arrival { missionId: number; pointName: string }

/** Conserve la dernière position du membre (aucun historique). */
export async function storePosition(c: Client, p: {
  userId: number; eventId: number; teamId: number; position: Position; accuracy: number | null; source: 'web' | 'owntracks'; battery?: number | null;
}): Promise<void> {
  await c.query(
    `INSERT INTO member_locations(user_id, event_id, team_id, geom, accuracy_m, updated_at, source, battery)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, now(), $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET event_id = EXCLUDED.event_id, team_id = EXCLUDED.team_id, geom = EXCLUDED.geom,
                                         accuracy_m = EXCLUDED.accuracy_m, updated_at = now(), source = EXCLUDED.source,
                                         battery = EXCLUDED.battery`,
    [p.userId, p.eventId, p.teamId, p.position[0], p.position[1], p.accuracy, p.source, p.battery ?? null],
  );
}

/**
 * Arrivée automatique : la mission en cours de l'équipe (première non terminée) passe « en position » si le membre
 * est à moins de ARRIVAL_RADIUS du point (avec une précision suffisante), ou s'il est entré dans la zone de ce point
 * (`zoneMissionId`, signalé par OwnTracks).
 */
export async function detectArrival(c: Client, p: {
  userId: number; eventId: number; teamId: number; position: Position | null; accuracy: number | null; zoneMissionId?: number | null;
}): Promise<Arrival | null> {
  const kind = (await c.query('SELECT kind FROM teams WHERE id = $1', [p.teamId])).rows[0]?.kind;
  if (kind !== 'points') return null;
  const m = (await c.query(
    `SELECT m.id, m.status, p.name,
            CASE WHEN $2::float8 IS NULL THEN NULL ELSE ST_DistanceSphere(p.geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)) END AS d
       FROM missions m JOIN mission_points p ON p.id = m.mission_point_id
      WHERE m.team_id = $1 AND m.cancelled_at IS NULL AND m.status <> 'terminee'
      ORDER BY m.position LIMIT 1 FOR UPDATE OF m`,
    [p.teamId, p.position?.[0] ?? null, p.position?.[1] ?? null],
  )).rows[0];
  if (!m || (m.status !== 'affectee' && m.status !== 'en_deplacement')) return null;
  const near = m.d !== null && m.d <= ARRIVAL_RADIUS && (p.accuracy === null || p.accuracy <= ARRIVAL_MAX_ACCURACY);
  const inZone = p.zoneMissionId === m.id;
  if (!near && !inZone) return null;
  await c.query(
    "UPDATE missions SET status = 'en_position', version = version + 1, updated_at = now(), status_changed_at = now(), status_changed_by = $2 WHERE id = $1",
    [m.id, p.userId],
  );
  await audit(c, { actorId: p.userId, eventId: p.eventId, entity: 'mission', entityId: m.id, action: 'statut', details: { from: m.status, to: 'en_position', auto: true } });
  return { missionId: m.id, pointName: m.name };
}

/** Le compte fait-il vraiment partie de l'équipe (membre ou responsable désigné), équipe active ? */
export async function isTeamMember(c: Client, userId: number, teamId: number): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM teams t WHERE t.id = $1 AND t.disabled_at IS NULL
        AND (t.leader_user_id = $2 OR EXISTS (SELECT 1 FROM team_memberships m WHERE m.team_id = t.id AND m.user_id = $2))`,
    [teamId, userId],
  );
  return !!r.rowCount;
}
