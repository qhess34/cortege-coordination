// Vérification côté serveur des droits sur un événement. Toute route qui touche un événement passe par ici.
import type { SessionUser } from './auth.js';
import type { Client } from './db.js';
import { forbidden, notFound } from './errors.js';

export type EventRole = 'organisateur' | 'responsable' | 'membre';

/** Rôle effectif sur l'événement : un administrateur est organisateur de tous les événements. */
export async function eventRole(c: Client, user: SessionUser, eventId: number): Promise<EventRole | null> {
  const ev = await c.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
  if (!ev.rowCount) return null;
  if (user.globalRole === 'admin') return 'organisateur';
  // Un participant n'a accès qu'à son équipe, par les routes /api/moi/… : rien de la manifestation entière.
  if (user.accountType === 'participant') return null;
  const r = await c.query('SELECT role FROM event_memberships WHERE event_id = $1 AND user_id = $2', [eventId, user.id]);
  return (r.rows[0]?.role as EventRole | undefined) ?? null;
}

/**
 * Exige un accès à l'événement. Un événement inaccessible répond 404 (comme s'il n'existait pas) pour ne rien
 * révéler ; un accès insuffisant répond 403.
 */
export async function requireEventRole(c: Client, user: SessionUser, eventId: number, needed: 'lecture' | 'organisation'): Promise<EventRole> {
  const role = await eventRole(c, user, eventId);
  if (!role) throw notFound('Événement');
  if (needed === 'organisation' && role !== 'organisateur') throw forbidden();
  return role;
}

/** Retrouve l'événement d'une entité, puis vérifie l'accès. */
export async function requireEntityAccess(
  c: Client,
  user: SessionUser,
  table: 'mission_points' | 'map_suggestions' | 'teams' | 'missions',
  id: number,
  needed: 'lecture' | 'organisation',
): Promise<number> {
  const r = await c.query('SELECT event_id FROM ' + table + ' WHERE id = $1', [id]);
  const eventId = r.rows[0]?.event_id as number | undefined;
  if (eventId === undefined) throw notFound();
  try {
    await requireEventRole(c, user, eventId, needed);
  } catch (e) {
    if (e instanceof Error && 'status' in e && (e as { status: number }).status === 404) throw notFound();
    throw e;
  }
  return eventId;
}

export function requireAdmin(user: SessionUser): void {
  if (user.globalRole !== 'admin') throw forbidden();
}

export function requireCanCreateEvent(user: SessionUser): void {
  if (user.globalRole !== 'admin' && user.globalRole !== 'organisateur') throw forbidden();
}

/**
 * Gestion d'une équipe (invitations, admissions, membres) : organisateur de la manifestation, ou responsable de
 * l'équipe si l'organisateur le lui permet. Renvoie l'événement et le rôle de gestion.
 */
export async function requireTeamManager(c: Client, user: SessionUser, teamId: number): Promise<{ eventId: number; asOrganizer: boolean }> {
  const t = (await c.query('SELECT event_id, leader_user_id, leader_can_invite FROM teams WHERE id = $1', [teamId])).rows[0];
  if (!t) throw notFound('Équipe');
  if ((await eventRole(c, user, t.event_id)) === 'organisateur') return { eventId: t.event_id, asOrganizer: true };
  if (t.leader_can_invite) {
    const leader = t.leader_user_id === user.id ||
      !!(await c.query("SELECT 1 FROM team_memberships WHERE team_id = $1 AND user_id = $2 AND role = 'responsable'", [teamId, user.id])).rowCount;
    if (leader) return { eventId: t.event_id, asOrganizer: false };
  }
  // Rien ne doit indiquer l'existence de l'équipe à qui n'y a pas accès.
  const visible = user.accountType === 'participant'
    ? !!(await c.query('SELECT 1 FROM team_memberships WHERE team_id = $1 AND user_id = $2', [teamId, user.id])).rowCount
    : (await eventRole(c, user, t.event_id)) !== null;
  if (!visible) throw notFound('Équipe');
  throw forbidden();
}
