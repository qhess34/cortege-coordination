// Mots de passe (scrypt) et sessions par cookie HttpOnly. Seul le hash du jeton de session est stocké.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Client } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = 'cortege_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Calcul effectué même sans compte, pour ne pas révéler par le temps de réponse qu'un identifiant existe.
  const parts = (stored ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, key] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return stored !== null && timingSafeEqual(actual, expected);
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest();

export interface SessionUser {
  sessionId: number;
  id: number;
  login: string | null;
  displayName: string;
  globalRole: 'admin' | 'organisateur' | 'aucun';
  /** « participant » : personne admise par invitation, sans identifiant ni mot de passe. */
  accountType: 'compte' | 'participant';
  /** Manifestation d'un participant (null pour un compte administré). */
  eventId: number | null;
}

export async function createSession(c: Client, userId: number, ttlHours: number, userAgent?: string): Promise<string> {
  return createSessionUntil(c, userId, new Date(Date.now() + ttlHours * 3600_000), userAgent);
}

/** Session valable jusqu'à une date donnée (participants : jusqu'au lendemain de la manifestation). */
export async function createSessionUntil(c: Client, userId: number, expiresAt: Date, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await c.query('INSERT INTO sessions(token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)', [
    hashToken(token), userId, expiresAt, userAgent?.slice(0, 300) ?? null,
  ]);
  return token;
}

/** Session valide (non expirée, non révoquée, compte actif). Prolonge l'expiration (glissante). */
export async function loadSession(c: Client, token: string, ttlHours: number): Promise<SessionUser | null> {
  const r = await c.query(
    `UPDATE sessions s SET last_seen_at = now(),
            expires_at = greatest(s.expires_at, now() + make_interval(hours => $2))
       FROM users u
      WHERE s.token_hash = $1 AND u.id = s.user_id
        AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL
      RETURNING s.id AS session_id, u.id, u.login, u.display_name, u.global_role, u.account_type, u.event_id`,
    [hashToken(token), ttlHours],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id, id: row.id, login: row.login, displayName: row.display_name, globalRole: row.global_role,
    accountType: row.account_type, eventId: row.event_id,
  };
}

export async function revokeSession(c: Client, sessionId: number): Promise<void> {
  await c.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
}

export async function revokeUserSessions(c: Client, userId: number): Promise<number> {
  const r = await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  return r.rowCount ?? 0;
}
