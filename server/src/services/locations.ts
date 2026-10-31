// Positions partagées et arrivée automatique au point, communes au partage par le navigateur et à OwnTracks.
import { audit } from '../audit.js';
import type { Client } from '../db.js';
import type { Position } from '../geo/route.js';
import { currentTrack } from './track.js';

/** Distance (m) au point de mission en deçà de laquelle l'arrivée est enregistrée automatiquement. */
export const ARRIVAL_RADIUS = 30;
/** Précision GPS minimale (m) pour l'arrivée automatique. */
export const ARRIVAL_MAX_ACCURACY = 50;
/** Une position plus ancienne n'est plus affichée. */
export const POSITION_MAX_AGE = '10 minutes';

/** Progression automatique : précision GPS minimale (m) et distance maximale au parcours (m). */
export const PROGRESS_MAX_ACCURACY = 100;
export const PROGRESS_MAX_OFFSET = 150;
/** Une nouvelle progression automatique n'est enregistrée qu'après ce délai (s) et ce déplacement (m). */
export const PROGRESS_MIN_INTERVAL_S = 60;
export const PROGRESS_MIN_MOVE = 20;

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
  // Point d'arrivée candidat : parmi les points encore à tenir (affectée ou en route), le plus proche de la
  // position (ou, pour OwnTracks, celui de la zone franchie). On ne prend plus le premier point du parcours :
  // sinon l'arrivée restait bloquée dessus une fois « en position » et les points suivants n'étaient jamais
  // détectés — le compteur « en position » de l'équipe ne dépassait jamais 1.
  const m = (await c.query(
    `SELECT m.id, m.status, p.name,
            CASE WHEN $2::float8 IS NULL THEN NULL ELSE ST_DistanceSphere(p.geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)) END AS d
       FROM missions m JOIN mission_points p ON p.id = m.mission_point_id
      WHERE m.team_id = $1 AND m.cancelled_at IS NULL AND m.status IN ('affectee', 'en_deplacement')
        AND ($4::int IS NULL OR m.id = $4)
      ORDER BY (CASE WHEN $4::int IS NOT NULL THEN 0 ELSE 1 END), d ASC NULLS LAST, m.position
      LIMIT 1 FOR UPDATE OF m`,
    [p.teamId, p.position?.[0] ?? null, p.position?.[1] ?? null, p.zoneMissionId ?? null],
  )).rows[0];
  if (!m) return null;
  const near = m.d !== null && m.d <= ARRIVAL_RADIUS && (p.accuracy === null || p.accuracy <= ARRIVAL_MAX_ACCURACY);
  const inZone = p.zoneMissionId != null && p.zoneMissionId === m.id;
  if (!near && !inZone) return null;
  await c.query(
    "UPDATE missions SET status = 'en_position', version = version + 1, updated_at = now(), status_changed_at = now(), status_changed_by = $2 WHERE id = $1",
    [m.id, p.userId],
  );
  await audit(c, { actorId: p.userId, eventId: p.eventId, entity: 'mission', entityId: m.id, action: 'statut', details: { from: m.status, to: 'en_position', auto: true } });
  return { missionId: m.id, pointName: m.name };
}

/**
 * Progression automatique du cortège à partir des positions partagées des équipes d'ouverture (tête) et de
 * fermeture (queue) : chaque position récente et assez précise est ramenée sur le parcours (sur une boucle, le passage
 * le plus proche de la progression précédente) ; la tête est la plus avancée, la queue la plus en arrière.
 * Enregistrée au plus une fois par minute, et seulement si elle a bougé. Sans auteur ni coordonnées : la progression
 * ne garde pas trace de la personne qui la porte. Retourne true si une progression a été enregistrée.
 */
export async function autoProgress(c: Client, p: { eventId: number; teamId: number }): Promise<boolean> {
  const kind = (await c.query('SELECT kind FROM teams WHERE id = $1', [p.teamId])).rows[0]?.kind;
  const part = kind === 'ouverture' ? 'tete' : kind === 'fermeture' ? 'queue' : null;
  if (!part) return false;
  const track = await currentTrack(c, p.eventId);
  if (!track) return false;
  // Verrou par manifestation et par partie : deux envois simultanés n'enregistrent pas deux progressions.
  await c.query('SELECT pg_advisory_xact_lock($1, $2)', [p.eventId, part === 'tete' ? 1 : 2]);
  const prev = (await c.query(
    `SELECT distance_m, extract(epoch FROM now() - created_at) AS age FROM event_progress
      WHERE event_id = $1 AND part = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [p.eventId, part],
  )).rows[0];
  if (prev && Number(prev.age) < PROGRESS_MIN_INTERVAL_S) return false;
  const rows = (await c.query(
    `SELECT ST_X(l.geom) AS lon, ST_Y(l.geom) AS lat FROM member_locations l JOIN teams t ON t.id = l.team_id
      WHERE l.event_id = $1 AND t.kind = $2 AND t.disabled_at IS NULL AND l.updated_at > now() - $3::interval
        AND (l.accuracy_m IS NULL OR l.accuracy_m <= $4)`,
    [p.eventId, kind, POSITION_MAX_AGE, PROGRESS_MAX_ACCURACY],
  )).rows;
  const ref = prev ? Number(prev.distance_m) : 0;
  const distances = rows.flatMap((r) => {
    const passages = track.route.passages([r.lon, r.lat], PROGRESS_MAX_OFFSET);
    if (!passages.length) return [];
    return [passages.reduce((a, b) => (Math.abs(b.distance - ref) < Math.abs(a.distance - ref) ? b : a)).distance];
  });
  if (!distances.length) return false;
  const distance = Math.round(part === 'tete' ? Math.max(...distances) : Math.min(...distances));
  if (prev && Math.abs(distance - ref) < PROGRESS_MIN_MOVE) return false;
  await c.query("INSERT INTO event_progress(event_id, distance_m, note, author_id, part) VALUES ($1, $2, 'automatique (positions)', NULL, $3)", [p.eventId, distance, part]);
  return true;
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
